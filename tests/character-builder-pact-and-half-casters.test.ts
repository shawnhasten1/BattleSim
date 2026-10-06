import { describe, expect, it } from "vitest";
import { effectiveDefinition, getExecutableActions, sampleEncounter, type ActionDefinition, type CreatureDefinition } from "@/engine";
import { runAutomatedEncounter } from "@/engine/turns";
import { SRD_2024_REFERENCE } from "@/data/srd/2024/reference";
import {
  blankCharacter,
  buildCharacter,
  quickBuild,
  rebuildActor,
  withChoice,
  withSuggestions,
  type CharacterBuild,
  type ChoiceSlot
} from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";

/** PC builder plan, Phase 5c: the Warlock (Fiend Patron), Paladin (Oath of Devotion) and Ranger (Hunter). */

const sources = SRD_BUILD_SOURCES;
const quick = (classId: string, level: number, backgroundId = "srd:background:soldier"): CharacterBuild =>
  quickBuild(sources, { classId: `srd:class:${classId}`, level, backgroundId });
const actor = (build: CharacterBuild): CreatureDefinition => rebuildActor(blankCharacter("def-pc", "PC"), build, sources).definition;
const built = (classId: string, level: number) => actor(quick(classId, level));
const column = (classKey: string, id: string) =>
  SRD_2024_REFERENCE.classes.find((entry) => entry.key === `srd-2024_${classKey}`)!.columns.find((entry) => entry.id === id)!.values;
const action = (definition: CreatureDefinition, name: string): ActionDefinition => {
  const found = getExecutableActions(definition).find((entry) => entry.name === name);
  if (!found) throw new Error(`no ${name}: ${getExecutableActions(definition).map((entry) => entry.name).join(", ")}`);
  return found;
};
const slotsOf = (build: CharacterBuild, id: string): ChoiceSlot[] => buildCharacter(build, sources).choices.filter((slot) => slot.path[0] === id);
/** A build with one level's choice set, and anything it opens suggested. */
const choose = (build: CharacterBuild, level: number, path: string[], value: Parameters<typeof withChoice>[3]) =>
  withSuggestions(withChoice(build, { kind: "level", index: level - 1 }, path, value), sources);

describe("the Warlock (Fiend Patron)", () => {
  it("casts with pact slots, all of its slot level, and prepares spells up to it", () => {
    expect(built("warlock", 5).resources).toMatchObject({ "slot-3": 2 });
    expect(built("warlock", 11).resources).toMatchObject({ "slot-5": 3 });
    const prepared = slotsOf(quick("warlock", 5), "prepared").find((slot) => slot.characterLevel === 5)!;
    expect(Math.max(...prepared.options.map((option) => option.level ?? 0))).toBe(3);
  });

  it("takes invocations as its table gives them, minding their prerequisites", () => {
    const counts = column("warlock", "eldritch-invocations");
    const picks = slotsOf(quick("warlock", 9), "eldritch-invocations");
    expect(picks.reduce((sum, slot) => sum + slot.count, 0)).toBe(counts[8]);
    // At 1st level an invocation that needs 2nd isn't offered, nor Thirsting Blade without Pact of the Blade.
    const first = picks.find((slot) => slot.characterLevel === 1)!;
    expect(first.options.find((option) => option.id === "agonizing-blast")).toMatchObject({ taken: true, detail: "from 2nd level" });
    let build = choose(quick("warlock", 5), 1, ["eldritch-invocations"], ["pact-of-the-blade"]);
    const fifth = slotsOf(build, "eldritch-invocations").find((slot) => slot.characterLevel === 5)!;
    expect(fifth.options.find((option) => option.id === "thirsting-blade")?.taken).toBeUndefined();
    build = choose(quick("warlock", 5), 1, ["eldritch-invocations"], ["armor-of-shadows"]);
    expect(slotsOf(build, "eldritch-invocations").find((slot) => slot.characterLevel === 5)!.options.find((option) => option.id === "thirsting-blade"))
      .toMatchObject({ taken: true, detail: "needs Pact of the Blade" });
  });

  it("Agonizing Blast, Repelling Blast and Eldritch Spear change Eldritch Blast", () => {
    const warlock = built("warlock", 5);
    const blast = warlock.spells!.find((entry) => entry.name === "Eldritch Blast")!;
    expect(blast.action).toMatchObject({
      range: 300,
      damage: [{ dice: "1d10", damageType: "force", abilityModifier: "cha" }],
      riders: [{ kind: "push", when: "on-hit", distance: 10, maxSize: "large" }]
    });
    expect(blast.range).toBe(300);
  });

  it("Pact of the Blade: a Charisma weapon it attacks with twice from 5th level (Thirsting Blade), three times from 12th", () => {
    let build = choose(quick("warlock", 12), 1, ["eldritch-invocations"], ["pact-of-the-blade"]);
    build = choose(build, 5, ["eldritch-invocations"], ["thirsting-blade", "agonizing-blast"]);
    build = choose(build, 12, ["eldritch-invocations"], ["devouring-blade"]);
    const warlock = actor(build);
    expect(warlock.weapons!.find((weapon) => weapon.id === "warlock-pact-weapon")).toMatchObject({ ability: "cha", damage: [{ dice: "1d8" }] });
    expect(action(warlock, "Attack (pact weapon)")).toMatchObject({ kind: "multiattack", attacks: [{ actionId: "warlock-pact-weapon", count: 3 }] });
    expect(getExecutableActions(warlock).filter((entry) => entry.name === "Attack (pact weapon)")).toHaveLength(1);
  });

  it("Armor of Shadows casts Mage Armor at will; Mystic Arcanum casts a 6th-level spell once, without slots of that level", () => {
    const warlock = built("warlock", 11);
    expect(warlock.spells!.find((entry) => entry.name === "Mage Armor (at will)")?.resourceCost).toBeUndefined();
    const arcanum = warlock.spells!.filter((entry) => entry.level === 6);
    expect(arcanum).toHaveLength(1);
    expect(arcanum[0]!.name).toMatch(/\(free\)$/);
    expect(warlock.resources?.[arcanum[0]!.resourceCost!.resourceId]).toBe(1);
  });

  it("Fiend Spells are always prepared; Fiendish Resilience resists one type; Lessons of the First Ones is an origin feat", () => {
    const warlock = built("warlock", 10);
    expect(warlock.spells!.filter((entry) => entry.id.startsWith("fiend-patron-")).map((entry) => entry.name))
      .toEqual(expect.arrayContaining(["Burning Hands", "Fireball", "Wall of Fire", "Insect Plague"]));
    expect(warlock.features!.find((entry) => entry.name.startsWith("Fiendish Resilience"))?.effects?.[0]).toMatchObject({ kind: "damage-adjustment" });
    const lessons = choose(quick("warlock", 2), 2, ["eldritch-invocations"], ["lessons-of-the-first-ones", "agonizing-blast"]);
    const feat = buildCharacter(lessons, sources).choices.find((slot) => slot.spec.kind === "feat" && slot.path[0] === "eldritch-invocations.lessons-of-the-first-ones.feat")!;
    expect(feat.options.every((option) => option.detail === "origin")).toBe(true);
    expect(feat.value).toBeDefined();
  });
});

describe("the Paladin (Oath of Devotion)", () => {
  it("casts as a half caster from 1st level, and lays on hands five times its level", () => {
    const first = built("paladin", 1);
    expect(first.resources).toMatchObject({ "slot-1": 2, "lay-on-hands": 5 });
    expect(built("paladin", 9).resources).toMatchObject({ "slot-3": 2, "lay-on-hands": 45 });
  });

  it("Paladin's Smite: Divine Smite always prepared, once free, a smite on each melee weapon attack", () => {
    const paladin = built("paladin", 2);
    expect(paladin.spells!.filter((entry) => entry.name.startsWith("Divine Smite")).map((entry) => entry.name).sort()).toEqual(["Divine Smite", "Divine Smite (free)"]);
    expect(paladin.spells!.find((entry) => entry.name === "Divine Smite")).toMatchObject({ automationSupport: "full", onHit: { bonusAction: true } });
    expect(getExecutableActions(paladin).some((entry) => /\(Divine Smite \(free\)\)$/.test(entry.name))).toBe(true);
  });

  it("Aura of Protection reaches 10 ft, 30 from 18th level; Radiant Strikes adds 1d8 on melee hits", () => {
    const aura = (level: number) => built("paladin", level).features!.find((entry) => entry.name === "Aura of Protection")!.aura?.range;
    expect(aura(6)).toBe(10);
    expect(aura(18)).toBe(30);
    expect(built("paladin", 11).features!.find((entry) => entry.name === "Radiant Strikes")?.effects?.[0])
      .toMatchObject({ kind: "damage-bonus", attackTypes: ["melee"], damage: [{ dice: "1d8", damageType: "radiant" }] });
  });

  it("Channel Divinity fuels Sacred Weapon and Abjure Foes", () => {
    const paladin = built("paladin", 9);
    expect(paladin.resources?.["paladin-channel-divinity"]).toBe(2);
    expect(action(paladin, "Sacred Weapon")).toMatchObject({ actionType: "free", resourceCost: { resourceId: "paladin-channel-divinity" } });
    expect(action(paladin, "Abjure Foes")).toMatchObject({ kind: "area-save", saveAbility: "wis", resourceCost: { resourceId: "paladin-channel-divinity" } });
  });

  it("Blessed Warrior: two Cleric cantrips instead of a Fighting Style feat, cast with Charisma", () => {
    const build = withSuggestions(withChoice(quick("paladin", 2), { kind: "level", index: 1 }, ["fighting-style"], { feat: "blessed-warrior" }), sources);
    const paladin = actor(build);
    const cantrips = paladin.spells!.filter((entry) => entry.level === 0);
    expect(cantrips).toHaveLength(2);
    expect(paladin.spellcasting).toEqual({ ability: "cha" });
    expect(cantrips.find((entry) => entry.name === "Sacred Flame")?.action).toMatchObject({ dcFormula: { ability: "spellcasting" } });
    expect(paladin.features!.some((entry) => entry.name === "Fighting Style: Blessed Warrior")).toBe(true);
  });
});

describe("the Ranger (Hunter)", () => {
  it("Favored Enemy: Hunter's Mark always prepared, cast free as often as the table says", () => {
    for (const level of [1, 5, 9, 17]) {
      const ranger = built("ranger", level);
      const free = ranger.spells!.find((entry) => entry.name === "Hunter's Mark (free)")!;
      expect(ranger.resources?.[free.resourceCost!.resourceId], `level ${level}`).toBe(column("ranger", "favored-enemy")[level - 1]);
    }
  });

  it("Roving, Tireless, Feral Senses and Colossus Slayer", () => {
    expect(effectiveDefinition(built("ranger", 5)).speed).toBe(30);
    // Roving is an effect now (EFFECTS_PLAN.md D6): +10 ft without heavy armor, and climb and swim at its speed.
    const sixth = effectiveDefinition(built("ranger", 6));
    expect(sixth.speed).toBe(40);
    expect(sixth.movement).toMatchObject({ walk: 40, climb: 40, swim: 40 });
    const tenth = built("ranger", 10);
    expect(action(tenth, "Tireless")).toMatchObject({ kind: "buff", tempHp: [{ dice: "1d8", abilityModifier: "wis" }], resourceCost: { resourceId: "tireless" } });
    expect(built("ranger", 18).senses).toMatchObject({ blindsight: 30 });
    expect(built("ranger", 3).features!.find((entry) => entry.name === "Hunter's Prey: Colossus Slayer")?.effects?.[0])
      .toMatchObject({ kind: "damage-bonus", oncePerTurn: true, condition: "target-injured" });
  });

  it("Druidic Warrior: two Druid cantrips, cast with Wisdom; Deft Explorer and Expertise", () => {
    const build = withSuggestions(withChoice(quick("ranger", 9), { kind: "level", index: 1 }, ["fighting-style"], { feat: "druidic-warrior" }), sources);
    const ranger = actor(build);
    expect(ranger.spells!.filter((entry) => entry.level === 0)).toHaveLength(2);
    expect(ranger.spellcasting).toEqual({ ability: "wis" });
    expect(buildCharacter(build, sources).choices.filter((slot) => slot.spec.kind === "expertise").map((slot) => slot.count)).toEqual([1, 2]);
  });
});

describe("built pact and half casters in a fight", { timeout: 30000 }, () => {
  const fight = (definition: CreatureDefinition, seed: string) => {
    const snapshot = structuredClone(sampleEncounter);
    snapshot.definitions = [...snapshot.definitions.filter((entry) => entry.id !== "def-fighter"), { ...definition, id: "def-fighter" }];
    // Sturdier goblins, so the fight lasts long enough to see what it does.
    for (const entry of snapshot.definitions) if (entry.id === "def-goblin") entry.maxHp = 60;
    for (const token of snapshot.combatants) {
      if (token.id === "pc-fighter") { token.currentHp = definition.maxHp; token.resources = { ...(definition.resources ?? {}) }; }
      if (token.definitionId === "def-goblin") token.currentHp = 60;
    }
    return runAutomatedEncounter({ ...snapshot, seed }, 20);
  };
  const declared = (result: ReturnType<typeof fight>, name: RegExp) =>
    result.log.filter((entry) => entry.type === "ActionDeclared" && entry.data?.actorId === "pc-fighter" && name.test(String(entry.data?.actionName)));

  it("the warlock blasts, or strikes with True Strike once foes close in (7af)", () => {
    const result = fight(built("warlock", 5), "warlock");
    expect(declared(result, /^(Eldritch Blast|True Strike \(.*\))$/).length).toBeGreaterThan(0);
    expect(result.outcome.completed).toBe(true);
  });

  it("the paladin and the ranger attack twice", () => {
    for (const classId of ["paladin", "ranger"]) {
      const result = fight(built(classId, 5), classId);
      expect(declared(result, /^Attack/).length, classId).toBeGreaterThan(0);
      expect(result.outcome.completed).toBe(true);
    }
  });
});

