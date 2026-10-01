import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { abilityModifier, type AttackActionDefinition, type CreatureDefinition } from "@/engine";
import { parseCsv } from "../scripts/srd-monsters/csv";
import { parseMultiattack } from "../scripts/srd-monsters/multiattack";
import { GapLog, averageDice } from "../scripts/srd-monsters/util";
import type { MonsterContext, RawEntry } from "../scripts/srd-monsters/context";

/**
 * SRD monsters must be built exactly like every other actor: raw `actions[]`, dice plus the wielding
 * ability's modifier (so editing STR changes the damage), weapons "(Two-Handed)", alternatives named
 * "Multiattack (Longsword)", condition immunities as a manual-only trait.
 */
const root = fileURLToPath(new URL("../", import.meta.url));
const chunkDir = `${root}src/data/srd/monsters/generated/chunks/`;
const monsters = readdirSync(chunkDir).flatMap((file) =>
  (JSON.parse(readFileSync(`${chunkDir}${file}`, "utf8")) as { definitions: CreatureDefinition[] }).definitions
);
const bySlug = (slug: string) => monsters.find((definition) => definition.id === `srd:monster:${slug}`)!;

function ctx(): MonsterContext {
  return {
    slug: "t", name: "T", lowerName: "t", cr: 1, proficiencyBonus: 2,
    abilities: { str: 16, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    gaps: new GapLog(), resources: {}, usedIds: new Set()
  };
}

describe("damage follows the actor convention", () => {
  const csvPath = `${root}srd_2014_monsters_full.csv`;

  it.skipIf(!existsSync(csvPath))("reproduces the statblock's average damage for every attack (dice + linked modifier)", () => {
    const rows = parseCsv(readFileSync(csvPath, "utf8"));
    const problems: string[] = [];
    let checked = 0;
    for (const row of rows) {
      const definition = bySlug(row.key!.replace(/^srd_/, ""));
      const entries = JSON.parse(row.actions || "[]") as RawEntry[];
      for (const entry of entries) {
        const stated = /^(?:Melee|Ranged|Melee or Ranged) (?:Weapon|Spell) Attack:.*?Hit:\s*(\d+)\s*\(([^)]+)\)/s.exec(entry.desc);
        if (!stated) continue;
        const statedAverage = Number(stated[1]);
        const action = definition.actions.find((candidate): candidate is AttackActionDefinition =>
          candidate.kind === "attack" && (candidate.name === entry.name || candidate.name.startsWith(`${entry.name} (`)) && !candidate.name.endsWith("(Two-Handed)")
        );
        if (!action || !action.damage[0]) continue; // overridden or not compiled — covered elsewhere
        const primary = action.damage[0];
        const modifier = primary.abilityModifier ? abilityModifier(definition.abilities[primary.abilityModifier]) : 0;
        const computed = Math.floor(averageDice(primary.dice) + modifier);
        checked += 1;
        if (computed !== statedAverage) problems.push(`${definition.name} ${entry.name}: statblock ${statedAverage}, engine ${computed} (${primary.dice}${primary.abilityModifier ? ` + ${primary.abilityModifier}` : ""})`);
      }
    }
    expect(checked).toBeGreaterThan(400);
    expect(problems).toEqual([]);
  });

  it("links ability modifiers on the great majority of weapon attacks, so editing STR/DEX changes damage", () => {
    const attacks = monsters.flatMap((definition) => definition.actions.filter((action): action is AttackActionDefinition => action.kind === "attack" && action.attackType !== "spell"));
    const linked = attacks.filter((action) => action.damage[0]?.abilityModifier);
    expect(linked.length / attacks.length).toBeGreaterThan(0.8);
    // A linked modifier names an ability that actually contributes the statblock's bonus.
    const goblin = bySlug("goblin");
    expect(attacks.every((action) => !action.damage[0]?.abilityModifier || action.damage[0].abilityModifier in goblin.abilities)).toBe(true);
  });

  it("never links an ability modifier onto extra damage (a dragon's fire is not boosted by STR)", () => {
    for (const definition of monsters) {
      for (const action of definition.actions) {
        if (action.kind === "attack") for (const extra of action.damage.slice(1)) expect(extra.abilityModifier, `${definition.id} ${action.name}`).toBeUndefined();
      }
    }
  });
});

describe("naming follows the actor convention", () => {
  it("makes one Multiattack and names its options after their weapons", () => {
    const own = [
      { id: "longsword", name: "Longsword", attackType: "melee" as const },
      { id: "longbow", name: "Longbow", attackType: "ranged" as const }
    ];
    const entry: RawEntry = { name: "Multiattack", desc: "The knight makes two longsword attacks or two longbow attacks.", action_type: "ACTION" };
    const parsed = parseMultiattack(entry, own, ctx());
    expect(parsed.map((action) => [action.id, action.name])).toEqual([["multiattack", "Multiattack"]]);
    expect(parsed[0]!.kind === "multiattack" && parsed[0]!.options?.map((option) => option.label)).toEqual(["Longbow"]);
    expect(parseMultiattack({ ...entry, desc: "The knight makes two longsword attacks." }, own, ctx()).map((action) => action.name)).toEqual(["Multiattack"]);
  });

  it("shows condition immunities in the sheet as a manual-only trait, singular or plural", () => {
    expect(bySlug("zombie").traits!.find((trait) => trait.name === "Condition Immunity: Poisoned")).toMatchObject({ automationSupport: "manual-only" });
    const ghast = bySlug("ghast").traits!.find((trait) => trait.name.startsWith("Condition Immunities:"))!;
    expect(ghast.name).toBe("Condition Immunities: Charmed, Exhaustion, Poisoned");
  });

  it("spells the two-handed copy the same way", () => {
    expect(bySlug("wight").actions.map((action) => action.name)).toContain("Longsword (Two-Handed)");
  });
});

/** The author's own exported actors, when present (they are gitignored). */
const ownActors: Array<[string, string]> = [["zombie", "Slam"], ["ghast", "Bite"], ["ghast", "Claws"], ["wight", "Longsword"], ["wight", "Longsword (Two-Handed)"], ["wight", "Longbow"]];
describe.skipIf(!existsSync(`${root}zombie.enemy.json`))("matches the author's own exported actors", () => {
  function load(slug: string): CreatureDefinition {
    const json = JSON.parse(readFileSync(`${root}${slug}.enemy.json`, "utf8")) as { definition?: CreatureDefinition } & CreatureDefinition;
    return json.definition ?? json;
  }

  it.each(ownActors)("%s %s has the same attack shape and damage recipe", (slug, name) => {
    const theirs = load(slug).actions.find((action) => action.name === name) as AttackActionDefinition;
    const ours = bySlug(slug).actions.find((action) => action.name === name) as AttackActionDefinition;
    expect(ours).toBeDefined();
    const shape = (action: AttackActionDefinition) => ({
      kind: action.kind, actionType: action.actionType, attackType: action.attackType, ability: action.ability,
      damage: action.damage.map((component) => ({ dice: component.dice, damageType: component.damageType, abilityModifier: component.abilityModifier }))
    });
    expect(shape(ours)).toEqual(shape(theirs));
  });

  it("uses the same damageAdjustments and condition-immunity trait wording as a hand-built zombie", () => {
    const theirs = load("zombie");
    const ours = bySlug("zombie");
    expect(ours.damageAdjustments).toEqual(theirs.damageAdjustments);
    expect(ours.traits!.map((trait) => trait.name)).toEqual(expect.arrayContaining(["Condition Immunity: Poisoned", "Undead Fortitude"]));
    expect(ours.proficiencyBonus).toBe(theirs.proficiencyBonus);
  });

  it("agrees with the hand-built wight and ghast on defenses (the export got the wight wrong)", () => {
    // Compare type + damage type + nonmagical flag; ours additionally records the silvered exception.
    const summary = (definition: CreatureDefinition) => (definition.damageAdjustments ?? [])
      .map((adjustment) => `${adjustment.type}:${adjustment.damageType}${adjustment.nonMagicalOnly ? "*" : ""}`).sort();
    for (const slug of ["wight", "zombie"]) expect(summary(bySlug(slug)), slug).toEqual(summary(load(slug)));
    // SRD ghasts are also immune to poison; the hand-built one only lists the necrotic resistance.
    expect(summary(bySlug("ghast"))).toEqual(expect.arrayContaining(summary(load("ghast"))));
    expect(bySlug("wight").conditionImmunities).toEqual(["exhaustion", "poisoned"]);
    expect(bySlug("wight").traits!.some((trait) => trait.name === "Condition Immunities: Exhaustion, Poisoned")).toBe(true);
  });
});
