import { NextResponse } from "next/server";
import { prisma } from "@/server/prisma";
import { requireUserId } from "@/server/require-user";

/**
 * Lean encounter listing for the campaign picker UI — id/name/updatedAt/
 * mapImageUrl only, no snapshotJson. `GET /api/projects/[id]` also returns
 * encounters but with their full (often multi-KB) snapshot attached, which
 * is wasted bandwidth for a thumbnail grid.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const { id } = await params;
  const project = await prisma.project.findUnique({
    where: { id },
    select: { id: true, name: true, ownerId: true }
  });
  if (!project || project.ownerId !== userId) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  const encounters = await prisma.encounter.findMany({
    where: { projectId: id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, updatedAt: true, mapImageUrl: true }
  });

  return NextResponse.json({ campaign: { id: project.id, name: project.name }, encounters });
}
