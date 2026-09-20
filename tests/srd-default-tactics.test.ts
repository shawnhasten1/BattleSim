// @vitest-environment happy-dom
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CreatureDefinition } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";

/** SRD monsters are placed with tactics that suit them, not one blanket default. */
const chunkDir = `${process.cwd()}/src/data/srd/monsters/generated/chunks/`;
const monsters = readdirSync(chunkDir).flatMap((file) => (JSON.parse(readFileSync(`${chunkDir}${file}`, "utf8")) as { definitions: CreatureDefinition[] }).definitions);
const of = (name: string) => monsters.find((monster) => monster.name === name)!;

describe("generated default tactics", () => {
  it("every creature has one", () => {
    expect(monsters.every((monster) => monster.defaultTactics !== undefined)).toBe(true);
  });

  it("matches how each kind of creature fights", () => {
    expect(of("Goblin").defaultTactics).toBe("skirmisher");
    expect(of("Lich").defaultTactics).toBe("controller");
    expect(of("Mage").defaultTactics).toBe("controller");
    expect(of("Ogre").defaultTactics).toBe("brute");
    expect(of("Troll").defaultTactics).toBe("brute");
    expect(of("Tarrasque").defaultTactics).toBe("brute");
    expect(of("Knight").defaultTactics).toBe("defender");
    expect(of("Bandit").defaultTactics).toBe("basic-ranged");
    expect(of("Wolf").defaultTactics).toBe("basic-melee");
    expect(of("Adult Red Dragon").defaultTactics).toBe("basic-melee"); // breath needs area weight, not brute's 0.5
  });

  it("legendary creatures hold their limited resources back", () => {
    expect(of("Adult Red Dragon").defaultResourceStance).toBe("conservative");
    expect(of("Lich").defaultResourceStance).toBe("conservative");
    expect(of("Goblin").defaultResourceStance).toBeUndefined();
  });
});

describe("placing a token", () => {
  it("uses the creature's tactics and stance", async () => {
    const store = () => useEncounterStore.getState();
    await store().addSrdMonster("srd:monster:lich", "enemy", { x: 3, y: 3 });
    await store().addSrdMonster("srd:monster:goblin", "enemy", { x: 6, y: 3 }, 2);
    const tokens = store().encounter.combatants;
    const lich = tokens.find((combatant) => combatant.definitionId === "srd:monster:lich")!;
    expect([lich.tacticsProfile, lich.resourceStance]).toEqual(["controller", "conservative"]);
    const goblins = tokens.filter((combatant) => combatant.definitionId === "srd:monster:goblin");
    expect(goblins.every((combatant) => combatant.tacticsProfile === "skirmisher" && combatant.resourceStance === "balanced")).toBe(true);
  });

  it("a creature without them keeps the old default", async () => {
    const store = () => useEncounterStore.getState();
    const plain = { ...of("Goblin"), id: "def-plain", defaultTactics: undefined, defaultResourceStance: undefined, actions: of("Goblin").actions.filter((action) => action.kind === "attack" && action.attackType === "melee") };
    store().addCreatureTokens(plain, "enemy", 1);
    const token = store().encounter.combatants.find((combatant) => combatant.definitionId === "def-plain")!;
    expect([token.tacticsProfile, token.resourceStance]).toEqual(["basic-melee", "balanced"]);
  });
});
