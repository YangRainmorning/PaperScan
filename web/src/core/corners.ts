import { downscale, thumbnailSize } from './resize.js';
import { NoPageFoundError, type Quad, type RgbImage } from './types.js';

export interface CornerDetectionOptions {
  /** Long edge, in pixels, of the thumbnail the detector actually works on. */
  thumbnailLongEdge: number;
  /** A pixel is "paper" only if its red channel is at least this bright. */
  minRed: number;
  /** Minimum red-minus-blue difference (paper reads warm under typical indoor light). */
  minWarmth: number;
  /** Above this red-minus-blue difference the pixel is considered coloured. */
  maxWarmth: number;
  /** Minimum fraction of the thumbnail a blob must cover to seed a detection. */
  minComponentFraction: number;
  /** Bounding boxes are grown by this fraction of the long edge before the overlap test. */
  mergeMarginFraction: number;
}

export const DEFAULT_CORNER_OPTIONS: CornerDetectionOptions = {
  thumbnailLongEdge: 1024,
  minRed: 165,
  minWarmth: 6,
  maxWarmth: 75,
  minComponentFraction: 0.01,
  mergeMarginFraction: 0.012,
};

export interface CornerDetectionResult {
  /** Corners in source pixels, in photo order (not yet rotated into reading order). */
  photoOrder: Quad;
  /** Fraction of the thumbnail covered by the merged page blobs. */
  paperFraction: number;
  /** The downscaled image the corners were measured on; useful for a verify overlay. */
  thumbnail: RgbImage;
  /** Pixels belonging to the merged page blobs, as a 0/1 mask over the thumbnail. */
  mask: Uint8Array;
}

interface Component {
  label: number;
  size: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * Finds the page in a photo without any machine learning: threshold down to "bright,
 * slightly warm" pixels, group them into connected blobs, and read the page's extreme
 * points off the diagonals.
 *
 * Picking the *biggest* blob is not enough. Certificates and diplomas usually carry a
 * printed border, and that border — being neither bright nor warm — splits the paper into
 * an outer ring and a much larger inner rectangle. The inner rectangle wins on pixel count,
 * so a naive detector crops the page to the inside of its own frame. Instead this seeds on
 * the blob with the largest *bounding box*, then merges in every blob whose bounding box
 * overlaps the seed's, grown slightly to bridge the gaps that downscaling opens up.
 */
export function detectCorners(
  source: RgbImage,
  options: Partial<CornerDetectionOptions> = {},
): CornerDetectionResult {
  const o: CornerDetectionOptions = { ...DEFAULT_CORNER_OPTIONS, ...options };
  const size = thumbnailSize(source.width, source.height, o.thumbnailLongEdge);
  const thumbnail = downscale(source, size.width, size.height);
  const { width: tw, height: th, data } = thumbnail;

  const mask = new Uint8Array(tw * th);
  for (let i = 0; i < mask.length; i++) {
    const p = i * 3;
    const r = data[p]!;
    const g = data[p + 1]!;
    const b = data[p + 2]!;
    if (r < o.minRed) continue;
    const warmth = r - b;
    if (warmth < o.minWarmth || warmth > o.maxWarmth) continue;
    if (g < b) continue;
    mask[i] = 1;
  }

  const { labels, components } = labelComponents(mask, tw, th);
  if (components.length === 0) {
    throw new NoPageFoundError();
  }

  const minimumSize = Math.max(64, Math.floor(tw * th * o.minComponentFraction));
  const candidates = components.filter((c) => c.size >= minimumSize);
  if (candidates.length === 0) {
    throw new NoPageFoundError();
  }

  let seed = candidates[0]!;
  let seedArea = -1;
  for (const c of candidates) {
    const area = (c.maxX - c.minX + 1) * (c.maxY - c.minY + 1);
    if (area > seedArea || (area === seedArea && c.size > seed.size)) {
      seed = c;
      seedArea = area;
    }
  }

  const margin = Math.max(3, Math.round(Math.max(tw, th) * o.mergeMarginFraction));
  const search = expand(seed, margin);
  const kept = new Uint8Array(components.length + 1);
  for (const c of components) {
    if (overlaps(expand(c, margin), search)) {
      kept[c.label] = 1;
    }
  }

  let tl = -1;
  let tr = -1;
  let br = -1;
  let bl = -1;
  let minSum = Number.MAX_SAFE_INTEGER;
  let maxDiff = -Number.MAX_SAFE_INTEGER;
  let maxSum = -Number.MAX_SAFE_INTEGER;
  let minDiff = Number.MAX_SAFE_INTEGER;
  let keptPixels = 0;

  // A standalone copy of the merged blobs, for the verify overlay and for debugging.
  const merged = new Uint8Array(tw * th);

  for (let i = 0; i < labels.length; i++) {
    const label = labels[i]!;
    if (label === 0 || kept[label] !== 1) continue;

    merged[i] = 1;
    keptPixels++;

    const x = i % tw;
    const y = (i - x) / tw;
    const sum = x + y;
    const diff = x - y;

    if (sum < minSum) {
      minSum = sum;
      tl = i;
    }
    if (diff > maxDiff) {
      maxDiff = diff;
      tr = i;
    }
    if (sum > maxSum) {
      maxSum = sum;
      br = i;
    }
    if (diff < minDiff) {
      minDiff = diff;
      bl = i;
    }
  }

  const kx = source.width / tw;
  const ky = source.height / th;
  const at = (index: number) => {
    const x = index % tw;
    const y = (index - x) / tw;
    return { x: x * kx, y: y * ky };
  };

  return {
    photoOrder: { tl: at(tl), tr: at(tr), br: at(br), bl: at(bl) },
    paperFraction: keptPixels / (tw * th),
    thumbnail,
    mask: merged,
  };
}

function expand(c: Component, margin: number): Component {
  return {
    label: c.label,
    size: c.size,
    minX: c.minX - margin,
    minY: c.minY - margin,
    maxX: c.maxX + margin,
    maxY: c.maxY + margin,
  };
}

function overlaps(a: Component, b: Component): boolean {
  return a.minX <= b.maxX && b.minX <= a.maxX && a.minY <= b.maxY && b.minY <= a.maxY;
}

/** 4-connected labelling with an explicit stack, so deep blobs cannot blow the call stack. */
function labelComponents(
  mask: Uint8Array,
  width: number,
  height: number,
): { labels: Int32Array; components: Component[] } {
  const labels = new Int32Array(mask.length);
  const stack = new Int32Array(mask.length);
  const components: Component[] = [];

  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== 1 || labels[start] !== 0) continue;

    const label = components.length + 1;
    let sp = 0;
    stack[sp++] = start;
    labels[start] = label;

    let size = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    while (sp > 0) {
      const p = stack[--sp]!;
      size++;

      const px = p % width;
      const py = (p - px) / width;

      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;

      if (px > 0) {
        const q = p - 1;
        if (mask[q] === 1 && labels[q] === 0) {
          labels[q] = label;
          stack[sp++] = q;
        }
      }
      if (px < width - 1) {
        const q = p + 1;
        if (mask[q] === 1 && labels[q] === 0) {
          labels[q] = label;
          stack[sp++] = q;
        }
      }
      if (py > 0) {
        const q = p - width;
        if (mask[q] === 1 && labels[q] === 0) {
          labels[q] = label;
          stack[sp++] = q;
        }
      }
      if (py < height - 1) {
        const q = p + width;
        if (mask[q] === 1 && labels[q] === 0) {
          labels[q] = label;
          stack[sp++] = q;
        }
      }
    }

    components.push({ label, size, minX, minY, maxX, maxY });
  }

  return { labels, components };
}
