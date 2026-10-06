import { describe, expect, it } from "vitest";
import type { ActionDefinition, SpellDefinition } from "@/engine";
import { SRD_SPELLS } from "@/data/srd";
import { SRD_52_ATTRIBUTION } from "@/data/srd/attribution";
import { AUTHORED_2024, NOT_COPIED, SAME_AS_2014, SPELL_GAPS } from "@/data/srd/2024/spell-authoring";
import { findSrd2024Spell, SRD_2024_SPELL_INDEX, SRD_2024_SPELLS, spellBasisOf, srd2024SpellId } from "@/data/srd/2024/spells";
import type { ReferenceSpell } from "@/data/srd/2024/reference-types";
import { spellRuns } from "@/lib/character-builder/spells";
import { checkSpellCoverage } from "../scripts/srd-2024/coverage";

/** PC builder plan, Phase 5a: the 2024 spells. */

const index = SRD_2024_SPELL_INDEX;
const entry = (slug: string) => index.spells.find((spell) => spell.slug === slug)!;
const spell = (slug: string) => findSrd2024Spell(srd2024SpellId(slug))!;

/** What the record says about a fact the index also has, in the index's terms. */
function facts(record: SpellDefinition) {
  const action = record.action as ActionDefinition;
  const range = record.range === "self" ? "Self" : record.range === "touch" ? "Touch"
    : record.range % 5280 === 0 ? `${record.range / 5280} mile${record.range === 5280 ? "" : "s"}` : `${record.range} feet`;
  return {
    level: record.level,
    castingTime: record.castingTime,
    concentration: Boolean(record.concentration),
    range,
    // Counterspell's save is the caster's, made against it.
    save: action.kind === "save" || action.kind === "area-save" ? action.saveAbility
      : action.kind === "activate-feature" && action.reaction?.trigger.kind === "enemy-casts-spell" ? action.reaction.trigger.casterSave ?? null : null
  };
}

function expected(spellEntry: ReferenceSpell) {
  return {
    level: spellEntry.level,
    castingTime: spellEntry.castingTime,
    concentration: spellEntry.concentration,
    range: spellEntry.range,
    save: spellEntry.save
  };
}

/**
 * Where a spell's simulation differs from its printed facts on purpose. Everything else must agree with the SRD 5.2
 * index: that's the check that a copied 2014 spell is still right in 2024.
 */
const ON_PURPOSE: Record<string, Partial<ReturnType<typeof expected>>> = {
  // Cast with a bonus action, then hurled 60 ft as a Magic action: what a fight sees.
  "produce-flame": { castingTime: "action", range: "60 feet" },
  // A line out from the caster ("Self"): the record's range is the line's length.
  "gust-of-wind": { range: "60 feet" },
  sunbeam: { range: "60 feet" },
  // The teleport's distance is on the action; the spell's own range is Self.
  "dimension-door": { range: "Self" },
  // Cast on the caster only.
  "greater-invisibility": { range: "Self" },
  // No save at all (damage for moving through it); an area action has to name one, which is never rolled.
  "spike-growth": { save: "dex" }
};

describe("the SRD 5.2 spell index", () => {
  it("has all 339 spells, with the SRD 5.2 attribution", () => {
    expect(index.attribution).toBe(SRD_52_ATTRIBUTION);
    expect(index.spells).toHaveLength(339);
    const count = (list: string) => index.spells.filter((spell) => spell.classes.includes(list)).length;
    expect(count("wizard")).toBe(218);
    expect(count("cleric")).toBe(109);
    expect(count("paladin")).toBe(38);
  });

  it("applies the overrides checked against the SRD 5.2 PDF", () => {
    expect(entry("prayer-of-healing").castingTime).toBe("10 minutes");
    expect(entry("plant-growth").castingTime).toBe("action");
    expect(entry("dissonant-whispers").higherLevel).toMatch(/1d6 for each spell slot level above 1/);
    expect(entry("healing-word").castingTime).toBe("bonus");
  });
});

describe("the 2024 spell library", () => {
  it("has every spell once, as srd:spell:<slug>-2024 from SRD 5.2", () => {
    expect(SRD_2024_SPELLS).toHaveLength(339);
    expect(new Set(SRD_2024_SPELLS.map((spell) => spell.id)).size).toBe(339);
    for (const record of SRD_2024_SPELLS) {
      expect(record.id).toMatch(/^srd:spell:[a-z0-9-]+-2024$/);
      expect(record.source).toMatchObject({ provider: "srd", documentKey: "srd-2024" });
    }
    // Never the 2014 spell's id.
    expect(SRD_2024_SPELLS.some((record) => SRD_SPELLS.some((old) => old.id === record.id))).toBe(false);
  });

  it("copies or explains every 2014 library spell, and names only spells that exist", () => {
    expect(checkSpellCoverage(index)).toEqual([]);
    for (const old of SRD_SPELLS) {
      const copied = Object.values(SAME_AS_2014).includes(old.id);
      expect(copied || Boolean(NOT_COPIED[old.id]), old.id).toBe(true);
    }
  });

  it("agrees with the SRD 5.2 facts for every spell it simulates", () => {
    for (const record of SRD_2024_SPELLS) {
      if (!record.action) continue;
      const slug = record.id.slice("srd:spell:".length, -"-2024".length);
      expect(facts(record), slug).toEqual({ ...expected(entry(slug)), ...(ON_PURPOSE[slug] ?? {}) });
    }
  });

  it("re-authors what changed in 2024", () => {
    const healing = (slug: string) => (spell(slug).action as Extract<ActionDefinition, { kind: "healing" }>).healing[0];
    expect(healing("cure-wounds")).toMatchObject({ dice: "2d8" });
    expect(spell("cure-wounds").upcast?.perSlotAboveBase?.damageDice).toBe("2d8");
    expect(healing("healing-word")).toMatchObject({ dice: "2d4" });
    expect(healing("mass-cure-wounds")).toMatchObject({ dice: "5d8", abilityModifier: "wis" });
    expect(spell("poison-spray").action).toMatchObject({ kind: "attack", range: 30 });
    expect(spell("inflict-wounds").action).toMatchObject({ kind: "save", saveAbility: "con", damage: [{ dice: "2d10" }], onSuccess: "half" });
    expect(spell("chill-touch").action).toMatchObject({ kind: "attack", range: 5, damage: [{ dice: "1d10" }] });
    expect(spell("vicious-mockery").action).toMatchObject({
      damage: [{ dice: "1d6" }],
      riders: [{ kind: "condition", when: "on-save-fail", nextAttack: { role: "made", mode: "disadvantage" } }]
    });
    expect(spell("spiritual-weapon").concentration).toBe(true);
    expect(spell("ice-storm").action).toMatchObject({ damage: [{ dice: "2d10", damageType: "bludgeoning" }, { dice: "4d6" }] });
    expect(spell("flame-strike").action).toMatchObject({ damage: [{ dice: "5d6" }, { dice: "5d6" }] });
    expect(spell("circle-of-death").action).toMatchObject({ damage: [{ dice: "8d8" }] });
    expect(spell("stoneskin").range).toBe("touch");
  });

  it("fixes a copy's range where 2024 changed it, or the 2014 copy has it wrong", () => {
    expect(spell("banishment").action).toMatchObject({ range: 30 });
    expect(spell("blindnessdeafness").action).toMatchObject({ range: 120 });
    expect(spell("cloudkill").action).toMatchObject({ range: 120, targeting: { origin: "point", range: 120 } });
    expect(spell("sunburst").action).toMatchObject({ range: 150, targeting: { origin: "point", range: 150 } });
  });

  it("strikes when 2024 says a lasting area does: entering it or ending a turn there, and as it appears", () => {
    const zone = (slug: string) => (spell(slug).action as Extract<ActionDefinition, { kind: "area-save" }>).zone;
    expect(zone("moonbeam")).toMatchObject({ trigger: ["on-enter", "end-of-turn-in-zone"], applyOnCast: true, repositionable: { maxFeetPerCasterTurn: 60 } });
    expect(zone("cloudkill")).toMatchObject({ trigger: ["on-enter", "end-of-turn-in-zone"], applyOnCast: true, movement: { driftFeetPerCasterTurn: 10 } });
    expect(zone("insect-plague")).toMatchObject({ trigger: ["on-enter", "end-of-turn-in-zone"], applyOnCast: true });
    expect(zone("spirit-guardians")).toMatchObject({ trigger: ["on-enter", "end-of-turn-in-zone"], anchor: "self" });
    expect(zone("spirit-guardians")?.applyOnCast).toBeUndefined();
    // Web still catches a creature that starts its turn in it, as in 2014.
    expect(zone("web")?.trigger).toEqual(["on-enter", "start-of-turn-in-zone"]);
  });

  it("names the 2014 spell's 2024 version by its 2024 name", () => {
    expect(spell("acid-arrow").name).toBe("Acid Arrow");
    expect(spell("acid-arrow").action?.name).toBe("Acid Arrow");
    expect(SRD_SPELLS.find((old) => old.id === "srd:spell:acid-arrow")?.name).toBe("Melf's Acid Arrow");
  });

  it("points a reaction spell's activation at itself", () => {
    expect(spell("shield").action).toMatchObject({ kind: "activate-feature", featureId: srd2024SpellId("shield"), resourceCost: { resourceId: "slot-1" } });
  });

  it("keeps the rest as reference only, with their SRD text", () => {
    const prayer = spell("prayer-of-healing");
    expect(prayer.action).toBeUndefined();
    expect(prayer.automationSupport).toBe("manual-only");
    expect(prayer.description).toMatch(/^Casting time: 10 minutes\./);
    for (const slug of Object.keys(SPELL_GAPS)) expect(spellBasisOf(slug), slug).toBe("reference");
  });

  it("runs every spell it copies or authors, apart from a note the AI can't act on", () => {
    const notRunning = SRD_2024_SPELLS.filter((record) => record.action && !spellRuns(record)).map((record) => record.name);
    expect(notRunning).toEqual(["Faerie Fire"]);
    expect(Object.keys(AUTHORED_2024).every((slug) => spellRuns(spell(slug)))).toBe(true);
  });
});
