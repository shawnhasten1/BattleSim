import { describe, expect, it } from "vitest";
import {
  createEngineState,
  getExecutableActions,
  resolveAreaSaveAction,
  sampleEncounter,
  type CombatantState,
  type CombatLogEvent,
  type CreatureDefinition,
  type EncounterSnapshot,
  type RandomSource,
  type SpellDefinition
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor, withSuggestions } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES, SRD_BUILDER_LIBRARY } from "@/lib/character-builder/srd";

/**
 * EDITIONS_PLAN.md Phase 9: a 2014 and a 2024 wizard in one fight, each casting its own edition's Fireball and
 * Counterspell. The 2014 Counterspell stops a spell of its slot's level outright; the 2024 one makes the caster save.
 */

const sources = SRD_BUILD_SOURCES;

/** A Wizard 5 built by the builder, with its own edition's Counterspell beside its Fireball. */
function wizard(classId: string, counterspell: string, id: string): CreatureDefinition {
  const actor = rebuildActor(blankCharacter(id, id), withSuggestions(quickBuild(sources, { classId, level: 5 }), sources), sources).definition;
  return { ...actor, id, spells: [...(actor.spells ?? []), structuredClone(SRD_BUILDER_LIBRARY.spell!(counterspell) as SpellDefinition)] };
}

const fighter = (): CreatureDefinition => structuredClone(sampleEncounter.definitions.find((entry) => entry.id === "def-fighter")!);

/** `caster` at (16, 5); `counterer` 12 squares off with three of its side bunched at (10, 5). */
function scene(caster: CreatureDefinition, counterer: CreatureDefinition): EncounterSnapshot {
  const base = structuredClone(sampleEncounter);
  const tokens: Array<{ id: string; def: CreatureDefinition; faction: "party" | "enemy"; at: [number, number] }> = [
    { id: "caster", def: caster, faction: "enemy", at: [16, 5] },
    { id: "counterer", def: counterer, faction: "party", at: [4, 5] },
    ...[[10, 5], [11, 5], [10, 6]].map(([x, y], index) => ({ id: `pc-${index + 1}`, def: fighter(), faction: "party" as const, at: [x!, y!] as [number, number] }))
  ];
  return {
    ...base, seed: "editions-counter", map: { ...base.map, grid: { ...base.map.grid, width: 30, height: 12 }, walls: [], terrain: [] },
    definitions: [...new Map(tokens.map((token) => [token.def.id, token.def])).values()],
    combatants: tokens.map((token, index): CombatantState => ({
      id: token.id, definitionId: token.def.id, displayName: token.id, faction: token.faction, position: { x: token.at[0], y: token.at[1] },
      currentHp: token.def.maxHp, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced",
      initiative: 20 - index, actionEconomy: { action: true, bonus: true, reaction: true },
      resources: token.def.resources ? { ...token.def.resources } : undefined
    }))
  };
}

/** Every d20 rolls `d20`; every other die its lowest. */
const rolling = (d20: number): RandomSource => {
  const source: RandomSource = { next: () => 0, nextInt: (min, max) => (max === 20 ? d20 : min), fork: () => source };
  return source;
};

const fireballOf = (definition: CreatureDefinition) => getExecutableActions(definition).find((action) => action.name === "Fireball")!;
const countered = (log: CombatLogEvent[]) => log.some((entry) => entry.type === "SpellCountered");
const resources = (snapshot: EncounterSnapshot, id: string) => snapshot.combatants.find((token) => token.id === id)!.resources ?? {};

describe("a 2014 and a 2024 wizard, each with its own Fireball and Counterspell", () => {
  const w14 = wizard("srd:class:wizard-2014", "srd:spell:counterspell", "w14");
  const w24 = wizard("srd:class:wizard", "srd:spell:counterspell-2024", "w24");

  it("each has its own edition's spells", () => {
    expect(w14.spells!.find((spell) => spell.name === "Fireball")!.source?.edition).toBe("2014");
    expect(w24.spells!.find((spell) => spell.name === "Fireball")!.source?.edition).toBe("2024");
    expect(w14.spells!.find((spell) => spell.name === "Counterspell")!.source?.edition).toBe("2014");
    expect(w24.spells!.find((spell) => spell.name === "Counterspell")!.source?.edition).toBe("2024");
  });

  it("the 2014 wizard's Counterspell stops the 2024 Fireball outright: a 3rd-level spell against a 3rd-level slot, no check", () => {
    const state = createEngineState(scene(w24, w14));
    const slots = resources(state.snapshot, "counterer")["slot-3"]!;
    resolveAreaSaveAction(state, "caster", { x: 10, y: 5 }, fireballOf(w24).id);
    expect(countered(state.log)).toBe(true);
    expect(state.log.some((entry) => entry.type === "CounterspellCheck")).toBe(false);
    expect(state.log.some((entry) => entry.type === "SaveRolled" && /Counterspell/.test(entry.message))).toBe(false);
    expect(resources(state.snapshot, "counterer")["slot-3"]).toBe(slots - 1);
  });

  it("the 2024 wizard's Counterspell makes the 2014 caster save: failed, the Fireball is stopped and its slot kept", () => {
    const state = createEngineState(scene(w14, w24));
    state.rng = rolling(1);
    const casterSlots = resources(state.snapshot, "caster")["slot-3"]!;
    resolveAreaSaveAction(state, "caster", { x: 10, y: 5 }, fireballOf(w14).id);
    expect(state.log.some((entry) => entry.type === "SaveRolled" && /CON save against counterer's Counterspell/.test(entry.message))).toBe(true);
    expect(countered(state.log)).toBe(true);
    expect(resources(state.snapshot, "caster")["slot-3"]).toBe(casterSlots);
  });

  it("…and made, the 2014 Fireball goes off", () => {
    const state = createEngineState(scene(w14, w24));
    state.rng = rolling(20);
    resolveAreaSaveAction(state, "caster", { x: 10, y: 5 }, fireballOf(w14).id);
    expect(countered(state.log)).toBe(false);
    expect(state.log.some((entry) => entry.type === "DamageApplied")).toBe(true);
  });
});
