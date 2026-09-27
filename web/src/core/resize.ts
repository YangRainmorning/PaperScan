import type { RgbImage } from './types.js';

/** Long edge, in pixels, of the thumbnail the detector works on. */
export function thumbnailSize(
  width: number,
  height: number,
  longEdge: number,
): { width: number; height: number } {
  const scale = longEdge / Math.max(width, height);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Area-averaging downscale.
 *
 * Every destination pixel is the exact area-weighted mean of the source rectangle it
 * covers, which is the right low-pass filter for the large reduction ratios used here
 * (a 50 MP photo becomes a 1024px thumbnail) and — unlike a separable kernel — is exactly
 * reproducible, so the tests can assert on it.
 */
export function downscale(source: RgbImage, width: number, height: number): RgbImage {
  const sw = source.width;
  const sh = source.height;
  const src = source.data;
  const out = new Uint8Array(width * height * 3);

  const scaleX = sw / width;
  const scaleY = sh / height;

  for (let y = 0; y < height; y++) {
    const y0 = y * scaleY;
    const y1 = y0 + scaleY;
    const iy0 = Math.floor(y0);
    const iy1 = Math.min(Math.ceil(y1), sh);

    for (let x = 0; x < width; x++) {
      const x0 = x * scaleX;
      const x1 = x0 + scaleX;
      const ix0 = Math.floor(x0);
      const ix1 = Math.min(Math.ceil(x1), sw);

      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let sumW = 0;

      for (let sy = iy0; sy < iy1; sy++) {
        const wy = Math.min(sy + 1, y1) - Math.max(sy, y0);
        if (wy <= 0) continue;

        let rowBase = (sy * sw + ix0) * 3;
        for (let sx = ix0; sx < ix1; sx++, rowBase += 3) {
          const wx = Math.min(sx + 1, x1) - Math.max(sx, x0);
          if (wx <= 0) continue;
          const w = wx * wy;
          sumR += src[rowBase]! * w;
          sumG += src[rowBase + 1]! * w;
          sumB += src[rowBase + 2]! * w;
          sumW += w;
        }
      }

      const o = (y * width + x) * 3;
      if (sumW > 0) {
        out[o] = clampByte(Math.round(sumR / sumW));
        out[o + 1] = clampByte(Math.round(sumG / sumW));
        out[o + 2] = clampByte(Math.round(sumB / sumW));
      }
    }
  }

  return { data: out, width, height };
}

export function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}
