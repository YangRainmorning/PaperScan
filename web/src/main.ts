import './style.css';
import { nextReadingEdge, type ReadingEdge, type RgbImage } from './core/types.js';
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

interface Settings {
  readingEdge: ReadingEdge;
  format: 'jpeg' | 'png';
  maxLongEdge: number | null;
  margin: number;
  autoTrim: boolean;
}

const settings: Settings = {
  readingEdge: 'top',
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
let paperQuad: number[] | null = null;
let lastStats: ScanStats | null = null;
let lastResult: RgbImage | null = null;
let afterUrl: string | null = null;

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
  $('showDetectionLabel').textContent = t.showDetection;
  $('download').textContent = t.download;
  $('rotate').textContent = t.rotate;
  $('again').textContent = t.again;
  $('advancedLabel').textContent = t.advanced;

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

  if (lastStats) renderStats(lastStats, lastResult ? lastResult.data.length : 0, 0);
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
$('rotate').addEventListener('click', () => {
  settings.readingEdge = nextReadingEdge(settings.readingEdge);
  void startScan();
});

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
    paperQuad = null;
    lastStats = null;
    lastResult = null;

    $<HTMLImageElement>('beforeImg').src = photo.previewUrl;
    await startScan();
  } catch (error) {
    busy = false;
    showError(error);
  }
}

async function startScan(): Promise<void> {
  if (!photo) return;

  busy = true;
  show('working');
  stageText(settings.readingEdge === 'top' ? 'detect' : 'rectify');

  const id = ++requestId;

  // The worker takes ownership of the buffer, so hand it a copy: the main thread keeps the
  // original for re-runs (rotating, changing the size) without paying to decode again.
  const copy = photo.image.data.slice();
  const request: ScanRequest = {
    id,
    data: copy.buffer as ArrayBuffer,
    width: photo.image.width,
    height: photo.image.height,
    corners: null,
    readingEdge: settings.readingEdge,
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

  const result: RgbImage = {
    data: new Uint8Array(message.data),
    width: message.width,
    height: message.height,
  };
  paperQuad = message.paperQuad;
  lastStats = message.stats;
  lastResult = result;

  const blob = await encodeImage(result, settings.format, 0.92);
  if (afterUrl) URL.revokeObjectURL(afterUrl);
  afterUrl = URL.createObjectURL(blob);

  const afterImage = $<HTMLImageElement>('afterImg');
  afterImage.src = afterUrl;

  const download = $<HTMLAnchorElement>('download');
  download.href = afterUrl;
  download.download = `${fileName}-scan.${settings.format === 'png' ? 'png' : 'jpg'}`;

  // 0.03 / 0.08 from the radio values are fractions of the page size, matching the CLI.
  renderStats(message.stats, result.data.length, blob.size);
  drawOverlay();

  busy = false;
  show('result');
}

/* ------------------------------------------------------------------- display */

function renderStats(stats: ScanStats, _rawBytes: number, fileBytes: number): void {
  const rows: Array<[string, string]> = [];

  const size = lastResult ? `${lastResult.width} × ${lastResult.height}` : '—';
  rows.push([t.statSize, size]);

  if (!lastStats?.paperFraction || stats.paperFraction > 0) {
    if (stats.paperFraction > 0) {
      rows.push([t.statPaper, `${(stats.paperFraction * 100).toFixed(0)}%`]);
    }
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

function drawOverlay(): void {
  const overlay = $<HTMLCanvasElement>('overlay');
  const showIt = $<HTMLInputElement>('showDetection').checked;

  if (!showIt || !photo || !paperQuad) {
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
    points.push([paperQuad[i]! * sx, paperQuad[i + 1]! * sy]);
  }

  const lineWidth = Math.max(2, photo.previewWidth / 320);
  context.lineWidth = lineWidth;
  context.strokeStyle = '#22c55e';
  context.beginPath();
  context.moveTo(points[0]![0], points[0]![1]);
  for (let i = 1; i < 4; i++) context.lineTo(points[i]![0], points[i]![1]);
  context.closePath();
  context.stroke();

  context.fillStyle = '#ef4444';
  for (const [x, y] of points) {
    context.beginPath();
    context.arc(x, y, lineWidth * 1.8, 0, Math.PI * 2);
    context.fill();
  }
}

$('showDetection').addEventListener('change', drawOverlay);

/* ------------------------------------------------------------- advanced bits */

for (const input of document.querySelectorAll<HTMLInputElement>('input[name="format"]')) {
  input.addEventListener('change', () => {
    settings.format = input.value === 'png' ? 'png' : 'jpeg';
    if (lastResult) void reencode();
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

async function reencode(): Promise<void> {
  if (!lastResult) return;
  const blob = await encodeImage(lastResult, settings.format, 0.92);
  if (afterUrl) URL.revokeObjectURL(afterUrl);
  afterUrl = URL.createObjectURL(blob);
  $<HTMLImageElement>('afterImg').src = afterUrl;
  const download = $<HTMLAnchorElement>('download');
  download.href = afterUrl;
  download.download = `${fileName}-scan.${settings.format === 'png' ? 'png' : 'jpg'}`;
  renderStats(lastStats!, lastResult.data.length, blob.size);
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
  paperQuad = null;
  lastStats = null;
  lastResult = null;
  busy = false;
  settings.readingEdge = 'top';
  show('picker');
}

function releaseUrls(): void {
  if (photo?.previewUrl) URL.revokeObjectURL(photo.previewUrl);
  if (afterUrl) URL.revokeObjectURL(afterUrl);
  afterUrl = null;
}

applyLanguage();
show('picker');
