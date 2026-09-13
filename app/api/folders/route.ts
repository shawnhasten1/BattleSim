import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/prisma";
import type { ActorFolder } from "@/lib/actor-folders";

const createSchema = z.object({
  name: z.string().min(1),
  parentId: z.string().nullable().optional()
});

export async function GET() {
  const records = await prisma.actorFolder.findMany({ orderBy: { name: "asc" } });
  return NextResponse.json({ folders: records.map(toActorFolder) });
}

export async function POST(request: Request) {
  const body = createSchema.parse(await request.json());
  const record = await prisma.actorFolder.create({
    data: { name: body.name, parentId: body.parentId ?? null }
  });
  return NextResponse.json({ folder: toActorFolder(record) }, { status: 201 });
}

function toActorFolder(record: { id: string; name: string; parentId: string | null }): ActorFolder {
  return { id: record.id, name: record.name, parentId: record.parentId };
}
