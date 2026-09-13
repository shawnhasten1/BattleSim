import { NextResponse } from "next/server";
import { z } from "zod";
import { put, del } from "@vercel/blob";
import { prisma } from "@/server/prisma";
import { requireUserId } from "@/server/require-user";
import { isOwnEncounter } from "@/server/encounter-access";

const uploadSchema = z.object({
  dataUrl: z.string().regex(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "Expected a base64 image data URL")
});

function parseDataUrl(dataUrl: string): { buffer: Buffer; contentType: string; extension: string } {
  const [header, base64] = dataUrl.split(",", 2);
  const contentType = header.slice("data:".length, header.indexOf(";"));
  const extension = contentType.split("/")[1] ?? "png";
  return { buffer: Buffer.from(base64, "base64"), contentType, extension };
}

/**
 * Persists an encounter's map background to Vercel Blob (CDN-served) so it's
 * visible from any device the owner logs into — not just the browser whose
 * IndexedDB originally cached it. See mapImageStore.ts for the local cache
 * half of this, and encounter-store.ts's setMapImage for how the two combine.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;
  if (!(await isOwnEncounter(id, userId))) {
    return NextResponse.json({ error: "Encounter not found" }, { status: 404 });
  }

  const body = uploadSchema.parse(await request.json());
  const { buffer, contentType, extension } = parseDataUrl(body.dataUrl);

  const previous = await prisma.encounter.findUnique({ where: { id }, select: { mapImageUrl: true } });

  const blob = await put(`map-images/${id}.${extension}`, buffer, {
    access: "public",
    contentType,
    addRandomSuffix: false,
    allowOverwrite: true
  });

  await prisma.encounter.update({ where: { id }, data: { mapImageUrl: blob.url } });

  if (previous?.mapImageUrl && previous.mapImageUrl !== blob.url) {
    await del(previous.mapImageUrl).catch(() => undefined);
  }

  return NextResponse.json({ url: blob.url });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;
  if (!(await isOwnEncounter(id, userId))) {
    return NextResponse.json({ error: "Encounter not found" }, { status: 404 });
  }

  const existing = await prisma.encounter.findUnique({ where: { id }, select: { mapImageUrl: true } });
  await prisma.encounter.update({ where: { id }, data: { mapImageUrl: null } });
  if (existing?.mapImageUrl) {
    await del(existing.mapImageUrl).catch(() => undefined);
  }

  return NextResponse.json({ ok: true });
}
