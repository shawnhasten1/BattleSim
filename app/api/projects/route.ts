import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/prisma";
import { encounterSnapshotSchema } from "@/engine";

const createProjectSchema = z.object({
  name: z.string().min(1).default("Untitled Encounter Project"),
  description: z.string().optional(),
  encounter: encounterSnapshotSchema
});

export async function GET() {
  const projects = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      description: true,
      updatedAt: true,
      encounters: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: { id: true, name: true }
      }
    }
  });
  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  const body = createProjectSchema.parse(await request.json());
  const project = await prisma.project.create({
    data: {
      name: body.name,
      description: body.description,
      maps: {
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
        }
      },
      encounters: {
        create: {
          name: body.encounter.name,
          schemaVersion: body.encounter.schemaVersion,
          snapshotJson: JSON.stringify(body.encounter)
        }
      }
    },
    include: {
      encounters: { take: 1, orderBy: { createdAt: "desc" } }
    }
  });
  return NextResponse.json({ project }, { status: 201 });
}
