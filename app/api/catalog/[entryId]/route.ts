import { NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { requireUserId } from "@/server/require-user";

/** Deletes one of the account's catalog entries, by its entry id (`homebrew:class:…`, URL-encoded). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ entryId: string }> }) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const { entryId } = await params;
  const { count } = await prisma.catalogEntry.deleteMany({ where: { ownerId: userId, entryId: decodeURIComponent(entryId) } });
  if (!count) return NextResponse.json({ error: "Entry not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
