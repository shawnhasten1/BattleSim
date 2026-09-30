import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import {
  resolveAttackBonus,
  sampleEncounter,
  type ActionDefinition,
  type CreatureDefinition,
  type DeathEffectDefinition,
  type FeatureDefinition,
  type SpellDefinition,
  type WeaponDefinition
} from "@/engine";
import { SRD_FEATURES, SRD_SPELLS, SRD_WEAPONS } from "@/data/srd";
import { useEncounterStore } from "@/store/encounter-store";
import { visibleSpecs, type FieldSpec } from "@/components/sheet/builders/field-spec";
import { deepEqual, mergeDraftEdit } from "@/components/sheet/builders/save-delta";
import {
  actionFieldSchema,
  actionFromEffectDraft,
  applyDraftChange,
  deathEffectDraftFromDefinition,
  deathEffectFieldSchema,
  deathEffectFromDraft,
  effectDraftFromAction,
  featureBuilderContext,
  featureDraftFromDefinition,
  featureFromDraft,
  spellDraftFromDefinition,
  spellFieldSchema,
  spellFromDraft,
  weaponDraftFromDefinition,
  weaponFieldSchema,
  weaponFromDraft,
  type BuilderDraft,
  type DiceValue
} from "@/components/sheet/builders/schemas";

/**
 * Every bundled SRD ability through the Abilities tab's save path (open it in the builder, edit, save), checking that
 * a save writes only what was edited. Guards against the lossy save that turned a Brown Bear's melee Claws into a
 * ranged INT attack (ABILITY_BUILDER_REDESIGN_PLAN.md §1.1).
 */

const pristine = useEncounterStore.getState();
afterAll(() => useEncounterStore.setState(pristine, true));
const store = () => useEncounterStore.getState();

interface Ability {
  id: string;
  name: string;
}

/** One kind of record the Abilities tab edits with the guided builder, and how the tab opens and saves it. */
interface Slot<T extends Ability> {
  records(definition: CreatureDefinition): T[];
  toDraft(record: T, definition: CreatureDefinition): BuilderDraft;
  convert(draft: BuilderDraft, definition: CreatureDefinition): unknown;
  write(definitionId: string, record: T): void;
  /** The form, and where its damage dice land in the saved record, for records that show damage dice. */
  fields?(draft: BuilderDraft): FieldSpec[];
  damagePath?: string;
}

const WEAPONS: Slot<WeaponDefinition> = {
  records: (definition) => definition.weapons ?? [],
  toDraft: (weapon) => weaponDraftFromDefinition(weapon),
  convert: (draft) => weaponFromDraft(draft),
  write: (definitionId, weapon) => store().updateWeapon(definitionId, weapon.id, weapon),
  fields: weaponFieldSchema,
  damagePath: "damage.0"
};

const SPELLS: Slot<SpellDefinition> = {
  records: (definition) => definition.spells ?? [],
  toDraft: (spell) => spellDraftFromDefinition(spell),
  convert: (draft) => spellFromDraft(draft),
  write: (definitionId, spell) => store().updateSpell(definitionId, spell.id, spell),
  fields: spellFieldSchema,
  damagePath: "action.damage.0"
};

const ACTIONS: Slot<ActionDefinition> = {
  // Multiattacks, summons and shapechanges have editors of their own.
  records: (definition) => [...definition.actions, ...(definition.bonusActions ?? []), ...(definition.reactions ?? [])]
    .filter((action) => action.kind !== "multiattack" && action.kind !== "summon" && action.kind !== "transform"),
  toDraft: (action) => effectDraftFromAction(action),
  convert: (draft) => actionFromEffectDraft(draft),
  write: (definitionId, action) => store().updateAction(definitionId, action.id, action),
  fields: actionFieldSchema,
  damagePath: "damage.0"
};

const FEATURES: Slot<FeatureDefinition> = {
  records: (definition) => [...(definition.features ?? []), ...(definition.traits ?? [])],
  toDraft: (feature, definition) => featureDraftFromDefinition(feature, featureBuilderContext(definition)),
  convert: (draft, definition) => featureFromDraft(draft, featureBuilderContext(definition)),
  write: (definitionId, feature) => store().updateFeature(definitionId, feature.id, feature)
};

const DEATH_EFFECTS: Slot<DeathEffectDefinition> = {
  records: (definition) => definition.deathEffects ?? [],
  toDraft: (effect) => deathEffectDraftFromDefinition(effect),
  convert: (draft) => deathEffectFromDraft(draft),
  write: (definitionId, effect) => store().updateDeathEffect(definitionId, effect.id, effect),
  fields: deathEffectFieldSchema,
  damagePath: "action.damage.0"
};

const SLOTS: Array<Slot<Ability>> = [WEAPONS, SPELLS, ACTIONS, FEATURES, DEATH_EFFECTS] as Array<Slot<Ability>>;

/* ─── the content ────────────────────────────────────────────────────────── */

const CHUNKS = fileURLToPath(new URL("../src/data/srd/monsters/generated/chunks/", import.meta.url));
const MONSTERS: CreatureDefinition[] = readdirSync(CHUNKS).flatMap(
  (file) => (JSON.parse(readFileSync(join(CHUNKS, file), "utf8")) as { definitions: CreatureDefinition[] }).definitions
);

function monster(name: string): CreatureDefinition {
  const found = MONSTERS.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`No SRD monster named ${name}`);
  return found;
}

/** A scene holding just this creature, as the store holds an SRD monster once it's added. */
function withCreature(definition: CreatureDefinition) {
  const encounter = structuredClone(sampleEncounter);
  encounter.definitions = [structuredClone(definition)];
  encounter.combatants = [];
  useEncounterStore.setState({ ...pristine, encounter }, true);
}

interface Opened {
  definitionId: string;
  recordId: string;
}

interface Case {
  label: string;
  slot: Slot<Ability>;
  /** Set the store up with the record on a creature, the way the sheet would have it. */
  open(): Opened;
}

function attachedToFighter(attach: () => string | undefined): Opened {
  useEncounterStore.setState(pristine, true);
  const recordId = attach();
  if (!recordId) throw new Error("attach failed");
  return { definitionId: "def-fighter", recordId };
}

const CASES: Case[] = [
  ...SRD_WEAPONS.map((weapon): Case => ({
    label: `library weapon ${weapon.name}`, slot: WEAPONS as Slot<Ability>,
    open: () => attachedToFighter(() => store().attachSrdWeapon("def-fighter", weapon.id))
  })),
  ...SRD_SPELLS.map((spell): Case => ({
    label: `library spell ${spell.name}`, slot: SPELLS as Slot<Ability>,
    open: () => attachedToFighter(() => store().attachSrdSpell("def-fighter", spell.id))
  })),
  ...SRD_FEATURES.map((feature): Case => ({
    label: `library feature ${feature.name}`, slot: FEATURES as Slot<Ability>,
    open: () => attachedToFighter(() => store().attachSrdFeature("def-fighter", feature.id))
  })),
  ...MONSTERS.flatMap((creature) => SLOTS.flatMap((slot) => slot.records(creature).map((record): Case => ({
    label: `${creature.name} › ${record.name}`, slot,
    open: () => {
      withCreature(creature);
      return { definitionId: creature.id, recordId: record.id };
    }
  }))))
];

/* ─── the save path ──────────────────────────────────────────────────────── */

interface Saved {
  /** The record as the app held it before the save. */
  stored: Ability;
  saved: Ability;
  changed: boolean;
}

/**
 * Open a record in its builder, apply `edit` to the draft, and save it the way the Abilities tab does. `edit` returns
 * null when it doesn't apply to this record's form.
 */
function saveThroughBuilder(testCase: Case, edit: (draft: BuilderDraft) => BuilderDraft | null): Saved | null {
  const { definitionId, recordId } = testCase.open();
  const slot = testCase.slot;
  const start = store();
  const definitionNow = () => store().encounter.definitions.find((candidate) => candidate.id === definitionId)!;
  const read = () => slot.records(definitionNow()).find((record) => record.id === recordId)!;
  const definition = definitionNow();
  const stored = read();

  const draft = slot.toDraft(stored, definition);
  const edited = edit(draft);
  if (!edited) return null;

  const result = mergeDraftEdit(stored, draft, edited, (next) => slot.convert(next, definition));
  if (result.changed) slot.write(definitionId, result.record);
  const saved = read();
  useEncounterStore.setState(start, true);
  return { stored, saved, changed: result.changed };
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

/** One more die (or, for an expression the boxes can't hold, a different expression). */
function bumpDice(draft: BuilderDraft): BuilderDraft {
  const dice = draft.dmg as DiceValue;
  return applyDraftChange(draft, "dmg", dice.raw !== undefined ? { ...dice, raw: "4d4" } : { ...dice, count: dice.count + 1 });
}

function showsDice(testCase: Case, draft: BuilderDraft): boolean {
  const fields = testCase.slot.fields?.(draft) ?? [];
  return visibleSpecs(fields, draft, "advanced").some((spec) => spec.key === "dmg");
}

/* ─── the sweep ──────────────────────────────────────────────────────────── */

describe("saving an SRD ability through the sheet builder", () => {
  it("covers the whole library and every SRD monster", () => {
    expect(CASES.length).toBeGreaterThan(1500);
  });

  it("writes nothing when nothing changed", () => {
    const written = CASES.filter((testCase) => saveThroughBuilder(testCase, (draft) => structuredClone(draft))!.changed).map((testCase) => testCase.label);
    expect(written).toEqual([]);
  });

  it("renaming changes only names", () => {
    const problems: string[] = [];
    for (const testCase of CASES) {
      const { stored, saved } = saveThroughBuilder(testCase, (draft) => applyDraftChange(draft, "name", "Renamed"))!;
      const stray = changedPaths(stored, saved).filter((path) => !/(^|\.)name$/.test(path));
      if (saved.name !== "Renamed" || stray.length) problems.push(`${testCase.label}: ${saved.name !== "Renamed" ? "not renamed; " : ""}${stray.join(", ")}`);
    }
    expect(problems).toEqual([]);
  });

  it("changing the damage dice changes only those dice", () => {
    const problems: string[] = [];
    let checked = 0;
    for (const testCase of CASES) {
      const result = saveThroughBuilder(testCase, (draft) => (showsDice(testCase, draft) ? bumpDice(draft) : null));
      if (!result) continue;
      checked += 1;
      const at = testCase.slot.damagePath!;
      const paths = changedPaths(result.stored, result.saved);
      const stray = paths.filter((path) => path !== `${at}.dice`);
      const mirrors = mirrorsMatch(at.split(".").reduce<unknown>((value, key) => (value as Record<string, unknown> | undefined)?.[key], result.saved));
      if (!paths.includes(`${at}.dice`) || stray.length || !mirrors) {
        problems.push(`${testCase.label}: ${paths.includes(`${at}.dice`) ? "" : "dice unchanged; "}${mirrors ? "" : "stale dice mirrors; "}${stray.join(", ")}`);
      }
    }
    // Every weapon, attack, and damaging save or area across the library and the monsters (771 when written).
    expect(checked).toBeGreaterThan(700);
    expect(problems).toEqual([]);
  });
});

/* ─── worked examples ────────────────────────────────────────────────────── */

describe("worked examples", () => {
  function editMonster<T extends Ability>(slot: Slot<T>, creatureName: string, recordName: string, edit: (draft: BuilderDraft) => BuilderDraft): { saved: T; definition: CreatureDefinition } {
    const creature = monster(creatureName);
    withCreature(creature);
    const definition = store().encounter.definitions[0]!;
    const stored = slot.records(definition).find((record) => record.name === recordName)!;
    const draft = slot.toDraft(stored, definition);
    const result = mergeDraftEdit(stored, draft, edit(draft), (next) => slot.convert(next, definition));
    expect(result.changed).toBe(true);
    slot.write(definition.id, result.record);
    const after = store().encounter.definitions[0]!;
    return { saved: slot.records(after).find((record) => record.id === stored.id)!, definition: after };
  }

  it("a Brown Bear's Claws stay a +6 melee STR attack when the dice change", () => {
    const { saved, definition } = editMonster(ACTIONS, "Brown Bear", "Claws", bumpDice);
    expect(saved).toMatchObject({ kind: "attack", attackType: "melee", ability: "str", reach: 5, attackBonus: 6 });
    if (saved.kind !== "attack") throw new Error("not an attack");
    expect(saved.attackBonusFormula).toBeUndefined();
    expect(resolveAttackBonus(saved, definition)).toBe(6);
    expect(saved.damage).toEqual([expect.objectContaining({ dice: "3d6", damageType: "slashing", abilityModifier: "str" })]);
  });

  it("an Adult Red Dragon's Bite keeps its fire damage when the piercing dice change", () => {
    const { saved } = editMonster(ACTIONS, "Adult Red Dragon", "Bite", bumpDice);
    if (saved.kind !== "attack") throw new Error("not an attack");
    expect(saved.damage).toHaveLength(2);
    expect(saved.damage[0]).toMatchObject({ dice: "3d10", damageType: "piercing" });
    expect(saved.damage[1]).toEqual({ dice: "2d6", damageType: "fire", diceCount: 2, diceSize: 6 });
  });

  it("an Adult Red Dragon's Fire Breath keeps its recharge when the DC changes", () => {
    const { saved } = editMonster(ACTIONS, "Adult Red Dragon", "Fire Breath", (draft) => applyDraftChange(draft, "saveDc", 20));
    expect(saved).toMatchObject({ kind: "area-save", dc: 20, usage: { kind: "recharge", recharge: { min: 5 } } });
    if (saved.kind !== "area-save") throw new Error("not an area save");
    expect(saved.resourceCost).toEqual({ resourceId: "usage:fire-breath", amount: 1 });
    expect(saved.area).toMatchObject({ type: "cone", size: 60 });
  });

  it("a Couatl's Shield stays an activated effect when it's renamed", () => {
    const { saved } = editMonster(SPELLS, "Couatl", "Shield", (draft) => applyDraftChange(draft, "name", "Warding Shield"));
    expect(saved.name).toBe("Warding Shield");
    expect(saved.action).toMatchObject({ kind: "activate-feature", name: "Warding Shield" });
  });

  it("a reference-only action opens as reference-only and stays that way when renamed", () => {
    const creature = MONSTERS.find((candidate) => candidate.actions.some((action) => action.kind === "unsupported"))!;
    const action = creature.actions.find((candidate) => candidate.kind === "unsupported")!;
    const draft = effectDraftFromAction(action);
    expect(draft.shape).toBe("keep");
    expect(visibleSpecs(actionFieldSchema(draft), draft, "advanced").find((spec) => spec.key === "shape")?.options?.[0]).toEqual({ value: "keep", label: "Reference only (not simulated)" });
    const { saved } = editMonster(ACTIONS, creature.name, action.name, (next) => applyDraftChange(next, "name", "Renamed"));
    expect(saved).toMatchObject({ kind: "unsupported", name: "Renamed", automationSupport: "unsupported" });
  });

  it("picking a shape for a reference-only action rebuilds it as that shape", () => {
    const creature = MONSTERS.find((candidate) => candidate.actions.some((action) => action.kind === "unsupported"))!;
    const action = creature.actions.find((candidate) => candidate.kind === "unsupported")!;
    const { saved } = editMonster(ACTIONS, creature.name, action.name, (next) => applyDraftChange(next, "shape", "save"));
    expect(saved).toMatchObject({ kind: "save", automationSupport: "full" });
  });

  it("Fire Bolt keeps its cantrip scaling and magical damage when the dice change", () => {
    useEncounterStore.setState(pristine, true);
    const spellId = store().attachSrdSpell("def-fighter", "srd:spell:fire-bolt")!;
    const definition = store().encounter.definitions.find((candidate) => candidate.id === "def-fighter")!;
    const stored = definition.spells!.find((spell) => spell.id === spellId)!;
    const draft = spellDraftFromDefinition(stored);
    const result = mergeDraftEdit(stored, draft, bumpDice(draft), spellFromDraft);
    store().updateSpell("def-fighter", spellId, result.record);
    const saved = store().encounter.definitions.find((candidate) => candidate.id === "def-fighter")!.spells!.find((spell) => spell.id === spellId)!;
    if (saved.action?.kind !== "attack") throw new Error("not an attack");
    expect(saved.action.damage[0]).toMatchObject({ dice: "2d10", damageType: "fire", magical: true, scaling: { mode: "cantrip-by-level" } });
  });
});
