/**
 * SRD 5.2 cache → the spell index (`src/data/srd/2024/generated/spells.json`): all 339 spells with their facts and text.
 * Pure; no I/O. See PC_BUILDER_PLAN.md, Phase 5a.
 *
 * Each spell's class list is its own entry's. The PDF disagrees with itself in a few places (Phantasmal Force and Mind
 * Spike are missing from class spell-list tables their own entries name; Flaming Sphere is Conjuration in its entry and
 * Evocation in the tables): the entries are what Open5e serves, and what this keeps. Where Open5e is wrong against the
 * PDF (long casting times rounded to "1minute" or "1hour", two missing higher-level texts) an override with a reason
 * fixes it (`SPELL_OVERRIDES`).
 */
import type { Ability } from "../../src/engine";
import { SRD_52_ATTRIBUTION } from "../../src/data/srd/attribution";
import { SPELL_OVERRIDES } from "../../src/data/srd/2024/overrides";
import type { ReferenceSpell, Srd2024SpellIndex } from "../../src/data/srd/2024/reference-types";
import type { Srd2024Cache } from "./reference";

type Raw = Record<string, unknown>;

const ABILITY_NAMES: Record<string, Ability> = {
  strength: "str", dexterity: "dex", constitution: "con", intelligence: "int", wisdom: "wis", charisma: "cha"
};

const str = (value: unknown): string => (typeof value === "string" ? value : "");

/** `bonus-action` → `bonus`; `1minute` → `1 minute`. */
function castingTimeOf(raw: string): string {
  if (raw === "bonus-action") return "bonus";
  if (raw === "action" || raw === "reaction") return raw;
  return raw.replace(/^(\d+)([a-z]+)$/, "$1 $2");
}

function componentsOf(raw: Raw): string {
  const parts = [raw.verbal ? "V" : "", raw.somatic ? "S" : "", raw.material ? `M${str(raw.material_specified) ? ` (${str(raw.material_specified)})` : ""}` : ""];
  return parts.filter(Boolean).join(", ");
}

function spellOf(raw: Raw, document: string): ReferenceSpell {
  const key = str(raw.key);
  const save = ABILITY_NAMES[str(raw.saving_throw_ability).toLowerCase()] ?? null;
  const shape = str(raw.shape_type);
  const trigger = str(raw.reaction_condition);
  const override = SPELL_OVERRIDES[key];
  return {
    key,
    slug: key.startsWith(`${document}_`) ? key.slice(document.length + 1) : key,
    name: str(raw.name),
    level: Number(raw.level ?? 0),
    school: (raw.school as { key?: string } | undefined)?.key ?? "",
    classes: ((raw.classes as Array<{ key: string }> | undefined) ?? []).map((entry) => entry.key.replace(`${document}_`, "")).sort(),
    castingTime: override?.castingTime ?? castingTimeOf(str(raw.casting_time)),
    ...(trigger ? { reactionTrigger: trigger } : {}),
    range: str(raw.range_text),
    components: componentsOf(raw),
    duration: str(raw.duration),
    concentration: Boolean(raw.concentration),
    ritual: Boolean(raw.ritual),
    save,
    damage: str(raw.damage_roll) || null,
    damageTypes: ((raw.damage_types as string[] | undefined) ?? []).slice(),
    area: shape ? { shape, size: Number(raw.shape_size ?? 0) } : null,
    text: str(raw.desc),
    higherLevel: override?.higherLevel ?? str(raw.higher_level)
  };
}

export function buildSrd2024Spells(cache: Srd2024Cache): { index: Srd2024SpellIndex; warnings: string[] } {
  const inDocument = (raw: Raw) => (raw.document as { key?: string } | undefined)?.key === cache.document;
  const spells = (cache.spells ?? []).filter(inDocument).map((raw) => spellOf(raw, cache.document)).sort((a, b) => a.key.localeCompare(b.key));
  const keys = new Set(spells.map((spell) => spell.key));
  const warnings = Object.keys(SPELL_OVERRIDES).filter((key) => !keys.has(key)).map((key) => `spell override ${key} matches nothing in the source`);
  return { index: { attribution: SRD_52_ATTRIBUTION, document: cache.document, spells }, warnings };
}
