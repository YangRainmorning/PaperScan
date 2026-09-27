declare module 'jpeg-js' {
  export interface RawImageData {
    width: number;
    height: number;
    data: Uint8Array;
  }

  export function decode(
    data: Uint8Array,
    options?: {
      useTArray?: boolean;
      formatAsRGBA?: boolean;
      maxResolutionInMP?: number;
      maxMemoryUsageInMB?: number;
      tolerantDecoding?: boolean;
    },
  ): RawImageData;

  export function encode(
    imageData: { data: Uint8Array; width: number; height: number },
    quality?: number,
  ): { data: Uint8Array };
}
