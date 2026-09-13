// One-off Phase 3 backfill: assigns every currently-unowned Project and
// ActorFolder to a given user, and splits CreatureDefinition rows —
// source-imported ones stay ownerId: null (shared/system templates),
// homebrew ones (no source) are assigned to the given user.
//
// Usage: node scripts/backfill-owners.mjs <owner-email>
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const ownerEmail = process.argv[2];
  if (!ownerEmail) {
    console.error("Usage: node scripts/backfill-owners.mjs <owner-email>");
    process.exitCode = 1;
    return;
  }

  const owner = await prisma.user.findUnique({ where: { email: ownerEmail } });
  if (!owner) {
    console.error(`No user found with email ${ownerEmail}`);
    process.exitCode = 1;
    return;
  }

  const projects = await prisma.project.updateMany({
    where: { ownerId: null },
    data: { ownerId: owner.id }
  });
  console.log(`Projects assigned to ${ownerEmail}: ${projects.count}`);

  const folders = await prisma.actorFolder.updateMany({
    where: { ownerId: null },
    data: { ownerId: owner.id }
  });
  console.log(`Actor folders assigned to ${ownerEmail}: ${folders.count}`);

  const definitions = await prisma.creatureDefinition.findMany({ where: { ownerId: null } });
  let templateCount = 0;
  let homebrewCount = 0;
  for (const definition of definitions) {
    const isImported = Boolean(definition.sourceKey || definition.importedJson);
    if (isImported) {
      templateCount += 1;
      continue;
    }
    await prisma.creatureDefinition.update({ where: { id: definition.id }, data: { ownerId: owner.id } });
    homebrewCount += 1;
  }
  console.log(`Definitions kept as shared templates (source-imported): ${templateCount}`);
  console.log(`Definitions assigned to ${ownerEmail} (homebrew): ${homebrewCount}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
