import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/server/prisma";
import { requireUserId } from "@/server/require-user";
import { wouldCreateCycle, type ActorFolder } from "@/lib/actor-folders";
import type { CreatureDefinition } from "@/engine";

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  parentId: z.string().nullable().optional()
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;
  const existing = await prisma.actorFolder.findUnique({ where: { id }, select: { ownerId: true } });
  if (!existing || existing.ownerId !== userId) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  const body = updateSchema.parse(await request.json());

  if (body.parentId !== undefined) {
    const folders = await prisma.actorFolder.findMany({ where: { ownerId: userId } });
    const asActorFolders: ActorFolder[] = folders.map((f) => ({ id: f.id, name: f.name, parentId: f.parentId }));
    if (wouldCreateCycle(asActorFolders, id, body.parentId)) {
      return NextResponse.json({ error: "Cannot move a folder into itself or one of its own descendants" }, { status: 400 });
    }
  }

  const record = await prisma.actorFolder.update({
    where: { id },
    data: {
      name: body.name,
      ...(body.parentId !== undefined ? { parentId: body.parentId } : {})
    }
  });
  return NextResponse.json({ folder: { id: record.id, name: record.name, parentId: record.parentId } });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;
  const existing = await prisma.actorFolder.findUnique({ where: { id }, select: { ownerId: true } });
  if (!existing || existing.ownerId !== userId) {
    return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  }

  await prisma.$transaction(async (tx) => {
    const folder = await tx.actorFolder.findUnique({ where: { id } });
    if (!folder) return;
    const newParentId = folder.parentId;

    await tx.actorFolder.updateMany({ where: { parentId: id, ownerId: userId }, data: { parentId: newParentId } });

    const definitionRecords = await tx.creatureDefinition.findMany({ where: { ownerId: userId } });
    for (const record of definitionRecords) {
      const definition = JSON.parse(record.data) as CreatureDefinition;
      if (definition.folderId !== id) continue;
      definition.folderId = newParentId;
      await tx.creatureDefinition.update({ where: { id: record.id }, data: { data: JSON.stringify(definition) } });
    }

    await tx.actorFolder.delete({ where: { id } });
  });

  return NextResponse.json({ ok: true });
}
