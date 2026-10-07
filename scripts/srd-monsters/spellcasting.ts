import type { ActionDefinition, SpellDefinition } from "../../src/engine/types";
import { SRD_SPELLS } from "../../src/data/srd/spells";
import type { RawEntry } from "./context";

/**
 * Monster spellcasting, combat-relevant spells only. A spell the bundled library can run becomes a real spell on
 * the creature — with the statblock's own save DC and attack bonus, its slots as `slot-N` pools, at-will spells free
 * and "N/day" ones as a limited pool. Everything else stays as text on the reference trait, split into utility
 * spells nobody needs simulated and combat spells that still need authoring.
 */
export interface SpellcastingResult {
  spells: SpellDefinition[];
  resources: Record<string, number>;
  /** Caster level from "is a 9th-level spellcaster". */
  level?: number;
  modelled: string[];
  utility: string[];
  /** A spell that matters in a fight but isn't in the library yet. */
  missing: string[];
}

/** Spells with no effect a combat sim would run: senses, communication, travel, scrying, illusions for show. */
const UTILITY = new RegExp(
  "^(detect|identify|light|mage hand|prestidigitation|thaumaturgy|druidcraft|tongues|comprehend|create food|speak with|animal messenger|"
  + "locate|clairvoyance|scrying|commune|dream|legend lore|divination|heroes feast|true seeing|disguise self|minor illusion|"
  + "dancing lights|nondetection|feather fall|water breathing|levitate|control weather|raise dead|resurrection|plane shift|"
  + "gaseous form|wind walk|goodberry|pass without trace|longstrider|zone of truth|spare the dying|mending|major image|"
  + "greater restoration|lesser restoration|protection from poison|remove curse|creation|sanctuary|freedom of movement|"
  + "fog cloud|silence|invisibility|enlarge|calm emotions|shillelagh|barkskin|clairvoyance|dispel|heroes.? feast|teleport|"
  + "mind blank|time stop|geas|telekinesis|globe of invulnerability|wall of force|contagion|guardian of faith)",
  "i"
);

const slugOf = (name: string) => name.toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** "mage armor*", "invisibility (self only)", "_sleep_" → the bare spell name. */
function cleanName(raw: string): string {
  return raw.replace(/\([^)]*\)/g, "").replace(/[*_]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

function names(list: string): string[] {
  return list.split(",").map(cleanName).filter(Boolean);
}

type Mode = { kind: "slot"; level: number; slots: number } | { kind: "will" } | { kind: "day"; uses: number };

function libraryEntry(name: string): SpellDefinition | undefined {
  const slug = slugOf(name);
  const spell = SRD_SPELLS.find((candidate) => candidate.id === `srd:spell:${slug}` || slugOf(candidate.name) === slug);
  return spell && spell.action && spell.automationSupport === "full" ? spell : undefined;
}

export function parseSpellcasting(entry: RawEntry, slug: string, usageFromName?: number): SpellcastingResult {
  const text = entry.desc.replace(/\r/g, "");
  const result: SpellcastingResult = { spells: [], resources: {}, modelled: [], utility: [], missing: [] };
  const level = /(\d+)(?:st|nd|rd|th)-level spellcaster/i.exec(text)?.[1];
  if (level) result.level = Number(level);
  const dc = /spell save DC (\d+)/i.exec(text)?.[1];
  const hit = /\+(\d+) to hit with spell attacks/i.exec(text)?.[1];

  const listed: Array<{ name: string; mode: Mode }> = [];
  for (const rawLine of text.split(/\n+/)) {
    const line = rawLine.replace(/^\s*[*-]\s*/, "").trim();
    let match: RegExpExecArray | null;
    if ((match = /^Cantrips? \(at will\):\s*(.+)$/i.exec(line))) {
      for (const name of names(match[1]!)) listed.push({ name, mode: { kind: "will" } });
    } else if ((match = /^(\d+)(?:st|nd|rd|th) level \((\d+) slots?\):\s*(.+)$/i.exec(line))) {
      for (const name of names(match[3]!)) listed.push({ name, mode: { kind: "slot", level: Number(match[1]), slots: Number(match[2]) } });
    } else if ((match = /^At will:\s*(.+)$/i.exec(line))) {
      for (const name of names(match[1]!)) listed.push({ name, mode: { kind: "will" } });
    } else if ((match = /^(\d+)\/day(?: each)?:\s*(.+)$/i.exec(line))) {
      for (const name of names(match[2]!)) listed.push({ name, mode: { kind: "day", uses: Number(match[1]) } });
    }
  }
  // "The archmage can cast disguise self and invisibility at will and has the following wizard spells prepared"
  const inline = /can (?:innately )?cast (.+?) at will/i.exec(text);
  if (inline) for (const name of inline[1]!.split(/,| and /).map(cleanName).filter(Boolean)) listed.push({ name, mode: { kind: "will" } });
  // "The mephit can innately cast _sleep_, requiring no material components." — its uses come from "(1/Day)" in the name.
  const single = /can innately cast _([^_]+)_/i.exec(text);
  if (single) listed.push({ name: cleanName(single[1]!), mode: { kind: "day", uses: usageFromName ?? 1 } });

  const seen = new Set<string>();
  for (const { name, mode } of listed) {
    const spellSlug = slugOf(name);
    if (seen.has(spellSlug)) continue;
    seen.add(spellSlug);
    const library = libraryEntry(name);
    if (!library) {
      (UTILITY.test(name) ? result.utility : result.missing).push(name);
      continue;
    }
    result.modelled.push(name);

    const spell = structuredClone(library);
    // The monster carries its own source; its copy of a library spell doesn't repeat one.
    delete spell.source;
    spell.id = `${slug}:spell:${spellSlug}`;
    const action = spell.action as ActionDefinition & Record<string, unknown>;
    action.id = `${spell.id}:action`;
    if (dc && (action.kind === "save" || action.kind === "area-save")) {
      action.dc = Number(dc);
      delete action.dcFormula;
    }
    if (hit && action.kind === "attack") {
      action.attackBonus = Number(hit);
      delete action.attackBonusFormula;
    }
    const cost = (resourceId: string) => ({ resourceId, amount: 1 });
    if (mode.kind === "slot" && spell.level > 0) {
      spell.resourceCost = cost(`slot-${spell.level}`);
      action.resourceCost = cost(`slot-${spell.level}`);
      result.resources[`slot-${mode.level}`] = mode.slots;
    } else if (mode.kind === "day") {
      const pool = `usage:${spell.id}`;
      spell.resourceCost = cost(pool);
      action.resourceCost = cost(pool);
      action.usage = { kind: "uses", uses: mode.uses };
      delete spell.upcast;
      result.resources[pool] = mode.uses;
    } else {
      // At will (and cantrips): no cost, nothing to upcast.
      delete spell.resourceCost;
      delete action.resourceCost;
      delete spell.upcast;
    }
    result.spells.push(spell);
  }
  return result;
}
