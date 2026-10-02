/**
 * Battlemap backgrounds arrive as `FileReader.readAsDataURL` output — a raw
 * base64 data URL that for a phone photo or a VTT map export is routinely
 * 5-20 MB. That does not belong in `localStorage` (≈5 MB for the whole store)
 * and is wasteful everywhere else too (serialized on every persist write, sent
 * whole to the server on save). Downscale it to something sane before it ever
 * reaches the store.
 */

export interface DownscaleOptions {
  /** Longest edge of the output, in CSS pixels. */
  maxEdge?: number;
  /** JPEG quality, 0-1. */
  quality?: number;
  /** Skip work when the source is already smaller than this many bytes. */
  passthroughBytes?: number;
  /** Most characters in the output data URL: quality, then size, steps down until it fits. */
  maxChars?: number;
}

const DEFAULTS: Required<DownscaleOptions> = {
  maxEdge: 2048,
  quality: 0.82,
  passthroughBytes: 600_000,
  maxChars: Number.POSITIVE_INFINITY
};

/** A map background is stored at up to about this many px per square: sharp at 3× zoom. */
export const STORED_PX_PER_SQUARE = 100;
/** The longest edge a map background is stored at. 4096 × 4096 is also iOS Safari's canvas limit (16.7 MP). */
export const MAP_MAX_EDGE = 4096;
/**
 * The most characters a stored map background's data URL may have. The
 * Blob sync posts it as JSON, and Vercel functions take request bodies up to
 * 4.5 MB.
 */
export const MAP_MAX_DATA_URL_CHARS = 3_500_000;

/**
 * How to store a map background: about 100 px per square when its grid is
 * known (an export at 200 px per square is halved; one at 70 is kept whole),
 * never past a 4096 px edge, and within the Blob sync's size budget.
 */
export function mapStorageOptions(size: ImagePixelSize | null | undefined, pxPerSquare?: number): DownscaleOptions {
  const options = { maxEdge: MAP_MAX_EDGE, maxChars: MAP_MAX_DATA_URL_CHARS };
  if (!size) return options;
  const longest = Math.max(size.widthPx, size.heightPx);
  const perSquare = pxPerSquare && pxPerSquare > STORED_PX_PER_SQUARE ? STORED_PX_PER_SQUARE / pxPerSquare : 1;
  return { ...options, maxEdge: Math.max(1, Math.min(MAP_MAX_EDGE, Math.floor(longest * perSquare))) };
}

/**
 * Encode at falling quality, then falling size, until the result fits
 * `maxChars`. `encode` draws at `scale` (of the planned size) and `quality`.
 * Gives the last, smallest attempt if even `minScale` doesn't fit.
 */
export function encodeWithinBudget(encode: (scale: number, quality: number) => string, quality: number, maxChars: number, minScale = 0.25): string {
  let scale = 1;
  let current = quality;
  let encoded = encode(scale, current);
  while (encoded.length > maxChars && scale > minScale) {
    if (current > 0.62) current = Math.round((current - 0.1) * 100) / 100;
    else scale *= 0.85;
    encoded = encode(scale, current);
  }
  return encoded;
}

/** Rough byte length of a data URL's payload without decoding it. */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return dataUrl.length;
  const body = dataUrl.slice(comma + 1);
  const padding = body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0;
  return Math.floor((body.length * 3) / 4) - padding;
}

/**
 * Return a data URL no larger than `maxEdge` on its longest side, re-encoded as
 * JPEG. Small inputs pass straight through. Resolves to the original string if
 * anything about the decode/encode fails, so an upload never hard-fails here.
 */
export async function downscaleDataUrl(dataUrl: string, options: DownscaleOptions = {}): Promise<string> {
  const { maxEdge, quality, passthroughBytes, maxChars } = { ...DEFAULTS, ...options };

  if (typeof document === "undefined" || !dataUrl.startsWith("data:image/")) {
    return dataUrl;
  }
  if (dataUrl.startsWith("data:image/svg")) {
    return dataUrl; // vector — rasterizing would only make it bigger
  }

  try {
    const image = await loadImage(dataUrl);
    const longest = Math.max(image.naturalWidth, image.naturalHeight);
    const withinBounds = longest <= maxEdge;

    if (withinBounds && dataUrlBytes(dataUrl) <= passthroughBytes && dataUrl.length <= maxChars) {
      return dataUrl;
    }

    const planned = withinBounds ? 1 : maxEdge / longest;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;
    const encoded = encodeWithinBudget((scale, q) => {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * planned * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * planned * scale));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", q);
    }, quality, maxChars);
    // Guard against pathological cases where re-encoding grew the payload.
    return encoded.length < dataUrl.length || !withinBounds || dataUrl.length > maxChars ? encoded : dataUrl;
  } catch {
    return dataUrl;
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image decode failed"));
    image.src = src;
  });
}

export interface ImagePixelSize {
  widthPx: number;
  heightPx: number;
}

/**
 * A battlemap file as picked: its data URL and its own pixel size, measured
 * before anything downscales it. A VTT export is exactly columns × its px per
 * square, so this size is what a grid can be read from. `size` is null when
 * the file can't be decoded.
 */
export interface MapImageFile {
  dataUrl: string;
  fileName: string;
  size: ImagePixelSize | null;
}

/** Read a picked file for use as a map background. Null if the file can't be read at all. */
export async function readMapImageFile(file: File): Promise<MapImageFile | null> {
  const dataUrl = await readAsDataUrl(file);
  if (!dataUrl) return null;
  const dims = await getImageDimensions(dataUrl);
  return { dataUrl, fileName: file.name, size: dims ? { widthPx: dims.width, heightPx: dims.height } : null };
}

function readAsDataUrl(file: Blob): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

/**
 * An image's luma (0–255, row by row) at its own size, for finding a grid
 * drawn on it. Null if it can't be decoded or read back.
 */
export async function readImageLuma(src: string): Promise<{ luma: Float32Array; width: number; height: number } | null> {
  if (typeof document === "undefined") return null;
  try {
    const image = await loadImage(src);
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context || !width || !height) return null;
    context.drawImage(image, 0, 0);
    const { data } = context.getImageData(0, 0, width, height);
    const luma = new Float32Array(width * height);
    for (let i = 0, j = 0; i < luma.length; i++, j += 4) luma[i] = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
    return { luma, width, height };
  } catch {
    return null;
  }
}

/** Natural pixel dimensions of a data URL, or null if it can't be decoded. */
export async function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number } | null> {
  if (typeof document === "undefined" || !dataUrl.startsWith("data:image/")) {
    return null;
  }
  try {
    const image = await loadImage(dataUrl);
    return { width: image.naturalWidth, height: image.naturalHeight };
  } catch {
    return null;
  }
}
