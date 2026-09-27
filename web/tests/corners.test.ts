import { describe, expect, it } from 'vitest';
import { detectCorners } from '../src/core/corners.js';
import { downscale, thumbnailSize } from '../src/core/resize.js';
import { isPageFoundError, type Quad } from '../src/core/types.js';
import { borderedDocument, centeredQuad, document, photoOfDocument, portraitQuad, Raster } from './helpers.js';

function expectQuadClose(expected: Quad, actual: Quad, tolerance: number): void {
  const keys = ['tl', 'tr', 'br', 'bl'] as const;
  for (const key of keys) {
    expect(Math.abs(expected[key].x - actual[key].x)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(expected[key].y - actual[key].y)).toBeLessThanOrEqual(tolerance);
  }
}

describe('downscale', () => {
  it('picks a thumbnail of the requested long edge', () => {
    expect(thumbnailSize(1600, 1200, 1024)).toEqual({ width: 1024, height: 768 });
    expect(thumbnailSize(1200, 1600, 1024)).toEqual({ width: 768, height: 1024 });
  });

  it('averages whole blocks exactly', () => {
    const raster = new Raster(4, 4, [0, 0, 0]);
    raster.rect(0, 0, 2, 2, [100, 100, 100]);
    raster.rect(2, 2, 2, 2, [200, 200, 200]);
    const small = downscale(raster.toImage(), 2, 2);

    expect(Array.from(small.data.slice(0, 3))).toEqual([100, 100, 100]);
    expect(Array.from(small.data.slice(3, 6))).toEqual([0, 0, 0]);
    expect(Array.from(small.data.slice(6, 9))).toEqual([0, 0, 0]);
    expect(Array.from(small.data.slice(9, 12))).toEqual([200, 200, 200]);
  });
});

describe('detectCorners', () => {
  it('finds the page in a synthetic photo', () => {
    const expected = centeredQuad(1600, 1200);
    const photo = photoOfDocument(document(900, 1200), expected, 1600, 1200);

    const result = detectCorners(photo);

    expectQuadClose(expected, result.photoOrder, 1600 * 0.02);
    expect(result.paperFraction).toBeGreaterThan(0.3);
    expect(result.paperFraction).toBeLessThan(0.7);
  });

  it('uses the requested thumbnail size', () => {
    const photo = photoOfDocument(document(400, 700), centeredQuad(2000, 1200), 2000, 1200);
    const result = detectCorners(photo, { thumbnailLongEdge: 512 });
    expect(Math.max(result.thumbnail.width, result.thumbnail.height)).toBe(512);
  });

  it('finds the outer edge of a bordered document', () => {
    const expected = portraitQuad(1600, 1200);
    const photo = photoOfDocument(borderedDocument(900, 1200), expected, 1600, 1200);

    const result = detectCorners(photo);

    // The printed border splits the paper in two; the detector must still report the sheet,
    // not the area framed by the border.
    expectQuadClose(expected, result.photoOrder, 1600 * 0.02);
  });

  it('throws when there is no page', () => {
    const flat = new Raster(400, 300, [30, 30, 30]).toImage();
    let caught: unknown;
    try {
      detectCorners(flat);
    } catch (error) {
      caught = error;
    }
    expect(isPageFoundError(caught)).toBe(true);
  });
});
