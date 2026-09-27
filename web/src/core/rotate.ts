import type { RgbImage } from './types.js';

/**
 * Rotates an image by a multiple of 90 degrees clockwise.
 *
 * Rotating the rectified canvas is exactly equivalent to re-warping with a different
 * reading edge — the page is the same physical region either way — but it costs one pass
 * over the pixels instead of a full re-detection and re-warp, which is what makes a live
 * orientation picker affordable.
 */
export function rotate90(image: RgbImage, quarterTurns: number): RgbImage {
  const turns = ((Math.trunc(quarterTurns) % 4) + 4) % 4;
  if (turns === 0) {
    return image;
  }

  const { data: src, width: w, height: h } = image;
  const swapAxes = turns === 1 || turns === 3;
  const outW = swapAxes ? h : w;
  const outH = swapAxes ? w : h;
  const out = new Uint8Array(outW * outH * 3);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let nx: number;
      let ny: number;
      switch (turns) {
        case 1:
          // 90 clockwise: the old top edge becomes the new right edge.
          nx = h - 1 - y;
          ny = x;
          break;
        case 2:
          nx = w - 1 - x;
          ny = h - 1 - y;
          break;
        default:
          // 270 clockwise.
          nx = y;
          ny = w - 1 - x;
          break;
      }

      const s = (y * w + x) * 3;
      const d = (ny * outW + nx) * 3;
      out[d] = src[s]!;
      out[d + 1] = src[s + 1]!;
      out[d + 2] = src[s + 2]!;
    }
  }

  return { data: out, width: outW, height: outH };
}
