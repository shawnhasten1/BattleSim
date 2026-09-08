import { NextResponse } from "next/server";
import { z } from "zod";
import type { CreatureDefinition } from "@/engine";
import { prisma } from "@/server/prisma";

const definitionSchema = z.object({
  definition: z.any()
});

export async function GET() {
  const records = await prisma.creatureDefinition.findMany({
    orderBy: { updatedAt: "desc" }
  });
  return NextResponse.json({
    definitions: records.map(deserializeDefinition)
  });
}

export async function POST(request: Request) {
  const body = definitionSchema.parse(await request.json()) as { definition: CreatureDefinition };
  const definition = body.definition;
  const record = await prisma.creatureDefinition.upsert({
    where: { id: definition.id },
    create: {
      id: definition.id,
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
