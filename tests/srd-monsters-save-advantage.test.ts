import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createEngineState, resolveAreaSaveAction, resolveSaveAction, sampleEncounter, type CombatantState, type CreatureDefinition, type EncounterSnapshot, type FeatureEffect } from "@/engine";

/** The generated SRD data carries scoped save advantages the engine understands. */
const chunkDir = fileURLToPath(new URL("../src/data/srd/monsters/generated/chunks/", import.meta.url));
const monsters = readdirSync(chunkDir).flatMap((file) =>
  (JSON.parse(readFileSync(`${chunkDir}${file}`, "utf8")) as { definitions: CreatureDefinition[] }).definitions
);
const byName = (name: string) => monsters.find((monster) => monster.name === name)!;
type Advantage = Extract<FeatureEffect, { kind: "save-advantage" }>;
const advantages = (monster: CreatureDefinition, feature: string): Advantage[] =>
  (monster.traits?.find((entry) => entry.name === feature)?.effects ?? []).filter((effect): effect is Advantage => effect.kind === "save-advantage");

describe("generated save advantages", () => {
  it("Magic Resistance is against magical effects", () => {
    for (const name of ["Balor", "Clay Golem", "Deva", "Tarrasque"]) {
      expect(advantages(byName(name), "Magic Resistance"), name).toEqual([{ kind: "save-advantage", against: { source: "magical" } }]);
    }
  });

  it("condition traits are scoped to their conditions", () => {
    expect(advantages(byName("Knight"), "Brave")[0]?.against?.conditions).toEqual(["frightened"]);
    expect(advantages(byName("Cultist"), "Dark Devotion")[0]?.against?.conditions).toEqual(["charmed", "frightened"]);
    expect(advantages(byName("Drow"), "Fey Ancestry")[0]?.against?.conditions).toEqual(["charmed"]);
    expect(advantages(byName("Mule"), "Sure-Footed")[0]).toMatchObject({ abilities: ["str", "dex"], against: { conditions: ["prone"] } });
    expect(advantages(byName("Ettin"), "Two Heads")[0]?.against?.conditions).toHaveLength(6);
    expect(advantages(byName("Deep Gnome (Svirfneblin)"), "Gnome Cunning")[0]).toMatchObject({ abilities: ["int", "wis", "cha"], against: { source: "magical" } });
  });

  it("the parts that can't be modelled keep the trait 'partial'", () => {
    expect(byName("Drow").traits?.find((entry) => entry.name === "Fey Ancestry")?.automationSupport).toBe("partial");
    expect(byName("Duergar").traits?.find((entry) => entry.name === "Duergar Resilience")?.automationSupport).toBe("partial");
    expect(byName("Knight").traits?.find((entry) => entry.name === "Brave")?.automationSupport).toBe("full");
  });

  it("actions whose text calls them magic are flagged; breath and claws are not", () => {
    const magical = (monster: string, action: string) => (byName(monster).actions.find((entry) => entry.name === action) as { magical?: boolean } | undefined)?.magical === true;
    expect(magical("Mummy", "Dreadful Glare")).toBe(true);
    expect(magical("Dryad", "Fey Charm")).toBe(true);
    expect(magical("Cockatrice", "Bite")).toBe(true);
    expect(magical("Adult Red Dragon", "Fire Breath")).toBe(false);
    expect(magical("Adult Red Dragon", "Frightful Presence")).toBe(false);
  });
});

describe("in play", () => {
  const advantageOn = (defender: CreatureDefinition, attacker: CreatureDefinition, actionId: string) => {
    const token = (id: string, definition: CreatureDefinition, faction: "party" | "enemy", x: number): CombatantState => ({
      id, definitionId: definition.id, displayName: id, faction, position: { x, y: 4 }, currentHp: definition.maxHp, tempHp: 0,
      state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced",
      resources: definition.resources ? { ...definition.resources } : undefined
    });
    const base = structuredClone(sampleEncounter);
    const scene: EncounterSnapshot = {
      ...base, seed: "real", rules: { ...base.rules, requireLineOfEffect: false }, map: { ...base.map, walls: [], terrain: [] },
      definitions: [defender, attacker], combatants: [token("defender", defender, "party", 4), token("attacker", attacker, "enemy", 5)]
    };
    const state = createEngineState(scene);
    const action = attacker.actions.find((entry) => entry.id === actionId)!;
    if (action.kind === "area-save") resolveAreaSaveAction(state, "attacker", { x: 4, y: 4 }, actionId);
    else resolveSaveAction(state, "attacker", "defender", actionId);
    const rolls = state.log.filter((entry) => entry.type === "SaveRolled");
    return (rolls[rolls.length - 1]?.data?.appliedSaveEffects as string[] | undefined) ?? [];
  };

  it("a Mummy's Dreadful Glare is 'against this magic', so a Balor's Magic Resistance applies; a Dragon's breath isn't", () => {
    const mummy = byName("Mummy");
    const glare = mummy.actions.find((action) => action.name === "Dreadful Glare")!;
    expect(advantageOn(byName("Balor"), mummy, glare.id)).toContain("Magic Resistance");
    const dragon = byName("Adult Red Dragon");
    const breath = dragon.actions.find((action) => action.name === "Fire Breath")!;
    expect(advantageOn(byName("Balor"), dragon, breath.id)).not.toContain("Magic Resistance");
  });

  it("Brave and Fey Ancestry apply to the matching condition only", () => {
    const glare = byName("Mummy").actions.find((action) => action.name === "Dreadful Glare")!; // frightens
    expect(advantageOn(byName("Knight"), byName("Mummy"), glare.id)).toContain("Brave");
    expect(advantageOn(byName("Drow"), byName("Mummy"), glare.id)).not.toContain("Fey Ancestry");
    const charm = byName("Dryad").actions.find((action) => action.name === "Fey Charm")!;
    expect(advantageOn(byName("Drow"), byName("Dryad"), charm.id)).toContain("Fey Ancestry");
    expect(advantageOn(byName("Knight"), byName("Dryad"), charm.id)).not.toContain("Brave");
  });
});
