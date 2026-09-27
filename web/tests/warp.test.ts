import { describe, expect, it } from 'vitest';
import { frame } from '../src/core/framer.js';
import { warp } from '../src/core/warp.js';
import type { Quad } from '../src/core/types.js';
import { Raster, centeredQuad, document, photoOfDocument, pixelAt } from './helpers.js';

function fullQuad(width: number, height: number): Quad {
  return {
    tl: { x: 0, y: 0 },
    tr: { x: width, y: 0 },
    br: { x: width, y: height },
    bl: { x: 0, y: height },
  };
}

describe('warp', () => {
  it('is an identity when the page is axis aligned and neutral', () => {
    const source = new Raster(64, 48, [250, 250, 250]).toImage();
    const result = warp(source, fullQuad(64, 48));

    expect(result.paperWidth).toBe(64);
    expect(result.paperHeight).toBe(48);
    expect(result.canvasWidth).toBe(64);
    expect(result.canvasHeight).toBe(48);
    expect(result.gains[0]).toBeCloseTo(1, 9);

    expect(result.pixels.every((value) => value === 250)).toBe(true);
  });

  it('normalises the paper to the target white', () => {
    const source = new Raster(32, 32, [200, 190, 180]).toImage();
    const result = warp(source, fullQuad(32, 32));

    expect(result.percentiles).toEqual([200, 190, 180]);

    for (let i = 0; i < result.pixels.length; i += 3) {
      expect(result.pixels[i]).toBeGreaterThanOrEqual(249);
      expect(result.pixels[i]).toBeLessThanOrEqual(251);
      expect(result.pixels[i + 1]).toBeGreaterThanOrEqual(249);
      expect(result.pixels[i + 2]).toBeGreaterThanOrEqual(249);
    }
  });

  it('grows the canvas by twice the margin', () => {
    const source = new Raster(100, 200, [250, 250, 250]).toImage();
    const result = warp(source, fullQuad(100, 200), { margin: 0.05 });

    expect(result.paperWidth).toBe(100);
    expect(result.paperHeight).toBe(200);
    expect(result.canvasWidth).toBe(110);
    expect(result.canvasHeight).toBe(220);
  });

  it('rejects an out of range margin', () => {
    const source = new Raster(8, 8, [250, 250, 250]).toImage();
    expect(() => warp(source, fullQuad(8, 8), { margin: 0.9 })).toThrow(RangeError);
  });

  it('is deterministic', () => {
    const quad = centeredQuad(320, 240);
    const photo = photoOfDocument(document(200, 260), quad, 320, 240);

    const first = warp(photo, quad);
    const second = warp(photo, quad);

    expect(Array.from(first.pixels)).toEqual(Array.from(second.pixels));
  });
});

describe('frame', () => {
  it('keeps every pixel when there is no margin', () => {
    const quad = centeredQuad(200, 160);
    const photo = photoOfDocument(document(120, 160), quad, 200, 160);
    const warped = warp(photo, quad);
    const framed = frame(warped);

    expect(framed.width).toBe(warped.canvasWidth);
    expect(framed.height).toBe(warped.canvasHeight);
    expect(Array.from(framed.data)).toEqual(Array.from(warped.pixels));
  });

  it('paints the border white when there is a margin', () => {
    const source = new Raster(80, 120, [200, 190, 180]).toImage();
    const warped = warp(source, fullQuad(80, 120), { margin: 0.1 });
    const framed = frame(warped);

    expect(framed.width).toBe(96);
    expect(framed.height).toBe(144);

    expect(pixelAt(framed, 0, 0)).toEqual([255, 255, 255]);
    expect(pixelAt(framed, framed.width - 1, 0)).toEqual([255, 255, 255]);
    expect(pixelAt(framed, 0, framed.height - 1)).toEqual([255, 255, 255]);
    expect(pixelAt(framed, framed.width - 1, framed.height - 1)).toEqual([255, 255, 255]);

    // The middle of the canvas is still the (white-balanced) page.
    const centre = pixelAt(framed, framed.width >> 1, framed.height >> 1);
    expect(centre[0]).toBeGreaterThanOrEqual(249);
    expect(centre[0]).toBeLessThanOrEqual(251);
  });
});
