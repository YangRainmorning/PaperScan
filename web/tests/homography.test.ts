import { describe, expect, it } from 'vitest';
import {
  homographyFromUnitSquare,
  mapInverse,
  mapUnitSquare,
  solveLinear,
} from '../src/core/homography.js';
import type { Quad } from '../src/core/types.js';

const skewed: Quad = {
  tl: { x: 120, y: 80 },
  tr: { x: 980, y: 140 },
  br: { x: 1010, y: 1260 },
  bl: { x: 90, y: 1180 },
};

describe('solveLinear', () => {
  it('solves a small system', () => {
    // 2x + y = 5, x - y = 1  =>  x = 2, y = 1
    const result = solveLinear(
      [
        [2, 1],
        [1, -1],
      ],
      [5, 1],
      2,
    );
    expect(result[0]).toBeCloseTo(2, 12);
    expect(result[1]).toBeCloseTo(1, 12);
  });
});

describe('homographyFromUnitSquare', () => {
  it('maps the unit square onto the quad', () => {
    const h = homographyFromUnitSquare(skewed);
    for (const [u, v, expected] of [
      [0, 0, skewed.tl],
      [1, 0, skewed.tr],
      [1, 1, skewed.br],
      [0, 1, skewed.bl],
    ] as const) {
      const actual = mapUnitSquare(h, u, v);
      expect(actual.x).toBeCloseTo(expected.x, 6);
      expect(actual.y).toBeCloseTo(expected.y, 6);
    }
  });

  it.each([
    [0.25, 0.25],
    [0.5, 0.5],
    [0.1, 0.9],
    [0.9, 0.1],
  ])('inverts the forward map at (%f, %f)', (u, v) => {
    const h = homographyFromUnitSquare(skewed);
    const source = mapUnitSquare(h, u, v);
    const back = mapInverse(h, source.x, source.y);
    expect(back.x).toBeCloseTo(u, 9);
    expect(back.y).toBeCloseTo(v, 9);
  });

  it('rejects a degenerate quad', () => {
    const collapsed: Quad = {
      tl: { x: 0, y: 0 },
      tr: { x: 0, y: 0 },
      br: { x: 0, y: 0 },
      bl: { x: 0, y: 0 },
    };
    expect(() => homographyFromUnitSquare(collapsed)).toThrow(/degenerate/);
  });
});
