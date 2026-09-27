import type { Rect, RgbImage } from './types.js';

export interface TrimOptions {
  /** Luma above which a pixel counts as paper. */
  threshold: number;
  /** How many scan lines to probe per edge. */
  sampleLines: number;
  /** How far inwards each probe may travel before it gives up. */
  maxProbeDepth: number;
  /** Probes start this far along each edge, as a fraction of its length. */
  lineStart: number;
  /** Fraction of each edge that is probed. */
  lineSpan: number;
  /** Minimum successful probes before an edge is trimmed at all. */
  minSamples: number;
  /** Pixels shaved off beyond the detected paper edge, to remove the dark seam. */
  pad: number;
  /** The crop is only applied if it keeps at least this many pixels in both axes. */
  minKeptSize: number;
}

export const DEFAULT_TRIM_OPTIONS: TrimOptions = {
  threshold: 140,
  sampleLines: 120,
  maxProbeDepth: 600,
  lineStart: 0.03,
  lineSpan: 0.94,
  minSamples: 10,
  pad: 2,
  minKeptSize: 10,
};

/**
 * Removes the sliver of background the homography drags in along the canvas edges.
 *
 * For each of the four edges the trimmer fires evenly spaced probes inwards and records the
 * first pixel that is paper-bright, confirmed by a second sample a few pixels further in so
 * a stray highlight cannot fool it. Each edge is then trimmed to the deepest result across
 * all probes, which guarantees the final image is paper right up to every border.
 *
 * Luma is compared as `(299r + 587g + 114b) > threshold * 1000`, never divided, so the
 * comparison is exact.
 */
export function findCrop(
  data: Uint8Array,
  width: number,
  height: number,
  options: Partial<TrimOptions> = {},
): Rect | null {
  const o: TrimOptions = { ...DEFAULT_TRIM_OPTIONS, ...options };

  const depth = Math.min(o.maxProbeDepth, Math.max(0, Math.min(width, height) - 5));
  if (depth <= 4 || o.sampleLines <= 1) return null;

  const limit = o.threshold * 1000;
  const lastLine = o.sampleLines - 1;

  let top = 0;
  let bottom = height - 1;
  let left = 0;
  let right = width - 1;

  let topCount = 0;
  let bottomCount = 0;
  let leftCount = 0;
  let rightCount = 0;
  let topMax = -1;
  let bottomMin = Number.MAX_SAFE_INTEGER;
  let leftMax = -1;
  let rightMin = Number.MAX_SAFE_INTEGER;

  for (let i = 0; i < o.sampleLines; i++) {
    const x = (width * (o.lineStart + (o.lineSpan * i) / lastLine)) | 0;
    if (x < 0 || x >= width) continue;

    for (let d = 0; d < depth; d++) {
      if (isPaper(data, width, x, d, limit) && isPaper(data, width, x, d + 4, limit)) {
        topCount++;
        if (d > topMax) topMax = d;
        break;
      }
    }

    for (let d = 0; d < depth; d++) {
      const y = height - 1 - d;
      if (isPaper(data, width, x, y, limit) && isPaper(data, width, x, y - 4, limit)) {
        bottomCount++;
        if (y < bottomMin) bottomMin = y;
        break;
      }
    }
  }

  for (let i = 0; i < o.sampleLines; i++) {
    const y = (height * (o.lineStart + (o.lineSpan * i) / lastLine)) | 0;
    if (y < 0 || y >= height) continue;

    for (let d = 0; d < depth; d++) {
      if (isPaper(data, width, d, y, limit) && isPaper(data, width, d + 4, y, limit)) {
        leftCount++;
        if (d > leftMax) leftMax = d;
        break;
      }
    }

    for (let d = 0; d < depth; d++) {
      const x = width - 1 - d;
      if (isPaper(data, width, x, y, limit) && isPaper(data, width, x - 4, y, limit)) {
        rightCount++;
        if (x < rightMin) rightMin = x;
        break;
      }
    }
  }

  if (topCount > o.minSamples) top = topMax + o.pad;
  if (bottomCount > o.minSamples) bottom = bottomMin - o.pad;
  if (leftCount > o.minSamples) left = leftMax + o.pad;
  if (rightCount > o.minSamples) right = rightMin - o.pad;

  if (bottom <= top + o.minKeptSize || right <= left + o.minKeptSize) {
    return null;
  }

  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
}

export function cropImage(image: RgbImage, rect: Rect): RgbImage {
  if (
    rect.x < 0 ||
    rect.y < 0 ||
    rect.x + rect.width > image.width ||
    rect.y + rect.height > image.height ||
    rect.width <= 0 ||
    rect.height <= 0
  ) {
    throw new RangeError('Crop rectangle falls outside the canvas.');
  }

  const out = new Uint8Array(rect.width * rect.height * 3);
  const rowBytes = rect.width * 3;
  const sourceStride = image.width * 3;

  for (let y = 0; y < rect.height; y++) {
    const from = (rect.y + y) * sourceStride + rect.x * 3;
    out.set(image.data.subarray(from, from + rowBytes), y * rowBytes);
  }

  return { data: out, width: rect.width, height: rect.height };
}

function isPaper(data: Uint8Array, width: number, x: number, y: number, limit: number): boolean {
  const i = (y * width + x) * 3;
  return data[i]! * 299 + data[i + 1]! * 587 + data[i + 2]! * 114 > limit;
}
