import { mapInverse } from './homography.js';
import { clampByte } from './resize.js';
import { centroid, type Point, type RgbImage } from './types.js';
import type { WarpResult } from './warp.js';

/**
 * Turns the rectified canvas into the final image: the page polygon is drawn on a white
 * background, so anything outside the page quad becomes a clean white border instead of the
 * stray pixels the homography pulled in from the background.
 */
export function frame(warped: WarpResult, edgeOverscan = 1.002): RgbImage {
  const { canvasWidth: width, canvasHeight: height } = warped;

  // A zero margin means the canvas *is* the page, and the overscanned polygon is strictly
  // larger than the canvas, so there is nothing to clip.
  if (warped.margin <= 0) {
    return { data: warped.pixels, width, height };
  }

  const paper = warped.paperQuad;
  const centre = centroid(paper);
  const corners = [paper.tl, paper.tr, paper.br, paper.bl];
  const polygon: Point[] = corners.map((corner) => {
    const source = {
      x: centre.x + (corner.x - centre.x) * edgeOverscan,
      y: centre.y + (corner.y - centre.y) * edgeOverscan,
    };
    const uv = mapInverse(warped.homography, source.x, source.y);
    return { x: uv.x * width, y: uv.y * height };
  });

  const output = warped.pixels.slice();

  for (let y = 0; y < height; y++) {
    const rowBase = y * width * 3;
    for (let x = 0; x < width; x++) {
      const coverage = polygonCoverage(polygon, x + 0.5, y + 0.5);
      if (coverage >= 1) continue;

      const i = rowBase + x * 3;
      if (coverage <= 0) {
        output[i] = 255;
        output[i + 1] = 255;
        output[i + 2] = 255;
        continue;
      }

      const inverse = 1 - coverage;
      output[i] = blend(output[i]!, coverage, inverse);
      output[i + 1] = blend(output[i + 1]!, coverage, inverse);
      output[i + 2] = blend(output[i + 2]!, coverage, inverse);
    }
  }

  return { data: output, width, height };
}

function blend(value: number, coverage: number, inverse: number): number {
  return clampByte(Math.round(value * coverage + 255 * inverse));
}

/** Anti-aliased coverage of a convex polygon at a point, in the range 0..1. */
function polygonCoverage(polygon: readonly Point[], x: number, y: number): number {
  // Signed area tells us the winding. With the shoelace sign convention below, "inside" is
  // "every edge cross product positive".
  let doubleArea = 0;
  for (let i = 0; i < 4; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % 4]!;
    doubleArea += a.x * b.y - b.x * a.y;
  }
  const orientation = doubleArea >= 0 ? 1 : -1;

  let minDistance = Number.MAX_VALUE;
  let maxDistance = -Number.MAX_VALUE;

  for (let i = 0; i < 4; i++) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % 4]!;
    const ex = b.x - a.x;
    const ey = b.y - a.y;
    const length = Math.sqrt(ex * ex + ey * ey);
    if (length < 1e-9) return 1;

    const distance = (orientation * ((y - a.y) * ex - (x - a.x) * ey)) / length;
    if (distance < minDistance) minDistance = distance;
    if (distance > maxDistance) maxDistance = distance;
  }

  // More than a pixel clear of every edge, so no supersampling is needed.
  if (minDistance > 1) return 1;
  if (maxDistance < -1) return 0;

  const samples = 4;
  let hits = 0;
  for (let sy = 0; sy < samples; sy++) {
    const py = y - 0.5 + (sy + 0.5) / samples;
    for (let sx = 0; sx < samples; sx++) {
      const px = x - 0.5 + (sx + 0.5) / samples;
      if (insidePolygon(polygon, px, py)) hits++;
    }
  }

  return hits / (samples * samples);
}

function insidePolygon(polygon: readonly Point[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const pi = polygon[i]!;
    const pj = polygon[j]!;
    if (
      pi.y > y !== pj.y > y &&
      x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y) + pi.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}
