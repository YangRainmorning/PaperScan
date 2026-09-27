export type Lang = 'en' | 'zh';

export interface Strings {
  readonly title: string;
  readonly tagline: string;
  readonly privacy: string;

  readonly dropTitle: string;
  readonly dropHint: string;
  readonly choose: string;
  readonly or: string;

  readonly stageDetect: string;
  readonly stageRectify: string;
  readonly stageBalance: string;
  readonly stageFrame: string;
  readonly stageTrim: string;
  readonly working: string;

  readonly before: string;
  readonly after: string;
  readonly showDetection: string;
  readonly detected: string;
  readonly cornerHint: string;
  readonly resetCorners: string;

  readonly download: string;
  readonly rotate: string;
  readonly again: string;
  readonly advanced: string;
  readonly orientation: string;
  readonly orientationHint: string;

  readonly format: string;
  readonly formatJpeg: string;
  readonly formatPng: string;
  readonly maxSize: string;
  readonly sizeOriginal: string;
  readonly margin: string;
  readonly marginNone: string;
  readonly marginSmall: string;
  readonly marginMedium: string;

  readonly statSize: string;
  readonly statTime: string;
  readonly statFile: string;
  readonly statPaper: string;
  readonly statQuality: string;

  readonly errNoPage: string;
  readonly errTooBig: string;
  readonly errNotImage: string;
  readonly errGeneric: string;
  readonly retry: string;

  readonly footer: string;
}

const en: Strings = {
  title: 'PaperScan',
  tagline: 'Turn a phone photo of a document into a proper scan.',
  privacy: 'Your photo never leaves this device. Everything runs in your browser.',

  dropTitle: 'Drop a photo here',
  dropHint: 'or tap to choose one — on a phone you can take it right now',
  choose: 'Choose a photo',
  or: 'or drop it anywhere on this page',

  stageDetect: 'Looking for the page…',
  stageRectify: 'Straightening…',
  stageBalance: 'Balancing the white…',
  stageFrame: 'Framing…',
  stageTrim: 'Trimming the background…',
  working: 'Working…',

  before: 'Photo',
  after: 'Scan',
  showDetection: 'Show what was detected',
  detected: 'Page found',
  cornerHint: 'Drag the four corners onto the page if the framing looks off.',
  resetCorners: 'Detect again',

  download: 'Download',
  rotate: 'Wrong way up? Rotate',
  again: 'Another photo',
  advanced: 'Advanced',
  orientation: 'Which way up is it?',
  orientationHint: 'Tap the one whose text reads normally.',

  format: 'Format',
  formatJpeg: 'JPEG — much smaller',
  formatPng: 'PNG — lossless, large',
  maxSize: 'Output size',
  sizeOriginal: 'Original resolution',
  margin: 'White border',
  marginNone: 'None',
  marginSmall: 'Thin',
  marginMedium: 'Wide',

  statSize: 'Size',
  statTime: 'Took',
  statFile: 'File',
  statPaper: 'Paper found',
  statQuality: 'White balance',

  errNoPage:
    "Couldn't find a page in that photo. Try a plainer background, more even light, or move the camera back so the whole sheet is visible.",
  errTooBig: 'That photo is too large for this device to process. Try one under 80 megapixels.',
  errNotImage: "That file isn't an image this browser can read.",
  errGeneric: 'Something went wrong while processing that photo.',
  retry: 'Try another photo',

  footer: 'Open source · MIT · No uploads, no accounts, no tracking',
};

const zh: Strings = {
  title: 'PaperScan',
  tagline: '把手机拍的文档照片，变成正经的扫描件。',
  privacy: '照片不会离开你的设备，全部在浏览器里完成。',

  dropTitle: '把照片拖到这里',
  dropHint: '或点一下选择照片 —— 手机上可以直接拍',
  choose: '选择照片',
  or: '也可以拖到页面任意位置',

  stageDetect: '正在找纸面…',
  stageRectify: '正在矫正透视…',
  stageBalance: '正在做白平衡…',
  stageFrame: '正在成帧…',
  stageTrim: '正在裁掉背景…',
  working: '处理中…',

  before: '原图',
  after: '扫描件',
  showDetection: '显示检测结果',
  detected: '已找到纸面',
  cornerHint: '如果框得不准，直接拖动四个角到纸的边缘。',
  resetCorners: '重新自动检测',

  download: '下载',
  rotate: '方向不对？转一下',
  again: '换一张',
  advanced: '高级选项',
  orientation: '哪一张文字是正的？',
  orientationHint: '点一下那张看着正常的就行。',

  format: '输出格式',
  formatJpeg: 'JPEG —— 体积小得多',
  formatPng: 'PNG —— 无损，很大',
  maxSize: '输出尺寸',
  sizeOriginal: '原始分辨率',
  margin: '四周留白',
  marginNone: '不留',
  marginSmall: '窄',
  marginMedium: '宽',

  statSize: '尺寸',
  statTime: '耗时',
  statFile: '文件',
  statPaper: '纸面占比',
  statQuality: '白平衡',

  errNoPage:
    '这张照片里没找到纸面。试试换个干净的背景、让光线均匀一些，或者离远点把整张纸拍全。',
  errTooBig: '这张照片太大，这台设备处理不了。请换一张 8000 万像素以下的。',
  errNotImage: '这个文件不是浏览器能读的图片。',
  errGeneric: '处理这张照片时出错了。',
  retry: '换一张试试',

  footer: '开源 · MIT · 不上传、不注册、无追踪',
};

const TABLES: Record<Lang, Strings> = { en, zh };

export function detectLang(): Lang {
  const candidates = [navigator.language, ...(navigator.languages ?? [])];
  for (const tag of candidates) {
    if (typeof tag === 'string' && tag.toLowerCase().startsWith('zh')) return 'zh';
  }
  return 'en';
}

export function strings(lang: Lang): Strings {
  return TABLES[lang];
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatSeconds(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}
