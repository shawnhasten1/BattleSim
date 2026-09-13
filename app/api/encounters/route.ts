import { NextResponse } from "next/server";
import { z } from "zod";
import { encounterSnapshotSchema } from "@/engine";
import { prisma } from "@/server/prisma";
import { requireUserId } from "@/server/require-user";

const createEncounterSchema = z.object({
  projectId: z.string().min(1),
  name: z.string().min(1).optional(),
  encounter: encounterSnapshotSchema
});

export async function POST(request: Request) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const body = createEncounterSchema.parse(await request.json());
  const existingProject = await prisma.project.findUnique({
    where: { id: body.projectId },
    select: { id: true, ownerId: true }
  });
  if (!existingProject || existingProject.ownerId !== userId) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const snapshot = {
    ...body.encounter,
    id: body.encounter.id,
    name: body.name ?? body.encounter.name
  };
  const encounter = await prisma.encounter.create({
    data: {
      projectId: body.projectId,
      name: snapshot.name,
      schemaVersion: snapshot.schemaVersion,
      snapshotJson: JSON.stringify(snapshot)
    }
  });

  return NextResponse.json({ encounter: deserializeEncounter(encounter) }, { status: 201 });
}

function deserializeEncounter(record: { snapshotJson: string }) {
  return {
    ...record,
    snapshotJson: JSON.parse(record.snapshotJson)
  };
}
