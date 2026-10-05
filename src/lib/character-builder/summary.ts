import type { CreatureDefinition } from "@/engine";
import type { BuildChange } from "./apply";
import { parseCharacterBuild, type CharacterBuild } from "./build-record";
import type { BuildSources } from "./build";

/** An actor's build, when it was made by the builder and the build is valid. */
export function readBuild(definition: Pick<CreatureDefinition, "character"> | undefined): CharacterBuild | undefined {
  return parseCharacterBuild(definition?.character?.build).build;
}

/** "Rogue 5 (Thief) · Criminal" for a built character. */
export function buildLabel(build: CharacterBuild, sources: BuildSources): string {
  const counts = new Map<string, number>();
  for (const level of build.levels) counts.set(level.classId, (counts.get(level.classId) ?? 0) + 1);
  const classes = [...counts].map(([classId, level]) => {
    const name = sources.catalog.classes.find((entry) => entry.id === classId)?.name ?? classId;
    const subclassId = build.levels.map((entry) => entry.choices.subclass).find((value): value is string => typeof value === "string"
      && sources.catalog.subclasses.some((sub) => sub.id === value && sub.classId === classId));
    const subclass = subclassId ? sources.catalog.subclasses.find((sub) => sub.id === subclassId)?.name : undefined;
    return `${name} ${level}${subclass ? ` (${subclass})` : ""}`;
  });
  const background = build.background.id ? sources.catalog.backgrounds.find((entry) => entry.id === build.background.id)?.name : build.background.custom ? "Custom background" : undefined;
  const species = build.species ? sources.catalog.species.find((entry) => entry.id === build.species!.id)?.name : undefined;
  return [classes.join(" / "), background, species].filter(Boolean).join(" · ");
}

const show = (value: unknown): string => {
  if (value === undefined || value === null) return "none";
  if (Array.isArray(value)) return value.length ? value.map(show).join(", ") : "none";
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined);
    if (entries.every(([, item]) => typeof item === "number")) return entries.map(([key, item]) => `${key.toUpperCase()} ${item}`).join(", ");
    if ("name" in (value as Record<string, unknown>)) return String((value as { name: unknown }).name);
    return entries.map(([key, item]) => `${key} ${show(item)}`).join(", ");
  }
  return String(value);
};

/** A record of numbers that changed (scores, speeds): only its entries that differ, "DEX 17 → 19". */
function numbersChanged(before: unknown, after: unknown): string | undefined {
  const isNumbers = (value: unknown) => value === undefined || (typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.values(value).every((item) => typeof item === "number" || item === undefined));
  if (!isNumbers(before) || !isNumbers(after) || (before === undefined && after === undefined)) return undefined;
  const was = (before ?? {}) as Record<string, number | undefined>;
  const now = (after ?? {}) as Record<string, number | undefined>;
  const keys = [...new Set([...Object.keys(was), ...Object.keys(now)])].filter((key) => was[key] !== now[key]);
  return keys.map((key) => `${key.toUpperCase()} ${was[key] ?? "none"} → ${now[key] ?? "none"}`).join(", ");
}

/** One change, said for the level-up dialog. */
export function changeSentence(change: BuildChange): string {
  if (change.kind === "field") {
    const numbers = numbersChanged(change.before, change.after);
    if (numbers) return `${change.name}: ${numbers}.`;
  }
  switch (change.kind) {
    case "gained": return `Gains ${change.name}.`;
    case "lost": return `Loses ${change.name}.`;
    case "changed": return change.details.length ? `${change.name}: ${change.details.join("; ")}.` : `${change.name} changes.`;
    case "field": return `${change.name}: ${show(change.before)} → ${show(change.after)}.`;
    case "kept":
      return change.reason === "removed"
        ? `${change.name}: you removed it, so it stays removed.`
        : change.reason === "not-granted"
          ? `${change.name}: no longer granted, but you changed it, so it stays.`
          : `${change.name}: you changed it, so it stays as you made it.`;
  }
}

/** Sort for the dialog: what's new first, then what grows, what goes, and last what was kept. */
export function orderedChanges(changes: BuildChange[]): BuildChange[] {
  const rank: Record<BuildChange["kind"], number> = { gained: 0, changed: 1, field: 2, lost: 3, kept: 4 };
  return [...changes].sort((a, b) => rank[a.kind] - rank[b.kind]);
}

const titleCase = (slug: string) => slug.replace(/-/g, " ").replace(/(^|\s)\w/g, (letter) => letter.toUpperCase());

/**
 * What gave a builder-made feature, for the Abilities list's chip: "Rogue", "Thief", "feat", "background". Read from
 * the build's `made` map without checking the whole build: it's only a label. Undefined for anything the builder
 * didn't make.
 */
export function builtFrom(definition: Pick<CreatureDefinition, "character">, featureId: string): string | undefined {
  const made = (definition.character?.build as { made?: Record<string, { key?: string }> } | undefined)?.made;
  const key = made?.[`feature:${featureId}`]?.key;
  if (!key) return undefined;
  const [kind, ...rest] = key.split(":");
  if (kind === "feat") return "feat";
  if (kind === "background") return "background";
  if (kind === "species") return "species";
  // class:srd:class:rogue:<grant> or subclass:srd:subclass:thief:<grant>
  const id = rest.slice(0, -1).join(":");
  return titleCase(id.slice(id.lastIndexOf(":") + 1));
}
