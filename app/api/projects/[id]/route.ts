import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/prisma";
import { requireUserId } from "@/server/require-user";
import { encounterSnapshotSchema } from "@/engine";

const updateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  encounter: encounterSnapshotSchema.optional()
});

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      maps: { orderBy: { updatedAt: "desc" } },
      encounters: { orderBy: { updatedAt: "desc" }, include: { simulationRuns: { orderBy: { createdAt: "desc" }, take: 10 } } }
    }
  });
  if (!project || project.ownerId !== userId) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  return NextResponse.json({ project: deserializeProject(project) });
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;
  const body = updateProjectSchema.parse(await request.json());
  const existing = await prisma.project.findUnique({
    where: { id },
    include: { encounters: { orderBy: { updatedAt: "desc" }, take: 1 }, maps: { orderBy: { updatedAt: "desc" }, take: 1 } }
  });
  if (!existing || existing.ownerId !== userId) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const project = await prisma.project.update({
    where: { id },
    data: {
      name: body.name ?? existing.name,
      description: body.description,
      ...(body.encounter
        ? {
          encounters: {
            upsert: {
              where: { id: existing.encounters[0]?.id ?? "__missing__" },
              create: {
                name: body.encounter.name,
                schemaVersion: body.encounter.schemaVersion,
                snapshotJson: JSON.stringify(body.encounter)
              },
              update: {
                name: body.encounter.name,
                schemaVersion: body.encounter.schemaVersion,
                snapshotJson: JSON.stringify(body.encounter)
              }
            }
          },
          maps: {
            upsert: {
              where: { id: existing.maps[0]?.id ?? "__missing__" },
              create: {
                name: body.encounter.map.name,
                gridSizePx: body.encounter.map.grid.squareSizePx ?? 44,
                gridOffsetX: body.encounter.map.image?.offsetX ?? 0,
                gridOffsetY: body.encounter.map.image?.offsetY ?? 0,
                distancePerSq: body.encounter.map.grid.distancePerSquare,
                widthSquares: body.encounter.map.grid.width,
                heightSquares: body.encounter.map.grid.height,
                wallsJson: JSON.stringify(body.encounter.map.walls),
                terrainJson: JSON.stringify(body.encounter.map.terrain)
              },
              update: {
                name: body.encounter.map.name,
                gridSizePx: body.encounter.map.grid.squareSizePx ?? 44,
                gridOffsetX: body.encounter.map.image?.offsetX ?? 0,
                gridOffsetY: body.encounter.map.image?.offsetY ?? 0,
                distancePerSq: body.encounter.map.grid.distancePerSquare,
                widthSquares: body.encounter.map.grid.width,
                heightSquares: body.encounter.map.grid.height,
                wallsJson: JSON.stringify(body.encounter.map.walls),
                terrainJson: JSON.stringify(body.encounter.map.terrain)
              }
            }
          }
        }
        : {})
    },
    include: { encounters: { orderBy: { updatedAt: "desc" }, take: 1 } }
  });
  return NextResponse.json({ project });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;
  const existing = await prisma.project.findUnique({ where: { id }, select: { ownerId: true } });
  if (!existing || existing.ownerId !== userId) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }
  await prisma.project.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}

function deserializeProject<T extends { maps: Array<{ wallsJson: string; terrainJson: string }>; encounters: Array<{ snapshotJson: string; simulationRuns?: Array<{ snapshotJson: string; metricsJson: string; eventLogJson: string }> }> }>(project: T) {
  return {
    ...project,
    maps: project.maps.map((map) => ({
      ...map,
      wallsJson: JSON.parse(map.wallsJson),
      terrainJson: JSON.parse(map.terrainJson)
    })),
    encounters: project.encounters.map((encounter) => ({
      ...encounter,
      snapshotJson: JSON.parse(encounter.snapshotJson),
      simulationRuns: encounter.simulationRuns?.map((run) => ({
        ...run,
        snapshotJson: JSON.parse(run.snapshotJson),
        metricsJson: JSON.parse(run.metricsJson),
        eventLogJson: JSON.parse(run.eventLogJson)
      }))
    }))
  };
}
