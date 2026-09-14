// Upserts a fixed dev-only account so Claude (or anyone) can log in locally
// through the normal email/password form without going through Google OAuth.
// Writes to whatever DATABASE_URL points at — never run this against prod.
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const email = process.env.SEED_TEST_EMAIL ?? "claude-test@local.dev";
const password = process.env.SEED_TEST_PASSWORD ?? "claude-test-password";
const name = process.env.SEED_TEST_NAME ?? "Claude Test";

const prisma = new PrismaClient();

const passwordHash = await bcrypt.hash(password, 12);
const user = await prisma.user.upsert({
  where: { email },
  update: { passwordHash },
  create: { email, name, passwordHash }
});

console.log(`Seeded test user: ${user.email} (id ${user.id})`);
console.log(`Password: ${password}`);

await prisma.$disconnect();
