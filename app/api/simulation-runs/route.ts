import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/prisma";
import { requireUserId } from "@/server/require-user";
import { isOwnEncounter } from "@/server/encounter-access";
import { encounterSnapshotSchema } from "@/engine";

const runSchema = z.object({
  encounterId: z.string(),
  seed: z.string(),
  outcome: z.string(),
  rounds: z.number().int().min(0),
  snapshot: encounterSnapshotSchema,
  metrics: z.record(z.unknown()),
  eventLog: z.array(z.record(z.unknown()))
});

export async function POST(request: Request) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const body = runSchema.parse(await request.json());
  if (!(await isOwnEncounter(body.encounterId, userId))) {
    return NextResponse.json({ error: "Encounter not found" }, { status: 404 });
  }

  const run = await prisma.simulationRun.create({
    data: {
      encounterId: body.encounterId,
      seed: body.seed,
      outcome: body.outcome,
      rounds: body.rounds,
      snapshotJson: JSON.stringify(body.snapshot),
      metricsJson: JSON.stringify(body.metrics),
      eventLogJson: JSON.stringify(body.eventLog)
    }
  });
  return NextResponse.json({ run }, { status: 201 });
}
