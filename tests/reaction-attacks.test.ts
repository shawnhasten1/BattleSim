import { describe, expect, it } from "vitest";
import {
  createEngineState,
  getExecutableActions,
  resolveAttack,
  resolveSaveAction,
  sampleEncounter,
  type CreatureDefinition,
  type RandomSource,
  type ResourceStance
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor, type CharacterBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { actionStatblock, featureStatblock } from "@/lib/statblock";

/**
 * PC builder plan, Phase 7u: reaction attacks. Retaliation: a reaction copy of each melee attack, made against an
 * attacker within 5 ft whose hit damaged it. Deflect Attacks' redirect: when the cut takes the damage to 0, a Focus
 * Point sends some of it back (a Dexterity save or two Martial Arts dice + Dexterity of the attack's type).
 */

const sources = SRD_BUILD_SOURCES;
const actor = (build: CharacterBuild): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), build, sources).definition;
const built = (classId: string, level: number, subclass?: string) =>
  actor(quickBuild(sources, { classId: `srd:class:${classId}`, level, ...(subclass ? { subclassId: subclass } : {}) }));

/** d20s as listed, then 10s; every other die its lowest. */
function d20s(...values: number[]): RandomSource {
  let index = 0;
  const make = (): RandomSource => ({ next: () => 0, nextInt: (min, max) => (max === 20 ? values[index++] ?? 10 : min), fork: make });
  return make();
}

/** This character in the fighter's place, the first goblin (sturdy) `gap` squares away, on the goblin's turn. */
function goblinAttacks(definition: CreatureDefinition, options: { gap?: number; stance?: ResourceStance } = {}) {
  const snapshot = structuredClone(sampleEncounter);
  const goblin = sampleEncounter.definitions.find((entry) => entry.id === "def-goblin")!;
  snapshot.map.walls = [];
  snapshot.map.terrain = [];
  snapshot.round = 1;
  snapshot.definitions = [
    ...snapshot.definitions.filter((entry) => entry.id !== "def-fighter" && entry.id !== "def-goblin"),
    { ...definition, id: "def-fighter" },
    { ...goblin, maxHp: 200 }
  ];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") {
      token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 };
      if (options.stance) token.resourceStance = options.stance;
    }
    if (token.id === "pc-archer") token.position = { x: 3, y: 9 };
    if (token.id === "enemy-goblin-1") { token.position = { x: 3 + (options.gap ?? 1), y: 3 }; token.currentHp = 200; }
    if (token.id === "enemy-goblin-2") token.position = { x: 14, y: 1 };
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "enemy-goblin-1");
  const state = createEngineState(snapshot);
  const find = (id: string) => state.snapshot.combatants.find((token) => token.id === id)!;
  const goblinActions = getExecutableActions(state.snapshot.definitions.find((entry) => entry.id === "def-goblin")!);
  const melee = goblinActions.find((entry) => entry.kind === "attack" && entry.attackType === "melee")!;
  const ranged = goblinActions.find((entry) => entry.kind === "attack" && entry.attackType === "ranged")!;
  return { state, find, melee, ranged };
}

const swingsBy = (state: ReturnType<typeof goblinAttacks>["state"], id: string) =>
  state.log.filter((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === id).map((entry) => entry.message);

describe("Retaliation", () => {
  const berserker = () => built("barbarian", 10, "srd:subclass:path-of-the-berserker");

  it("gives each melee attack a reaction copy, the most damaging first", () => {
    const reactions = getExecutableActions(berserker()).filter((entry) => entry.actionType === "reaction" && entry.name.includes("(Retaliation)"));
    expect(reactions[0]?.name).toBe("Greataxe (Retaliation)");
    expect(reactions.every((entry) => entry.kind === "attack" && entry.attackType === "melee")).toBe(true);
  });

  it("strikes back at an attacker within 5 ft whose hit damaged it", () => {
    const { state, find, melee } = goblinAttacks(berserker());
    state.rng = d20s(15, 15);
    resolveAttack(state, "enemy-goblin-1", "pc-fighter", melee.id);
    expect(swingsBy(state, "pc-fighter")).toEqual([expect.stringContaining("Greataxe (Retaliation)")]);
    expect(find("pc-fighter").actionEconomy?.reaction).toBe(false);
  });

  it("not against a hit from farther off, nor a miss", () => {
    const far = goblinAttacks(berserker(), { gap: 4 });
    far.state.rng = d20s(15);
    resolveAttack(far.state, "enemy-goblin-1", "pc-fighter", far.ranged.id);
    expect(swingsBy(far.state, "pc-fighter")).toEqual([]);
    const missed = goblinAttacks(berserker());
    missed.state.rng = d20s(2);
    resolveAttack(missed.state, "enemy-goblin-1", "pc-fighter", missed.melee.id);
    expect(swingsBy(missed.state, "pc-fighter")).toEqual([]);
  });

  it("reads as an attack back", () => {
    const definition = berserker();
    const feature = definition.features!.find((entry) => entry.name === "Retaliation")!;
    expect(featureStatblock(feature, definition).text)
      .toContain("When it takes damage from an attack by a creature within 5 feet of it, it can use its reaction to make one melee attack against the attacker.");
  });
});

describe("Deflect Attacks' redirect", () => {
  const monk = () => built("monk", 3);

  it("when the cut takes the damage to 0: a Focus Point, and a Dexterity save or the damage sent back", () => {
    const definition = monk();
    const { state, find, melee } = goblinAttacks(definition);
    const focus = find("pc-fighter").resources?.["focus-points"] ?? 0;
    const hpBefore = find("enemy-goblin-1").currentHp;
    // The goblin hits (15); its save against the redirect fails (1).
    state.rng = d20s(15, 1);
    resolveAttack(state, "enemy-goblin-1", "pc-fighter", melee.id);
    expect(find("pc-fighter").currentHp).toBe(definition.maxHp);
    expect(find("pc-fighter").resources?.["focus-points"]).toBe(focus - 1);
    expect(state.log.some((entry) => entry.type === "FeatureEffectApplied" && entry.data?.effectKind === "damage-redirect")).toBe(true);
    // Two Martial Arts dice (lowest: 1 each) + Dexterity, slashing as the scimitar's.
    const dex = Math.floor((definition.abilities.dex - 10) / 2);
    expect(find("enemy-goblin-1").currentHp).toBe(hpBefore - (2 + dex));
    const back = state.log.filter((entry) => entry.type === "DamageApplied" && entry.data?.targetId === "enemy-goblin-1").at(-1);
    expect(back?.data?.components).toMatchObject([{ damageType: "slashing" }]);
  });

  it("no point spent when some of the damage gets through", () => {
    // A clumsy monk: its cut (the lowest roll, Dexterity 1) takes nothing off.
    const definition = { ...monk(), abilities: { ...monk().abilities, dex: 1 } };
    const { state, find, melee } = goblinAttacks(definition);
    const focus = find("pc-fighter").resources?.["focus-points"] ?? 0;
    state.rng = d20s(15);
    resolveAttack(state, "enemy-goblin-1", "pc-fighter", melee.id);
    expect(state.log.some((entry) => entry.type === "FeatureEffectApplied" && entry.data?.effectKind === "damage-cut")).toBe(true);
    expect(find("pc-fighter").currentHp).toBeLessThan(definition.maxHp);
    expect(find("pc-fighter").resources?.["focus-points"]).toBe(focus);
  });

  it("a conservative monk keeps its points: the plain Deflect Attacks", () => {
    const { state, find, melee } = goblinAttacks(monk(), { stance: "conservative" });
    const focus = find("pc-fighter").resources?.["focus-points"] ?? 0;
    state.rng = d20s(15, 1);
    resolveAttack(state, "enemy-goblin-1", "pc-fighter", melee.id);
    expect(find("pc-fighter").resources?.["focus-points"]).toBe(focus);
    expect(state.log.some((entry) => entry.type === "FeatureEffectApplied" && entry.data?.effectKind === "damage-redirect")).toBe(false);
  });

  it("isn't offered without a point", () => {
    const { state, find, melee } = goblinAttacks(monk());
    find("pc-fighter").resources = { ...find("pc-fighter").resources, "focus-points": 0 };
    const offered: string[] = [];
    state.decide = (request) => {
      if (request.kind === "reaction") offered.push(...request.options.map((option) => option.name));
      return undefined;
    };
    state.rng = d20s(15, 1);
    resolveAttack(state, "enemy-goblin-1", "pc-fighter", melee.id);
    expect(offered.some((name) => /redirect/.test(name))).toBe(false);
    expect(offered.some((name) => /Deflect Attacks/.test(name))).toBe(true);
  });

  it("reads as a redirect at 0", () => {
    const definition = monk();
    const redirect = getExecutableActions(definition).find((entry) => entry.name === "Deflect Attacks (redirect)")!;
    expect(actionStatblock(redirect, definition).text).toContain("If that reduces it to 0, it can spend 1 focus point to redirect it: a creature within 5 feet (after a melee attack) or 60 feet (after a ranged one) must succeed on a DC");
  });
});

describe("Retaliation against damage that isn't a hit (7ay)", () => {
  const berserker = () => built("barbarian", 10, "srd:subclass:path-of-the-berserker");
  const spitting = (gap: number) => {
    const scene = goblinAttacks(berserker(), { gap });
    scene.state.snapshot.definitions = scene.state.snapshot.definitions.map((entry) => (entry.id === "def-goblin"
      ? {
        ...entry,
        actions: [...entry.actions, {
          kind: "save" as const, id: "spit", name: "Spit", actionType: "action" as const, saveAbility: "dex" as const, dc: 30, range: 30,
          damage: [{ dice: "2d6", damageType: "acid" as const }], halfDamageOnSuccess: false, onSuccess: "none" as const, automationSupport: "full" as const
        }]
      }
      : entry));
    return scene;
  };

  it("a creature within 5 ft that damages it with a save gets the swing back", () => {
    const { state } = spitting(1);
    state.rng = d20s(1, 15);
    resolveSaveAction(state, "enemy-goblin-1", "pc-fighter", "spit");
    expect(swingsBy(state, "pc-fighter")).toHaveLength(1);
  });

  it("not from farther off", () => {
    const { state } = spitting(3);
    state.rng = d20s(1, 15);
    resolveSaveAction(state, "enemy-goblin-1", "pc-fighter", "spit");
    expect(swingsBy(state, "pc-fighter")).toHaveLength(0);
  });
});
