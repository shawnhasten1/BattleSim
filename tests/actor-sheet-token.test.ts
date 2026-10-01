import { describe, expect, it } from "vitest";
import { sampleEncounter, type BuffActionDefinition, type CombatantState, type CreatureDefinition } from "@/engine";
import { loadSrdMonster } from "@/data/srd/monsters";
import { appearanceLine, fightLine, statusLine, tacticsLine } from "@/lib/actor-sheet/summaries";
import { imageSource, isSurprised, prepBuffs } from "@/lib/actor-sheet/token";

/** The actor sheet plan's Phase 4: the Token tab's folded lines, and the helpers its rows share with the Combat panel. */

const goblin = () => structuredClone(sampleEncounter.definitions.find((definition) => definition.id === "def-goblin")!);
const goblinToken = () => structuredClone(sampleEncounter.combatants.find((combatant) => combatant.id === "enemy-goblin-2")!);

const mageArmor: BuffActionDefinition = {
  kind: "buff",
  id: "mage-armor",
  name: "Mage Armor",
  actionType: "action",
  range: 5,
  targeting: { target: "single" },
  prepOnly: true,
  appliedCondition: { name: "custom", durationRounds: 100, modifiers: { armorClass: 3 } },
  resourceCost: { resourceId: "slot-1", amount: 1 },
  automationSupport: "full"
};

describe("the buffs cast before a fight", () => {
  it("are the creature's prepOnly buffs, up when their condition is on the token, affordable with a slot left", async () => {
    const mage = (await loadSrdMonster("srd:monster:mage"))!;
    const token = { conditions: [], resources: { "slot-1": 4 } } as Pick<CombatantState, "conditions" | "resources">;
    expect(prepBuffs(mage, token).map(({ action, active, affordable }) => [action.name, active, affordable])).toEqual([["Mage Armor", false, true]]);
    const up = { conditions: [{ id: "mage:spell:mage-armor:action", name: "custom" as const, startedRound: 0 }], resources: { "slot-1": 0 } };
    expect(prepBuffs(mage, up).map(({ active, affordable }) => [active, affordable])).toEqual([[true, false]]);
    expect(prepBuffs(goblin(), goblinToken())).toEqual([]);
  });
});

describe("the Token tab's folded lines", () => {
  it("This fight: on the board, or arriving later, and what's set for it", () => {
    const definition: CreatureDefinition = { ...goblin(), actions: [...goblin().actions, mageArmor], lairActions: [{ ...mageArmor, id: "lair" }] };
    const token = goblinToken();
    expect(fightLine(definition, token)).toBe("on the board");
    const set: CombatantState = {
      ...token,
      state: "reserve",
      arrivesRound: 3,
      conditions: [{ id: "surprised", name: "surprised", startedRound: 0 }, { id: "mage-armor", name: "custom", startedRound: 0 }],
      altitude: 30,
      inLair: true
    };
    expect(isSurprised(set)).toBe(true);
    expect(fightLine(definition, set)).toBe("arrives round 3 · surprised · Mage Armor up · 30 ft in the air · in its lair");
    // In its lair only counts for a creature with lair actions.
    expect(fightLine(goblin(), { ...token, inLair: true })).toBe("on the board");
  });

  it("Tactics: profile, spending, and how enemies pick it", () => {
    const token = goblinToken();
    expect(tacticsLine(token)).toBe("Basic melee · Balanced · targeted normally");
    expect(tacticsLine({ ...token, tags: ["high-priority"] })).toBe("Basic melee · Balanced · targeted first");
    expect(tacticsLine({ ...token, resourceStance: "liberal", tags: ["low-priority", "protected"] })).toBe("Basic melee · Liberal · targeted last · protected");
    expect(tacticsLine({ ...token, tags: ["high-priority", "low-priority"] })).toBe("Basic melee · Balanced · both target priorities set");
  });

  it("Appearance: where its image comes from, its border, and what only changes an image", () => {
    const definition = goblin();
    const token = goblinToken();
    expect(imageSource(definition, token)).toBeUndefined();
    expect(appearanceLine(definition, { ...token, tokenVisuals: { scale: 1.2, tint: "#ff0000", showNameplate: true } }))
      .toBe("initials · white border · nameplate");
    const shared = { ...definition, tokenVisuals: { imageUrl: "data:image/png;base64,AA" } };
    expect(imageSource(shared, token)).toBe("creature");
    expect(appearanceLine(shared, token)).toBe("image (every Imported Goblin Stand-in) · white border");
    const own = { ...token, tokenVisuals: { imageUrl: "data:image/png;base64,BB", borderColor: "#aa0000", scale: 1.2, tint: "#ff0000" } };
    expect(imageSource(shared, own)).toBe("token");
    expect(appearanceLine(shared, own)).toBe("image (this token) · custom border · image at 120% · glow");
  });

  it("Status & position: its state and square", () => {
    const token = goblinToken();
    expect(statusLine(token)).toBe("Active · square 8, 5");
    expect(statusLine({ ...token, state: "fled" })).toBe("Fled · square 8, 5");
    expect(statusLine({ ...token, state: "reserve", arrivesRound: 2 })).toBe("Arrives round 2 · square 8, 5");
  });
});
