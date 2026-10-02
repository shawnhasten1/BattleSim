import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { parseCombatantPackage, type CreatureDefinition } from "@/engine";
import { loadSrdMonster } from "@/data/srd/monsters";
import { saveKind, skillKind, withChallengeRating, withClasses, withProficienciesFollowing } from "@/lib/actor-sheet/edits";
import { challengeLine, defensesLine, sensesLine, skillsLine, speedLine } from "@/lib/actor-sheet/summaries";
import { useEncounterStore } from "@/store/encounter-store";

/** The actor sheet plan's Phase 3: the Stats tab reads like a statblock. */

const pristine = useEncounterStore.getState();
beforeEach(() => useEncounterStore.setState(pristine, true));

const store = () => useEncounterStore.getState();
const definition = (id: string) => store().encounter.definitions.find((candidate) => candidate.id === id)!;
const monster = async (slug: string) => (await loadSrdMonster(`srd:monster:${slug}`))!;

/** An SRD Knight in the scene as `def-knight`, with the sample's two goblin tokens on it. */
async function knightsInScene() {
  const knight = { ...(await monster("knight")), id: "def-knight" };
  useEncounterStore.setState((state) => ({
    encounter: {
      ...state.encounter,
      definitions: [...state.encounter.definitions, knight],
      combatants: state.encounter.combatants.map((combatant) => (combatant.definitionId === "def-goblin" ? { ...combatant, definitionId: "def-knight" } : combatant))
    },
    undoStack: []
  }));
}

describe("the summaries read like the printed statblocks", () => {
  it("for an Adult Red Dragon", async () => {
    const dragon = await monster("adult-red-dragon");
    expect(speedLine(dragon)).toBe("40 ft, climb 40 ft, fly 80 ft");
    expect(skillsLine(dragon)).toBe("Perception +13, Stealth +6");
    expect(defensesLine(dragon)).toBe("immune to fire");
    expect(sensesLine(dragon)).toBe("blindsight 60 ft, darkvision 120 ft, passive Perception 23 · Common, Draconic");
    expect(challengeLine(dragon)).toBe("CR 17 · proficiency +6");
  });

  it("for a Lich: its defenses, truesight and caster level", async () => {
    const lich = await monster("lich");
    expect(skillsLine(lich)).toBe("Arcana +18, History +12, Insight +9, Perception +9");
    expect(defensesLine(lich)).toBe("resists cold, lightning and necrotic; immune to poison; immune to bludgeoning, piercing and slashing from nonmagical attacks · can't be charmed, exhausted, frightened, paralyzed or poisoned");
    expect(sensesLine(lich)).toBe("truesight 120 ft, passive Perception 19 · Common plus up to five other languages");
    expect(challengeLine(lich)).toBe("CR 21 · 18th-level spellcaster · proficiency +7");
  });

  it("for a Knight, a Mage and a Goblin", async () => {
    const [knight, mage, goblin] = await Promise.all([monster("knight"), monster("mage"), monster("goblin")]);
    expect([skillsLine(knight), defensesLine(knight), sensesLine(knight), challengeLine(knight)]).toEqual([
      "none", "none", "passive Perception 10 · any one language (usually Common)", "CR 3 · proficiency +2"
    ]);
    expect([skillsLine(mage), challengeLine(mage)]).toEqual(["Arcana +6, History +6", "CR 6 · 9th-level spellcaster · proficiency +3"]);
    expect([skillsLine(goblin), sensesLine(goblin), challengeLine(goblin)]).toEqual([
      "Stealth +6", "darkvision 60 ft, passive Perception 9 · Common, Goblin", "CR 1/4 · proficiency +2"
    ]);
  });

  it("for the Lore Bard, a character", () => {
    const bard = parseCombatantPackage(JSON.parse(readFileSync(`${process.cwd()}/lore-bard.party.json`, "utf8"))).definition;
    expect(challengeLine(bard)).toBe("Level 6 Bard (College of Lore) · proficiency +3");
  });

  it("and every SRD save is modifier + proficiency, so it shows as proficient", async () => {
    const dragon = await monster("adult-red-dragon");
    expect((["str", "dex", "con", "int", "wis", "cha"] as const).map((ability) => saveKind(dragon, ability)))
      .toEqual(["none", "proficient", "proficient", "none", "proficient", "proficient"]);
  });
});

describe("proficient saves and skills follow scores and proficiency (plan D9)", () => {
  it("a score typed a digit at a time, as one undo step", async () => {
    await knightsInScene();
    // CON 14, a proficient CON save of +4; WIS 11, a proficient +2.
    store().mergeEdits("con", () => store().updateCreatureAbility("def-knight", "con", 1));
    store().mergeEdits("con", () => store().updateCreatureAbility("def-knight", "con", 16));
    expect(definition("def-knight").saves).toEqual({ con: 5, wis: 2 });
    expect(store().undoStack).toHaveLength(1);
  });

  it("the proficiency bonus, and a level when the bonus is left to it", async () => {
    await knightsInScene();
    store().updateCreatureDefinition("def-knight", { proficiencyBonus: 3 });
    expect(definition("def-knight").saves).toEqual({ con: 5, wis: 3 });
    store().updateCreatureDefinition("def-knight", { proficiencyBonus: undefined, character: { level: 9 } });
    // Level 9 gives +4.
    expect(definition("def-knight").saves).toEqual({ con: 6, wis: 4 });
  });

  it("but not a number of its own, nor saves the change sets itself", async () => {
    await knightsInScene();
    store().updateCreatureDefinition("def-knight", { saves: { con: 9, wis: 2 } });
    store().updateCreatureAbility("def-knight", "con", 16);
    expect(definition("def-knight").saves).toEqual({ con: 9, wis: 2 });
    store().updateCreatureDefinition("def-knight", { proficiencyBonus: 3, saves: { con: 9, wis: 7 } });
    expect(definition("def-knight").saves).toEqual({ con: 9, wis: 7 });
  });

  it("skills too: proficient, expertise, and their own", () => {
    const rogue = {
      ...definition("def-fighter"), abilities: { ...definition("def-fighter").abilities, dex: 16 }, proficiencyBonus: 2,
      skills: { stealth: 5, acrobatics: 7, sleight_of_hand: 9 }
    } as CreatureDefinition;
    expect(["stealth", "acrobatics", "sleight_of_hand"].map((id) => skillKind(rogue, id))).toEqual(["proficient", "expertise", "custom"]);
    const raised = withProficienciesFollowing(rogue, { ...rogue, abilities: { ...rogue.abilities, dex: 18 } });
    expect(raised.skills).toEqual({ stealth: 6, acrobatics: 8, sleight_of_hand: 9 });
  });
});

describe("level and challenge", () => {
  it("a challenge rating sets the proficiency it gives, unless the bonus is its own", async () => {
    const knight = await monster("knight");
    expect(withChallengeRating(knight, 9)).toEqual({ challengeRating: 9, proficiencyBonus: 4 });
    expect(withChallengeRating({ ...knight, proficiencyBonus: 5 }, 9)).toEqual({ challengeRating: 9 });
    expect(withChallengeRating({ ...knight, proficiencyBonus: undefined, challengeRating: undefined }, 0.25)).toEqual({ challengeRating: 0.25, proficiencyBonus: 2 });
    // A new token from Create Token: no rating, and the +2 its level 1 gives, so a rating's bonus replaces it.
    const fresh = { ...knight, challengeRating: undefined, proficiencyBonus: 2, character: undefined };
    expect(withChallengeRating(fresh, 5)).toEqual({ challengeRating: 5, proficiencyBonus: 3 });
    expect(withChallengeRating({ ...fresh, proficiencyBonus: 4 }, 5)).toEqual({ challengeRating: 5 });
  });

  it("classes total the level, keep what they carry, and leaving none keeps the level", () => {
    const lore = { level: 6, classes: [{ id: "bard", name: "Bard", level: 6, subclass: { name: "College of Lore" } }] };
    expect(withClasses(lore, [...lore.classes, { name: "Fighter", level: 2 }])).toEqual({
      level: 8, classes: [{ id: "bard", name: "Bard", level: 6, subclass: { name: "College of Lore" } }, { name: "Fighter", level: 2 }]
    });
    expect(withClasses(lore, [])).toEqual({ level: 6 });
  });
});

describe("size", () => {
  it("grows a token from its top-left square, and moves one that would leave the map back on", async () => {
    await knightsInScene();
    const { width } = store().encounter.map.grid;
    useEncounterStore.setState((state) => ({
      encounter: { ...state.encounter, combatants: state.encounter.combatants.map((combatant) => (combatant.id === "enemy-goblin-1" ? { ...combatant, position: { x: width - 1, y: 2 } } : combatant)) }
    }));
    const before = store().encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-2")!.position;
    store().updateCreatureDefinition("def-knight", { size: "large" });
    const position = (id: string) => store().encounter.combatants.find((combatant) => combatant.id === id)!.position;
    expect(position("enemy-goblin-1")).toEqual({ x: width - 2, y: 2 });
    expect(position("enemy-goblin-2")).toEqual(before.x <= width - 2 ? before : { ...before, x: width - 2 });
  });
});
