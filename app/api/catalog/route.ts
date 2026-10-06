import { NextResponse } from "next/server";
import { parseCatalogEntry, type CatalogEntry } from "@/lib/character-builder/homebrew";
import { prisma } from "@/server/prisma";
import { requireUserId } from "@/server/require-user";

/** The account's homebrew and imported catalog entries (classes, subclasses, feats, backgrounds, species). */
export async function GET() {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const records = await prisma.catalogEntry.findMany({ where: { ownerId: userId }, orderBy: { name: "asc" } });
  const entries: CatalogEntry[] = [];
  const problems: string[] = [];
  for (const record of records) {
    // Checked again on the way out: an entry saved by an older version can fail a newer schema, and is reported.
    const result = parseCatalogEntry({ kind: record.kind, entry: JSON.parse(record.data) });
    if (result.entry) entries.push(result.entry);
    else problems.push(`${record.name}: ${result.problem}`);
  }
  return NextResponse.json({ entries, problems });
}

/**
 * Saves entries (`{ entries: [{ kind, entry }, …] }`), each checked by its kind's schema: new ones are added, ones with
 * an id the account already has are replaced. What fails is reported, and the rest are saved.
 */
export async function POST(request: Request) {
  const userId = await requireUserId();
  if (userId instanceof NextResponse) return userId;

  const body = await request.json().catch(() => null) as { entries?: unknown } | null;
  if (!body || !Array.isArray(body.entries)) return NextResponse.json({ error: "Expected { entries: [...] }" }, { status: 400 });

  const saved: CatalogEntry[] = [];
  const problems: string[] = [];
  for (const raw of body.entries) {
    const result = parseCatalogEntry(raw);
    if (!result.entry) {
      const name = (raw as { entry?: { name?: unknown } } | null)?.entry?.name;
      problems.push(`${typeof name === "string" && name ? name : "An entry"}: ${result.problem}`);
      continue;
    }
    const { kind, entry } = result.entry;
    const fields = {
      kind,
      name: entry.name,
      sourceKey: entry.source.documentKey ?? entry.source.provider,
      sourceName: entry.source.documentName ?? null,
      schemaVersion: 1,
      data: JSON.stringify(entry)
    };
    await prisma.catalogEntry.upsert({
      where: { ownerId_entryId: { ownerId: userId, entryId: entry.id } },
      create: { ownerId: userId, entryId: entry.id, ...fields },
      update: fields
    });
    saved.push(result.entry);
  }
  return NextResponse.json({ entries: saved, problems }, { status: saved.length ? 201 : 400 });
}
