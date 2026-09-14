import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/prisma";
import { requireUserId } from "@/server/require-user";
import { encounterSnapshotSchema } from "@/engine";

const createProjectSchema = z.object({
  name: z.string().min(1).default("Untitled Encounter Project"),
  description: z.string().optional(),
  encounter: encounterSnapshotSchema
});

export async function GET() {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const projects = await prisma.project.findMany({
    where: { ownerId: userId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      description: true,
      coverImageUrl: true,
      updatedAt: true,
      encounters: {
        orderBy: { updatedAt: "desc" },
        select: { id: true, name: true, updatedAt: true }
      }
    }
  });
  return NextResponse.json({ projects });
}

export async function POST(request: Request) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const body = createProjectSchema.parse(await request.json());
  const project = await prisma.project.create({
    data: {
      ownerId: userId,
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
      encounters: { orderBy: { createdAt: "desc" } }
    }
  });
  return NextResponse.json({ project }, { status: 201 });
}
