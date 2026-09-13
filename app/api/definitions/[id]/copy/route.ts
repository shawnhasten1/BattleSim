import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import type { CreatureDefinition } from "@/engine";
import { prisma } from "@/server/prisma";
import { requireUserId } from "@/server/require-user";

/**
 * Clones a definition into the caller's own library — the only way to
 * customize a shared template (`ownerId: null`), since the mutate routes
 * reject anyone editing a row they don't own. Also works on your own actor
 * (an explicit duplicate), but not on someone else's private actor.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;
  const source = await prisma.creatureDefinition.findUnique({ where: { id } });
  if (!source || (source.ownerId !== null && source.ownerId !== userId)) {
    return NextResponse.json({ error: "Definition not found" }, { status: 404 });
  }

  const sourceDefinition = JSON.parse(source.data) as CreatureDefinition;
  const newId = randomUUID();
  const copiedDefinition: CreatureDefinition = {
    ...sourceDefinition,
    id: newId,
    name: source.ownerId === null ? `${sourceDefinition.name} (Copy)` : sourceDefinition.name
  };

  const record = await prisma.creatureDefinition.create({
    data: {
      id: newId,
      ownerId: userId,
      copiedFromId: source.id,
      name: copiedDefinition.name,
      sourceKey: source.sourceKey,
      sourceName: source.sourceName,
      sourceSlug: source.sourceSlug,
      importedAt: source.importedAt,
      schemaVersion: source.schemaVersion,
      data: JSON.stringify(copiedDefinition),
      importedJson: source.importedJson
    }
  });

  return NextResponse.json({ definition: JSON.parse(record.data) as CreatureDefinition }, { status: 201 });
}
