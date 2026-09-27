/**
 * Core value types. This module — and everything under `core/` — is deliberately free of
 * any DOM, canvas or Node dependency, so the same code runs in the browser and in tests.
 */

/** A tightly packed, top-down 24-bit RGB buffer: `width * height * 3` bytes. */
export interface RgbImage {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface Point {
  x: number;
  y: number;
}

/**
 * The four corners of the page, always in *reading order*: top-left, top-right,
 * bottom-right, bottom-left — the order you would name them looking at the page the right
 * way up, which is not necessarily the order they appear in the photo.
 */
export interface Quad {
  tl: Point;
  tr: Point;
  br: Point;
  bl: Point;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Which edge of the photo the page's readable "up" direction points at. Used to relabel a
 * detected quad, which always comes back in photo orientation.
 */
export type ReadingEdge = 'top' | 'right' | 'bottom' | 'left';

export const READING_EDGES: readonly ReadingEdge[] = ['top', 'right', 'bottom', 'left'];

export function order(quad: Quad): [Point, Point, Point, Point] {
  return [quad.tl, quad.tr, quad.br, quad.bl];
}

export function centroid(quad: Quad): Point {
  return {
    x: (quad.tl.x + quad.tr.x + quad.br.x + quad.bl.x) / 4,
    y: (quad.tl.y + quad.tr.y + quad.br.y + quad.bl.y) / 4,
  };
}

export function distance(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Average width and height of the page in source pixels. */
export function paperSize(quad: Quad): { width: number; height: number } {
  return {
    width: (distance(quad.tl, quad.tr) + distance(quad.bl, quad.br)) / 2,
    height: (distance(quad.tl, quad.bl) + distance(quad.tr, quad.br)) / 2,
  };
}

export function expandAboutCentroid(quad: Quad, factor: number): Quad {
  const c = centroid(quad);
  const grow = (p: Point): Point => ({
    x: c.x + (p.x - c.x) * factor,
    y: c.y + (p.y - c.y) * factor,
  });
  return { tl: grow(quad.tl), tr: grow(quad.tr), br: grow(quad.br), bl: grow(quad.bl) };
}

/** Relabels a photo-order quad so its corners are in reading order for the given edge. */
export function rotateQuad(quad: Quad, edge: ReadingEdge): Quad {
  switch (edge) {
    case 'top':
      return quad;
    case 'right':
      return { tl: quad.tr, tr: quad.br, br: quad.bl, bl: quad.tl };
    case 'bottom':
      return { tl: quad.br, tr: quad.bl, br: quad.tl, bl: quad.tr };
    case 'left':
      return { tl: quad.bl, tr: quad.tl, br: quad.tr, bl: quad.br };
  }
}

export function nextReadingEdge(edge: ReadingEdge): ReadingEdge {
  const index = READING_EDGES.indexOf(edge);
  return READING_EDGES[(index + 1) % READING_EDGES.length]!;
}

export function quadToArray(quad: Quad): number[] {
  return [quad.tl.x, quad.tl.y, quad.tr.x, quad.tr.y, quad.br.x, quad.br.y, quad.bl.x, quad.bl.y];
}

export function quadFromArray(values: readonly number[]): Quad {
  if (values.length !== 8) {
    throw new Error(`A quad needs 8 numbers, got ${values.length}.`);
  }
  return {
    tl: { x: values[0]!, y: values[1]! },
    tr: { x: values[2]!, y: values[3]! },
    br: { x: values[4]!, y: values[5]! },
    bl: { x: values[6]!, y: values[7]! },
  };
}

export function formatQuad(quad: Quad): string {
  return quadToArray(quad)
    .map((v) => (Math.round(v * 100) / 100).toString())
    .join(',')
    .replace(/,(\d)/g, ',$1');
}

/** Parses `"x,y;x,y;x,y;x,y"`, the format the CLI accepts. */
export function parseQuad(text: string): Quad {
  const groups = text
    .split(';')
    .map((g) => g.trim())
    .filter((g) => g.length > 0);

  if (groups.length !== 4) {
    throw new Error(`Expected 4 corner groups separated by ';', got ${groups.length}.`);
  }

  const values: number[] = [];
  for (const group of groups) {
    const parts = group.split(',').map((p) => p.trim());
    if (parts.length !== 2) {
      throw new Error(`Corner '${group}' is not a valid "x,y" pair.`);
    }
    const x = Number(parts[0]);
    const y = Number(parts[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error(`Corner '${group}' is not a valid "x,y" pair.`);
    }
    values.push(x, y);
  }

  return quadFromArray(values);
}

export function isPageFoundError(error: unknown): error is NoPageFoundError {
  return error instanceof NoPageFoundError;
}

/** Thrown when a photo contains nothing that looks like a page. */
export class NoPageFoundError extends Error {
  constructor() {
    super(
      'No page was found in this photo. Try photographing it against a contrasting ' +
        'background with even lighting.',
    );
    this.name = 'NoPageFoundError';
  }
}
