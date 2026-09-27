import { describe, expect, it } from 'vitest';
import { rotate90 } from '../src/core/rotate.js';
import type { RgbImage } from '../src/core/types.js';

/** A 3x2 image where every pixel encodes its own coordinates. */
function marked(): RgbImage {
  const data = new Uint8Array(3 * 2 * 3);
  for (let y = 0; y < 2; y++) {
    for (let x = 0; x < 3; x++) {
      const i = (y * 3 + x) * 3;
      data[i] = x * 10;
      data[i + 1] = y * 10;
      data[i + 2] = 0;
    }
  }
  return { data, width: 3, height: 2 };
}

function read(image: RgbImage, x: number, y: number): [number, number] {
  const i = (y * image.width + x) * 3;
  return [image.data[i]!, image.data[i + 1]!];
}

describe('rotate90', () => {
  it('returns the same image for a multiple of four turns', () => {
    const source = marked();
    expect(rotate90(source, 0)).toBe(source);
    expect(rotate90(source, 4)).toBe(source);
    expect(rotate90(source, -4)).toBe(source);
  });

  it('swaps the axes for odd turns', () => {
    expect(rotate90(marked(), 1)).toMatchObject({ width: 2, height: 3 });
    expect(rotate90(marked(), 3)).toMatchObject({ width: 2, height: 3 });
  });

  it('keeps the axes for two turns', () => {
    expect(rotate90(marked(), 2)).toMatchObject({ width: 3, height: 2 });
  });

  it('moves the top-left corner to the top-right going clockwise', () => {
    const rotated = rotate90(marked(), 1);
    // Source (0,0) -> destination (outW - 1, 0).
    expect(read(rotated, rotated.width - 1, 0)).toEqual([0, 0]);
    // Source (2,0) -> destination (outW - 1, outH - 1).
    expect(read(rotated, rotated.width - 1, rotated.height - 1)).toEqual([20, 0]);
  });

  it('moves the top-left corner to the bottom-left going anticlockwise', () => {
    const rotated = rotate90(marked(), 3);
    expect(read(rotated, 0, rotated.height - 1)).toEqual([0, 0]);
  });

  it('is the inverse of itself at two turns', () => {
    const once = rotate90(marked(), 2);
    const twice = rotate90(once, 2);
    expect(Array.from(twice.data)).toEqual(Array.from(marked().data));
  });

  it('round-trips through four turns', () => {
    let image = marked();
    for (let i = 0; i < 4; i++) {
      image = rotate90(image, 1);
    }
    expect(image.width).toBe(3);
    expect(image.height).toBe(2);
    expect(Array.from(image.data)).toEqual(Array.from(marked().data));
  });
});
