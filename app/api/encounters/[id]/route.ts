import { NextResponse } from "next/server";
import { z } from "zod";
import { encounterSnapshotSchema } from "@/engine";
import { prisma } from "@/server/prisma";
import { requireUserId } from "@/server/require-user";
import { isOwnEncounter } from "@/server/encounter-access";

const updateEncounterSchema = z.object({
  name: z.string().min(1).optional(),
  encounter: encounterSnapshotSchema.optional()
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;
  if (!(await isOwnEncounter(id, userId))) {
    return NextResponse.json({ error: "Encounter not found" }, { status: 404 });
  }
  const encounter = await prisma.encounter.findUnique({
    where: { id },
    include: {
      simulationRuns: { orderBy: { createdAt: "desc" }, take: 10 }
    }
  });
  if (!encounter) {
    return NextResponse.json({ error: "Encounter not found" }, { status: 404 });
  }
  return NextResponse.json({ encounter: deserializeEncounter(encounter) });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;
  if (!(await isOwnEncounter(id, userId))) {
    return NextResponse.json({ error: "Encounter not found" }, { status: 404 });
  }
  const body = updateEncounterSchema.parse(await request.json());
  const existing = await prisma.encounter.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Encounter not found" }, { status: 404 });
  }

  const existingSnapshot = JSON.parse(existing.snapshotJson);
  const snapshot = body.encounter
    ? {
      ...body.encounter,
      name: body.name ?? body.encounter.name
    }
    : {
      ...existingSnapshot,
      name: body.name ?? existing.name
    };

  const encounter = await prisma.encounter.update({
    where: { id },
    data: {
      name: body.name ?? snapshot.name,
      schemaVersion: snapshot.schemaVersion ?? existing.schemaVersion,
      snapshotJson: JSON.stringify(snapshot)
    }
  });

  return NextResponse.json({ encounter: deserializeEncounter(encounter) });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;
  if (!(await isOwnEncounter(id, userId))) {
    return NextResponse.json({ error: "Encounter not found" }, { status: 404 });
  }
  await prisma.encounter.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

function deserializeEncounter<T extends { snapshotJson: string; simulationRuns?: Array<{ snapshotJson: string; metricsJson: string; eventLogJson: string }> }>(record: T) {
  return {
    ...record,
    snapshotJson: JSON.parse(record.snapshotJson),
    simulationRuns: record.simulationRuns?.map((run) => ({
      ...run,
      snapshotJson: JSON.parse(run.snapshotJson),
      metricsJson: JSON.parse(run.metricsJson),
      eventLogJson: JSON.parse(run.eventLogJson)
    }))
  };
}
