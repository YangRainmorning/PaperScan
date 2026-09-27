import {
  detectCorners,
  type CornerDetectionOptions,
  type CornerDetectionResult,
} from './corners.js';
import { frame } from './framer.js';
import { cropImage, findCrop, type TrimOptions } from './trim.js';
import { rotateQuad, type Quad, type ReadingEdge, type Rect, type RgbImage } from './types.js';
import { warp, type WarpOptions } from './warp.js';

export type ScanStage = 'detect' | 'rectify' | 'balance' | 'frame' | 'trim';

export type ProgressCallback = (stage: ScanStage) => void;

export interface ScanOptions {
  /** Manual page corners in source pixels, reading order. When set, detection is skipped. */
  corners?: Quad | null;
  /** Which photo edge the page's readable "up" points at. Only used for detected corners. */
  readingEdge: ReadingEdge;
  warp: Partial<WarpOptions>;
  detection: Partial<CornerDetectionOptions>;
  trimming: Partial<TrimOptions>;
  /** Trim the background off the canvas. Turn off to keep the raw rectified output. */
  autoTrim: boolean;
}

export const DEFAULT_SCAN_OPTIONS: ScanOptions = {
  corners: null,
  readingEdge: 'top',
  warp: {},
  detection: {},
  trimming: {},
  autoTrim: true,
};

export interface ScanResult {
  /** The finished scan. */
  image: RgbImage;
  /** The page quad in reading order, in source pixel coordinates. */
  paperQuad: Quad;
  manualCorners: boolean;
  /** Fraction of the photo covered by the detected page (0 when corners were manual). */
  paperFraction: number;
  paperWidth: number;
  paperHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  /** The crop applied by the trimmer, or null when nothing was removed. */
  crop: Rect | null;
  /** 90th-percentile channel values of the raw canvas, before white balancing. */
  percentiles: [number, number, number];
  /** Per-channel white-balance gains. */
  gains: [number, number, number];
  /** Present only when detection ran. */
  detection: CornerDetectionResult | null;
  elapsedMs: number;
}

/**
 * The five-stage pipeline that turns a photo of a page into a scan: find the corners,
 * rectify, white-balance, trim the background, hand back the image.
 */
export function runPipeline(
  source: RgbImage,
  options: Partial<ScanOptions> = {},
  onProgress?: ProgressCallback,
): ScanResult {
  const o: ScanOptions = { ...DEFAULT_SCAN_OPTIONS, ...options };
  const started = now();

  let paper: Quad;
  let detection: CornerDetectionResult | null = null;
  let paperFraction = 0;
  const manualCorners = o.corners != null;

  if (o.corners) {
    paper = o.corners;
  } else {
    onProgress?.('detect');
    detection = detectCorners(source, o.detection);
    paperFraction = detection.paperFraction;
    paper = rotateQuad(detection.photoOrder, o.readingEdge);
  }

  onProgress?.('rectify');
  const warped = warp(source, paper, o.warp);
  onProgress?.('balance');
  onProgress?.('frame');

  const canvas = frame(warped, o.warp.edgeOverscan ?? 1.002);

  onProgress?.('trim');
  let image = canvas;
  let crop: Rect | null = null;

  if (o.autoTrim) {
    crop = findCrop(canvas.data, canvas.width, canvas.height, o.trimming);
    if (crop) {
      image = cropImage(canvas, crop);
    }
  }

  return {
    image,
    paperQuad: paper,
    manualCorners,
    paperFraction,
    paperWidth: warped.paperWidth,
    paperHeight: warped.paperHeight,
    canvasWidth: warped.canvasWidth,
    canvasHeight: warped.canvasHeight,
    crop,
    percentiles: warped.percentiles,
    gains: warped.gains,
    detection,
    elapsedMs: now() - started,
  };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
