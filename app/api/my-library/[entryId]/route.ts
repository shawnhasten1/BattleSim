import { NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { requireUserId } from "@/server/require-user";

/** Removes one of the account's saved abilities, by its id (`mine:…`, URL-encoded). Copies already on sheets stay. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ entryId: string }> }) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const { entryId } = await params;
  const { count } = await prisma.catalogEntry.deleteMany({ where: { ownerId: userId, kind: "ability", entryId: decodeURIComponent(entryId) } });
  if (!count) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
