/**
 * Regression against the reference certificate — the same photo the C# engine and the
 * original PowerShell v0 tool were validated on.
 *
 * The photo is somebody's real document, so it is not in the repository. Point
 * `PAPERSCAN_REGRESSION_JPEG` at it to run this file; otherwise it is skipped.
 *
 *   PAPERSCAN_REGRESSION_JPEG=.../certificate.jpg npm test
 *
 * Expected values come from the C# baseline:
 *
 *   paperscan certificate.jpg -r right -c "5834,456;5789,7975;489,7975;424,520"
 *   -> page 7487 x 5355, paper white R212 G203 B191, gains R1.179 G1.232 B1.309
 */
import { existsSync, readFileSync } from 'node:fs';
import { decode as decodeJpeg } from 'jpeg-js';
import { describe, expect, it } from 'vitest';
import { runPipeline } from '../src/core/pipeline.js';
import { parseQuad, type RgbImage } from '../src/core/types.js';
import { luma, pixelAt } from './helpers.js';

const fixture = process.env.PAPERSCAN_REGRESSION_JPEG;
const available = Boolean(fixture && existsSync(fixture));

const MANUAL_CORNERS = '5834,456;5789,7975;489,7975;424,520';

function loadJpegRgb(path: string): RgbImage {
  const raw = decodeJpeg(readFileSync(path), {
    useTArray: true,
    formatAsRGBA: true,
    maxResolutionInMP: 200,
    maxMemoryUsageInMB: 4096,
  });

  const pixels = raw.data;
  const out = new Uint8Array(raw.width * raw.height * 3);
  for (let i = 0, o = 0; i < pixels.length; i += 4, o += 3) {
    out[o] = pixels[i]!;
    out[o + 1] = pixels[i + 1]!;
    out[o + 2] = pixels[i + 2]!;
  }

  return { data: out, width: raw.width, height: raw.height };
}

/**
 * Brightest pixel found in the four corner patches of the photo — i.e. how bright the
 * surface the page was lying on gets. The scan's border must beat this.
 */
function maxBackgroundLuma(image: RgbImage): number {
  const patch = Math.min(240, Math.floor(Math.min(image.width, image.height) / 8));
  const origins: Array<[number, number]> = [
    [0, 0],
    [image.width - patch, 0],
    [0, image.height - patch],
    [image.width - patch, image.height - patch],
  ];

  let brightest = 0;
  for (const [ox, oy] of origins) {
    for (let y = 0; y < patch; y += 3) {
      for (let x = 0; x < patch; x += 3) {
        brightest = Math.max(brightest, luma(...pixelAt(image, ox + x, oy + y)));
      }
    }
  }
  return brightest;
}

describe.skipIf(!available)('reference certificate', () => {
  it('reproduces the C# baseline', () => {
    const source = loadJpegRgb(fixture!);
    expect(source.width).toBe(6144);
    expect(source.height).toBe(8192);

    const result = runPipeline(source, {
      corners: parseQuad(MANUAL_CORNERS),
      readingEdge: 'right',
    });

    // Geometry is exact: the canvas size comes from the page quad's own edge lengths.
    expect(result.paperWidth).toBe(7487);
    expect(result.paperHeight).toBe(5355);

    console.log(
      `  page ${result.paperWidth}x${result.paperHeight}  ` +
        `paper white R${result.percentiles[0]} G${result.percentiles[1]} B${result.percentiles[2]}  ` +
        `gains R${result.gains[0].toFixed(3)} G${result.gains[1].toFixed(3)} B${result.gains[2].toFixed(3)}  ` +
        `crop ${JSON.stringify(result.crop)}  ` +
        `final ${result.image.width}x${result.image.height}  ` +
        `${(result.elapsedMs / 1000).toFixed(1)}s`,
    );

    // The white-balance statistics track the C# engine to within one level per channel. The
    // difference is the JPEG decoder: jpeg-js, GDI+ and ImageSharp each round the inverse
    // DCT slightly differently, and the percentile lands one bucket away as a result.
    const expectedPercentiles = [212, 203, 191];
    for (let c = 0; c < 3; c++) {
      expect(Math.abs(result.percentiles[c]! - expectedPercentiles[c]!)).toBeLessThanOrEqual(1);
    }
    expect(result.gains[0]).toBeCloseTo(1.179, 1);
    expect(result.gains[1]).toBeCloseTo(1.232, 1);
    expect(result.gains[2]).toBeCloseTo(1.309, 1);

    // ...and the trim agrees on three of four edges. The fourth depends on how the JPEG
    // decoder rounds: GDI+, ImageSharp and jpeg-js each differ by +-1-3 per channel on
    // roughly a quarter of the pixels, which can flip one of the 120 probes by two pixels.
    expect(result.crop).not.toBeNull();
    expect(result.crop!.x).toBe(8);
    expect(result.crop!.y).toBe(19);
    expect(result.canvasHeight - (result.crop!.y + result.crop!.height)).toBe(46);
    const rightTrim = result.canvasWidth - (result.crop!.x + result.crop!.width);
    expect(rightTrim).toBeGreaterThanOrEqual(27);
    expect(rightTrim).toBeLessThanOrEqual(33);

    expect(result.image.height).toBe(5290);
    expect(result.image.width).toBeGreaterThanOrEqual(7444);
    expect(result.image.width).toBeLessThanOrEqual(7454);

    // The property the trimmer exists to guarantee: every border pixel is paper, not the
    // dark surround the homography pulled in. Rather than assert an arbitrary brightness,
    // measure the surround in the source photo itself and require every border pixel to be
    // brighter than it.
    const backgroundMax = maxBackgroundLuma(source);

    const { image } = result;
    let minLuma = Number.MAX_VALUE;
    for (let x = 0; x < image.width; x++) {
      for (const y of [0, image.height - 1]) {
        minLuma = Math.min(minLuma, luma(...pixelAt(image, x, y)));
      }
    }
    for (let y = 0; y < image.height; y++) {
      for (const x of [0, image.width - 1]) {
        minLuma = Math.min(minLuma, luma(...pixelAt(image, x, y)));
      }
    }

    console.log(
      `  outermost row/column min luma ${minLuma.toFixed(1)}, ` +
        `source background max luma ${backgroundMax.toFixed(1)}`,
    );

    expect(minLuma).toBeGreaterThan(backgroundMax);
  }, 300_000);

  it('detects the corners on this photo', () => {
    const source = loadJpegRgb(fixture!);

    // No manual corners: the detector has to find the page by itself.
    //
    // The blob pass alone is rough — on this photo it is 320 px out on one corner, because
    // the sheet lies on a pale wooden table over a patterned quilt and both have patches
    // that pass the "bright and warm" paper test. Snapping each edge onto the outermost
    // strong step in the image brings that to under 25 px vertically, which is what removes
    // the visible tilt.
    const manual = parseQuad(MANUAL_CORNERS);
    const result = runPipeline(source, { readingEdge: 'right' });

    expect(result.manualCorners).toBe(false);
    expect(result.paperFraction).toBeGreaterThan(0.3);

    const detected = result.paperQuad;
    console.log(`  manual     ${manual}`);
    console.log(`  detected   ${detected}`);

    const keys = ['tl', 'tr', 'br', 'bl'] as const;
    let worstX = 0;
    let worstY = 0;
    for (const key of keys) {
      worstX = Math.max(worstX, Math.abs(detected[key].x - manual[key].x));
      worstY = Math.max(worstY, Math.abs(detected[key].y - manual[key].y));
    }
    console.log(`  worst error dx ${worstX.toFixed(0)} dy ${worstY.toFixed(0)}`);

    // 150 px on a 7500 px edge is 2% — not exact, but the tilt is gone. The web app still
    // puts a draggable handle on each corner, because this is a heuristic on a photograph
    // and there is no threshold that makes it exact.
    expect(worstY).toBeLessThan(60);
    expect(worstX).toBeLessThan(150);
  }, 300_000);
});
