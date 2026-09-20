import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GAP_CODES } from "@/data/srd/monsters/gaps";
import type { SrdMonsterIndexEntry } from "@/data/srd/monsters/types";
import { creatureDefinitionSchema, parseDiceExpression, type AreaSaveActionDefinition, type AttackActionDefinition, type CreatureDefinition, type MultiattackActionDefinition, type SaveActionDefinition } from "@/engine";
import { parseAttack } from "../scripts/srd-monsters/attacks";
import { buildMonsterLibrary } from "../scripts/srd-monsters/build";
import { type MonsterContext, type RawEntry } from "../scripts/srd-monsters/context";
import { parseCsv } from "../scripts/srd-monsters/csv";
import { parseConditionImmunities, parseDamageAdjustments } from "../scripts/srd-monsters/defenses";
import { parseMultiattack } from "../scripts/srd-monsters/multiattack";
import { parseSaveAction, splitBoldVariants } from "../scripts/srd-monsters/saves";
import { GapLog } from "../scripts/srd-monsters/util";

const generatedDir = fileURLToPath(new URL("../src/data/srd/monsters/generated/", import.meta.url));
const csvPath = fileURLToPath(new URL("../srd_2014_monsters_full.csv", import.meta.url));

function loadDefinitions(): CreatureDefinition[] {
  return readdirSync(`${generatedDir}chunks`).flatMap((file) =>
    (JSON.parse(readFileSync(`${generatedDir}chunks/${file}`, "utf8")) as { definitions: CreatureDefinition[] }).definitions
  );
}
const definitions = loadDefinitions();
const index = (JSON.parse(readFileSync(`${generatedDir}monster-index.json`, "utf8")) as { monsters: SrdMonsterIndexEntry[] }).monsters;

function monster(slug: string): CreatureDefinition {
  const found = definitions.find((definition) => definition.id === `srd:monster:${slug}`);
  if (!found) throw new Error(`no monster ${slug}`);
  return found;
}
function attackOf(definition: CreatureDefinition, id: string): AttackActionDefinition {
  const found = definition.actions.find((action) => action.id === id);
  if (!found || found.kind !== "attack") throw new Error(`${definition.name} has no attack ${id}`);
  return found;
}

function ctx(overrides: Partial<MonsterContext> = {}): MonsterContext {
  return {
    slug: "test", name: "Test", lowerName: "test", cr: 1, proficiencyBonus: 2,
    abilities: { str: 16, dex: 14, con: 12, int: 8, wis: 10, cha: 8 },
    gaps: new GapLog(), resources: {}, usedIds: new Set(), ...overrides
  };
}
function entry(name: string, desc: string, extra: Partial<RawEntry> = {}): RawEntry {
  return { name, desc, action_type: "ACTION", ...extra };
}

describe("csv reader", () => {
  it("handles quoted commas, doubled quotes and embedded newlines", () => {
    const rows = parseCsv('a,b,c\n1,"x, y","say ""hi""\nthere"\n2,,z\n');
    expect(rows).toEqual([
      { a: "1", b: "x, y", c: 'say "hi"\nthere' },
      { a: "2", b: "", c: "z" }
    ]);
  });

  it("strips a leading byte-order mark from the first header", () => {
    expect(parseCsv("﻿key,name\nsrd_x,X\n")[0]).toEqual({ key: "srd_x", name: "X" });
  });
});

describe("attack parser", () => {
  it("reads to-hit, reach and multi-type damage, and infers the ability from the bonus", () => {
    const result = parseAttack(entry("Flame Blade", "Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 8 (1d8 + 3) slashing damage plus 4 (1d8) fire damage."), ctx())!;
    const attack = result.actions[0] as AttackActionDefinition;
    expect(attack.attackBonus).toBe(5);
    expect(attack.ability).toBe("str"); // +5 = proficiency 2 + STR mod 3
    expect(attack.reach).toBe(5);
    expect(attack.damage.map((component) => [component.dice, component.damageType])).toEqual([["1d8+3", "slashing"], ["1d8", "fire"]]);
  });

  it("emits a separate two-handed attack for the versatile damage", () => {
    const result = parseAttack(entry("Longsword", "Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 7 (1d8 + 3) slashing damage, or 8 (1d10 + 3) slashing damage if used with two hands."), ctx())!;
    expect(result.actions.map((action) => action.name)).toEqual(["Longsword", "Longsword (Two-Handed)"]);
    expect((result.actions[1] as AttackActionDefinition).damage[0]!.dice).toBe("1d10+3");
  });

  it("splits Melee or Ranged into two actions with their own ranges", () => {
    const result = parseAttack(entry("Spear", "Melee or Ranged Weapon Attack: +4 to hit, reach 5 ft. or range 20/60 ft., one target. Hit: 4 (1d6 + 1) piercing damage."), ctx())!;
    const [melee, ranged] = result.actions as AttackActionDefinition[];
    expect(melee).toMatchObject({ name: "Spear (Melee)", attackType: "melee", reach: 5 });
    expect(ranged).toMatchObject({ name: "Spear (Ranged)", attackType: "ranged", range: 20, longRange: 60 });
  });

  it("ignores a parenthetical second to-hit (shillelagh) instead of failing", () => {
    const result = parseAttack(entry("Quarterstaff", "Melee Weapon Attack: +2 to hit (+4 to hit with shillelagh), reach 5 ft., one target. Hit: 3 (1d6) bludgeoning damage, or 6 (1d8 + 2) bludgeoning damage with shillelagh or if wielded with two hands."), ctx())!;
    expect((result.actions[0] as AttackActionDefinition).attackBonus).toBe(2);
  });

  it("turns a save-or-prone tail into a condition rider that rolls its own save", () => {
    const result = parseAttack(entry("Bite", "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 7 (2d4 + 2) piercing damage. If the target is a creature, it must succeed on a DC 11 Strength saving throw or be knocked prone."), ctx())!;
    const attack = result.actions[0] as AttackActionDefinition;
    expect(attack.riders).toEqual([{
      kind: "condition", when: "on-hit", condition: "prone",
      duration: { kind: "until-start-of-next-turn" },
      save: { ability: "str", dc: 11, onSuccess: "negates" }
    }]);
  });

  it("scopes a poison-save-for-damage tail to its attack with a save-gated-damage feature, ignoring the stable-but-poisoned sentence", () => {
    const gaps = new GapLog();
    const result = parseAttack(entry("Bite", "Melee Weapon Attack: +5 to hit, reach 5 ft., one creature. Hit: 7 (1d8 + 3) piercing damage, and the target must make a DC 11 Constitution saving throw, taking 9 (2d8) poison damage on a failed save, or half as much damage on a successful one. If the poison damage reduces the target to 0 hit points, the target is stable but poisoned for 1 hour, even after regaining hit points, and is paralyzed while poisoned in this way."), ctx({ gaps }))!;
    const attack = result.actions[0] as AttackActionDefinition;
    expect(attack.riders).toBeUndefined(); // the "paralyzed while poisoned" sentence must not become a condition
    expect(result.features[0]!.effects).toEqual([{
      kind: "save-gated-damage", actionIds: [attack.id],
      damage: [{ dice: "2d8", damageType: "poison" }],
      save: { ability: "con", dc: 11, halfDamageOnSuccess: true }
    }]);
    expect(gaps.gaps).toHaveLength(0);
  });

  it("does not invent save damage from disease text (aboleth tentacle)", () => {
    const gaps = new GapLog();
    const result = parseAttack(entry("Tentacle", "Melee Weapon Attack: +9 to hit, reach 10 ft., one target. Hit: 12 (2d6 + 5) bludgeoning damage. If the target is a creature, it must succeed on a DC 14 Constitution saving throw or become diseased. The disease has no effect for 1 minute. When the creature is outside a body of water, it takes 6 (1d12) acid damage every 10 minutes unless moisture is applied."), ctx({ gaps, proficiencyBonus: 4, abilities: { str: 21, dex: 9, con: 15, int: 18, wis: 15, cha: 18 } }))!;
    // No invented save damage — the disease text is kept as a reference-only trait.
    expect(result.features.some((feature) => feature.effects?.some((effect) => effect.kind === "save-gated-damage"))).toBe(false);
    expect(result.features).toEqual([expect.objectContaining({ name: "Tentacle (not automated)", automationSupport: "manual-only" })]);
    expect(gaps.codes()).toEqual(["RIDER_TEXT"]);
  });

  it("keeps grapples as reference notes rather than an inescapable condition", () => {
    const gaps = new GapLog();
    const result = parseAttack(entry("Constrict", "Melee Weapon Attack: +6 to hit, reach 5 ft., one target. Hit: 6 (1d6 + 3) bludgeoning damage, and the target is grappled (escape DC 14)."), ctx({ gaps }))!;
    const attack = result.actions[0] as AttackActionDefinition;
    expect(attack.riders?.some((rider) => rider.kind === "condition")).toBeFalsy();
    expect(gaps.codes()).toContain("HOLD_GRAPPLE");
  });

  it("compiles an attack whose only damage is save-gated (Spit Poison)", () => {
    const result = parseAttack(entry("Spit Poison", "Ranged Weapon Attack: +8 to hit, range 15/30 ft., one creature. Hit: The target must make a DC 15 Constitution saving throw, taking 45 (10d8) poison damage on a failed save, or half as much damage on a successful one."), ctx({ proficiencyBonus: 4 }))!;
    expect((result.actions[0] as AttackActionDefinition).damage).toEqual([]);
    expect(result.features[0]!.effects![0]).toMatchObject({ kind: "save-gated-damage", damage: [{ dice: "10d8" }] });
  });

  it("marks spell attacks magical and flags swarm half-HP damage", () => {
    const spell = parseAttack(entry("Ray", "Ranged Spell Attack: +5 to hit, range 60 ft., one target. Hit: 10 (3d6) radiant damage."), ctx({ abilities: { str: 8, dex: 10, con: 10, int: 10, wis: 10, cha: 16 } }))!;
    expect((spell.actions[0] as AttackActionDefinition)).toMatchObject({ attackType: "spell", ability: "cha" });
    expect((spell.actions[0] as AttackActionDefinition).damage[0]!.magical).toBe(true);

    const gaps = new GapLog();
    parseAttack(entry("Bites", "Melee Weapon Attack: +4 to hit, reach 0 ft., one creature in the swarm's space. Hit: 5 (2d4) piercing damage, or 2 (1d4) piercing damage if the swarm has half of its hit points or fewer."), ctx({ gaps }));
    expect(gaps.codes()).toContain("SWARM_DAMAGE");
  });

  it("refuses to guess at text it cannot read", () => {
    expect(parseAttack(entry("Odd", "Something else entirely."), ctx())).toBeNull();
  });
});

describe("save-action parser", () => {
  const breath = "The dragon exhales fire in a 60-foot cone. Each creature in that area must make a DC 21 Dexterity saving throw, taking 63 (18d6) fire damage on a failed save, or half as much damage on a successful one.";

  it("builds an area-save cone with half damage and a recharge (recorded + interim one-use pool)", () => {
    const context = ctx();
    const action = parseSaveAction(entry("Fire Breath", breath, { usage_limits: { type: "RECHARGE_ON_ROLL", param: 5 } }), context) as AreaSaveActionDefinition;
    expect(action).toMatchObject({
      kind: "area-save", saveAbility: "dex", dc: 21, halfDamageOnSuccess: true, area: { type: "cone", size: 60 },
      usage: { kind: "recharge", recharge: { min: 5 } }, resourceCost: { resourceId: "usage:fire-breath", amount: 1 }
    });
    expect(action.damage).toEqual([{ dice: "18d6", damageType: "fire" }]);
    expect(context.resources["usage:fire-breath"]).toBe(1);
    expect(context.gaps.codes()).toContain("RECHARGE");
  });

  it("reads Frightful Presence as a hostile-only frightened aura with repeat saves", () => {
    const context = ctx();
    const action = parseSaveAction(entry("Frightful Presence", "Each creature of the dragon's choice that is within 120 ft. of the dragon and aware of it must succeed on a DC 19 Wisdom saving throw or become frightened for 1 minute. A creature can repeat the saving throw at the end of each of its turns, ending the effect on itself on a success. If a creature's saving throw is successful or the effect ends for it, the creature is immune to the dragon's Frightful Presence for the next 24 hours."), context) as AreaSaveActionDefinition;
    expect(action).toMatchObject({ area: { type: "circle", size: 120 }, affects: "hostile", onSuccess: "negates", damage: [] });
    expect(action.riders?.[0]).toMatchObject({ condition: "frightened", when: "on-save-fail", duration: { kind: "save-ends", saveAt: "turn-end" } });
    expect(context.gaps.codes()).toContain("SAVE_IMMUNITY_AFTER");
  });

  it("makes a single-target save when there is no area", () => {
    const action = parseSaveAction(entry("Charm", "The vampire targets one humanoid it can see within 30 ft. of it. If the target can see the vampire, the target must succeed on a DC 17 Wisdom saving throw against this magic or be charmed by the vampire. The charmed target regards the vampire as a trusted friend for 1 hour."), ctx()) as SaveActionDefinition;
    expect(action).toMatchObject({ kind: "save", range: 30, saveAbility: "wis", dc: 17 });
    expect(action.riders?.[0]).toMatchObject({ condition: "charmed" });
  });

  it("treats a charm that lasts until its source dies as permanent", () => {
    const action = parseSaveAction(entry("Enslave", "The aboleth targets one creature it can see within 30 ft. of it. The target must succeed on a DC 14 Wisdom saving throw or be magically charmed by the aboleth until the aboleth dies or until it is on a different plane of existence from the target."), ctx()) as SaveActionDefinition;
    expect(action.riders?.[0]).toMatchObject({ duration: { kind: "permanent" } });
  });

  it("splits bold-bulleted breath weapons that share one recharge pool", () => {
    const text = "The dragon uses one of the following breath weapons:\n\n- **Fire Breath.** The dragon exhales fire in an 60-foot line that is 5 feet wide. Each creature in that line must make a DC 18 Dexterity saving throw, taking 45 (13d6) fire damage on a failed save, or half as much damage on a successful one.\n- **Sleep Breath.** The dragon exhales sleep gas in a 60-foot cone. Each creature in that area must succeed on a DC 18 Constitution saving throw or fall unconscious for 10 minutes.";
    const variants = splitBoldVariants(text)!;
    expect(variants.map((variant) => variant.name)).toEqual(["Fire Breath", "Sleep Breath"]);
    const context = ctx();
    const usage = { usage_limits: { type: "RECHARGE_ON_ROLL" as const, param: 5 } };
    const fire = parseSaveAction(entry("Breath Weapons", text, usage), context, { ...variants[0]!, poolId: "breath-weapons" }) as AreaSaveActionDefinition;
    const sleep = parseSaveAction(entry("Breath Weapons", text, usage), context, { ...variants[1]!, poolId: "breath-weapons" }) as AreaSaveActionDefinition;
    expect(fire.area).toMatchObject({ type: "line", size: 60, width: 5 });
    expect(sleep.riders?.[0]).toMatchObject({ condition: "unconscious" });
    expect(fire.resourceCost!.resourceId).toBe(sleep.resourceCost!.resourceId); // one shared pool
    expect(splitBoldVariants("A plain description.")).toBeNull();
  });

  it("declines effects it cannot model instead of dropping them silently", () => {
    const context = ctx();
    expect(parseSaveAction(entry("Draining Kiss", "The target must succeed on a DC 15 Constitution saving throw or take 10 (3d6) necrotic damage. The target's hit point maximum is reduced by an amount equal to the damage taken."), context)).toBeNull();
    expect(context.gaps.codes()).toEqual(["SAVE_UNPARSED"]);
  });
});

describe("multiattack parser", () => {
  const own = [
    { id: "bite", name: "Bite", attackType: "melee" as const },
    { id: "claws", name: "Claws", attackType: "melee" as const },
    { id: "longbow", name: "Longbow", attackType: "ranged" as const }
  ];
  const steps = (actions: ReturnType<typeof parseMultiattack>) => (actions as MultiattackActionDefinition[]).map((action) => action.attacks.map((step) => `${step.count}x${step.actionId}`));

  it("reads a colon list of counts and weapons", () => {
    expect(steps(parseMultiattack(entry("Multiattack", "The owlbear makes two attacks: one with its bite and one with its claws."), own, ctx()))).toEqual([["1xbite", "1xclaws"]]);
  });

  it("reads a numbered weapon ('two longbow attacks') and an 'or' alternative as separate options", () => {
    expect(steps(parseMultiattack(entry("Multiattack", "The bandit captain makes two claws attacks or two longbow attacks."), own, ctx()))).toEqual([["2xclaws"], ["2xlongbow"]]);
  });

  it("splits 'either with its A or its B' into one option per weapon", () => {
    expect(steps(parseMultiattack(entry("Multiattack", "The oni makes two attacks, either with its claws or its longbow."), own, ctx()))).toEqual([["2xclaws"], ["2xlongbow"]]);
  });

  it("handles 'only one of which can be a bite' as two options", () => {
    expect(steps(parseMultiattack(entry("Multiattack", "The vampire makes two attacks, only one of which can be a bite."), own, ctx()))).toEqual([["2xclaws"], ["1xclaws", "1xbite"]]);
  });

  it("drops form notes and splits form alternatives", () => {
    expect(steps(parseMultiattack(entry("Multiattack", "The werewolf makes two attacks: two with its claws (humanoid form) or one with its bite and one with its claws (hybrid form)."), own, ctx()))).toEqual([["2xclaws"], ["1xbite", "1xclaws"]]);
  });

  it("skips non-attack steps but reports them", () => {
    const context = ctx();
    const result = parseMultiattack(entry("Multiattack", "The dragon can use its Frightful Presence. It then makes three attacks: one with its bite and two with its claws."), own, context);
    expect(steps(result)).toEqual([["1xbite", "2xclaws"]]);
    expect(context.gaps.codes()).toContain("MULTIATTACK_STEP");
  });

  it("reports rather than guesses when an attack is not one of the creature's own", () => {
    const context = ctx();
    expect(parseMultiattack(entry("Multiattack", "The thing makes two tentacle attacks."), own, context)).toEqual([]);
    expect(context.gaps.codes()).toEqual(["MULTIATTACK_PARSE"]);
  });
});

describe("defense parser", () => {
  it("reads plain lists, nonmagical clauses and silvered / adamantine exceptions", () => {
    const gaps = new GapLog();
    expect(parseDamageAdjustments("cold; bludgeoning, piercing, and slashing from nonmagical attacks not made with silvered weapons", "resistance", gaps)).toEqual([
      { type: "resistance", damageType: "cold" },
      ...(["bludgeoning", "piercing", "slashing"] as const).map((damageType) => ({ type: "resistance" as const, damageType, nonMagicalOnly: true, exceptMaterials: ["silvered"] }))
    ]);
    expect(gaps.codes()).toEqual(["NONMAGIC_EXCEPTION"]);
    expect(parseDamageAdjustments("bludgeoning, piercing, and slashing from nonmagical attacks not made with adamantine weapons", "immunity", new GapLog())[0]).toMatchObject({ exceptMaterials: ["adamantine"] });
  });

  it("does not apply an exception to a damage type it isn't attached to", () => {
    const adjustments = parseDamageAdjustments("fire, poison", "immunity", new GapLog());
    expect(adjustments).toEqual([{ type: "immunity", damageType: "fire" }, { type: "immunity", damageType: "poison" }]);
  });

  it("flags a clause it cannot read instead of guessing", () => {
    const gaps = new GapLog();
    expect(parseDamageAdjustments("damage from spells", "resistance", gaps)).toEqual([]);
    expect(parseDamageAdjustments("piercing from magic weapons wielded by good creatures", "vulnerability", gaps)).toEqual([]);
    expect(gaps.codes()).toEqual(["DEFENSE_TEXT"]);
  });

  it("reads condition immunities", () => {
    const gaps = new GapLog();
    expect(parseConditionImmunities("charmed, exhaustion, petrified", gaps)).toEqual(["charmed", "exhaustion", "petrified"]);
    expect(gaps.codes()).toEqual(["COND_IMMUNITY"]);
  });
});

describe("hand-verified SRD statblocks", () => {
  it("Goblin", () => {
    const goblin = monster("goblin");
    expect(goblin).toMatchObject({ armorClass: 15, maxHp: 7, speed: 30, size: "small", type: "humanoid", challengeRating: 0.25, proficiencyBonus: 2 });
    expect(attackOf(goblin, "scimitar")).toMatchObject({ attackBonus: 4, reach: 5, damage: [{ dice: "1d6+2", damageType: "slashing" }] });
    expect(attackOf(goblin, "shortbow")).toMatchObject({ attackBonus: 4, range: 80, longRange: 320 });
    expect(goblin.traits!.find((trait) => trait.name === "Nimble Escape")!.grantedActions).toHaveLength(2);
    expect(index.find((entry) => entry.slug === "goblin")!.tier).toBe("full");
  });

  it("Wolf: Pack Tactics is real and the bite knocks prone on a failed DC 11 Strength save", () => {
    const wolf = monster("wolf");
    expect(wolf).toMatchObject({ armorClass: 13, maxHp: 11, speed: 40 });
    expect(wolf.traits!.find((trait) => trait.name === "Pack Tactics")!.effects).toEqual([{ kind: "attack-advantage", condition: "ally-adjacent-to-target" }]);
    expect(attackOf(wolf, "bite")).toMatchObject({ attackBonus: 4, damage: [{ dice: "2d4+2" }] });
    expect(attackOf(wolf, "bite").riders![0]).toMatchObject({ condition: "prone", save: { ability: "str", dc: 11 } });
  });

  it("Owlbear", () => {
    const owlbear = monster("owlbear");
    expect(owlbear).toMatchObject({ armorClass: 13, maxHp: 59, challengeRating: 3 });
    expect(attackOf(owlbear, "beak")).toMatchObject({ attackBonus: 7, damage: [{ dice: "1d10+5", damageType: "piercing" }] });
    expect(attackOf(owlbear, "claws")).toMatchObject({ attackBonus: 7, damage: [{ dice: "2d8+5", damageType: "slashing" }] });
    expect((owlbear.actions.find((action) => action.kind === "multiattack") as MultiattackActionDefinition).attacks).toEqual([
      { actionId: "beak", count: 1 }, { actionId: "claws", count: 1 }
    ]);
  });

  it("Adult Red Dragon", () => {
    const dragon = monster("adult-red-dragon");
    expect(dragon).toMatchObject({ armorClass: 19, maxHp: 256, challengeRating: 17, proficiencyBonus: 6, speed: 40 });
    expect(dragon.movement).toEqual({ walk: 40, fly: 80, climb: 40 });
    expect(attackOf(dragon, "bite")).toMatchObject({ attackBonus: 14, reach: 10 });
    expect(attackOf(dragon, "bite").damage.map((component) => [component.dice, component.damageType])).toEqual([["2d10+8", "piercing"], ["2d6", "fire"]]);
    const breath = dragon.actions.find((action) => action.id === "fire-breath") as AreaSaveActionDefinition;
    expect(breath).toMatchObject({ dc: 21, saveAbility: "dex", area: { type: "cone", size: 60 }, usage: { kind: "recharge", recharge: { min: 5 } } });
    expect(dragon.damageAdjustments).toEqual([{ type: "immunity", damageType: "fire" }]);
    expect(dragon.legendary!.pool).toBe(3);
    expect(dragon.legendary!.actions.find((action) => action.name === "Wing Attack")).toMatchObject({ cost: 2, action: { kind: "area-save", dc: 22 } });
    expect(dragon.legendary!.actions.find((action) => action.name === "Tail Attack")).toMatchObject({ cost: 1, actionId: "tail" });
  });

  it("Troll, Zombie, Aboleth, Giant Spider", () => {
    expect(monster("troll")).toMatchObject({ armorClass: 15, maxHp: 84 });
    expect(attackOf(monster("troll"), "claw")).toMatchObject({ attackBonus: 7, damage: [{ dice: "2d6+4" }] });
    expect(attackOf(monster("zombie"), "slam")).toMatchObject({ attackBonus: 3, damage: [{ dice: "1d6+1" }] });
    expect(monster("zombie").conditionImmunities).toEqual(["poisoned"]);
    expect(attackOf(monster("aboleth"), "tentacle")).toMatchObject({ attackBonus: 9, damage: [{ dice: "2d6+5" }] });
    expect(monster("aboleth").traits!.some((trait) => trait.effects?.some((effect) => effect.kind === "save-gated-damage"))).toBe(false);
    const spider = monster("giant-spider");
    expect(attackOf(spider, "bite")).toMatchObject({ attackBonus: 5, damage: [{ dice: "1d8+3" }] });
    expect(spider.traits!.find((trait) => trait.name === "Bite (save effect)")!.effects![0]).toMatchObject({ save: { ability: "con", dc: 11 }, damage: [{ dice: "2d8" }] });
  });

  it("gives a creature with no walk speed a usable ground speed (Ghost)", () => {
    const ghost = monster("ghost");
    expect(ghost.movement).toMatchObject({ walk: 0, fly: 40, hover: true });
    expect(ghost.speed).toBe(40);
  });

  it("applies documented overrides for source-data errors", () => {
    expect(monster("donkey").speed).toBe(40);
    expect(attackOf(monster("donkey"), "bite")).toMatchObject({ attackBonus: 2 });
    expect(monster("elf-drow").speed).toBe(30);
    expect((monster("hydra").actions.find((action) => action.kind === "multiattack") as MultiattackActionDefinition).attacks).toEqual([{ actionId: "bite", count: 5 }]);
  });

  it("stamps 'weapon attacks are magical' on the creature's weapon damage (Oni)", () => {
    expect(attackOf(monster("oni"), "claw").damage.every((component) => component.magical === true)).toBe(true);
  });
});

describe("generated library integrity", () => {
  it("has every SRD creature exactly once, correctly namespaced", () => {
    expect(definitions).toHaveLength(325);
    expect(new Set(definitions.map((definition) => definition.id)).size).toBe(325);
    expect(definitions.every((definition) => definition.id.startsWith("srd:monster:"))).toBe(true);
    expect(index).toHaveLength(325);
    expect(index.map((entry) => entry.id).sort()).toEqual(definitions.map((definition) => definition.id).sort());
  });

  it("validates every definition against the engine schema, and every dice string parses", () => {
    for (const definition of definitions) {
      expect(creatureDefinitionSchema.safeParse(definition).success, definition.id).toBe(true);
      const dice = [
        ...definition.actions.flatMap((action) => "damage" in action ? action.damage.map((component) => component.dice) : []),
        ...definition.actions.flatMap((action) => action.kind === "healing" ? action.healing.map((component) => component.dice) : [])
      ];
      for (const expression of dice) expect(() => parseDiceExpression(expression), `${definition.id} ${expression}`).not.toThrow();
    }
  });

  it("points every multiattack step, legendary reference and resource cost at something real", () => {
    for (const definition of definitions) {
      const ids = new Set(definition.actions.map((action) => action.id));
      for (const action of definition.actions) {
        if (action.kind === "multiattack") for (const step of action.attacks) expect(ids.has(step.actionId), `${definition.id} → ${step.actionId}`).toBe(true);
        if ("resourceCost" in action && action.resourceCost) expect(definition.resources?.[action.resourceCost.resourceId], `${definition.id} ${action.name}`).toBeGreaterThan(0);
      }
      for (const ref of definition.legendary?.actions ?? []) if (ref.actionId) expect(ids.has(ref.actionId), `${definition.id} legendary ${ref.name}`).toBe(true);
    }
  });

  it("never puts a `note` rider on an action: the engine demotes those to partial and the AI stops using them", () => {
    for (const definition of definitions) {
      for (const action of definition.actions) {
        if ("riders" in action) {
          expect(action.riders?.some((rider) => rider.kind === "note"), `${definition.id} ${action.name}`).toBeFalsy();
        }
      }
    }
  });

  it("keeps every compiled combat action at full automation so the AI will use it", () => {
    for (const definition of definitions) {
      for (const action of definition.actions) {
        if (["attack", "save", "area-save", "multiattack", "healing", "reposition"].includes(action.kind)) {
          expect(action.automationSupport, `${definition.id} ${action.name}`).toBe("full");
        }
      }
    }
  });

  it("never gives a creature a save-gated damage feature for an action it doesn't have", () => {
    for (const definition of definitions) {
      const ids = new Set(definition.actions.map((action) => action.id));
      for (const trait of definition.traits ?? []) {
        for (const effect of trait.effects ?? []) {
          if (effect.kind === "save-gated-damage") for (const id of effect.actionIds ?? []) expect(ids.has(id), `${definition.id} ${trait.name}`).toBe(true);
        }
      }
    }
  });

  it("keeps the index consistent with the definitions and only uses known gap codes", () => {
    for (const entry of index) {
      const definition = monster(entry.slug);
      expect(entry).toMatchObject({ name: definition.name, hp: definition.maxHp, ac: definition.armorClass, cr: definition.challengeRating, type: definition.type, chunk: definition.type });
      for (const code of entry.gaps) expect(code in GAP_CODES, `${entry.slug} ${code}`).toBe(true);
      expect(entry.tier === "full").toBe(entry.gaps.length === 0);
    }
  });

  it("never leaves a creature frozen in place unless it is a shrieker", () => {
    expect(definitions.filter((definition) => definition.speed === 0).map((definition) => definition.name)).toEqual(["Shrieker"]);
  });

  it("carries the CC-BY attribution in every generated data file", () => {
    for (const file of ["monster-index.json", ...readdirSync(`${generatedDir}chunks`).map((name) => `chunks/${name}`)]) {
      expect(readFileSync(`${generatedDir}${file}`, "utf8")).toContain("Creative Commons Attribution 4.0");
    }
  });

  it("does not regress: nearly every creature has runnable actions", () => {
    const manual = index.filter((entry) => entry.tier === "manual");
    expect(manual.length).toBeLessThanOrEqual(3);
    expect(index.filter((entry) => entry.tier === "full").length).toBeGreaterThanOrEqual(35);
  });

  it.skipIf(!existsSync(csvPath))("is in sync with the CSV (run `npm run srd:monsters` if this fails)", () => {
    const built = buildMonsterLibrary(readFileSync(csvPath, "utf8"));
    expect(built.errors).toEqual([]);
    for (const [name, content] of built.files) {
      if (name.startsWith("..")) continue; // COVERAGE.md lives one directory up
      expect(readFileSync(`${generatedDir}${name}`, "utf8") === content, `${name} is stale`).toBe(true);
    }
  });
});
