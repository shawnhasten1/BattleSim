import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/prisma";
import { requireUserId } from "@/server/require-user";
import { replaceBlobImage, deleteBlobImage, readBlobImage } from "@/server/blob-image";

const uploadSchema = z.object({
  dataUrl: z.string().regex(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "Expected a base64 image data URL")
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;
  const existing = await prisma.project.findUnique({ where: { id }, select: { ownerId: true, coverImageUrl: true } });
  if (!existing || existing.ownerId !== userId || !existing.coverImageUrl) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const blob = await readBlobImage(existing.coverImageUrl);
  if (!blob) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(blob.stream, {
    headers: { "Content-Type": blob.contentType, "Cache-Control": "private, no-cache" }
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;
  const existing = await prisma.project.findUnique({ where: { id }, select: { ownerId: true, coverImageUrl: true } });
  if (!existing || existing.ownerId !== userId) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const body = uploadSchema.parse(await request.json());
  const url = await replaceBlobImage(`campaign-covers/${id}`, body.dataUrl, existing.coverImageUrl);
  await prisma.project.update({ where: { id }, data: { coverImageUrl: url } });

  return NextResponse.json({ url });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;
  const existing = await prisma.project.findUnique({ where: { id }, select: { ownerId: true, coverImageUrl: true } });
  if (!existing || existing.ownerId !== userId) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  await prisma.project.update({ where: { id }, data: { coverImageUrl: null } });
  await deleteBlobImage(existing.coverImageUrl);

  return NextResponse.json({ ok: true });
}
