import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/prisma";
import { requireUserId } from "@/server/require-user";
import { isOwnEncounter } from "@/server/encounter-access";
import { replaceBlobImage, deleteBlobImage } from "@/server/blob-image";

const uploadSchema = z.object({
  dataUrl: z.string().regex(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "Expected a base64 image data URL")
});

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
  const previous = await prisma.encounter.findUnique({ where: { id }, select: { mapImageUrl: true } });

  const url = await replaceBlobImage(`map-images/${id}`, body.dataUrl, previous?.mapImageUrl ?? null);
  await prisma.encounter.update({ where: { id }, data: { mapImageUrl: url } });

  return NextResponse.json({ url });
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
  await deleteBlobImage(existing?.mapImageUrl ?? null);

  return NextResponse.json({ ok: true });
}
