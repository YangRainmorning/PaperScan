import type { Point, Quad } from './types.js';

/**
 * A planar homography mapping the unit square (0,0)-(1,1) onto an arbitrary quadrilateral,
 * plus the inverse mapping used to locate source pixels inside the warped canvas.
 */
export interface Homography {
  /** h11 h12 h13 h21 h22 h23 h31 h32, with h33 fixed at 1. */
  readonly h: Float64Array;
}

/**
 * Dense Gauss-Jordan elimination with partial pivoting. Small systems only.
 * The input matrices are not modified.
 */
export function solveLinear(a: readonly number[][], b: readonly number[], n: number): number[] {
  const m = a.map((row) => row.slice());
  const rhs = b.slice();

  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(m[r]![i]!) > Math.abs(m[pivot]![i]!)) {
        pivot = r;
      }
    }

    if (pivot !== i) {
      const tmpRow = m[i]!;
      m[i] = m[pivot]!;
      m[pivot] = tmpRow;
      const tmpB = rhs[i]!;
      rhs[i] = rhs[pivot]!;
      rhs[pivot] = tmpB;
    }

    const p = m[i]![i]!;
    if (Math.abs(p) < 1e-15) {
      throw new Error('The corner set is degenerate: the system has no unique solution.');
    }

    for (let c = i; c < n; c++) {
      m[i]![c] = m[i]![c]! / p;
    }
    rhs[i] = rhs[i]! / p;

    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const f = m[r]![i]!;
      if (f === 0) continue;
      for (let c = i; c < n; c++) {
        m[r]![c] = m[r]![c]! - f * m[i]![c]!;
      }
      rhs[r] = rhs[r]! - f * rhs[i]!;
    }
  }

  return rhs;
}

/** Builds the homography sending (0,0),(1,0),(1,1),(0,1) to the quad's four corners. */
export function homographyFromUnitSquare(quad: Quad): Homography {
  const corners = [quad.tl, quad.tr, quad.br, quad.bl];
  const u = [0, 1, 1, 0];
  const v = [0, 0, 1, 1];

  const a: number[][] = [];
  for (let i = 0; i < 8; i++) a.push(new Array<number>(8).fill(0));
  const b = new Array<number>(8).fill(0);

  for (let i = 0; i < 4; i++) {
    const x = corners[i]!.x;
    const y = corners[i]!.y;
    const du = u[i]!;
    const dv = v[i]!;

    a[i * 2]![0] = du;
    a[i * 2]![1] = dv;
    a[i * 2]![2] = 1;
    a[i * 2]![6] = -du * x;
    a[i * 2]![7] = -dv * x;
    b[i * 2] = x;

    a[i * 2 + 1]![3] = du;
    a[i * 2 + 1]![4] = dv;
    a[i * 2 + 1]![5] = 1;
    a[i * 2 + 1]![6] = -du * y;
    a[i * 2 + 1]![7] = -dv * y;
    b[i * 2 + 1] = y;
  }

  return { h: Float64Array.from(solveLinear(a, b, 8)) };
}

/** Forward map: unit-square coordinates to source pixel coordinates. */
export function mapUnitSquare(h: Homography, u: number, v: number): Point {
  const c = h.h;
  const den = c[6]! * u + c[7]! * v + 1;
  return {
    x: (c[0]! * u + c[1]! * v + c[2]!) / den,
    y: (c[3]! * u + c[4]! * v + c[5]!) / den,
  };
}

/**
 * Inverse map: solves `mapUnitSquare(u, v) == (x, y)`. Used to find where a source point
 * lands on the warped canvas.
 */
export function mapInverse(h: Homography, x: number, y: number): Point {
  const c = h.h;
  const a11 = c[0]! - x * c[6]!;
  const a12 = c[1]! - x * c[7]!;
  const b1 = x - c[2]!;
  const a21 = c[3]! - y * c[6]!;
  const a22 = c[4]! - y * c[7]!;
  const b2 = y - c[5]!;

  const det = a11 * a22 - a12 * a21;
  if (Math.abs(det) < 1e-12) {
    return { x: 0.5, y: 0.5 };
  }

  return {
    x: (b1 * a22 - a12 * b2) / det,
    y: (a11 * b2 - b1 * a21) / det,
  };
}
