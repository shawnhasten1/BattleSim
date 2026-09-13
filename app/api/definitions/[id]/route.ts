import { NextResponse } from "next/server";
import { z } from "zod";
import type { CreatureDefinition } from "@/engine";
import { prisma } from "@/server/prisma";
import { requireUserId } from "@/server/require-user";

const updateSchema = z.object({
  definition: z.any()
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;
  const record = await prisma.creatureDefinition.findUnique({ where: { id } });
  if (!record || (record.ownerId !== null && record.ownerId !== userId)) {
    return NextResponse.json({ error: "Definition not found" }, { status: 404 });
  }
  return NextResponse.json({ definition: JSON.parse(record.data) as CreatureDefinition });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;
  const existing = await prisma.creatureDefinition.findUnique({ where: { id }, select: { ownerId: true } });
  if (!existing) {
    return NextResponse.json({ error: "Definition not found" }, { status: 404 });
  }
  if (existing.ownerId !== userId) {
    return NextResponse.json({ error: "You don't own this actor" }, { status: 403 });
  }

  const body = updateSchema.parse(await request.json()) as { definition: CreatureDefinition };
  const definition = { ...body.definition, id };
  const record = await prisma.creatureDefinition.update({
    where: { id },
    data: {
      name: definition.name,
      sourceKey: definition.source?.documentKey ?? definition.source?.provider,
      sourceName: definition.source?.documentName,
      sourceSlug: definition.source?.slug,
      importedAt: definition.source?.importedAt ? new Date(definition.source.importedAt) : undefined,
      schemaVersion: 1,
      data: JSON.stringify(definition),
      importedJson: definition.source ? JSON.stringify(definition.source) : undefined
    }
  });
  return NextResponse.json({ definition: JSON.parse(record.data) as CreatureDefinition });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;
  const existing = await prisma.creatureDefinition.findUnique({ where: { id }, select: { ownerId: true } });
  if (!existing) {
    return NextResponse.json({ error: "Definition not found" }, { status: 404 });
  }
  if (existing.ownerId !== userId) {
    return NextResponse.json({ error: "You don't own this actor" }, { status: 403 });
  }
  await prisma.creatureDefinition.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
