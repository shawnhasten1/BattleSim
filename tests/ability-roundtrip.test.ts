import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { resolveAttackBonus, type CreatureDefinition, type DamageComponent } from "@/engine";
import { SRD_FEATURES, SRD_SPELLS, SRD_WEAPONS } from "@/data/srd";
import { useEncounterStore } from "@/store/encounter-store";
import { diceExpression, diceParts, pathBinding, saveDcBinding, withLineDice } from "@/lib/ability-editor/bindings";
import { withReplacedAbility } from "@/lib/ability-editor/records";
import { abilityRefs, findAbility, refKey, type AbilityRecord, type AbilityRef } from "@/lib/ability-editor/refs";
import { deepEqual } from "@/lib/deep-equal";
import { statblockFor } from "@/lib/statblock";

/**
 * Every bundled SRD ability saved through the ability editor's model (ABILITY_BUILDER_REDESIGN_PLAN.md §5.1): it edits a
 * working copy of the record through bindings and saves by putting the whole record back (`replaceAbilityRecord`, which
 * normalizes with `withReplacedAbility`). A save writes only what was edited: the guard against the lossy save of the
 * old builder, which turned a Brown Bear's melee Claws into a ranged INT attack (§1.1).
 */

const pristine = useEncounterStore.getState();
afterAll(() => useEncounterStore.setState(pristine, true));
const store = () => useEncounterStore.getState();

const CHUNKS = fileURLToPath(new URL("../src/data/srd/monsters/generated/chunks/", import.meta.url));
const MONSTERS: CreatureDefinition[] = readdirSync(CHUNKS).flatMap(
  (file) => (JSON.parse(readFileSync(join(CHUNKS, file), "utf8")) as { definitions: CreatureDefinition[] }).definitions
);

function monster(name: string): CreatureDefinition {
  const found = MONSTERS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`No SRD monster named ${name}`);
  return found;
}

/** Keys minted afresh on every write, which say nothing about what the DM changed. */
const MINTED = new Set(["id", "featureId", "actionId", "importedAt"]);
/** Mirrors of `dice` that the normalizer derives from it (the dice check below makes sure they follow). */
const DICE_MIRRORS = new Set(["diceCount", "diceSize", "flatBonus"]);

/**
 * Where two records differ in meaning. Ignored: minted ids, dice mirrors, and `aimedFromSelf: false` becoming absent
 * (both mean "not aimed"), which the store's normalizer rewrites on every save.
 */
function changedPaths(before: unknown, after: unknown, path = ""): string[] {
  if (deepEqual(before, after)) return [];
  if (/(^|\.)aimedFromSelf$/.test(path) && !before && !after) return [];
  const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;
  if (isObject(before) && isObject(after) && Array.isArray(before) === Array.isArray(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .filter((key) => !MINTED.has(key) && !DICE_MIRRORS.has(key))
      .flatMap((key) => changedPaths(before[key], after[key], path ? `${path}.${key}` : key));
  }
  return [path];
}

/** Whether a component's `diceCount` / `diceSize` mirrors, where present, agree with its `dice`. */
function mirrorsMatch(component: unknown): boolean {
  const { dice, diceCount, diceSize } = (component ?? {}) as { dice?: string; diceCount?: number; diceSize?: number };
  const match = /^(\d+)d(\d+)/.exec(dice ?? "");
  if (diceCount === undefined && diceSize === undefined) return true;
  return Boolean(match) && Number(match![1]) === diceCount && Number(match![2]) === diceSize;
}

const valueAt = (record: unknown, path: string) => path.split(".").reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], record);

/**
 * Where the Damage section's first line is: a weapon's or an action's own, or the action a spell casts, a death effect
 * fires or a legendary action has of its own.
 */
function firstDamagePath(record: AbilityRecord): string | undefined {
  const hasLines = (value: unknown) => ((value as { damage?: unknown[] } | undefined)?.damage?.length ?? 0) > 0;
  if (hasLines(record)) return "damage.0";
  if (hasLines((record as { action?: unknown }).action)) return "action.damage.0";
  return undefined;
}

/**
 * The record with one die more on the line at `path`, as the Damage section's dice count makes it (a flat amount or an
 * expression the boxes can't hold becomes another expression), through the binding the section uses.
 */
function withDiceBumped(record: AbilityRecord, path: string): AbilityRecord {
  const copy = structuredClone(record);
  const keys = path.split(".");
  const lines = valueAt(copy, keys.slice(0, -1).join(".")) as DamageComponent[];
  const index = Number(keys[keys.length - 1]);
  const parts = diceParts(lines[index]!.dice);
  lines[index] = withLineDice(lines[index]!, parts ? diceExpression(parts.count + 1, parts.sides, parts.bonus) : "4d4");
  return copy;
}

interface Stored {
  label: string;
  definition: CreatureDefinition;
  ref: AbilityRef;
}

/** The library attached to the sample fighter the way the sheet attaches it, then every ability on every SRD monster. */
function everyAbility(): Stored[] {
  useEncounterStore.setState(pristine, true);
  for (const weapon of SRD_WEAPONS) store().attachSrdWeapon("def-fighter", weapon.id);
  for (const spell of SRD_SPELLS) store().attachSrdSpell("def-fighter", spell.id);
  for (const feature of SRD_FEATURES) store().attachSrdFeature("def-fighter", feature.id);
  const fighter = structuredClone(store().encounter.definitions.find((candidate) => candidate.id === "def-fighter")!);
  useEncounterStore.setState(pristine, true);
  return [fighter, ...MONSTERS].flatMap((definition) => abilityRefs(definition).map((ref) => ({ label: `${definition.name} ${refKey(ref)}`, definition, ref })));
}
const ABILITIES = everyAbility();

const save = (definition: CreatureDefinition, ref: AbilityRef, record: AbilityRecord) => {
  const replaced = withReplacedAbility(definition, ref, record)!;
  return { definition: replaced.definition, ref: replaced.ref, record: findAbility(replaced.definition, replaced.ref)! };
};

describe("saving an SRD ability through the ability editor's model", () => {
  it("covers the whole library and every SRD monster ability", () => {
    expect(ABILITIES.length).toBeGreaterThan(1900);
  });

  it("keeps everything a record says when it's saved unedited", () => {
    const problems = ABILITIES.flatMap(({ label, definition, ref }) => {
      const stored = findAbility(definition, ref)!;
      const stray = changedPaths(stored, save(definition, ref, structuredClone(stored)).record);
      return stray.length ? [`${label}: ${stray.join(", ")}`] : [];
    });
    expect(problems).toEqual([]);
  });

  it("gives the same record however many times it's saved", () => {
    const problems = ABILITIES.flatMap(({ label, definition, ref }) => {
      const once = save(definition, ref, structuredClone(findAbility(definition, ref)!));
      const twice = save(once.definition, once.ref, structuredClone(once.record));
      return deepEqual(twice.definition, once.definition) ? [] : [label];
    });
    expect(problems).toEqual([]);
  });

  it("reads the same in the statblock after a save", () => {
    const problems = ABILITIES.flatMap(({ label, definition, ref }) => {
      const saved = save(definition, ref, structuredClone(findAbility(definition, ref)!));
      return deepEqual(statblockFor(saved.definition, saved.ref), statblockFor(definition, ref)) ? [] : [label];
    });
    expect(problems).toEqual([]);
  });

  it("changes only the name when the name binding is edited", () => {
    const name = pathBinding<AbilityRecord, string>(["name"]);
    const problems = ABILITIES.flatMap(({ label, definition, ref }) => {
      const stored = findAbility(definition, ref)!;
      const unedited = save(definition, ref, structuredClone(stored)).record;
      const renamed = save(definition, ref, name.set(structuredClone(stored), "Renamed")).record;
      const stray = changedPaths(unedited, renamed).filter((path) => path !== "name");
      return name.get(renamed) !== "Renamed" || stray.length ? [`${label}: ${stray.join(", ")}`] : [];
    });
    expect(problems).toEqual([]);
  });

  it("changes only a damage line's dice when they're edited, and a cantrip's growth that followed them", () => {
    const problems: string[] = [];
    let checked = 0;
    for (const { label, definition, ref } of ABILITIES) {
      const stored = findAbility(definition, ref)!;
      const at = firstDamagePath(stored);
      if (!at) continue;
      checked += 1;
      const unedited = save(definition, ref, structuredClone(stored)).record;
      const edited = save(definition, ref, withDiceBumped(stored, at)).record;
      const paths = changedPaths(unedited, edited);
      const stray = paths.filter((path) => path !== `${at}.dice` && !path.startsWith(`${at}.scaling.steps`));
      const mirrors = mirrorsMatch(valueAt(edited, at));
      if (!paths.includes(`${at}.dice`) || stray.length || !mirrors) {
        problems.push(`${label}: ${paths.includes(`${at}.dice`) ? "" : "dice unchanged; "}${mirrors ? "" : "stale dice mirrors; "}${stray.join(", ")}`);
      }
    }
    // Every weapon, attack and damaging save or area across the library and the monsters, their own and granted.
    expect(checked).toBeGreaterThan(700);
    expect(problems).toEqual([]);
  });
});

describe("worked examples", () => {
  function edit(creatureName: string, recordName: string, change: (record: AbilityRecord) => AbilityRecord) {
    const creature = monster(creatureName);
    const ref = abilityRefs(creature).find((candidate) => (findAbility(creature, candidate) as { name?: string }).name === recordName)!;
    return save(creature, ref, change(structuredClone(findAbility(creature, ref)!)));
  }

  it("a Brown Bear's Claws stay a +6 melee STR attack when the dice change", () => {
    const { record, definition } = edit("Brown Bear", "Claws", (claws) => withDiceBumped(claws, "damage.0"));
    expect(record).toMatchObject({ kind: "attack", attackType: "melee", ability: "str", reach: 5, attackBonus: 6 });
    if (!("kind" in record) || record.kind !== "attack") throw new Error("not an attack");
    expect(record.attackBonusFormula).toBeUndefined();
    expect(resolveAttackBonus(record, definition)).toBe(6);
    expect(record.damage).toEqual([expect.objectContaining({ dice: "3d6", damageType: "slashing", abilityModifier: "str" })]);
  });

  it("an Adult Red Dragon's Bite keeps its fire damage when the piercing dice change", () => {
    const { record } = edit("Adult Red Dragon", "Bite", (bite) => withDiceBumped(bite, "damage.0"));
    if (!("kind" in record) || record.kind !== "attack") throw new Error("not an attack");
    expect(record.damage).toHaveLength(2);
    expect(record.damage[0]).toMatchObject({ dice: "3d10", damageType: "piercing" });
    expect(record.damage[1]).toEqual({ dice: "2d6", damageType: "fire", diceCount: 2, diceSize: 6 });
  });

  it("an Adult Red Dragon's Fire Breath keeps its recharge when the DC changes", () => {
    const { record } = edit("Adult Red Dragon", "Fire Breath", (breath) => saveDcBinding.set(breath as never, { mode: "printed", value: 20 }));
    expect(record).toMatchObject({ kind: "area-save", dc: 20, usage: { kind: "recharge", recharge: { min: 5 } }, area: { type: "cone", size: 60 } });
    expect((record as { resourceCost?: unknown }).resourceCost).toEqual({ resourceId: "usage:fire-breath", amount: 1 });
  });

  it("a Couatl's Shield stays an activated effect when it's renamed", () => {
    const { record } = edit("Couatl", "Shield", (shield) => pathBinding<AbilityRecord, string>(["name"]).set(shield, "Warding Shield"));
    expect(record).toMatchObject({ name: "Warding Shield", action: { kind: "activate-feature" } });
  });

  it("Fire Bolt keeps its magical fire damage when the dice change, and its growth follows them", () => {
    useEncounterStore.setState(pristine, true);
    const spellId = store().attachSrdSpell("def-fighter", "srd:spell:fire-bolt")!;
    const fighter = store().encounter.definitions.find((candidate) => candidate.id === "def-fighter")!;
    const ref: AbilityRef = { list: "spells", id: spellId };
    const { record } = save(fighter, ref, withDiceBumped(findAbility(fighter, ref)!, "action.damage.0"));
    expect((record as { action?: { damage?: DamageComponent[] } }).action?.damage?.[0]).toMatchObject({
      dice: "2d10", damageType: "fire", magical: true,
      scaling: { mode: "cantrip-by-level", steps: [{ atLevel: 5, dice: "4d10" }, { atLevel: 11, dice: "6d10" }, { atLevel: 17, dice: "8d10" }] }
    });
  });
});
