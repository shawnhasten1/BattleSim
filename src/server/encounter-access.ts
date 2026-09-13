import { prisma } from "@/server/prisma";

/** Encounters have no ownerId of their own — ownership is via their parent Project. */
export async function isOwnEncounter(encounterId: string, userId: string): Promise<boolean> {
  const encounter = await prisma.encounter.findUnique({
    where: { id: encounterId },
    select: { project: { select: { ownerId: true } } }
  });
  return encounter?.project.ownerId === userId;
}
