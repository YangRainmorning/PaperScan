import { describe, expect, it } from 'vitest';
import { runPipeline } from '../src/core/pipeline.js';
import { downscale } from '../src/core/resize.js';
import { isPageFoundError, type Quad, type RgbImage } from '../src/core/types.js';
import { document, luma, photoOfDocument, pixelAt, portraitQuad, Raster } from './helpers.js';

/** (100,40) to (500,600) inside a 640x700 photo, holding a 400x560 document. */
const axisAlignedQuad: Quad = {
  tl: { x: 100, y: 40 },
  tr: { x: 500, y: 40 },
  br: { x: 500, y: 600 },
  bl: { x: 100, y: 600 },
};

function writePhoto(quad: Quad, documentWidth: number, documentHeight: number): RgbImage {
  return photoOfDocument(document(documentWidth, documentHeight), quad, 640, 700);
}

describe('runPipeline', () => {
  it('rectifies to the document size with manual corners', () => {
    const photo = writePhoto(axisAlignedQuad, 400, 560);

    const result = runPipeline(photo, { corners: axisAlignedQuad });

    expect(result.manualCorners).toBe(true);
    expect(result.paperWidth).toBe(400);
    expect(result.paperHeight).toBe(560);

    // The trimmer shaves the 2px pad off each edge.
    expect(result.image.width).toBeGreaterThanOrEqual(390);
    expect(result.image.width).toBeLessThanOrEqual(400);
    expect(result.image.height).toBeGreaterThanOrEqual(545);
    expect(result.image.height).toBeLessThanOrEqual(560);
  });

  it('leaves no dark border on the output', () => {
    const photo = writePhoto(axisAlignedQuad, 400, 560);
    const result = runPipeline(photo, { corners: axisAlignedQuad });

    const { image } = result;
    let minLuma = Number.MAX_VALUE;

    for (let x = 0; x < image.width; x++) {
      for (const y of [0, image.height - 1]) {
        const [r, g, b] = pixelAt(image, x, y);
        minLuma = Math.min(minLuma, luma(r, g, b));
      }
    }
    for (let y = 0; y < image.height; y++) {
      for (const x of [0, image.width - 1]) {
        const [r, g, b] = pixelAt(image, x, y);
        minLuma = Math.min(minLuma, luma(r, g, b));
      }
    }

    expect(minLuma).toBeGreaterThan(180);
  });

  it('detects corners automatically when none are given', () => {
    const photo = writePhoto(portraitQuad(640, 700), 400, 560);

    const result = runPipeline(photo, { readingEdge: 'top' });

    expect(result.manualCorners).toBe(false);
    expect(result.detection).not.toBeNull();
    expect(result.paperFraction).toBeGreaterThan(0.2);
    expect(result.paperFraction).toBeLessThan(0.6);

    // The portrait quad on a 640x700 photo measures roughly 270 x 596.
    expect(result.paperWidth).toBeGreaterThanOrEqual(240);
    expect(result.paperWidth).toBeLessThanOrEqual(300);
    expect(result.paperHeight).toBeGreaterThanOrEqual(540);
    expect(result.paperHeight).toBeLessThanOrEqual(650);
  });

  it('reports the stages it went through', () => {
    const photo = writePhoto(axisAlignedQuad, 200, 280);
    const stages: string[] = [];

    runPipeline(photo, { corners: axisAlignedQuad }, (stage) => stages.push(stage));

    expect(stages).toContain('rectify');
    expect(stages).toContain('trim');
    expect(stages).not.toContain('detect');
  });

  it('skips trimming when asked', () => {
    const photo = writePhoto(axisAlignedQuad, 400, 560);
    const result = runPipeline(photo, { corners: axisAlignedQuad, autoTrim: false });

    expect(result.crop).toBeNull();
    expect(result.image.width).toBe(result.canvasWidth);
    expect(result.image.height).toBe(result.canvasHeight);
  });

  it('throws a recognisable error when there is no page', () => {
    const flat = new Raster(400, 300, [30, 30, 30]).toImage();
    let caught: unknown;
    try {
      runPipeline(flat, { readingEdge: 'top' });
    } catch (error) {
      caught = error;
    }
    expect(isPageFoundError(caught)).toBe(true);
  });

  it('can be downscaled for a smaller download', () => {
    const photo = writePhoto(axisAlignedQuad, 400, 560);
    const result = runPipeline(photo, { corners: axisAlignedQuad });

    const small = downscale(result.image, 200, Math.round((200 * result.image.height) / result.image.width));
    expect(small.width).toBe(200);
    expect(luma(...pixelAt(small, 100, 100))).toBeGreaterThan(180);
  });
});
