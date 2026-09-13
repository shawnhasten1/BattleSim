import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/prisma";
import { requireUserId } from "@/server/require-user";
import type { ActorFolder } from "@/lib/actor-folders";

const createSchema = z.object({
  name: z.string().min(1),
  parentId: z.string().nullable().optional()
});

export async function GET() {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const records = await prisma.actorFolder.findMany({
    where: { OR: [{ ownerId: userId }, { ownerId: null }] },
    orderBy: { name: "asc" }
  });
  return NextResponse.json({ folders: records.map(toActorFolder) });
}

export async function POST(request: Request) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const body = createSchema.parse(await request.json());
  const record = await prisma.actorFolder.create({
    data: { ownerId: userId, name: body.name, parentId: body.parentId ?? null }
  });
  return NextResponse.json({ folder: toActorFolder(record) }, { status: 201 });
}

function toActorFolder(record: { id: string; name: string; parentId: string | null }): ActorFolder {
  return { id: record.id, name: record.name, parentId: record.parentId };
}
