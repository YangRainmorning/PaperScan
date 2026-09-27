import { order, type Point, type Quad, type RgbImage } from './types.js';

export interface RefineOptions {
  /** Samples taken along each edge. */
  samples: number;
  /** Fraction of each edge, from each end, that is left unsampled. */
  trim: number;
  /** How far to search, as a fraction of the edge's length. */
  reach: number;
  /** Minimum luma step (over 4 px) for a sample to count as a real edge. */
  minContrast: number;
  /** A candidate must be at least this fraction of the strongest step on its profile. */
  relativeStrength: number;
}

export const DEFAULT_REFINE_OPTIONS: RefineOptions = {
  samples: 32,
  trim: 0.06,
  reach: 0.05,
  minContrast: 10,
  relativeStrength: 0.8,
};

/** A line in normal form: `nx*x + ny*y = c`. */
interface Line {
  nx: number;
  ny: number;
  c: number;
}

/**
 * Snaps a rough page quad onto the actual edges in the photo.
 *
 * The blob detector answers "roughly where is the sheet", and on a cluttered surface it can
 * be off by a few hundred pixels on one corner 鈥?enough to leave a visible tilt in the
 * rectified scan. But the sheet's edges are long, straight, high-contrast lines, so each one
 * can be found directly: walk a profile across the rough edge, take the strongest step, and
 * fit a line through the results.
 *
 * The fit is what makes this robust. A stray lobe of background only contributes a minority
 * of the samples, and the two-round least-squares fit discards them, whereas the blob's
 * extreme-point heuristic lets one such lobe decide a whole corner.
 */
export function refineQuad(
  image: RgbImage,
  rough: Quad,
  options: Partial<RefineOptions> = {},
): Quad {
  const o: RefineOptions = { ...DEFAULT_REFINE_OPTIONS, ...options };
  const corners = order(rough);
  const lines: Line[] = [];

  for (let i = 0; i < 4; i++) {
    lines.push(fitEdge(image, corners[i]!, corners[(i + 1) % 4]!, o));
  }

  const refined: Point[] = [];
  for (let i = 0; i < 4; i++) {
    // Corner i sits between edge i-1 and edge i.
    const a = lines[(i + 3) % 4]!;
    const b = lines[i]!;
    refined.push(intersect(a, b) ?? corners[i]!);
  }

  return { tl: refined[0]!, tr: refined[1]!, br: refined[2]!, bl: refined[3]! };
}

function fitEdge(image: RgbImage, a: Point, b: Point, o: RefineOptions): Line {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  const fallback = lineThrough(a, b);

  if (length < 8) {
    return fallback;
  }

  // Unit normal, and the reach in pixels (at least a couple of pixels).
  const nx = -dy / length;
  const ny = dx / length;
  const reach = Math.max(2, Math.round(length * o.reach));

  const points: Point[] = [];
  for (let s = 0; s < o.samples; s++) {
    const t = o.trim + ((1 - 2 * o.trim) * s) / Math.max(1, o.samples - 1);
    const px = a.x + dx * t;
    const py = a.y + dy * t;

    // Score every offset in the window, then take the *outermost* one that is nearly as
    // strong as the best. The page's boundary is the outermost major edge across this
    // profile; a printed border or a header rule inside it can be just as sharp 鈥?on a
    // synthetic page the rule is actually sharper than the paper edge 鈥?so "strongest step"
    // alone picks the wrong one about half the time.
    let bestStep = 0;
    const steps: number[] = [];
    for (let d = -reach; d <= reach; d++) {
      const before = lumaAt(image, px + nx * (d - 2), py + ny * (d - 2));
      const after = lumaAt(image, px + nx * (d + 2), py + ny * (d + 2));
      const step = Math.abs(after - before);
      steps.push(step);
      if (step > bestStep) bestStep = step;
    }

    if (bestStep < o.minContrast) continue;

    const threshold = bestStep * o.relativeStrength;
    for (let index = 0; index < steps.length; index++) {
      if (steps[index]! >= threshold) {
        const d = index - reach;
        points.push({ x: px + nx * d, y: py + ny * d });
        break;
      }
    }
  }

  if (points.length < 5) {
    return fallback;
  }

  let fitted = fitLine(points) ?? fallback;

  // Second pass: drop anything more than a couple of pixels off the first fit. This is the
  // step that ignores a background lobe the blob picked up.
  const residuals = points.map((p) => Math.abs(fitted.nx * p.x + fitted.ny * p.y - fitted.c));
  const sorted = residuals.slice().sort((x, y) => x - y);
  const median = sorted[sorted.length >> 1]!;
  const keep = points.filter((_, index) => residuals[index]! <= Math.max(2, median * 3 + 1));

  if (keep.length >= 5) {
    fitted = fitLine(keep) ?? fitted;
  }

  return fitted;
}

/** Total least squares: the best line through a set of points, in normal form. */
function fitLine(points: readonly Point[]): Line | null {
  const n = points.length;
  if (n < 2) return null;

  let meanX = 0;
  let meanY = 0;
  for (const p of points) {
    meanX += p.x;
    meanY += p.y;
  }
  meanX /= n;
  meanY /= n;

  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of points) {
    const dx = p.x - meanX;
    const dy = p.y - meanY;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }

  // Principal direction of the point cloud; the normal is perpendicular to it.
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const nx = -Math.sin(theta);
  const ny = Math.cos(theta);
  const c = nx * meanX + ny * meanY;

  return Math.abs(nx) + Math.abs(ny) < 1e-9 ? null : { nx, ny, c };
}

function lineThrough(a: Point, b: Point): Line {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  return { nx, ny, c: nx * a.x + ny * a.y };
}

function intersect(a: Line, b: Line): Point | null {
  const det = a.nx * b.ny - b.nx * a.ny;
  if (Math.abs(det) < 1e-9) return null;
  return {
    x: (a.c * b.ny - b.c * a.ny) / det,
    y: (a.nx * b.c - b.nx * a.c) / det,
  };
}

/** Bilinear luma. Returns mid-grey outside the image so a profile cannot run off the rails. */
function lumaAt(image: RgbImage, x: number, y: number): number {
  const clampedX = x < 0 ? 0 : x > image.width - 1.001 ? image.width - 1.001 : x;
  const clampedY = y < 0 ? 0 : y > image.height - 1.001 ? image.height - 1.001 : y;

  const x0 = clampedX | 0;
  const y0 = clampedY | 0;
  const fx = clampedX - x0;
  const fy = clampedY - y0;

  const stride = image.width * 3;
  const i00 = y0 * stride + x0 * 3;
  const i10 = i00 + 3;
  const i01 = i00 + stride;
  const i11 = i01 + 3;

  const w00 = (1 - fx) * (1 - fy);
  const w10 = fx * (1 - fy);
  const w01 = (1 - fx) * fy;
  const w11 = fx * fy;

  const l00 = image.data[i00]! * 0.299 + image.data[i00 + 1]! * 0.587 + image.data[i00 + 2]! * 0.114;
  const l10 = image.data[i10]! * 0.299 + image.data[i10 + 1]! * 0.587 + image.data[i10 + 2]! * 0.114;
  const l01 = image.data[i01]! * 0.299 + image.data[i01 + 1]! * 0.587 + image.data[i01 + 2]! * 0.114;
  const l11 = image.data[i11]! * 0.299 + image.data[i11 + 1]! * 0.587 + image.data[i11 + 2]! * 0.114;

  return l00 * w00 + l10 * w10 + l01 * w01 + l11 * w11;
}
