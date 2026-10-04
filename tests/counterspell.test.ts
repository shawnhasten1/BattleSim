import { describe, expect, it } from "vitest";
import {
  createEngineState,
  getExecutableActions,
  migrateDefinition,
  resolveAreaSaveAction,
  resolveHealingAction,
  resolveSaveAction,
  sampleEncounter,
  spellThreat
} from "@/engine";
import type { ActionDefinition, CombatantState, CombatLogEvent, CreatureDefinition, EncounterSnapshot, RandomSource, ReactionRequest, SpellDefinition } from "@/engine";
import { findSrdSpell } from "@/data/srd";

/**
 * Counterspell by the rules, and an AI that counters what's worth countering: a spell no higher than the counter's
 * slot is stopped outright, one above it takes a check (DC 10 + its level), and the AI weighs what the spell would do
 * to its side — damage across everyone it catches, who it would drop, the conditions it would land and for how long —
 * against the slot it would spend and its chance of success.
 */

const spell = (id: string): SpellDefinition => structuredClone(findSrdSpell(id) as SpellDefinition);

const blank = (id: string, extra: Partial<CreatureDefinition> = {}): CreatureDefinition => ({
  id, name: id, size: "medium", armorClass: 12, maxHp: 40, speed: 30, type: "humanoid",
  abilities: { str: 10, dex: 14, con: 10, int: 10, wis: 12, cha: 10 },
  actions: [], ...extra
});

/** INT and WIS 18, proficiency +3: its spells' DC is 15. */
const evoker = (slots: Record<string, number>, spells: string[]) => blank("evoker", {
  abilities: { str: 10, dex: 10, con: 10, int: 18, wis: 18, cha: 10 }, proficiencyBonus: 3,
  spellcasting: { ability: "int" }, spells: spells.map(spell), resources: slots
});

/** INT 18: its counter's check is d20 + 4. No melee attack and no other reaction, so its reaction costs it nothing else. */
const abjurer = (slots: Record<string, number>) => blank("abjurer", {
  abilities: { str: 10, dex: 10, con: 10, int: 18, wis: 10, cha: 10 }, proficiencyBonus: 3,
  spellcasting: { ability: "int" }, spells: [spell("srd:spell:counterspell")], resources: slots
});

/** A fighter worth keeping on its feet: 40 HP and a 2d6 + 3 greatsword. */
const fighter = (id: string) => blank(id, {
  actions: [{ kind: "attack", id: "greatsword", name: "Greatsword", actionType: "action", attackType: "melee", ability: "str",
    attackBonus: 5, range: 5, reach: 5, damage: [{ dice: "2d6+3", damageType: "slashing" }], automationSupport: "full" } as ActionDefinition]
});

type Token = { id: string; def: CreatureDefinition; faction: "party" | "enemy"; at: [number, number]; extra?: Partial<CombatantState> };

function scene(tokens: Token[], seed = "counter"): EncounterSnapshot {
  const base = structuredClone(sampleEncounter);
  const definitions = [...new Map(tokens.map((token) => [token.def.id, token.def])).values()];
  return {
    ...base, seed, map: { ...base.map, grid: { ...base.map.grid, width: 30, height: 12 }, walls: [], terrain: [] },
    definitions,
    combatants: tokens.map((token, index): CombatantState => ({
      id: token.id, definitionId: token.def.id, displayName: token.id, faction: token.faction, position: { x: token.at[0], y: token.at[1] },
      currentHp: token.def.maxHp, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced",
      initiative: 20 - index, actionEconomy: { action: true, bonus: true, reaction: true },
      resources: token.def.resources ? { ...token.def.resources } : undefined, ...token.extra
    }))
  };
}

/** d20s as listed, then 1s; every other die rolls its lowest. */
function d20s(...values: number[]): RandomSource {
  let index = 0;
  const make = (): RandomSource => ({
    next: () => 0,
    nextInt: (min: number, max: number) => (max === 20 ? Math.min(20, Math.max(1, values[index++] ?? 1)) : min),
    fork: make
  });
  return make();
}

const find = (snapshot: EncounterSnapshot, id: string) => snapshot.combatants.find((combatant) => combatant.id === id)!;
const counterDecision = (log: CombatLogEvent[]) => log.find((entry) => entry.type === "AiDecision" && entry.data && "threat" in entry.data);
const countered = (log: CombatLogEvent[]) => log.some((entry) => entry.type === "SpellCountered");

/** Four PCs bunched up at (10, 5), the abjurer out of the blast, the evoker 30 ft off. */
function partyUnderFireball(abjurerSlots: Record<string, number>, stance: CombatantState["resourceStance"] = "balanced", pcs = 4): EncounterSnapshot {
  const party: Token[] = [[10, 5], [11, 5], [10, 6], [11, 6]].slice(0, pcs)
    .map(([x, y], index) => ({ id: `pc-${index + 1}`, def: fighter("pc"), faction: "party", at: [x!, y!] }));
  return scene([
    { id: "evoker", def: evoker({ "slot-3": 2, "slot-5": 1 }, ["srd:spell:fireball"]), faction: "enemy", at: [16, 5] },
    { id: "abjurer", def: abjurer(abjurerSlots), faction: "party", at: [4, 5], extra: { resourceStance: stance } },
    ...party
  ]);
}

const FIREBALL_5 = "srd:spell:fireball:action:upcast-5";

describe("the worked examples", () => {
  it("a 5th-level Fireball into four PCs: countered with the 5th-level slot, even by a conservative caster", () => {
    for (const stance of ["balanced", "conservative"] as const) {
      const state = createEngineState(partyUnderFireball({ "slot-3": 2, "slot-5": 1 }, stance));
      resolveAreaSaveAction(state, "evoker", { x: 10, y: 5 }, FIREBALL_5);
      expect(countered(state.log), stance).toBe(true);
      expect(find(state.snapshot, "abjurer").resources, stance).toMatchObject({ "slot-3": 2, "slot-5": 0 });
      expect(state.log.some((entry) => entry.type === "CounterspellCheck"), stance).toBe(false);
      const decision = counterDecision(state.log)!;
      expect((decision.data!.threat as { total: number }).total).toBeGreaterThan(100);
      expect((decision.data!.threat as { creatures: unknown[] }).creatures).toHaveLength(4);
    }
  });

  it("the same Fireball at one PC: countered by a balanced caster, let through by a conservative one", () => {
    const balanced = createEngineState(partyUnderFireball({ "slot-3": 2, "slot-5": 1 }, "balanced", 1));
    resolveAreaSaveAction(balanced, "evoker", { x: 10, y: 5 }, FIREBALL_5);
    expect(countered(balanced.log)).toBe(true);

    const conservative = createEngineState(partyUnderFireball({ "slot-3": 2, "slot-5": 1 }, "conservative", 1));
    resolveAreaSaveAction(conservative, "evoker", { x: 10, y: 5 }, FIREBALL_5);
    expect(countered(conservative.log)).toBe(false);
    expect(counterDecision(conservative.log)!.message).toMatch(/lets Fireball at level 5 through/);
    expect(find(conservative.snapshot, "abjurer").resources).toMatchObject({ "slot-3": 2, "slot-5": 1 });
  });

  it("Hold Person on the party's fighter: countered with a 3rd-level slot, even by a conservative caster", () => {
    for (const stance of ["balanced", "conservative"] as const) {
      const state = createEngineState(scene([
        { id: "evoker", def: evoker({ "slot-2": 2 }, ["srd:spell:hold-person"]), faction: "enemy", at: [12, 5] },
        { id: "abjurer", def: abjurer({ "slot-3": 2 }), faction: "party", at: [4, 5], extra: { resourceStance: stance } },
        { id: "pc-1", def: fighter("pc"), faction: "party", at: [8, 5] }
      ]));
      resolveSaveAction(state, "evoker", "pc-1", "srd:spell:hold-person:action");
      expect(countered(state.log), stance).toBe(true);
      const threat = counterDecision(state.log)!.data!.threat as { creatures: Array<{ conditions: Array<{ name: string; chance: number; turns: number }> }> };
      expect(threat.creatures[0]!.conditions[0]).toMatchObject({ name: "paralyzed", chance: 0.65 });
      expect(threat.creatures[0]!.conditions[0]!.turns).toBeCloseTo(1 / 0.35);
    }
  });

  it("a 5th-level Fireball, with only 3rd-level slots: countered all the same, rolling the check", () => {
    const state = createEngineState(partyUnderFireball({ "slot-3": 2 }));
    state.rng = d20s(11); // 11 + 4 = 15 against DC 15
    resolveAreaSaveAction(state, "evoker", { x: 10, y: 5 }, FIREBALL_5);
    expect(state.log.find((entry) => entry.type === "CounterspellCheck")?.data).toMatchObject({ dc: 15, success: true, spellLevel: 5 });
    expect(countered(state.log)).toBe(true);
    expect(find(state.snapshot, "abjurer").resources).toMatchObject({ "slot-3": 1 });
  });

  it("Cure Wounds on an enemy who isn't hurt: let through", () => {
    const state = createEngineState(scene([
      { id: "evoker", def: evoker({ "slot-1": 2 }, ["srd:spell:cure-wounds"]), faction: "enemy", at: [12, 5] },
      { id: "ogre", def: fighter("ogre"), faction: "enemy", at: [13, 5] },
      { id: "abjurer", def: abjurer({ "slot-3": 2 }), faction: "party", at: [6, 5] }
    ]));
    resolveHealingAction(state, "evoker", "ogre", "srd:spell:cure-wounds:action");
    expect(countered(state.log)).toBe(false);
    expect((counterDecision(state.log)!.data!.threat as { total: number }).total).toBe(0);
  });

  it("a Fireball that catches two of the caster's own and one PC: let through", () => {
    const state = createEngineState(scene([
      { id: "evoker", def: evoker({ "slot-3": 2 }, ["srd:spell:fireball"]), faction: "enemy", at: [15, 5] },
      { id: "ogre-1", def: fighter("ogre"), faction: "enemy", at: [10, 5] },
      { id: "ogre-2", def: fighter("ogre"), faction: "enemy", at: [11, 5] },
      { id: "pc-1", def: fighter("pc"), faction: "party", at: [10, 6] },
      { id: "abjurer", def: abjurer({ "slot-3": 2 }), faction: "party", at: [4, 5] }
    ]));
    resolveAreaSaveAction(state, "evoker", { x: 10, y: 5 }, "srd:spell:fireball:action");
    expect(countered(state.log)).toBe(false);
    expect((counterDecision(state.log)!.data!.threat as { total: number }).total).toBeLessThan(0);
  });
});

describe("the rules of a counter", () => {
  it("with only 3rd-level slots against a 5th-level spell, a failed check spends the slot and the spell goes off", () => {
    const state = createEngineState(partyUnderFireball({ "slot-3": 2 }));
    state.rng = d20s(10); // 10 + 4 = 14 against DC 15
    const result = resolveAreaSaveAction(state, "evoker", { x: 10, y: 5 }, FIREBALL_5);
    expect(state.log.find((entry) => entry.type === "CounterspellCheck")?.data).toMatchObject({ dc: 15, success: false });
    expect(countered(state.log)).toBe(false);
    expect(result.targets.length).toBe(4);
    expect(find(state.snapshot, "abjurer").resources).toMatchObject({ "slot-3": 1 });
    expect(find(state.snapshot, "abjurer").actionEconomy?.reaction).toBe(false);
  });

  it("an upcast Fireball is a 5th-level spell: a 3rd-level counter needs the check against it, not at its printed level", () => {
    const state = createEngineState(partyUnderFireball({ "slot-3": 2 }));
    state.rng = d20s(20);
    resolveAreaSaveAction(state, "evoker", { x: 10, y: 5 }, FIREBALL_5);
    expect(state.log.find((entry) => entry.type === "CounterspellCheck")?.data).toMatchObject({ spellLevel: 5, dc: 15 });
  });

  it("a counter set to never roll (checkAbove: false) can't touch a spell above its slot", () => {
    const encounter = partyUnderFireball({ "slot-3": 2 });
    const counter = encounter.definitions.find((definition) => definition.id === "abjurer")!.spells![0]!.action as Extract<ActionDefinition, { kind: "activate-feature" }>;
    counter.reaction = { ...counter.reaction!, trigger: { kind: "enemy-casts-spell", withinFt: 60, checkAbove: false } };
    const state = createEngineState(encounter);
    resolveAreaSaveAction(state, "evoker", { x: 10, y: 5 }, FIREBALL_5);
    expect(countered(state.log)).toBe(false);
    expect(state.log.some((entry) => entry.type === "ReactionTriggered")).toBe(false);
  });

  it("a paralysis spell on something immune to paralysis isn't worth a slot", () => {
    const state = createEngineState(scene([
      { id: "evoker", def: evoker({ "slot-2": 2 }, ["srd:spell:hold-person"]), faction: "enemy", at: [12, 5] },
      { id: "abjurer", def: abjurer({ "slot-3": 2 }), faction: "party", at: [4, 5] },
      { id: "golem", def: blank("golem", { conditionImmunities: ["paralyzed"] }), faction: "party", at: [8, 5] }
    ]));
    resolveSaveAction(state, "evoker", "golem", "srd:spell:hold-person:action");
    expect(countered(state.log)).toBe(false);
  });

  it("Hold Person upcast to catch two is worth more to stop than the same spell at one", () => {
    const encounter = scene([
      { id: "evoker", def: evoker({ "slot-2": 2, "slot-3": 1 }, ["srd:spell:hold-person"]), faction: "enemy", at: [12, 5] },
      { id: "abjurer", def: abjurer({ "slot-3": 2 }), faction: "party", at: [4, 5] },
      { id: "pc-1", def: fighter("pc"), faction: "party", at: [8, 5] },
      { id: "pc-2", def: fighter("pc"), faction: "party", at: [8, 6] }
    ]);
    const caster = find(encounter, "evoker");
    const actions = getExecutableActions(encounter.definitions.find((definition) => definition.id === "evoker")!);
    const base = actions.find((action) => action.id === "srd:spell:hold-person:action")!;
    const upcast = actions.find((action) => action.id === "srd:spell:hold-person:action:upcast-3")!;
    const one = spellThreat(encounter, find(encounter, "abjurer"), caster, base, { targetIds: ["pc-1"] }, 2);
    const two = spellThreat(encounter, find(encounter, "abjurer"), caster, upcast, { targetIds: ["pc-1", "pc-2"] }, 3);
    expect(two.total).toBeCloseTo(one.total * 2);
  });
});

describe("what a counterer knows (the campaign rule)", () => {
  function unseen(spellId: string, cast: (state: ReturnType<typeof createEngineState>) => void) {
    const encounter = scene([
      { id: "evoker", def: evoker({ "slot-1": 2, "slot-3": 2 }, [spellId]), faction: "enemy", at: [16, 5] },
      { id: "ogre", def: fighter("ogre"), faction: "enemy", at: [17, 5], extra: { currentHp: 5 } },
      { id: "abjurer", def: abjurer({ "slot-3": 2 }), faction: "party", at: [4, 5] },
      { id: "pc-1", def: fighter("pc"), faction: "party", at: [10, 5] }
    ]);
    encounter.rules = { ...encounter.rules, counterspellReadsSpell: false };
    const state = createEngineState(encounter);
    const asked: ReactionRequest[] = [];
    state.decide = (request) => {
      if (request.kind === "reaction") asked.push(request);
      return undefined;
    };
    cast(state);
    return { state, asked };
  }

  it("off: a Fireball and a Cure Wounds look the same — a spell from a caster with 3rd-level slots", () => {
    const fireball = unseen("srd:spell:fireball", (state) => resolveAreaSaveAction(state, "evoker", { x: 10, y: 5 }, "srd:spell:fireball:action"));
    const cure = unseen("srd:spell:cure-wounds", (state) => resolveHealingAction(state, "evoker", "ogre", "srd:spell:cure-wounds:action"));
    for (const { state, asked } of [fireball, cure]) {
      const decision = counterDecision(state.log)!;
      expect(decision.data!.threat).toMatchObject({ basis: "level", total: 18 });
      expect(decision.message).toMatch(/the spell/);
      expect(asked[0]!.context.spell).toMatchObject({ known: false, name: "", level: 0 });
      expect(asked[0]!.context.spell!.threat).toBeUndefined();
    }
    expect(countered(fireball.state.log)).toBe(countered(cure.state.log));
  });

  it("on (the default): the prompt names the spell and carries its threat", () => {
    const state = createEngineState(partyUnderFireball({ "slot-3": 2, "slot-5": 1 }));
    const asked: ReactionRequest[] = [];
    state.decide = (request) => {
      if (request.kind === "reaction") asked.push(request);
      return undefined;
    };
    resolveAreaSaveAction(state, "evoker", { x: 10, y: 5 }, FIREBALL_5);
    expect(asked[0]!.context.spell).toMatchObject({ known: true, level: 5 });
    expect(asked[0]!.context.spell!.threat!.creatures).toHaveLength(4);
    expect(asked[0]!.options.map((option) => option.counter)).toEqual([
      { slot: 3, check: { dcBase: 10, modifier: 4 }, chance: 0.5, dc: 15 },
      { slot: 5, check: { dcBase: 10, modifier: 4 }, chance: 1 }
    ]);
  });
});

describe("a DM overruling the counter's check", () => {
  it("ruled a success, the spell is stopped; ruled a failure, it goes off", () => {
    for (const outcome of ["success", "failure"] as const) {
      const state = createEngineState(partyUnderFireball({ "slot-3": 2 }));
      state.rng = d20s(outcome === "success" ? 2 : 19);
      state.decide = (request) => (request.kind === "roll" && request.label?.startsWith("Counter") ? { kind: "roll", outcome } : undefined);
      resolveAreaSaveAction(state, "evoker", { x: 10, y: 5 }, FIREBALL_5);
      expect(state.log.find((entry) => entry.type === "CounterspellCheck")?.data, outcome).toMatchObject({ success: outcome === "success", overridden: outcome });
      expect(countered(state.log), outcome).toBe(outcome === "success");
    }
  });
});

describe("saved counters", () => {
  const counter = (trigger: object): CreatureDefinition => blank("saved", {
    reactions: [{ kind: "activate-feature", id: "counter", name: "Counterspell", actionType: "reaction", featureId: "counter",
      reaction: { trigger: trigger as never, priority: "worthwhile" }, resourceCost: { resourceId: "slot-3", amount: 1 }, automationSupport: "full" }]
  });
  const triggerOf = (definition: CreatureDefinition) => (definition.reactions![0] as Extract<ActionDefinition, { kind: "activate-feature" }>).reaction!.trigger;

  it("take Counterspell's check against a spell above their slot", () => {
    expect(triggerOf(migrateDefinition(counter({ kind: "enemy-casts-spell", withinFt: 60 })))).toEqual({ kind: "enemy-casts-spell", withinFt: 60, checkAbove: { dcBase: 10 } });
  });

  it("keep a level cap, a check of their own, or none", () => {
    for (const trigger of [
      { kind: "enemy-casts-spell", withinFt: 60, maxSpellLevel: 3 },
      { kind: "enemy-casts-spell", withinFt: 60, checkAbove: { dcBase: 12, bonus: 2 } },
      { kind: "enemy-casts-spell", withinFt: 60, checkAbove: false }
    ]) {
      expect(triggerOf(migrateDefinition(counter(trigger)))).toEqual(trigger);
    }
  });
});
