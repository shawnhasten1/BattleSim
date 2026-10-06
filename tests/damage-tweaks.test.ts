import { describe, expect, it } from "vitest";
import {
  actionProblem,
  averageDamage,
  createEngineState,
  getExecutableActions,
  resolveAreaSaveAction,
  resolveAttack,
  resolveDamageAdjustment,
  resolveSaveAction,
  sampleEncounter,
  type CreatureDefinition,
  type RandomSource
} from "@/engine";
import { blankCharacter, quickBuild, rebuildActor, withChoice, withSuggestions, type CharacterBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { featureStatblock } from "@/lib/statblock";

/**
 * PC builder plan, Phase 7ad: three damage tweaks. Boon of Irresistible Offense (bludgeoning, piercing and slashing
 * damage ignores resistance), Overchannel (a Wizard spell of level 1-5 at its maximum damage, once a fight) and Improved
 * Blessed Strikes' Potent Spellcasting (temporary hit points when a Cleric cantrip deals damage).
 */

const sources = SRD_BUILD_SOURCES;
const actor = (build: CharacterBuild): CreatureDefinition => rebuildActor(blankCharacter("def-fighter", "PC"), build, sources).definition;

/** Every d20 rolls these values in turn, then 10; other dice `die` (their highest unless "low"). */
function d20s(values: number[], die: "high" | "low" = "high"): RandomSource {
  let index = 0;
  const make = (): RandomSource => ({ next: () => 0.999, nextInt: (min, max) => (max === 20 ? values[index++] ?? 10 : die === "high" ? max : min), fork: make });
  return make();
}

/** The character in the fighter's place, the first goblin beside it with 200 hit points and `defenses`. */
function scene(definition: CreatureDefinition, defenses: CreatureDefinition["damageAdjustments"] = []) {
  const snapshot = structuredClone(sampleEncounter);
  snapshot.map.walls = [];
  snapshot.map.terrain = [];
  snapshot.round = 1;
  const goblin = sampleEncounter.definitions.find((entry) => entry.id === "def-goblin")!;
  snapshot.definitions = [
    ...snapshot.definitions.filter((entry) => entry.id !== "def-fighter" && entry.id !== "def-goblin"),
    { ...definition, id: "def-fighter" },
    { ...goblin, maxHp: 200, damageAdjustments: defenses }
  ];
  for (const token of snapshot.combatants) {
    if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; token.position = { x: 3, y: 3 }; }
    if (token.id === "pc-archer") token.position = { x: 3, y: 9 };
    if (token.id === "enemy-goblin-1") { token.position = { x: 4, y: 3 }; token.currentHp = 200; }
    if (token.id === "enemy-goblin-2") { token.position = { x: 16, y: 1 }; token.currentHp = 200; }
  }
  snapshot.turnIndex = snapshot.combatants.findIndex((token) => token.id === "pc-fighter");
  const state = createEngineState(snapshot);
  const find = (id: string) => state.snapshot.combatants.find((token) => token.id === id)!;
  const dealt = (targetId: string) => state.log.filter((entry) => entry.type === "DamageApplied" && entry.data?.targetId === targetId)
    .reduce((sum, entry) => sum + (entry.data?.totalApplied as number), 0);
  return { state, find, dealt };
}

describe("Boon of Irresistible Offense", () => {
  const withBoon = () => {
    let build = quickBuild(sources, { classId: "srd:class:fighter", level: 19 });
    build = withSuggestions(withChoice(build, { kind: "level", index: 18 }, ["epic-boon"], { feat: "srd:feat:boon-of-irresistible-offense" }), sources);
    return actor(build);
  };
  const resists = (["bludgeoning", "piercing", "slashing"] as const).map((damageType) => ({ type: "resistance" as const, damageType }));

  it("its weapon damage ignores resistance to it; immunity still counts", () => {
    const fighter = withBoon();
    const boon = fighter.features!.find((entry) => entry.name === "Boon of Irresistible Offense")!;
    expect(boon.automationSupport).toBe("full");
    expect(featureStatblock(boon, fighter).text).toContain("bludgeoning, piercing, and slashing damage ignores resistance");
    const plain: CreatureDefinition = { ...fighter, features: fighter.features!.filter((entry) => entry !== boon) };
    const swing = (definition: CreatureDefinition) => {
      const { state, dealt } = scene(definition, resists);
      const attack = getExecutableActions(definition).find((entry) => entry.kind === "attack" && entry.actionType === "action")!;
      state.rng = d20s([15]);
      resolveAttack(state, "pc-fighter", "enemy-goblin-1", attack.id);
      return dealt("enemy-goblin-1");
    };
    const full = swing(fighter);
    expect(full).toBeGreaterThan(0);
    expect(swing(plain)).toBe(Math.floor(full / 2));

    expect(resolveDamageAdjustment(10, "slashing", resists, { ignoresResistance: ["slashing"] }).amount).toBe(10);
    expect(resolveDamageAdjustment(10, "slashing", [{ type: "immunity", damageType: "slashing" }], { ignoresResistance: ["slashing"] }).amount).toBe(0);
    expect(resolveDamageAdjustment(10, "fire", [{ type: "resistance", damageType: "fire" }], { ignoresResistance: ["slashing"] }).amount).toBe(5);
  });

  it("Overwhelming Strike: a 20 adds the attack's ability score (7ah)", () => {
    const fighter = withBoon();
    const attack = getExecutableActions(fighter).find((entry) => entry.kind === "attack" && entry.actionType === "action")!;
    const score = fighter.abilities[(attack as { ability: "str" | "dex" }).ability];
    const swing = (roll: number) => {
      const { state, dealt } = scene(fighter);
      state.rng = d20s([roll]);
      resolveAttack(state, "pc-fighter", "enemy-goblin-1", attack.id);
      const sources = state.log.filter((entry) => entry.type === "DamageApplied").flatMap((entry) => entry.data?.components as Array<{ sourceFeatureName?: string; finalAmount: number }>);
      return { total: dealt("enemy-goblin-1"), overwhelming: sources.filter((part) => part.sourceFeatureName === "Boon of Irresistible Offense").reduce((sum, part) => sum + part.finalAmount, 0) };
    };
    expect(swing(20).overwhelming).toBe(score);
    expect(swing(19).overwhelming).toBe(0);
  });

  it("the AI counts it", () => {
    const fighter = withBoon();
    const attack = getExecutableActions(fighter).find((entry) => entry.kind === "attack" && entry.actionType === "action")!;
    expect(averageDamage(attack, fighter, resists)).toBe(averageDamage(attack, fighter));
  });
});

describe("Overchannel", () => {
  const evoker = () => actor(quickBuild(sources, { classId: "srd:class:wizard", level: 14 }));

  it("a copy of each Wizard spell of level 1-5 cast with a slot, once a fight", () => {
    const wizard = evoker();
    expect(wizard.features!.find((entry) => entry.id === "evoker-overchannel")?.automationSupport).toBe("partial");
    expect(wizard.resources?.overchannel).toBe(1);
    const copies = getExecutableActions(wizard).filter((entry) => entry.id.endsWith(":overchannel"));
    expect(copies.map((entry) => entry.name)).toContain("Fireball (Overchannel)");
    expect(copies.map((entry) => entry.name)).toContain("Fireball (upcast to slot 5) (Overchannel)");
    // Not a cantrip, a free cast or a 6th-level slot.
    for (const copy of copies) {
      expect("spellLevel" in copy && copy.spellLevel).toBeGreaterThan(0);
      expect("resourceCost" in copy ? copy.resourceCost?.resourceId : undefined).toMatch(/^slot-[1-5]$/);
    }
  });

  it("Fireball at its maximum: 48, whatever the dice (and Empowered Evocation's Intelligence)", () => {
    const wizard = evoker();
    const intelligence = Math.floor((wizard.abilities.int - 10) / 2);
    const { state, find, dealt } = scene(wizard);
    const fireball = getExecutableActions(wizard).find((entry) => entry.name === "Fireball (Overchannel)")!;
    expect(averageDamage(fireball, wizard)).toBe(48 + intelligence);
    state.rng = d20s([1, 1], "low");
    resolveAreaSaveAction(state, "pc-fighter", { x: 8, y: 3 }, fireball.id);
    expect(dealt("enemy-goblin-1")).toBe(48 + intelligence);
    expect(find("pc-fighter").resources?.overchannel).toBe(0);
    expect(actionProblem(state.snapshot, "pc-fighter", fireball.id)).toBeTruthy();
  });
});

describe("Improved Blessed Strikes: Potent Spellcasting", () => {
  const potent = () => {
    let build = quickBuild(sources, { classId: "srd:class:cleric", level: 14 });
    build = withSuggestions(withChoice(build, { kind: "level", index: 6 }, ["blessed-strikes"], ["potent-spellcasting"]), sources);
    return actor(build);
  };

  it("comes with Potent Spellcasting, not Divine Strike", () => {
    expect(potent().features!.some((entry) => entry.id === "cleric-potent-spellcasting-improved-potent-spellcasting")).toBe(true);
    expect(actor(quickBuild(sources, { classId: "srd:class:cleric", level: 14 })).features!.some((entry) => entry.id === "cleric-potent-spellcasting-improved-potent-spellcasting")).toBe(false);
  });

  it("a cantrip's damage gives the most hurt ally within 60 ft twice the Wisdom modifier in temporary hit points", () => {
    const cleric = potent();
    const wisdom = Math.floor((cleric.abilities.wis - 10) / 2);
    const { state, find } = scene(cleric);
    find("pc-archer").currentHp = 3;
    const flame = getExecutableActions(cleric).find((entry) => entry.name === "Sacred Flame")!;
    state.rng = d20s([1]);
    resolveSaveAction(state, "pc-fighter", "enemy-goblin-1", flame.id);
    expect(find("pc-archer").tempHp).toBe(2 * wisdom);
    expect(find("pc-fighter").tempHp).toBe(0);
  });

  it("nothing when the cantrip deals no damage", () => {
    const cleric = potent();
    const { state, find } = scene(cleric);
    const flame = getExecutableActions(cleric).find((entry) => entry.name === "Sacred Flame")!;
    state.rng = d20s([20]);
    resolveSaveAction(state, "pc-fighter", "enemy-goblin-1", flame.id);
    expect(find("pc-archer").tempHp + find("pc-fighter").tempHp).toBe(0);
  });
});
