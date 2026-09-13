import { NextResponse } from "next/server";
import { z } from "zod";
import type { CreatureDefinition } from "@/engine";
import { prisma } from "@/server/prisma";
import { requireUserId } from "@/server/require-user";

const definitionSchema = z.object({
  definition: z.any()
});

export async function GET() {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const records = await prisma.creatureDefinition.findMany({
    where: { OR: [{ ownerId: userId }, { ownerId: null }] },
    orderBy: { updatedAt: "desc" }
  });
  return NextResponse.json({
    definitions: records.map(deserializeDefinition),
    templateIds: records.filter((record) => record.ownerId === null).map((record) => record.id)
  });
}

export async function POST(request: Request) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const body = definitionSchema.parse(await request.json()) as { definition: CreatureDefinition };
  const definition = body.definition;

  const existing = await prisma.creatureDefinition.findUnique({
    where: { id: definition.id },
    select: { ownerId: true }
  });
  if (existing && existing.ownerId !== userId) {
    // Someone else's actor, or a shared template — this route only ever
    // edits your own rows. Templates are cloned via the copy endpoint instead.
    return NextResponse.json({ error: "You don't own this actor" }, { status: 403 });
  }

  const record = await prisma.creatureDefinition.upsert({
    where: { id: definition.id },
    create: {
      id: definition.id,
      ownerId: userId,
      name: definition.name,
      sourceKey: definition.source?.documentKey ?? definition.source?.provider,
      sourceName: definition.source?.documentName,
      sourceSlug: definition.source?.slug,
      importedAt: definition.source?.importedAt ? new Date(definition.source.importedAt) : undefined,
      schemaVersion: 1,
      data: JSON.stringify(definition),
      importedJson: definition.source ? JSON.stringify(definition.source) : undefined
    },
    update: {
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
  return NextResponse.json({ definition: deserializeDefinition(record) }, { status: 201 });
}

function deserializeDefinition(record: { data: string }) {
  return JSON.parse(record.data) as CreatureDefinition;
}
