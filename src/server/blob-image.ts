import { put, del, get } from "@vercel/blob";

/** Splits a `data:image/...;base64,...` URL into bytes + content type. */
export function parseDataUrl(dataUrl: string): { buffer: Buffer; contentType: string; extension: string } {
  const [header, base64] = dataUrl.split(",", 2);
  const contentType = header.slice("data:".length, header.indexOf(";"));
  const extension = contentType.split("/")[1] ?? "png";
  return { buffer: Buffer.from(base64, "base64"), contentType, extension };
}

/**
 * Uploads a data URL to Vercel Blob at a stable pathname (so re-uploads
 * overwrite in place), then deletes whatever it replaced. Used for both
 * encounter map backgrounds and campaign cover thumbnails.
 */
export async function replaceBlobImage(
  pathnameBase: string,
  dataUrl: string,
  previousUrl: string | null
): Promise<string> {
  const { buffer, contentType, extension } = parseDataUrl(dataUrl);
  const blob = await put(`${pathnameBase}.${extension}`, buffer, {
    access: "private",
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true
  });
  if (previousUrl && previousUrl !== blob.url) {
    await del(previousUrl).catch(() => undefined);
  }
  return blob.url;
}

export async function deleteBlobImage(url: string | null): Promise<void> {
  if (!url) return;
  await del(url).catch(() => undefined);
}

/** Streams a private blob's bytes + content type, or null if it doesn't exist. */
export async function readBlobImage(url: string): Promise<{ stream: ReadableStream; contentType: string } | null> {
  const result = await get(url, { access: "private" });
  if (result?.statusCode !== 200) return null;
  return { stream: result.stream, contentType: result.blob.contentType };
}
