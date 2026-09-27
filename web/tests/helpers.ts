import { mapInverse, homographyFromUnitSquare } from '../src/core/homography.js';
import type { Quad, RgbImage } from '../src/core/types.js';

export const PAPER: readonly [number, number, number] = [235, 227, 212];
export const INK: readonly [number, number, number] = [40, 38, 36];
export const BACKGROUND: readonly [number, number, number] = [45, 52, 58];

/** A minimal RGB raster with the handful of drawing primitives the fixtures need. */
export class Raster {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number, fill: readonly [number, number, number]) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 3);
    this.fill(fill);
  }

  fill(color: readonly [number, number, number]): void {
    for (let i = 0; i < this.data.length; i += 3) {
      this.data[i] = color[0];
      this.data[i + 1] = color[1];
      this.data[i + 2] = color[2];
    }
  }

  set(x: number, y: number, color: readonly [number, number, number]): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 3;
    this.data[i] = color[0];
    this.data[i + 1] = color[1];
    this.data[i + 2] = color[2];
  }

  rect(x: number, y: number, w: number, h: number, color: readonly [number, number, number]): void {
    for (let dy = 0; dy < h; dy++) {
      for (let dx = 0; dx < w; dx++) {
        this.set(x + dx, y + dy, color);
      }
    }
  }

  toImage(): RgbImage {
    return { data: this.data, width: this.width, height: this.height };
  }
}

/**
 * An upright document: warm paper, a couple of printed rules and some text-like bars.
 *
 * The decoration deliberately never encloses the paper. The corner detector picks the
 * largest connected run of "bright and warm" pixels, so a closed printed border would make
 * it lock onto the framed area instead of the sheet — which is exactly what
 * `borderedDocument` is for.
 */
export function document(width = 900, height = 1200): RgbImage {
  const raster = new Raster(width, height, PAPER);
  const margin = 40;

  raster.rect(margin + 20, 60, width - 2 * margin - 40, 8, INK);
  raster.rect(margin + 20, height - 68, width - 2 * margin - 40, 8, INK);

  for (let line = 0; line < 22; line++) {
    const y = 120 + line * 44;
    if (y + 14 >= height - 120) break;
    const length = 120 + ((line * 37) % 11) * 50;
    raster.rect(110, y, Math.min(length, width - 220), 14, INK);
  }

  return raster.toImage();
}

/** A document with a closed printed border — the shape that breaks naive corner detection. */
export function borderedDocument(width = 900, height = 1200): RgbImage {
  const raster = new Raster(width, height, PAPER);
  const outer = 45;
  const thickness = 10;

  raster.rect(outer, outer, width - 2 * outer, thickness, INK);
  raster.rect(outer, height - outer - thickness, width - 2 * outer, thickness, INK);
  raster.rect(outer, outer, thickness, height - 2 * outer, INK);
  raster.rect(width - outer - thickness, outer, thickness, height - 2 * outer, INK);

  return raster.toImage();
}

/** A page quad that is roughly centred in a photo of the given size. */
export function centeredQuad(width: number, height: number): Quad {
  return {
    tl: { x: width * 0.18, y: height * 0.12 },
    tr: { x: width * 0.82, y: height * 0.17 },
    br: { x: width * 0.8, y: height * 0.88 },
    bl: { x: width * 0.2, y: height * 0.84 },
  };
}

/** A tall, only mildly skewed page quad — what a phone held upright produces. */
export function portraitQuad(width: number, height: number): Quad {
  return {
    tl: { x: width * 0.3, y: height * 0.06 },
    tr: { x: width * 0.72, y: height * 0.09 },
    br: { x: width * 0.68, y: height * 0.94 },
    bl: { x: width * 0.26, y: height * 0.91 },
  };
}

/**
 * Perspective-blits `doc` into `quad` on a dark background, producing something that looks
 * like a phone photo of a page.
 */
export function photoOfDocument(
  doc: RgbImage,
  quad: Quad,
  width: number,
  height: number,
): RgbImage {
  const photo = new Raster(width, height, BACKGROUND);
  const inverse = homographyFromUnitSquare(quad);
  const dw = doc.width;
  const dh = doc.height;
  const src = doc.data;
  const out = photo.data;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const uv = mapInverse(inverse, x + 0.5, y + 0.5);
      if (uv.x < 0 || uv.x >= 1 || uv.y < 0 || uv.y >= 1) continue;

      const sx = Math.min(dw - 1, Math.max(0, (uv.x * dw) | 0));
      const sy = Math.min(dh - 1, Math.max(0, (uv.y * dh) | 0));
      const i = (sy * dw + sx) * 3;
      const o = (y * width + x) * 3;
      out[o] = src[i]!;
      out[o + 1] = src[i + 1]!;
      out[o + 2] = src[i + 2]!;
    }
  }

  return photo.toImage();
}

/** A canvas of paper with dark bands along the requested edges. */
export function canvasWithBorder(
  width: number,
  height: number,
  darkTop: number,
  darkLeft: number,
  darkRight: number,
  darkBottom: number,
): Uint8Array {
  const data = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const dark = y < darkTop || y >= height - darkBottom || x < darkLeft || x >= width - darkRight;
      const i = (y * width + x) * 3;
      const value = dark ? 30 : 240;
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
    }
  }
  return data;
}

export function luma(r: number, g: number, b: number): number {
  return (r * 299 + g * 587 + b * 114) / 1000;
}

export function pixelAt(image: RgbImage, x: number, y: number): [number, number, number] {
  const i = (y * image.width + x) * 3;
  return [image.data[i]!, image.data[i + 1]!, image.data[i + 2]!];
}

/** Depth of a nested object, used to prove the core never allocates per pixel. */
export function mib(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
