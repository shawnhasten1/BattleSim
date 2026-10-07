import { NextResponse } from "next/server";
import { parseSavedAbility, type SavedAbility } from "@/lib/ability-editor/my-library";
import { prisma } from "@/server/prisma";
import { requireUserId } from "@/server/require-user";

/** Where My library's entries are kept: the account's catalog table, under a kind of their own. */
const KIND = "ability";

/** The account's library of saved abilities (My library): items, weapons, spells and features to use on any creature. */
export async function GET() {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const records = await prisma.catalogEntry.findMany({ where: { ownerId: userId, kind: KIND }, orderBy: { name: "asc" } });
  const entries: SavedAbility[] = [];
  const problems: string[] = [];
  for (const record of records) {
    const result = parseSavedAbility(JSON.parse(record.data));
    if (result.entry) entries.push(result.entry);
    else problems.push(`${record.name}: ${result.problem}`);
  }
  return NextResponse.json({ entries, problems });
}

/** Saves one entry (`{ entry }`): a new id adds it, one the account has replaces it. */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const body = await request.json().catch(() => null) as { entry?: unknown } | null;
  const result = parseSavedAbility(body?.entry);
  if (!result.entry) return NextResponse.json({ error: result.problem }, { status: 400 });

  const entry = result.entry;
  const fields = { kind: KIND, name: entry.name, sourceKey: "mine", sourceName: "My library", schemaVersion: 1, data: JSON.stringify(entry) };
  await prisma.catalogEntry.upsert({
    where: { ownerId_entryId: { ownerId: userId, entryId: entry.id } },
    create: { ownerId: userId, entryId: entry.id, ...fields },
    update: fields
  });
  return NextResponse.json({ entry }, { status: 201 });
}
