/**
 * Battlemap backgrounds arrive as `FileReader.readAsDataURL` output — a raw
 * base64 data URL that for a phone photo or a VTT map export is routinely
 * 5-20 MB. That does not belong in `localStorage` (≈5 MB for the whole store)
 * and is wasteful everywhere else too (serialized on every persist write, sent
 * whole to the server on save). Downscale it to something sane before it ever
 * reaches the store.
 */

interface DownscaleOptions {
  /** Longest edge of the output, in CSS pixels. */
  maxEdge?: number;
  /** JPEG quality, 0-1. */
  quality?: number;
  /** Skip work when the source is already smaller than this many bytes. */
  passthroughBytes?: number;
}

const DEFAULTS: Required<DownscaleOptions> = {
  maxEdge: 2048,
  quality: 0.82,
  passthroughBytes: 600_000
};

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
  const { maxEdge, quality, passthroughBytes } = { ...DEFAULTS, ...options };

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

    if (withinBounds && dataUrlBytes(dataUrl) <= passthroughBytes) {
      return dataUrl;
    }

    const scale = withinBounds ? 1 : maxEdge / longest;
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return dataUrl;
    context.drawImage(image, 0, 0, width, height);

    const encoded = canvas.toDataURL("image/jpeg", quality);
    // Guard against pathological cases where re-encoding grew the payload.
    return encoded.length < dataUrl.length || !withinBounds ? encoded : dataUrl;
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
