import { beforeAll, describe, expect, it } from "vitest";
import {
  getExecutableActions,
  resolveAttackBonus,
  type ActionDefinition,
  type CreatureDefinition,
  type WeaponDefinition
} from "@/engine";
import { findSrdFeature, findSrdSpell, findSrdWeapon } from "@/data/srd";
import { SRD_MONSTER_INDEX, loadSrdMonster } from "@/data/srd/monsters";
import { abilityRefs, type AbilityRef } from "@/lib/ability-editor/refs";
import {
  actionStatblock,
  featureStatblock,
  poolName,
  spellStatblock,
  statblockFor,
  weaponStatblock,
  type StatblockEntry
} from "@/lib/statblock";

/**
 * The ability editor's statblock text: abilities read the way a printed statblock prints them, with the numbers the
 * simulator actually rolls. The SRD expectations are the printed lines (Brown Bear's Claws, the red dragon's Fire
 * Breath), reworded only where the engine models the ability differently from the text.
 */

const MONSTERS = [
  "brown-bear", "adult-red-dragon", "wolf", "ghast", "troll", "giant-constrictor-snake", "goblin", "vampire", "mage",
  "lich", "knight", "zombie", "balor", "purple-worm", "tiger", "bat"
];
const monsters = new Map<string, CreatureDefinition>();

beforeAll(async () => {
  for (const id of MONSTERS) monsters.set(id, (await loadSrdMonster(`srd:monster:${id}`))!);
});

/** The entry titled `title` (ignoring a "(Recharge 5–6)"-style suffix) in one of the monster's lists. */
function entry(monster: string, list: AbilityRef["list"], title: string): StatblockEntry {
  const definition = monsters.get(monster)!;
  for (const ref of abilityRefs(definition)) {
    if (ref.list !== list) continue;
    const found = statblockFor(definition, ref)!;
    if (found.title === title || found.title.startsWith(`${title} (`)) return found;
  }
  throw new Error(`${monster} has no ${list} entry "${title}"`);
}

describe("statblock text for SRD monsters", () => {
  it("prints attacks as the SRD does", () => {
    expect(entry("brown-bear", "actions", "Claws").text).toBe(
      "Melee Weapon Attack: +6 to hit, reach 5 ft., one target. Hit: 11 (2d6 + 4) slashing damage.");
    expect(entry("adult-red-dragon", "actions", "Bite").text).toBe(
      "Melee Weapon Attack: +14 to hit, reach 10 ft., one target. Hit: 19 (2d10 + 8) piercing damage plus 7 (2d6) fire damage.");
    expect(entry("goblin", "actions", "Shortbow").text).toBe(
      "Ranged Weapon Attack: +4 to hit, range 80/320 ft., one target. Hit: 5 (1d6 + 2) piercing damage.");
    expect(entry("bat", "actions", "Bite").text).toBe("Melee Weapon Attack: +0 to hit, reach 5 ft., one target. Hit: 1 piercing damage.");
  });

  it("prints what an attack does on a hit", () => {
    expect(entry("wolf", "actions", "Bite").text).toBe(
      "Melee Weapon Attack: +4 to hit, reach 5 ft., one target. Hit: 7 (2d4 + 2) piercing damage. "
      + "The target must succeed on a DC 11 Strength saving throw or be knocked prone.");
    expect(entry("ghast", "actions", "Claws").text).toBe(
      "Melee Weapon Attack: +5 to hit, reach 5 ft., one target. Hit: 10 (2d6 + 3) slashing damage. "
      + "The target must succeed on a DC 10 Constitution saving throw or be paralyzed. "
      + "The target can repeat the saving throw at the end of each of its turns, ending the effect on itself on a success.");
    expect(entry("giant-constrictor-snake", "actions", "Constrict").text).toBe(
      "Melee Weapon Attack: +6 to hit, reach 5 ft., one target. Hit: 13 (2d8 + 4) bludgeoning damage. "
      + "The target is grappled (escape DC 16). Until this grapple ends, the target is restrained.");
    expect(entry("purple-worm", "actions", "Bite").text).toContain(
      "It swallows the target if it is large or smaller, unless it succeeds on a DC 19 Dexterity saving throw.");
  });

  it("prints saves and areas, with the recharge in the title and not as a cost", () => {
    const breath = entry("adult-red-dragon", "actions", "Fire Breath");
    expect(breath.title).toBe("Fire Breath (Recharge 5–6)");
    expect(breath.text).toBe(
      "Each creature in a 60-foot cone must make a DC 21 Dexterity saving throw, "
      + "taking 63 (18d6) fire damage on a failed save, or half as much damage on a successful one.");
    expect(entry("adult-red-dragon", "actions", "Frightful Presence").text).toBe(
      "Each enemy within 120 feet of it must succeed on a DC 19 Wisdom saving throw or be frightened. "
      + "A creature can repeat the saving throw at the end of each of its turns, ending the effect on itself on a success. "
      + "A creature that succeeds is immune to this for the rest of the fight.");
  });

  it("prints multiattack as the SRD does", () => {
    expect(entry("brown-bear", "actions", "Multiattack").text).toBe("It makes two attacks: one with its bite and one with its claws.");
    expect(entry("adult-red-dragon", "actions", "Multiattack").text).toBe(
      "It can use its Frightful Presence. It then makes three attacks: one with its bite and two with its claws.");
  });

  it("prints legendary actions with their cost, and says what a borrowed action is", () => {
    const wing = entry("adult-red-dragon", "legendary", "Wing Attack");
    expect(wing.title).toBe("Wing Attack (Costs 2 Actions)");
    expect(wing.text).toBe(
      "Each creature within 10 feet of it must succeed on a DC 22 Dexterity saving throw or take 15 (2d6 + 8) bludgeoning damage and be knocked prone.");
    expect(entry("adult-red-dragon", "legendary", "Tail Attack").text).toBe(
      "It makes a tail attack. Melee Weapon Attack: +14 to hit, reach 15 ft., one target. Hit: 17 (2d8 + 8) bludgeoning damage.");
    expect(entry("lich", "legendary", "Cantrip").text).toMatch(/^It casts Ray of Frost\. /);
  });

  it("prints traits", () => {
    expect(entry("wolf", "traits", "Pack Tactics").text).toBe("It has advantage on attack rolls if an ally is within 5 feet of the target.");
    expect(entry("ghast", "traits", "Stench").text).toBe(
      "A creature that starts its turn within 5 feet of it must succeed on a DC 10 Constitution saving throw or be poisoned "
      + "until the start of its next turn. A creature that succeeds is immune to this for the rest of the fight.");
    expect(entry("troll", "traits", "Regeneration").text).toBe(
      "It regains 10 hit points at the start of its turn, even at 0 hit points. If it takes acid or fire damage, this doesn't work at the start of its next turn.");
    expect(entry("zombie", "traits", "Undead Fortitude").text).toBe(
      "If damage reduces it to 0 hit points, it makes a Constitution saving throw with a DC of 5 + the damage taken, "
      + "and on a success it drops to 1 hit point instead, unless the damage is radiant or it's from a critical hit.");
    expect(entry("goblin", "traits", "Nimble Escape").text).toBe("It can take the Disengage or Hide action as a bonus action.");
    const resistance = entry("vampire", "traits", "Legendary Resistance");
    expect(resistance.title).toBe("Legendary Resistance (3/Day)");
    expect(resistance.text).toBe("If it fails a saving throw, it can choose to succeed instead (uses 1 legendary resistance).");
    expect(entry("tiger", "traits", "Pounce").text).toContain("If a charge hits a creature and leaves it prone, it can make one Bite attack against it as a bonus action.");
  });

  it("prints spells with their level, slot and scaling", () => {
    expect(entry("mage", "spells", "Fireball").text).toBe(
      "3rd-level spell, 1 action, range 150 feet, uses a 3rd-level slot. Each creature in a 20-foot-radius sphere centered on a point within 150 feet "
      + "must make a DC 14 Dexterity saving throw, taking 28 (8d6) fire damage on a failed save, or half as much damage on a successful one. "
      + "At higher levels: +1d6 damage for each slot level above 3rd.");
    expect(entry("mage", "spells", "Magic Missile").text).toBe(
      "1st-level spell, 1 action, range 120 feet, uses a 1st-level slot. Three darts each hit a creature of its choice within 120 feet automatically. "
      + "Each deals 3 (1d4 + 1) force damage. At higher levels: one more dart for each slot level above 1st.");
    // An 18th-level caster's cantrip rolls its 17th-level dice.
    expect(entry("lich", "spells", "Ray of Frost").text).toContain("Hit: 18 (4d8) cold damage.");
  });

  it("prints reactions and death effects", () => {
    expect(entry("knight", "reactions", "Parry").text).toBe("When a melee attack would hit it (reaction): it gains a +2 bonus to AC against that attack.");
    expect(entry("balor", "deathEffects", "Death Throes").text).toBe(
      "When it dies: Each creature within 30 feet of it must make a DC 20 Dexterity saving throw, "
      + "taking 70 (20d6) fire damage on a failed save, or half as much damage on a successful one.");
  });

  it("gives each entry a one-line short form for list rows", () => {
    expect(entry("brown-bear", "actions", "Claws").short).toBe("+6 to hit, reach 5 ft · 11 (2d6 + 4) slashing");
    expect(entry("wolf", "actions", "Bite").short).toBe("+4 to hit, reach 5 ft · 7 (2d4 + 2) piercing · DC 11 STR or prone");
    expect(entry("adult-red-dragon", "actions", "Fire Breath").short).toBe("Recharge 5–6 · 60-ft cone · DC 21 DEX · 63 (18d6) fire, half on save");
    expect(entry("ghast", "traits", "Stench").short).toBe("aura 5 ft: DC 10 CON or poisoned");
    expect(entry("mage", "spells", "Fireball").short).toBe("level 3 · 20-ft sphere within 150 ft · DC 14 DEX · 28 (8d6) fire, half on save");
  });

  it("says when there's nothing to simulate, or only reference text", () => {
    expect(entry("brown-bear", "traits", "Keen Smell").support).toBe("no-effect");
    expect(entry("balor", "actions", "Teleport").support).toBe("reference");
    expect(entry("brown-bear", "actions", "Claws").support).toBe("simulated");
  });

  it("renders every ability on every SRD monster, with the engine's attack bonus", async () => {
    const problems: string[] = [];
    for (const { id } of SRD_MONSTER_INDEX) {
      const definition = (await loadSrdMonster(id))!;
      const attacks = new Map(getExecutableActions(definition).flatMap((action) => (action.kind === "attack" ? [[action.id, action] as const] : [])));
      for (const ref of abilityRefs(definition)) {
        const rendered = statblockFor(definition, ref);
        if (!rendered?.title || /undefined|NaN|\[object/.test(`${rendered.title} ${rendered.text} ${rendered.short}`)) {
          problems.push(`${definition.name}: ${JSON.stringify(ref)} → ${JSON.stringify(rendered)}`);
          continue;
        }
        const attack = "id" in ref ? attacks.get(ref.id) : undefined;
        if (attack && ref.list === "actions" && !attack.autoHit && rendered.support === "simulated") {
          const bonus = resolveAttackBonus(attack, definition);
          if (!rendered.text.includes(`${bonus < 0 ? bonus : `+${bonus}`} to hit`)) problems.push(`${definition.name} ${attack.name}: ${rendered.text}`);
        }
      }
    }
    expect(problems).toEqual([]);
  }, 60_000);
});

describe("statblock numbers follow the engine", () => {
  const creature = (overrides: Partial<CreatureDefinition> = {}): CreatureDefinition => ({
    id: "c", name: "C", size: "medium", armorClass: 14, maxHp: 30, speed: 30, proficiencyBonus: 2,
    abilities: { str: 16, dex: 18, con: 12, int: 10, wis: 10, cha: 10 }, actions: [], ...overrides
  });

  it("uses an attack's calculated bonus over its printed one", () => {
    const action: ActionDefinition = {
      kind: "attack", id: "a", name: "Strike", actionType: "action", attackType: "melee", ability: "str", range: 5,
      attackBonus: 99, attackBonusFormula: { ability: "str", proficiency: true, base: 1 }, damage: [{ dice: "1d8", damageType: "slashing", abilityModifier: "str" }],
      automationSupport: "full"
    };
    expect(actionStatblock(action, creature()).text).toBe("Melee Weapon Attack: +6 to hit, reach 5 ft., one target. Hit: 7 (1d8 + 3) slashing damage.");
  });

  it("adds the better of STR and DEX to a finesse weapon's damage", () => {
    const rapier = findSrdWeapon("srd:weapon:rapier")!;
    const weapon: WeaponDefinition = { ...rapier, id: "rapier", actionId: "rapier-attack" };
    const text = weaponStatblock(weapon, creature({ weapons: [weapon] })).text;
    expect(text).toBe("Melee Weapon Attack: +6 to hit, reach 5 ft., one target. Hit: 8 (1d8 + 4) piercing damage.");
  });

  it("shows what a custom condition does, and keeps notes and manual triggers apart", () => {
    const action: ActionDefinition = {
      kind: "save", id: "s", name: "Chill", actionType: "action", range: 30, saveAbility: "con", dc: 13, damage: [], halfDamageOnSuccess: false,
      riders: [
        { kind: "condition", when: "on-save-fail", condition: { custom: "chilled-to-the-bone" }, duration: { kind: "rounds", rounds: 1 }, modifiers: { movementMultiplier: 2 } },
        { kind: "note", text: "Frost rimes the target's armor." }
      ],
      automationSupport: "full"
    };
    const rendered = actionStatblock(action, creature());
    expect(rendered.text).toBe("One creature within 30 feet must succeed on a DC 13 Constitution saving throw or be chilled to the bone (half speed) for 1 round.");
    expect(rendered.notSimulated).toEqual(["Frost rimes the target's armor."]);

    const manual: ActionDefinition = {
      kind: "attack", id: "r", name: "Riposte", actionType: "reaction", attackType: "melee", ability: "dex", range: 5,
      damage: [{ dice: "1d6", damageType: "piercing", abilityModifier: "dex" }],
      reaction: { trigger: { kind: "manual", note: "A creature misses it with a melee attack" } }, automationSupport: "full"
    };
    const riposte = actionStatblock(manual, creature());
    expect(riposte.text).toMatch(/^When a creature misses it with a melee attack \(reaction\): Melee Weapon Attack: \+6 to hit/);
    expect(riposte.notSimulated).toHaveLength(1);
  });

  it("describes an activated feature by what activating it does", () => {
    const barbarian = creature();
    expect(featureStatblock(findSrdFeature("srd:feature:rage")!, barbarian).text).toBe(
      "As a bonus action (uses 1 rage), it gains these benefits for 1 minute: its melee hits using Strength deal an extra 2 damage. "
      + "It has resistance to bludgeoning, piercing, and slashing damage. It has advantage on Strength saving throws.");
    expect(featureStatblock(findSrdFeature("srd:feature:action-surge")!, barbarian).text).toBe(
      "Without using an action (uses 1 action surge), it can take one additional action.");
  });

  it("upcasts a healing spell's healing", () => {
    expect(spellStatblock(findSrdSpell("srd:spell:cure-wounds")!, creature()).text).toContain("At higher levels: +1d8 healing for each slot level above 1st.");
  });

  it("previews a weapon it only swings as a bonus action", () => {
    const dagger = { ...findSrdWeapon("srd:weapon:dagger")!, id: "offhand", usableAs: ["bonus"] as Array<"bonus"> };
    const entry = weaponStatblock(dagger, creature({ weapons: [dagger] }));
    expect(entry.support).toBe("simulated");
    expect(entry.text).toMatch(/^Melee Weapon Attack: \+6 to hit/);
    expect(entry.text).toContain("It attacks with it as a bonus action.");
  });

  it("names pools in the singular for one", () => {
    expect(poolName("ki-points", 1)).toBe("ki point");
    expect(poolName("ki-points", 2)).toBe("ki points");
    expect(poolName("weapon-1:charges", 1)).toBe("charge");
    expect(poolName("rage", 2)).toBe("rages");
  });

  it("says a reaction lock as the rule does", () => {
    expect(spellStatblock(findSrdSpell("srd:spell:shocking-grasp")!, creature()).text).toContain("The target can't take reactions until the start of its next turn.");
  });

  it("finds nothing for a ref that points nowhere", () => {
    expect(statblockFor(creature(), { list: "actions", id: "missing" })).toBeUndefined();
  });
});

describe("every SRD multiattack reads like its statblock", { timeout: 60000 }, () => {
  // The browsable creatures, and the shapes only a transform reaches.
  const FORMS = ["werebear--bear", "werebear--hybrid", "wereboar--hybrid", "wererat--hybrid", "weretiger--hybrid", "werewolf--hybrid"];
  const all = new Map<string, CreatureDefinition>();
  beforeAll(async () => {
    for (const id of [...SRD_MONSTER_INDEX.map((indexed) => indexed.id), ...FORMS.map((form) => `srd:monster:${form}`)]) {
      const definition = (await loadSrdMonster(id))!;
      if (definition.actions.some((action) => action.kind === "multiattack")) all.set(id.replace("srd:monster:", ""), definition);
    }
  });
  const text = (slug: string) => {
    const definition = all.get(slug)!;
    return actionStatblock(definition.actions.find((action) => action.kind === "multiattack")!, definition);
  };

  it("names every attack and ability its routines use, in plain sentences", () => {
    expect(all.size).toBeGreaterThan(140);
    for (const [slug, definition] of all) {
      const multiattack = definition.actions.find((action) => action.kind === "multiattack")!;
      const { text: sentence } = actionStatblock(multiattack, definition);
      expect(sentence, slug).toMatch(/^It [^]*\.$/);
      expect(sentence, slug).not.toMatch(/undefined|\s{2}/);
      // Its own words, without the statblock text it quotes as not simulated ("(escape DC 14)").
      const own = (multiattack.unsimulated ?? []).reduce((rest, note) => rest.replace(note, ""), sentence);
      expect(own, slug).not.toMatch(/\(|any (?:melee|ranged|weapon)/);
      const byId = new Map(getExecutableActions(definition).map((action) => [action.id, action]));
      for (const step of [multiattack.attacks, ...(multiattack.options ?? []).map((option) => option.attacks)].flat()) {
        if (!step.actionId) continue;
        const word = byId.get(step.actionId)!.name.replace(/\s*\([^)]*\)/g, "").toLowerCase();
        // "claw" is named in "two with its claws"; Constrict in "one to constrict".
        expect(sentence.toLowerCase(), `${slug}: ${word}`).toContain(word);
      }
    }
  });

  it("reads options, replacements, step rules and abilities the way the SRD prints them", () => {
    const expected: Record<string, string> = {
      scout: "It makes two melee attacks or two ranged attacks.",
      erinyes: "It makes three attacks.",
      "chain-devil": "It makes two chain attacks.",
      efreeti: "It makes two scimitar attacks or uses its Hurl Flame twice.",
      "barbed-devil": "It makes three attacks: one with its tail and two with its claws. Alternatively, it uses its Hurl Flame twice.",
      "bandit-captain": "It makes three attacks: two with its scimitar and one with its dagger, or two ranged attacks with its dagger.",
      centaur: "It makes two attacks: one with its pike and one with its hooves, or two ranged attacks with its longbow.",
      medusa: "It makes three attacks: one with its snake hair and two with its shortsword, or two ranged attacks with its longbow.",
      behir: "It makes two attacks: one with its bite and one to constrict.",
      wight: "It makes two longsword attacks or two longbow attacks. It can use its Life Drain in place of one longsword attack.",
      chimera: "It makes three attacks: one with its bite, one with its horns, and one with its claws. It can use its Fire Breath in place of its bite attack or its horns attack.",
      "dragon-turtle": "It makes three attacks: one with its bite and two with its claws. It can make one tail attack in place of its two claw attacks.",
      drider: "It makes three longsword attacks or three longbow attacks. It can make one bite attack in place of one longsword attack or one longbow attack.",
      "vampire-spawn": "It makes two attacks with its claws. It can make one bite attack in place of one attack with its claws.",
      tarrasque: "It can use its Frightful Presence. It then makes five attacks: one with its bite, two with its claws, one with its horns, and one with its tail. "
        + "It can use its Swallow in place of its bite attack.",
      "gibbering-mouther": "It makes one attack with its bites and can then use its Blinding Spittle.",
      grick: "It makes one attack with its tentacles. If that attack hits, it can make one beak attack against the same target.",
      "tyrannosaurus-rex": "It makes two attacks: one with its bite and one with its tail. It can't make both attacks against the same target.",
      veteran: "It makes three attacks: two with its longsword and one with its shortsword.",
      xorn: "It makes four attacks: three with its claws and one with its bite.",
      "werebear--bear": "It makes two claw attacks.",
      "werebear--hybrid": "It makes two greataxe attacks or two claw attacks.",
      "werewolf--hybrid": "It makes two attacks: one with its bite and one with its claws."
    };
    for (const [slug, sentence] of Object.entries(expected)) expect(text(slug).text, slug).toBe(sentence);
  });

  it("says what the routine doesn't run, apart from what it does", () => {
    expect(text("lizardfolk")).toMatchObject({ text: "It makes two melee attacks. Each attack uses a different weapon.", notSimulated: ["Each attack uses a different weapon."] });
    expect(text("kraken").notSimulated).toEqual(["It can replace each tentacle attack with one use of Fling."]);
    expect(text("horned-devil").text).toBe(
      "It makes three attacks: two with its fork and one with its tail. Alternatively, it uses its Hurl Flame three times. It can also use Hurl Flame in place of just some of its melee attacks.");
    expect(text("scout").notSimulated).toEqual([]);
  });

  it("gives each routine a short form that lists the options by label", () => {
    expect(text("wight").short).toBe("2 × Longsword · or Longbow · or Life Drain");
    expect(text("scout").short).toBe("2 × any melee attack · or Ranged");
    expect(text("grick").short).toBe("Tentacles, Beak");
  });
});
