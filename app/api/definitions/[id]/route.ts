import { NextResponse } from "next/server";
import { z } from "zod";
import type { CreatureDefinition } from "@/engine";
import { prisma } from "@/server/prisma";

const updateSchema = z.object({
  definition: z.any()
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const record = await prisma.creatureDefinition.findUnique({ where: { id } });
  if (!record) {
    return NextResponse.json({ error: "Definition not found" }, { status: 404 });
  }
  return NextResponse.json({ definition: JSON.parse(record.data) as CreatureDefinition });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
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
  const { id } = await params;
  await prisma.creatureDefinition.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
