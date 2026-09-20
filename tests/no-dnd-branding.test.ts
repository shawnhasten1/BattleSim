import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The SRD 5.1 grants no rights to the "Dungeons & Dragons" name or marks, and offers
 * "compatible with fifth edition" / "5E compatible" as the safe way to say what this is. So the app,
 * its docs and its metadata must not use the D&D name (the owner's decision, 2026-09-20).
 * The game term "Dungeon Master" and the prescribed attribution URL (dnd.wizards.com) are not affected.
 */
const root = process.cwd();
const BRANDING = /D&D|D&amp;D|Dungeons\s*(?:&|&amp;|and)\s*Dragons/i;

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name === "generated") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, exts, out);
    else if (exts.some((ext) => name.endsWith(ext))) out.push(path);
  }
  return out;
}

describe("no D&D branding", () => {
  const files = [
    ...["README.md", "AGENTS.md", "package.json", "app/layout.tsx"].map((file) => join(root, file)),
    ...walk(join(root, "app"), [".tsx", ".ts"]),
    ...walk(join(root, "src/components"), [".tsx", ".ts"]),
    ...walk(join(root, "docs"), [".md"])
  ];

  it("scans a meaningful set of user-facing files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("uses none of the D&D name in the app, docs or metadata", () => {
    const offenders = files.filter((file) => existsSync(file) && BRANDING.test(readFileSync(file, "utf8")));
    expect(offenders.map((file) => file.slice(root.length + 1))).toEqual([]);
  });

  it("says what the app is compatible with, in the words the SRD offers", () => {
    const layout = readFileSync(join(root, "app/layout.tsx"), "utf8");
    expect(layout).toMatch(/compatible with fifth edition/);
    expect(readFileSync(join(root, "README.md"), "utf8")).toMatch(/compatible with fifth edition/);
  });

  it("names the package after the app, not the game", () => {
    expect(JSON.parse(readFileSync(join(root, "package.json"), "utf8")).name).toBe("battlesim");
  });
});
