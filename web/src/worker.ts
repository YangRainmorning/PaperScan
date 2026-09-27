import type { ScanStage } from './core/pipeline.js';
import { isPageFoundError, quadFromArray, type ReadingEdge, type RgbImage } from './core/types.js';
import { runPipeline } from './core/pipeline.js';
import { downscale } from './core/resize.js';

export interface ScanRequest {
  id: number;
  /** Transferred from the main thread, so this is the only copy while the scan runs. */
  data: ArrayBuffer;
  width: number;
  height: number;
  corners: number[] | null;
  readingEdge: ReadingEdge;
  autoTrim: boolean;
  margin: number;
  maxLongEdge: number | null;
}

export interface ScanStats {
  paperWidth: number;
  paperHeight: number;
  canvasWidth: number;
  canvasHeight: number;
  crop: { x: number; y: number; width: number; height: number } | null;
  percentiles: [number, number, number];
  gains: [number, number, number];
  paperFraction: number;
  elapsedMs: number;
}

export type ScanResponse =
  | { id: number; type: 'progress'; stage: ScanStage }
  | {
      id: number;
      type: 'done';
      data: ArrayBuffer;
      width: number;
      height: number;
      paperQuad: number[];
      manualCorners: boolean;
      stats: ScanStats;
    }
  | { id: number; type: 'error'; message: string; noPage: boolean };

/**
 * The whole pipeline runs here rather than on the main thread, so the spinner keeps
 * spinning and the page stays responsive during the multi-second loops over a 40 MP image.
 * `core/` has no DOM dependency precisely so that it can run in this context unchanged.
 */
const ctx = self as unknown as {
  postMessage(message: ScanResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ScanRequest>) => void) | null;
};

ctx.onmessage = (event: MessageEvent<ScanRequest>) => {
  const request = event.data;
  const { id } = request;

  try {
    let source: RgbImage = {
      data: new Uint8Array(request.data),
      width: request.width,
      height: request.height,
    };

    const result = runPipeline(
      source,
      {
        corners: request.corners ? quadFromArray(request.corners) : null,
        readingEdge: request.readingEdge,
        autoTrim: request.autoTrim,
        warp: { margin: request.margin },
      },
      (stage) => ctx.postMessage({ id, type: 'progress', stage }),
    );

    let output = result.image;
    if (request.maxLongEdge && Math.max(output.width, output.height) > request.maxLongEdge) {
      const scale = request.maxLongEdge / Math.max(output.width, output.height);
      output = downscale(
        output,
        Math.max(1, Math.round(output.width * scale)),
        Math.max(1, Math.round(output.height * scale)),
      );
    }

    source = { data: new Uint8Array(0), width: 0, height: 0 };

    const buffer = output.data.buffer as ArrayBuffer;
    ctx.postMessage(
      {
        id,
        type: 'done',
        data: buffer,
        width: output.width,
        height: output.height,
        paperQuad: [
          result.paperQuad.tl.x, result.paperQuad.tl.y,
          result.paperQuad.tr.x, result.paperQuad.tr.y,
          result.paperQuad.br.x, result.paperQuad.br.y,
          result.paperQuad.bl.x, result.paperQuad.bl.y,
        ],
        manualCorners: result.manualCorners,
        stats: {
          paperWidth: result.paperWidth,
          paperHeight: result.paperHeight,
          canvasWidth: result.canvasWidth,
          canvasHeight: result.canvasHeight,
          crop: result.crop,
          percentiles: result.percentiles,
          gains: result.gains,
          paperFraction: result.paperFraction,
          elapsedMs: result.elapsedMs,
        },
      },
      [buffer],
    );
  } catch (error) {
    ctx.postMessage({
      id,
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
      noPage: isPageFoundError(error),
    });
  }
};
