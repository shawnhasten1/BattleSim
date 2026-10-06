import { describe, expect, it } from "vitest";
import {
  createEngineState,
  getExecutableActions,
  resolveAreaSaveAction,
  sampleEncounter,
  type ActionDefinition,
  type CombatantState,
  type CreatureDefinition,
  type EncounterSnapshot,
  type RandomSource,
  type ReactionRequest,
  type SpellDefinition
} from "@/engine";
import { findSrdSpell } from "@/data/srd";
import { findSrd2024Spell } from "@/data/srd/2024/spells";
import { describeQuestion } from "@/lib/play/questions";

/**
 * PC builder plan, Phase 7q: the 2024 Counterspell. The caster makes a Constitution save against the counterer's spell
 * save DC; a failure stops the spell whatever its level, and a slot it was cast with isn't spent.
 */

const blank = (id: string, extra: Partial<CreatureDefinition> = {}): CreatureDefinition => ({
  id, name: id, size: "medium", armorClass: 12, maxHp: 40, speed: 30, type: "humanoid",
  abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 12, cha: 10 }, actions: [], ...extra
});

/** An evoker with Fireball and two 3rd-level slots. */
const evoker = blank("evoker", {
  abilities: { str: 10, dex: 10, con: 10, int: 18, wis: 10, cha: 10 }, proficiencyBonus: 3, spellcasting: { ability: "int" },
  spells: [structuredClone(findSrdSpell("srd:spell:fireball") as SpellDefinition)], resources: { "slot-3": 2 }
});

/** INT 18, proficiency +3: a spell save DC of 15. The 2024 Counterspell, a 3rd-level slot. */
const counterer = blank("counterer", {
  abilities: { str: 10, dex: 10, con: 10, int: 18, wis: 10, cha: 10 }, proficiencyBonus: 3, spellcasting: { ability: "int" },
  spells: [structuredClone(findSrd2024Spell("srd:spell:counterspell-2024")!)], resources: { "slot-3": 1 }
});

function scene(): EncounterSnapshot {
  const base = structuredClone(sampleEncounter);
  const tokens: Array<{ id: string; def: CreatureDefinition; faction: "party" | "enemy"; at: [number, number] }> = [
    { id: "evoker", def: evoker, faction: "enemy", at: [10, 5] },
    { id: "counterer", def: counterer, faction: "party", at: [14, 5] },
    { id: "target", def: blank("target"), faction: "party", at: [16, 8] }
  ];
  return {
    ...base, map: { ...base.map, grid: { ...base.map.grid, width: 30, height: 12 }, walls: [], terrain: [] },
    definitions: [evoker, counterer, tokens[2]!.def],
    combatants: tokens.map((token, index): CombatantState => ({
      id: token.id, definitionId: token.def.id, displayName: token.id, faction: token.faction, position: { x: token.at[0], y: token.at[1] },
      currentHp: token.def.maxHp, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced",
      initiative: 20 - index, actionEconomy: { action: true, bonus: true, reaction: true },
      resources: token.def.resources ? { ...token.def.resources } : undefined
    })),
    round: 1, turnIndex: 0
  };
}

/** d20s as listed, then 10s; every other die its lowest. */
function d20s(...values: number[]): RandomSource {
  let index = 0;
  const make = (): RandomSource => ({ next: () => 0, nextInt: (min, max) => (max === 20 ? values[index++] ?? 10 : min), fork: make });
  return make();
}

/** The evoker casts Fireball at the target, the counterer told to counter it (a person's answer). */
function castAndCounter(d20: number[]) {
  const state = createEngineState(scene());
  const counter = getExecutableActions(counterer).find((entry) => entry.name === "Counterspell")!;
  const asked: ReactionRequest[] = [];
  state.decide = (request) => {
    if (request.kind !== "reaction" || request.trigger !== "enemy-casts-spell") return undefined;
    asked.push(request);
    return { kind: "reaction", actionId: counter.id };
  };
  state.rng = d20s(...d20);
  const fireball = getExecutableActions(evoker).find((entry) => entry.name === "Fireball")!;
  resolveAreaSaveAction(state, "evoker", { x: 16, y: 8 }, fireball.id);
  const find = (id: string) => state.snapshot.combatants.find((token) => token.id === id)!;
  return { state, find, asked, counter };
}

describe("the 2024 Counterspell", () => {
  it("is the caster's Constitution save, whatever the spell's level", () => {
    const counter = findSrd2024Spell("srd:spell:counterspell-2024")!.action as Extract<ActionDefinition, { kind: "activate-feature" }>;
    expect(counter.reaction?.trigger).toMatchObject({ kind: "enemy-casts-spell", withinFt: 60, casterSave: "con" });
  });

  it("a failed save stops the spell, and its slot isn't spent", () => {
    const { state, find } = castAndCounter([2]);
    expect(state.log.some((entry) => entry.type === "SpellCountered")).toBe(true);
    expect(find("evoker").resources?.["slot-3"]).toBe(2);
    expect(find("counterer").resources?.["slot-3"]).toBe(0);
    expect(find("target").currentHp).toBe(40);
    expect(state.log.find((entry) => entry.type === "SaveRolled" && entry.data?.counterspell)?.data).toMatchObject({ dc: 15, success: false });
  });

  it("a made save lets it through, the slot spent", () => {
    const { state, find } = castAndCounter([18]);
    expect(state.log.some((entry) => entry.type === "SpellCountered")).toBe(false);
    expect(find("evoker").resources?.["slot-3"]).toBe(1);
    expect(find("target").currentHp).toBeLessThan(40);
  });

  it("asks with the save's odds", () => {
    const { state, asked } = castAndCounter([2]);
    expect(asked[0]?.options[0]?.counter).toMatchObject({ casterSave: { ability: "con", dc: 15 }, chance: 0.7 });
    const text = describeQuestion(asked[0]!, state.snapshot);
    expect(text.options[0]?.detail).toContain("CON save DC 15: 70% it fails");
  });
});
