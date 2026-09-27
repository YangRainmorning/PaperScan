import { describe, expect, it } from 'vitest';
import { cropImage, findCrop } from '../src/core/trim.js';
import { canvasWithBorder } from './helpers.js';

describe('findCrop', () => {
  it('removes a dark border on every side', () => {
    const width = 400;
    const height = 300;
    const data = canvasWithBorder(width, height, 20, 15, 25, 30);

    const crop = findCrop(data, width, height);

    expect(crop).not.toBeNull();
    expect(crop!.x).toBeGreaterThanOrEqual(15);
    expect(crop!.x).toBeLessThanOrEqual(20);
    expect(crop!.y).toBeGreaterThanOrEqual(20);
    expect(crop!.y).toBeLessThanOrEqual(25);
    expect(crop!.width).toBeGreaterThanOrEqual(348);
    expect(crop!.width).toBeLessThanOrEqual(362);
    expect(crop!.height).toBeGreaterThanOrEqual(238);
    expect(crop!.height).toBeLessThanOrEqual(252);
  });

  it('leaves nothing dark inside the result', () => {
    const width = 320;
    const height = 240;
    const data = canvasWithBorder(width, height, 18, 12, 22, 14);

    const crop = findCrop(data, width, height)!;

    for (let y = crop.y; y < crop.y + crop.height; y++) {
      for (let x = crop.x; x < crop.x + crop.width; x++) {
        const i = (y * width + x) * 3;
        expect(data[i]).toBeGreaterThanOrEqual(240);
      }
    }
  });

  it('returns the whole canvas when nothing is bright', () => {
    const width = 200;
    const height = 150;
    const data = new Uint8Array(width * height * 3).fill(30);

    expect(findCrop(data, width, height)).toEqual({ x: 0, y: 0, width, height });
  });

  it('returns null when the crop would be degenerate', () => {
    const data = canvasWithBorder(200, 150, 20, 20, 20, 20);
    expect(findCrop(data, 200, 150, { minKeptSize: 5000 })).toBeNull();
  });
});

describe('cropImage', () => {
  it('copies exactly the requested rectangle', () => {
    const width = 10;
    const height = 8;
    const data = new Uint8Array(width * height * 3);
    for (let i = 0; i < data.length; i++) {
      data[i] = i % 251;
    }

    const rect = { x: 2, y: 3, width: 4, height: 2 };
    const cropped = cropImage({ data, width, height }, rect);

    expect(cropped.width).toBe(4);
    expect(cropped.height).toBe(2);

    for (let y = 0; y < rect.height; y++) {
      for (let x = 0; x < rect.width; x++) {
        const expected = ((rect.y + y) * width + rect.x + x) * 3;
        const actual = (y * rect.width + x) * 3;
        expect(cropped.data[actual]).toBe(data[expected]);
        expect(cropped.data[actual + 1]).toBe(data[expected + 1]);
        expect(cropped.data[actual + 2]).toBe(data[expected + 2]);
      }
    }
  });

  it('rejects a rectangle outside the canvas', () => {
    const image = { data: new Uint8Array(10 * 10 * 3), width: 10, height: 10 };
    expect(() => cropImage(image, { x: 5, y: 5, width: 20, height: 20 })).toThrow(RangeError);
  });
});
