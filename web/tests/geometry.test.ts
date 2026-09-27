import { describe, expect, it } from 'vitest';
import {
  centroid,
  expandAboutCentroid,
  nextReadingEdge,
  paperSize,
  parseQuad,
  quadFromArray,
  quadToArray,
  rotateQuad,
  type Quad,
} from '../src/core/types.js';

const unit: Quad = {
  tl: { x: 0, y: 0 },
  tr: { x: 1, y: 0 },
  br: { x: 1, y: 1 },
  bl: { x: 0, y: 1 },
};

describe('parseQuad', () => {
  it('reads corners in reading order', () => {
    const quad = parseQuad('10,20; 30,40; 50,60; 70,80');
    expect(quad).toEqual({
      tl: { x: 10, y: 20 },
      tr: { x: 30, y: 40 },
      br: { x: 50, y: 60 },
      bl: { x: 70, y: 80 },
    });
  });

  it('round-trips through the flat array form', () => {
    const quad = parseQuad('1,2;3,4;5,6;7,8');
    expect(quadToArray(quadFromArray(quadToArray(quad)))).toEqual(quadToArray(quad));
  });

  it.each(['', '1,2;3,4', '1,2;3,4;5,6;7,8;9,10', '1,2;3,4;5,6;7', 'a,b;3,4;5,6;7,8'])(
    'rejects malformed input %j',
    (text) => {
      expect(() => parseQuad(text)).toThrow();
    },
  );
});

describe('rotateQuad', () => {
  it('relabels the corners for each reading edge', () => {
    expect(rotateQuad(unit, 'top').tl).toEqual(unit.tl);
    expect(rotateQuad(unit, 'right').tl).toEqual(unit.tr);
    expect(rotateQuad(unit, 'bottom').tl).toEqual(unit.br);
    expect(rotateQuad(unit, 'left').tl).toEqual(unit.bl);
  });

  it('is cyclic', () => {
    const quad: Quad = {
      tl: { x: 0, y: 0 },
      tr: { x: 10, y: 1 },
      br: { x: 9, y: 11 },
      bl: { x: -1, y: 10 },
    };
    const rotated = rotateQuad(
      rotateQuad(rotateQuad(rotateQuad(quad, 'right'), 'right'), 'right'),
      'right',
    );
    expect(quadToArray(rotated)).toEqual(quadToArray(quad));
  });

  it('cycles through the edges in order', () => {
    expect(nextReadingEdge('top')).toBe('right');
    expect(nextReadingEdge('right')).toBe('bottom');
    expect(nextReadingEdge('bottom')).toBe('left');
    expect(nextReadingEdge('left')).toBe('top');
  });
});

describe('quad metrics', () => {
  it('uses the mean of opposite edges for the page size', () => {
    const quad: Quad = {
      tl: { x: 0, y: 0 },
      tr: { x: 100, y: 0 },
      br: { x: 100, y: 200 },
      bl: { x: 0, y: 200 },
    };
    expect(paperSize(quad)).toEqual({ width: 100, height: 200 });
  });

  it('keeps the centre when expanding', () => {
    const quad: Quad = {
      tl: { x: 0, y: 0 },
      tr: { x: 100, y: 0 },
      br: { x: 100, y: 100 },
      bl: { x: 0, y: 100 },
    };
    const grown = expandAboutCentroid(quad, 2);
    expect(centroid(grown)).toEqual({ x: 50, y: 50 });
    expect(grown.tl).toEqual({ x: -50, y: -50 });
    expect(grown.br).toEqual({ x: 150, y: 150 });
  });
});
