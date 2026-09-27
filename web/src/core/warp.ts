import { homographyFromUnitSquare, type Homography } from './homography.js';
import { clampByte } from './resize.js';
import { expandAboutCentroid, paperSize, type Quad, type RgbImage } from './types.js';

export interface WarpOptions {
  /**
   * White border to add around the page, as a fraction of the page size
   * (0.03 = 3% on every side). Zero produces a tight crop.
   */
  margin: number;
  /** Brightness the paper is normalised to. 250 leaves a little headroom below pure white. */
  targetWhite: number;
  /** Percentile of each channel treated as "paper white". */
  whitePercentile: number;
  /** Expansion applied to the page polygon when framing the canvas, so edges are cleanly cut. */
  edgeOverscan: number;
}

export const DEFAULT_WARP_OPTIONS: WarpOptions = {
  margin: 0,
  targetWhite: 250,
  whitePercentile: 0.9,
  edgeOverscan: 1.002,
};

export interface WarpResult {
  /** White-balanced canvas pixels, tightly packed RGB. */
  pixels: Uint8Array;
  canvasWidth: number;
  canvasHeight: number;
  paperWidth: number;
  paperHeight: number;
  /** The percentile value measured on the raw canvas, per channel, before balancing. */
  percentiles: [number, number, number];
  /** The per-channel gains that were applied. */
  gains: [number, number, number];
  homography: Homography;
  paperQuad: Quad;
  margin: number;
}

/**
 * Resamples the page out of the photo with a homography and normalises the paper to white.
 *
 * The canvas is produced at 1:1 source resolution: its size is the average edge length of
 * the page quad, so no detail is invented and none is thrown away. Sampling is bilinear.
 *
 * The white balance is a per-channel percentile stretch: the value at the given percentile
 * of each channel is treated as "paper white" and mapped to `targetWhite`. That removes the
 * warm tint of indoor lighting while leaving the hue of stamps and artwork alone, unlike a
 * grey-world or histogram-equalisation approach.
 */
export function warp(
  source: RgbImage,
  paper: Quad,
  options: Partial<WarpOptions> = {},
): WarpResult {
  const o: WarpOptions = { ...DEFAULT_WARP_OPTIONS, ...options };

  if (o.margin < 0 || o.margin > 0.5) {
    throw new RangeError(`Margin must be between 0 and 0.5, got ${o.margin}.`);
  }

  const paperDimensions = paperSize(paper);
  const paperWidth = Math.max(1, Math.round(paperDimensions.width));
  const paperHeight = Math.max(1, Math.round(paperDimensions.height));

  const k = 1 + 2 * o.margin;
  const canvasQuad = expandAboutCentroid(paper, k);
  const canvasWidth = Math.max(1, Math.round(paperWidth * k));
  const canvasHeight = Math.max(1, Math.round(paperHeight * k));

  const homography = homographyFromUnitSquare(canvasQuad);
  const c = homography.h;
  const a11 = c[0]!;
  const a12 = c[1]!;
  const a13 = c[2]!;
  const a21 = c[3]!;
  const a22 = c[4]!;
  const a23 = c[5]!;
  const a31 = c[6]!;
  const a32 = c[7]!;

  const src = source.data;
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  const sourceStride = sourceWidth * 3;
  const maxX = sourceWidth - 1.001;
  const maxY = sourceHeight - 1.001;

  const dst = new Uint8Array(canvasWidth * canvasHeight * 3);
  const histR = new Int32Array(256);
  const histG = new Int32Array(256);
  const histB = new Int32Array(256);

  for (let py = 0; py < canvasHeight; py++) {
    const v = (py + 0.5) / canvasHeight;
    const rowBase = py * canvasWidth * 3;

    for (let px = 0; px < canvasWidth; px++) {
      const u = (px + 0.5) / canvasWidth;
      const den = a31 * u + a32 * v + 1;
      let sx = (a11 * u + a12 * v + a13) / den;
      let sy = (a21 * u + a22 * v + a23) / den;

      if (sx < 0) sx = 0;
      else if (sx > maxX) sx = maxX;
      if (sy < 0) sy = 0;
      else if (sy > maxY) sy = maxY;

      const x0 = sx | 0;
      const y0 = sy | 0;
      const fx = sx - x0;
      const fy = sy - y0;

      const i00 = y0 * sourceStride + x0 * 3;
      const i10 = i00 + 3;
      const i01 = i00 + sourceStride;
      const i11 = i01 + 3;

      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;

      const r = clampByte(
        (src[i00]! * w00 + src[i10]! * w10 + src[i01]! * w01 + src[i11]! * w11) | 0,
      );
      const g = clampByte(
        (src[i00 + 1]! * w00 + src[i10 + 1]! * w10 + src[i01 + 1]! * w01 + src[i11 + 1]! * w11) | 0,
      );
      const b = clampByte(
        (src[i00 + 2]! * w00 + src[i10 + 2]! * w10 + src[i01 + 2]! * w01 + src[i11 + 2]! * w11) | 0,
      );

      const q = rowBase + px * 3;
      dst[q] = r;
      dst[q + 1] = g;
      dst[q + 2] = b;

      histR[r]!++;
      histG[g]!++;
      histB[b]!++;
    }
  }

  const total = canvasWidth * canvasHeight;
  const percentiles: [number, number, number] = [
    percentile(histR, total, o.whitePercentile),
    percentile(histG, total, o.whitePercentile),
    percentile(histB, total, o.whitePercentile),
  ];
  const gains: [number, number, number] = [
    o.targetWhite / Math.max(1, percentiles[0]),
    o.targetWhite / Math.max(1, percentiles[1]),
    o.targetWhite / Math.max(1, percentiles[2]),
  ];

  const gainR = gains[0];
  const gainG = gains[1];
  const gainB = gains[2];
  for (let i = 0; i < dst.length; i += 3) {
    dst[i] = clampByte((dst[i]! * gainR) | 0);
    dst[i + 1] = clampByte((dst[i + 1]! * gainG) | 0);
    dst[i + 2] = clampByte((dst[i + 2]! * gainB) | 0);
  }

  return {
    pixels: dst,
    canvasWidth,
    canvasHeight,
    paperWidth,
    paperHeight,
    percentiles,
    gains,
    homography,
    paperQuad: paper,
    margin: o.margin,
  };
}

function percentile(histogram: Int32Array, total: number, fraction: number): number {
  const target = Math.ceil(total * fraction);
  let accumulated = 0;
  for (let value = 0; value < histogram.length; value++) {
    accumulated += histogram[value]!;
    if (accumulated >= target) {
      return value;
    }
  }
  return 255;
}
