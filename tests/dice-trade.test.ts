import { describe, expect, it } from "vitest";
import {
  createEngineState,
  getExecutableActions,
  resolveAttack,
  sampleEncounter,
  takeAutomatedTurn,
  type CreatureDefinition,
  type RandomSource
} from "@/engine";
import { withoutDice } from "@/engine/combat";
import { blankCharacter, quickBuild, rebuildActor, type CharacterBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { featureStatblock } from "@/lib/statblock";

/**
 * PC builder plan, Phase 7r: Cunning Strike. An on-hit option paid in Sneak Attack dice (`tradesDice`): a variant of
 * each attack Sneak Attack adds to, whose riders and move land only with Sneak Attack's damage, which gives up the dice.
 */

const sources = SRD_BUILD_SOURCES;
const actor = (build: CharacterBuild): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), build, sources).definition;
const rogue = (level: number) => actor(quickBuild(sources, { classId: "srd:class:rogue", level }));

/** d20s as listed, then 10s; every other die its lowest. */
function d20s(...values: number[]): RandomSource {
  let index = 0;
  const make = (): RandomSource => ({ next: () => 0, nextInt: (min, max) => (max === 20 ? values[index++] ?? 10 : min), fork: make });
  return make();
}

/**
 * The rogue in the fighter's place next to the first goblin (sturdy, of `size`), on its turn; the archer beside the
 * goblin too (Sneak Attack) unless `alone`.
 */
function fight(definition: CreatureDefinition, options: { alone?: boolean; size?: CreatureDefinition["size"]; clumsy?: boolean; nimble?: boolean; elusive?: boolean; at?: { x: number; y: number } } = {}) {
  const snapshot = structuredClone(sampleEncounter);
  const goblin = sampleEncounter.definitions.find((entry) => entry.id === "def-goblin")!;
  snapshot.map.walls = [];
  snapshot.map.terrain = [];
  snapshot.round = 1;
  snapshot.definitions = [
    ...snapshot.definitions.filter((entry) => entry.id !== "def-fighter" && entry.id !== "def-goblin"),
    { ...definition, id: "def-fighter" },
    { ...goblin, maxHp: 200, size: options.size ?? "small", abilities: { ...goblin.abilities, ...(options.clumsy ? { dex: 6 } : {}), ...(options.nimble ? { dex: 20 } : {}) },
      ...(options.elusive ? { features: [{ id: "elusive", name: "Elusive", category: "trait" as const, effects: [{ kind: "no-advantage-against" as const }], automationSupport: "full" as const }] } : {}) }
  ];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = options.at ?? { x: 3, y: 3 }; }
    if (token.id === "pc-archer") token.position = options.alone ? { x: 12, y: 9 } : { x: 4, y: 4 };
    if (token.id === "enemy-goblin-1") { token.position = { x: 4, y: 3 }; token.currentHp = 200; }
    if (token.id === "enemy-goblin-2") { token.position = { x: 12, y: 1 }; token.currentHp = 200; }
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  const state = createEngineState(snapshot);
  const find = (id: string) => state.snapshot.combatants.find((token) => token.id === id)!;
  const attack = (name: string) => {
    const found = getExecutableActions(definition).find((entry) => entry.name === name);
    if (!found) throw new Error(`no ${name}`);
    return found;
  };
  return { state, find, attack };
}

const traded = (state: ReturnType<typeof fight>["state"]) => state.log.filter((entry) => entry.type === "FeatureEffectApplied" && entry.data?.tradedDice);

describe("withoutDice", () => {
  it("takes dice off the first damage line before rolling", () => {
    expect(withoutDice([{ dice: "3d6", damageType: "piercing" }], 1)).toEqual([{ dice: "2d6", damageType: "piercing" }]);
    expect(withoutDice([{ dice: "3d6+2", damageType: "piercing" }], 3)).toEqual([{ dice: "2", damageType: "piercing" }]);
    expect(withoutDice([{ dice: "6d6", damageType: "piercing" }], 6)).toEqual([]);
    expect(withoutDice([{ dice: "2d6", damageType: "piercing" }], 3)).toBeUndefined();
  });
});

describe("Cunning Strike", () => {
  it("is a variant of each attack Sneak Attack adds to, for Poison, Trip and Withdraw", () => {
    const definition = rogue(5);
    expect(definition.features?.some((feature) => feature.id === "rogue-sneak-attack")).toBe(true);
    const names = getExecutableActions(definition).filter((entry) => entry.name.includes("Cunning Strike")).map((entry) => entry.name);
    for (const weapon of ["Dagger", "Shortsword", "Shortbow"]) {
      for (const effect of ["Poison", "Trip", "Withdraw"]) expect(names).toContain(`${weapon} (Cunning Strike: ${effect})`);
    }
    // Devious Strikes come at 14th level; Knock Out needs six of the dice.
    expect(names.some((name) => name.includes("Knock Out"))).toBe(false);
    const higher = getExecutableActions(rogue(14)).map((entry) => entry.name);
    expect(higher).toContain("Shortsword (Cunning Strike: Knock Out)");
    expect(higher).toContain("Shortsword (Cunning Strike: Obscure)");
  });

  it("trips with Sneak Attack's damage, a die of it given up", () => {
    const { state, find, attack } = fight(rogue(5));
    state.rng = d20s(15, 1);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", attack("Shortsword (Cunning Strike: Trip)").id);
    const log = traded(state);
    expect(log).toHaveLength(1);
    expect(log[0]!.data).toMatchObject({ tradedDice: "1d6", tradedFrom: "Sneak Attack" });
    // 3d6 of Sneak Attack, less one: two d6s rolled for it.
    const damage = state.log.find((entry) => entry.type === "DamageApplied");
    const rolled = (damage?.data?.components as Array<{ roll: { expression: string } }>).map((component) => component.roll.expression);
    expect(rolled).toContain("2d6");
    expect(rolled).not.toContain("3d6");
    expect(find("enemy-goblin-1").conditions?.some((condition) => condition.name === "prone")).toBe(true);
  });

  it("does nothing without Sneak Attack: no trip, no dice given up", () => {
    const { state, find, attack } = fight(rogue(5), { alone: true });
    state.rng = d20s(15, 1);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", attack("Shortsword (Cunning Strike: Trip)").id);
    expect(state.log.find((entry) => entry.type === "AttackRolled")?.data?.hit).toBe(true);
    expect(traded(state)).toHaveLength(0);
    expect(find("enemy-goblin-1").conditions?.some((condition) => condition.name === "prone") ?? false).toBe(false);
  });

  it("can't trip a Huge creature, which doesn't save", () => {
    const { state, find, attack } = fight(rogue(5), { size: "huge" });
    state.rng = d20s(15, 1);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", attack("Shortsword (Cunning Strike: Trip)").id);
    expect(traded(state)).toHaveLength(1);
    expect(find("enemy-goblin-1").conditions?.some((condition) => condition.name === "prone") ?? false).toBe(false);
    expect(state.log.filter((entry) => entry.type === "SaveRolled")).toHaveLength(0);
  });

  it("poisons on a failed Constitution save against 8 + Dexterity + proficiency", () => {
    const definition = rogue(5);
    const { state, find, attack } = fight(definition);
    state.rng = d20s(15, 1);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", attack("Dagger (Cunning Strike: Poison)").id);
    const dex = Math.floor((definition.abilities.dex - 10) / 2);
    expect(state.log.find((entry) => entry.type === "SaveRolled")?.data).toMatchObject({ dc: 8 + dex + 3 });
    expect(find("enemy-goblin-1").conditions?.some((condition) => condition.name === "poisoned")).toBe(true);
  });

  it("withdraws: half its speed more, provoking no opportunity attacks", () => {
    const { state, find, attack } = fight(rogue(5));
    state.rng = d20s(15);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", attack("Shortsword (Cunning Strike: Withdraw)").id);
    expect(find("pc-fighter").turnFlags).toMatchObject({ bonusMovement: 3, disengaged: true });
  });
});

describe("Devious Strikes", () => {
  it("knocks out until it saves or takes damage", () => {
    const { state, find, attack } = fight(rogue(14));
    state.rng = d20s(15, 1);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", attack("Shortsword (Cunning Strike: Knock Out)").id);
    const knockedOut = find("enemy-goblin-1").conditions?.find((condition) => condition.name === "unconscious");
    expect(knockedOut?.endsOnDamage).toBe(true);
  });

  it("blinds until the end of the target's next turn", () => {
    const { state, find, attack } = fight(rogue(14));
    state.rng = d20s(15, 1);
    resolveAttack(state, "pc-fighter", "enemy-goblin-1", attack("Shortsword (Cunning Strike: Obscure)").id);
    const goblinIndex = state.snapshot.combatants.findIndex((token) => token.id === "enemy-goblin-1");
    const blinded = find("enemy-goblin-1").conditions?.find((condition) => condition.name === "blinded");
    const laterThisRound = goblinIndex > state.snapshot.turnIndex;
    expect(blinded?.expiresAt).toEqual({ round: laterThisRound ? 1 : 2, turnIndex: goblinIndex, timing: "end" });
  });
});

describe("the AI and Cunning Strike", () => {
  /** What the rogue swung on its turn, and the dice trades it paid. */
  function turn(profile: "skirmisher" | "controller", options: Parameters<typeof fight>[1] & { bowOnly?: boolean } = {}) {
    const definition = rogue(5);
    if (options.bowOnly) definition.weapons = definition.weapons?.filter((weapon) => weapon.name === "Shortbow");
    const { state, find } = fight(definition, options);
    find("pc-fighter").tacticsProfile = profile;
    takeAutomatedTurn(state, find("pc-fighter"));
    const swung = state.log.filter((entry) => entry.type === "AttackRolled").map((entry) => entry.message);
    return { swung, paid: traded(state).map((entry) => entry.data?.featureName as string) };
  }

  it("withdraws as a skirmisher with a foe beside it, Sneak Attack landing, on the first swing only", () => {
    const { swung, paid } = turn("skirmisher");
    expect(paid).toEqual(["Cunning Strike: Withdraw"]);
    expect(swung[0]).toContain("(Cunning Strike: Withdraw)");
    expect(swung.slice(1).some((message) => message.includes("Cunning Strike"))).toBe(false);
  });

  it("trips a clumsy target from afar under Controller tactics", () => {
    const { paid } = turn("controller", { bowOnly: true, clumsy: true, at: { x: 9, y: 3 } });
    expect(paid).toEqual(["Cunning Strike: Trip"]);
  });

  it("keeps the dice against a nimble one: the condition isn't worth them", () => {
    const { paid } = turn("controller", { bowOnly: true, nimble: true, at: { x: 9, y: 3 } });
    expect(paid).toHaveLength(0);
  });

  it("doesn't pick it when Sneak Attack won't land", () => {
    // Nobody beside the goblin, and no advantage against it (not Steady Aim's, not Vex's).
    const { swung, paid } = turn("skirmisher", { alone: true, elusive: true });
    expect(swung.length).toBeGreaterThan(0);
    expect(paid).toHaveLength(0);
    expect(swung.some((message) => message.includes("Cunning Strike"))).toBe(false);
  });
});

describe("Cunning Strike on the sheet", () => {
  it("reads as Sneak Attack dice given up", () => {
    const definition = rogue(5);
    const feature = definition.features!.find((entry) => entry.name === "Cunning Strike")!;
    const text = featureStatblock(feature, definition).text;
    expect(text).toContain("Cunning Strike: Trip: when it deals Sneak Attack damage, it can give up 1d6 of it for DC");
    expect(text).toContain("prone (large or smaller)");
    expect(text).toContain("a move of up to half its speed without provoking opportunity attacks");
  });
});
