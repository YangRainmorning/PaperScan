import type { RgbImage } from './core/types.js';

/** Anything above this is likely to exhaust a phone browser's memory. */
export const MAX_INPUT_PIXELS = 80_000_000;

export interface DecodedPhoto {
  /** Full-resolution RGB pixels, ready for the pipeline. */
  image: RgbImage;
  /** A downscaled copy for on-screen preview, already an object URL. */
  previewUrl: string;
  previewWidth: number;
  previewHeight: number;
}

export class ImageTooLargeError extends Error {
  constructor() {
    super('The photo is too large to process on this device.');
    this.name = 'ImageTooLargeError';
  }
}

const PREVIEW_LONG_EDGE = 1200;

/**
 * Decodes a file into a tightly packed RGB buffer plus a small preview.
 *
 * `imageOrientation: 'from-image'` matters: phone cameras record rotation in EXIF rather
 * than rotating the pixels, and without it a portrait photo arrives on its side.
 */
export async function decodePhoto(file: Blob): Promise<DecodedPhoto> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error('not-an-image');
  }

  try {
    const { width, height } = bitmap;
    if (width * height > MAX_INPUT_PIXELS) {
      throw new ImageTooLargeError();
    }

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('no-2d-context');
    context.drawImage(bitmap, 0, 0);

    const rgba = context.getImageData(0, 0, width, height).data;
    const rgb = new Uint8Array(width * height * 3);
    for (let i = 0, o = 0; i < rgba.length; i += 4, o += 3) {
      rgb[o] = rgba[i]!;
      rgb[o + 1] = rgba[i + 1]!;
      rgb[o + 2] = rgba[i + 2]!;
    }

    // Small preview for display. Kept on the main thread so the corner overlay can be
    // drawn over it after the worker has taken ownership of the full-resolution buffer.
    const scale = Math.min(1, PREVIEW_LONG_EDGE / Math.max(width, height));
    const pw = Math.max(1, Math.round(width * scale));
    const ph = Math.max(1, Math.round(height * scale));

    const previewCanvas = document.createElement('canvas');
    previewCanvas.width = pw;
    previewCanvas.height = ph;
    const previewContext = previewCanvas.getContext('2d');
    if (!previewContext) throw new Error('no-2d-context');
    previewContext.drawImage(bitmap, 0, 0, pw, ph);

    const previewUrl = await canvasToUrl(previewCanvas, 'image/jpeg', 0.85);

    return { image: { data: rgb, width, height }, previewUrl, previewWidth: pw, previewHeight: ph };
  } finally {
    bitmap.close();
  }
}

/** Wraps a raw RGB buffer in a canvas, for encoding or for drawing. */
export function toCanvas(image: RgbImage): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('no-2d-context');

  const imageData = context.createImageData(image.width, image.height);
  const target = imageData.data;
  const source = image.data;
  for (let i = 0, o = 0; i < source.length; i += 3, o += 4) {
    target[o] = source[i]!;
    target[o + 1] = source[i + 1]!;
    target[o + 2] = source[i + 2]!;
    target[o + 3] = 255;
  }
  context.putImageData(imageData, 0, 0);
  return canvas;
}

export async function encodeImage(
  image: RgbImage,
  format: 'jpeg' | 'png',
  quality = 0.92,
): Promise<Blob> {
  const canvas = toCanvas(image);
  const type = format === 'png' ? 'image/png' : 'image/jpeg';
  const blob = await canvasToBlob(canvas, type, quality);
  if (!blob) throw new Error('encode-failed');
  return blob;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

async function canvasToUrl(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<string> {
  const blob = await canvasToBlob(canvas, type, quality);
  if (!blob) throw new Error('encode-failed');
  return URL.createObjectURL(blob);
}
