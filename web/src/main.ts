import './style.css';
import { rotate90 } from './core/rotate.js';
import { downscale } from './core/resize.js';
import type { RgbImage } from './core/types.js';
import {
  detectLang,
  formatBytes,
  formatSeconds,
  strings,
  type Lang,
  type Strings,
} from './i18n.js';
import { ImageTooLargeError, decodePhoto, encodeImage, type DecodedPhoto } from './imageio.js';
import type { ScanRequest, ScanResponse, ScanStats } from './worker.js';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing element #${id}`);
  return element as T;
};

/** Long edge of the little previews in the orientation picker. */
const THUMB_EDGE = 200;

interface Settings {
  format: 'jpeg' | 'png';
  maxLongEdge: number | null;
  margin: number;
  autoTrim: boolean;
}

const settings: Settings = {
  format: 'jpeg',
  maxLongEdge: null,
  margin: 0,
  autoTrim: true,
};

let lang: Lang = detectLang();
let t: Strings = strings(lang);

let photo: DecodedPhoto | null = null;
let fileName = 'photo';
let requestId = 0;
let busy = false;
/** The page quad in source pixels, photo order — this is what the drag handles move. */
let corners: number[] | null = null;
/** True once the user has dragged a corner, which stops the detector overwriting it. */
let manualCorners = false;
let dragging = -1;

/** The pipeline's output, always in the detection orientation (reading edge "top"). */
let baseResult: RgbImage | null = null;
/** `baseResult` rotated by `turns` quarter turns clockwise — what is on screen. */
let turns = 0;
let displayed: RgbImage | null = null;

let lastStats: ScanStats | null = null;
let afterUrl: string | null = null;
let thumbUrls: string[] = [];

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
worker.onmessage = (event: MessageEvent<ScanResponse>) => {
  void handleWorkerMessage(event.data);
};

/* ------------------------------------------------------------------ language */

function applyLanguage(): void {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
  document.title = `${t.title} — ${t.tagline}`;

  $('title').textContent = t.title;
  $('tagline').textContent = t.tagline;
  $('privacy').textContent = t.privacy;

  $('dropTitle').textContent = t.dropTitle;
  $('dropHint').textContent = t.dropHint;
  $('choose').textContent = t.choose;

  $('beforeLabel').textContent = t.before;
  $('afterLabel').textContent = t.after;
  $('cornerHint').textContent = t.cornerHint;
  $('resetCorners').textContent = t.resetCorners;
  $('download').textContent = t.download;
  $('again').textContent = t.again;
  $('advancedLabel').textContent = t.advanced;
  $('orientationLabel').textContent = t.orientation;
  $('orientationHint').textContent = t.orientationHint;

  $('formatLabel').textContent = t.format;
  $('formatJpeg').textContent = t.formatJpeg;
  $('formatPng').textContent = t.formatPng;
  $('maxSizeLabel').textContent = t.maxSize;
  $('maxSizeOriginal').textContent = t.sizeOriginal;
  $('marginLabel').textContent = t.margin;
  $('marginNone').textContent = t.marginNone;
  $('marginSmall').textContent = t.marginSmall;
  $('marginMedium').textContent = t.marginMedium;

  $('retry').textContent = t.retry;
  $('footer').textContent = t.footer;
  $('lang').textContent = lang === 'zh' ? 'EN' : '中文';

  if (lastStats && displayed) {
    renderStats(lastStats, displayed, 0);
  }
}

$('lang').addEventListener('click', () => {
  lang = lang === 'zh' ? 'en' : 'zh';
  t = strings(lang);
  applyLanguage();
});

/* -------------------------------------------------------------------- views */

function show(which: 'picker' | 'working' | 'result' | 'error'): void {
  for (const id of ['picker', 'working', 'result', 'error'] as const) {
    $(id).hidden = id !== which;
  }
}

function stageText(stage: string): void {
  const map: Record<string, string> = {
    detect: t.stageDetect,
    rectify: t.stageRectify,
    balance: t.stageBalance,
    frame: t.stageFrame,
    trim: t.stageTrim,
  };
  $('stage').textContent = map[stage] ?? t.working;
}

/* --------------------------------------------------------------------- input */

const picker = $('picker');
const fileInput = $<HTMLInputElement>('file');

$('choose').addEventListener('click', (event) => {
  event.stopPropagation();
  fileInput.click();
});

picker.addEventListener('click', () => fileInput.click());
picker.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    fileInput.click();
  }
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void acceptFile(file);
  fileInput.value = '';
});

for (const type of ['dragenter', 'dragover'] as const) {
  document.addEventListener(type, (event) => {
    event.preventDefault();
    if (!busy) document.body.classList.add('dragging');
  });
}

for (const type of ['dragleave', 'dragend'] as const) {
  document.addEventListener(type, () => document.body.classList.remove('dragging'));
}

document.addEventListener('drop', (event) => {
  event.preventDefault();
  document.body.classList.remove('dragging');
  const file = event.dataTransfer?.files?.[0];
  if (file && !busy) void acceptFile(file);
});

document.addEventListener('paste', (event) => {
  if (busy) return;
  const item = Array.from(event.clipboardData?.items ?? []).find((i) => i.type.startsWith('image/'));
  const file = item?.getAsFile();
  if (file) void acceptFile(file);
});

$('again').addEventListener('click', reset);
$('retry').addEventListener('click', reset);

/* ------------------------------------------------------------------ pipeline */

async function acceptFile(file: File): Promise<void> {
  if (busy) return;
  busy = true;
  show('working');
  stageText('detect');
  releaseUrls();

  try {
    photo = await decodePhoto(file);
    fileName = file.name.replace(/\.[^.]+$/, '') || 'photo';
    corners = null;
    manualCorners = false;
    lastStats = null;
    baseResult = null;
    displayed = null;
    turns = 0;

    $<HTMLImageElement>('beforeImg').src = photo.previewUrl;
    await startScan();
  } catch (error) {
    busy = false;
    showError(error);
  }
}

async function startScan(): Promise<void> {
  scansStarted++;
  if (!photo) return;

  busy = true;
  show('working');
  stageText('detect');

  const id = ++requestId;

  // The worker takes ownership of the buffer, so hand it a copy: the main thread keeps the
  // original so that changing the margin or the output size does not mean decoding again.
  const copy = photo.image.data.slice();
  const request: ScanRequest = {
    id,
    data: copy.buffer as ArrayBuffer,
    width: photo.image.width,
    height: photo.image.height,
    corners: manualCorners && corners ? corners : null,
    // Always rectify in the detection orientation; the picker below rotates the finished
    // scan, which is one cheap pass instead of a whole extra pipeline run.
    readingEdge: 'top',
    autoTrim: settings.autoTrim,
    margin: settings.margin,
    maxLongEdge: settings.maxLongEdge,
  };
  worker.postMessage(request, [request.data]);
}

async function handleWorkerMessage(message: ScanResponse): Promise<void> {
  if (message.id !== requestId) return;

  if (message.type === 'progress') {
    stageText(message.stage);
    return;
  }

  if (message.type === 'error') {
    busy = false;
    if (message.noPage) {
      showMessage(t.errNoPage);
    } else {
      showMessage(`${t.errGeneric} ${message.message}`);
    }
    return;
  }

  baseResult = {
    data: new Uint8Array(message.data),
    width: message.width,
    height: message.height,
  };

  // Keep whatever the user dragged; only take the detector's answer when they have not.
  if (!message.manualCorners) {
    corners = message.paperQuad;
    manualCorners = false;
  }

  lastStats = message.stats;
  turns = 0;

  await applyOrientation(0);
  await buildOrientationChoices();

  drawOverlay();
  busy = false;
  show('result');
}

/* --------------------------------------------------------------- orientation */

/**
 * Rotates the finished scan and publishes it: the big preview, the download link and the
 * stats all follow whichever quarter turn is selected.
 */
async function applyOrientation(next: number): Promise<void> {
  if (!baseResult) return;

  turns = ((next % 4) + 4) % 4;
  const rotated = rotate90(baseResult, turns);
  displayed = rotated;

  const blob = await encodeImage(rotated, settings.format, 0.92);
  if (afterUrl) URL.revokeObjectURL(afterUrl);
  afterUrl = URL.createObjectURL(blob);

  $<HTMLImageElement>('afterImg').src = afterUrl;

  const download = $<HTMLAnchorElement>('download');
  download.href = afterUrl;
  download.download = `${fileName}-scan.${settings.format === 'png' ? 'png' : 'jpg'}`;

  if (lastStats) renderStats(lastStats, rotated, blob.size);
  markSelected();
}

/**
 * Builds the four thumbnails. They are rotated copies of a small downscale, so all four
 * together cost about as much as one preview — which is what makes showing them affordable
 * instead of making the user click a button and hope.
 */
async function buildOrientationChoices(): Promise<void> {
  const box = $('orientChoices');
  box.replaceChildren();
  for (const url of thumbUrls) URL.revokeObjectURL(url);
  thumbUrls = [];

  if (!baseResult) return;

  const scale = Math.min(1, (THUMB_EDGE * 1.6) / Math.max(baseResult.width, baseResult.height));
  const small = downscale(
    baseResult,
    Math.max(1, Math.round(baseResult.width * scale)),
    Math.max(1, Math.round(baseResult.height * scale)),
  );

  for (let turn = 0; turn < 4; turn++) {
    const url = await objectUrl(rotate90(small, turn));
    thumbUrls.push(url);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'orient-option';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', String(turn === turns));
    button.setAttribute('aria-label', `${t.orientation} ${turn * 90}°`);

    const image = document.createElement('img');
    image.src = url;
    image.alt = '';
    button.append(image);

    button.addEventListener('click', () => {
      void applyOrientation(turn);
    });

    box.append(button);
  }

  markSelected();
}

function markSelected(): void {
  const buttons = $('orientChoices').querySelectorAll<HTMLButtonElement>('.orient-option');
  buttons.forEach((button, index) => {
    button.setAttribute('aria-checked', String(index === turns));
  });
}

async function objectUrl(image: RgbImage): Promise<string> {
  const blob = await encodeImage(image, 'jpeg', 0.82);
  return URL.createObjectURL(blob);
}

/* ------------------------------------------------------------------- display */

function renderStats(stats: ScanStats, image: RgbImage, fileBytes: number): void {
  const rows: Array<[string, string]> = [];

  rows.push([t.statSize, `${image.width} × ${image.height}`]);

  if (stats.paperFraction > 0) {
    rows.push([t.statPaper, `${(stats.paperFraction * 100).toFixed(0)}%`]);
  }

  rows.push([t.statTime, formatSeconds(stats.elapsedMs)]);
  if (fileBytes > 0) rows.push([t.statFile, formatBytes(fileBytes)]);
  rows.push([
    t.statQuality,
    `R${stats.percentiles[0]} G${stats.percentiles[1]} B${stats.percentiles[2]}`,
  ]);

  const list = $('stats');
  list.replaceChildren(
    ...rows.flatMap(([label, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      return [dt, dd];
    }),
  );
}

/**
 * Draws the page quad over the photo, with a grab handle at each corner. This is the
 * detector's output made editable: automatic detection is good but not infallible on a
 * cluttered background, and dragging a corner is a far better answer than asking somebody
 * to read pixel coordinates off their own photo.
 */
function drawOverlay(): void {
  const overlay = $<HTMLCanvasElement>('overlay');
  if (!photo || !corners) {
    overlay.hidden = true;
    return;
  }

  overlay.hidden = false;
  overlay.width = photo.previewWidth;
  overlay.height = photo.previewHeight;

  const context = overlay.getContext('2d');
  if (!context) return;

  const sx = photo.previewWidth / photo.image.width;
  const sy = photo.previewHeight / photo.image.height;
  const points: Array<[number, number]> = [];
  for (let i = 0; i < 8; i += 2) {
    points.push([corners[i]! * sx, corners[i + 1]! * sy]);
  }

  const lineWidth = Math.max(2, photo.previewWidth / 320);

  context.lineWidth = lineWidth;
  context.strokeStyle = '#22c55e';
  context.beginPath();
  context.moveTo(points[0]![0], points[0]![1]);
  for (let i = 1; i < 4; i++) context.lineTo(points[i]![0], points[i]![1]);
  context.closePath();
  context.stroke();

  const radius = lineWidth * 2.4;
  for (const [x, y] of points) {
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = '#ef4444';
    context.fill();
    context.lineWidth = lineWidth * 0.7;
    context.strokeStyle = '#ffffff';
    context.stroke();
    context.lineWidth = lineWidth;
    context.strokeStyle = '#22c55e';
  }
}

/** Maps a pointer position to source-image pixels. */
function pointerToSource(clientX: number, clientY: number): { x: number; y: number } | null {
  if (!photo) return null;
  const rect = $<HTMLCanvasElement>('overlay').getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  return {
    x: (((clientX - rect.left) / rect.width) * photo.image.width),
    y: (((clientY - rect.top) / rect.height) * photo.image.height),
  };
}

const overlayCanvas = $<HTMLCanvasElement>('overlay');
let pointerEventsSeen = 0;
let dragsStarted = 0;
let scansStarted = 0;

overlayCanvas.addEventListener('pointerdown', (event) => {
  pointerEventsSeen++;
  if (!corners || !photo || busy) return;
  const point = pointerToSource(event.clientX, event.clientY);
  if (!point) return;

  // Grab whichever handle is within roughly a fingertip of the pointer.
  const reach = 34 * (photo.image.width / Math.max(1, photo.previewWidth));
  let best = -1;
  let bestDistance = reach;
  for (let i = 0; i < 4; i++) {
    const distance = Math.hypot(corners[i * 2]! - point.x, corners[i * 2 + 1]! - point.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  if (best < 0) return;

  dragging = best;
  dragsStarted++;
  overlayCanvas.classList.add('grabbing');
  try {
    overlayCanvas.setPointerCapture(event.pointerId);
  } catch {
    // Synthetic events have no real pointer to capture; dragging still works.
  }
  event.preventDefault();
});

overlayCanvas.addEventListener('pointermove', (event) => {
  if (dragging < 0 || !corners || !photo) return;
  const point = pointerToSource(event.clientX, event.clientY);
  if (!point) return;

  corners[dragging * 2] = Math.max(0, Math.min(photo.image.width - 1, point.x));
  corners[dragging * 2 + 1] = Math.max(0, Math.min(photo.image.height - 1, point.y));
  manualCorners = true;
  drawOverlay();
});

const endDrag = (event: PointerEvent): void => {
  if (dragging < 0) return;
  dragging = -1;
  overlayCanvas.classList.remove('grabbing');
  try {
    overlayCanvas.releasePointerCapture(event.pointerId);
  } catch {
    // The capture may already be gone; nothing to undo.
  }
  void startScan();
};

overlayCanvas.addEventListener('pointerup', endDrag);
overlayCanvas.addEventListener('pointercancel', endDrag);

$('resetCorners').addEventListener('click', () => {
  manualCorners = false;
  corners = null;
  void startScan();
});

/* ------------------------------------------------------------- advanced bits */

for (const input of document.querySelectorAll<HTMLInputElement>('input[name="format"]')) {
  input.addEventListener('change', () => {
    settings.format = input.value === 'png' ? 'png' : 'jpeg';
    if (baseResult) void applyOrientation(turns);
  });
}

for (const input of document.querySelectorAll<HTMLInputElement>('input[name="maxsize"]')) {
  input.addEventListener('change', () => {
    settings.maxLongEdge = input.value === 'original' ? null : Number(input.value);
    void startScan();
  });
}

for (const input of document.querySelectorAll<HTMLInputElement>('input[name="margin"]')) {
  input.addEventListener('change', () => {
    settings.margin = Number(input.value);
    void startScan();
  });
}

/* -------------------------------------------------------------- errors/reset */

function showError(error: unknown): void {
  if (error instanceof ImageTooLargeError) {
    showMessage(t.errTooBig);
  } else if (error instanceof Error && error.message === 'not-an-image') {
    showMessage(t.errNotImage);
  } else {
    showMessage(`${t.errGeneric} ${error instanceof Error ? error.message : String(error)}`);
  }
}

function showMessage(text: string): void {
  $('errorText').textContent = text;
  show('error');
}

function reset(): void {
  releaseUrls();
  photo = null;
  corners = null;
  manualCorners = false;
  lastStats = null;
  baseResult = null;
  displayed = null;
  turns = 0;
  busy = false;
  show('picker');
}

function releaseUrls(): void {
  if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl);
  if (afterUrl) URL.revokeObjectURL(afterUrl);
  for (const url of thumbUrls) URL.revokeObjectURL(url);
  afterUrl = null;
  thumbUrls = [];
}

applyLanguage();
show('picker');

// Read-only hook so tools/browser-check.mjs can aim a real mouse drag at a handle.
// It exposes nothing that can change state.
(window as unknown as Record<string, unknown>)['__paperscanDebug'] = {
  quad: () => (corners ? corners.slice() : null),
  /** Source-image pixels; the quad is in these, not in preview pixels. */
  source: () => (photo ? { width: photo.image.width, height: photo.image.height } : null),
  preview: () => (photo ? { width: photo.previewWidth, height: photo.previewHeight } : null),
  onResult: () => !$('result').hidden,
  selection: () => turns,
  pointerEvents: () => pointerEventsSeen,
  dragsStarted: () => dragsStarted,
  scansStarted: () => scansStarted,
  busy: () => busy,
};
