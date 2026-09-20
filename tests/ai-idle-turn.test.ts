import { describe, expect, it } from "vitest";
import { explainIdleTurn, runAutomatedEncounter, sampleEncounter, type CombatantState, type CreatureDefinition, type EncounterSnapshot } from "@/engine";

/**
 * When the AI finds nothing to do, only a genuine automation gap is a *warning*. Everything else — nobody
 * active left to attack, a spent resource, no one reachable — is an ordinary tactical situation and is logged as
 * an AI decision instead. The old message, "<actor> has no fully automated action", fired for all of them; in
 * practice almost always because only downed characters were left, so a creature with perfectly good attacks
 * looked like it lacked automation.
 */
const fighter = sampleEncounter.definitions.find((definition) => definition.id === "def-fighter")!;

function combatant(id: string, definition: CreatureDefinition, faction: "party" | "enemy", x: number, y: number, extra: Partial<CombatantState> = {}): CombatantState {
  return {
    id, definitionId: definition.id, displayName: id, faction, position: { x, y }, currentHp: definition.maxHp, tempHp: 0,
    state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced", ...extra
  };
}

function scene(definitions: CreatureDefinition[], combatants: CombatantState[]): EncounterSnapshot {
  const base = structuredClone(sampleEncounter);
  return { ...base, seed: "idle-turn", map: { ...base.map, walls: [], terrain: [] }, definitions, combatants };
}

const goblin: CreatureDefinition = {
  id: "def-goblin-idle", name: "Goblin", size: "small", armorClass: 13, maxHp: 20, speed: 30,
  abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
  actions: [{ kind: "attack", id: "scimitar", name: "Scimitar", actionType: "action", attackType: "melee", ability: "dex", attackBonus: 20, range: 5, reach: 5, damage: [{ dice: "1d6", damageType: "slashing", abilityModifier: "dex" }], automationSupport: "full" }]
};

const decisions = (log: { type: string; message: string; data?: Record<string, unknown> }[], reason: string) =>
  log.filter((entry) => entry.type === "AiDecision" && entry.data?.reason === reason);

describe("explainIdleTurn", () => {
  const target = combatant("Fighter", fighter, "party", 6, 4);

  it("a creature with no fully automated attack has a real automation gap", () => {
    const manual: CreatureDefinition = { ...goblin, id: "def-manual", actions: [{ kind: "unsupported", id: "x", name: "X", actionType: "action", automationSupport: "unsupported" }] };
    const actor = combatant("Manual", manual, "enemy", 2, 4);
    expect(explainIdleTurn(scene([fighter, manual], [target, actor]), actor).reason).toBe("no-automated-action");
  });

  it("nothing but non-offensive actions is also a gap", () => {
    const utilityOnly: CreatureDefinition = { ...goblin, id: "def-util", actions: [] };
    const actor = combatant("Util", utilityOnly, "enemy", 2, 4);
    expect(explainIdleTurn(scene([fighter, utilityOnly], [target, actor]), actor).reason).toBe("no-automated-action");
  });

  it("a spent resource is out-of-resources, not a gap", () => {
    const limited: CreatureDefinition = { ...goblin, id: "def-limited", actions: [{ ...goblin.actions[0]!, id: "zap", resourceCost: { resourceId: "charge", amount: 1 } } as CreatureDefinition["actions"][number]] };
    const spent = combatant("Spent", limited, "enemy", 2, 4, { resources: { charge: 0 } });
    const ready = combatant("Ready", limited, "enemy", 3, 4, { resources: { charge: 1 } });
    const snapshot = scene([fighter, limited], [target, spent, ready]);
    expect(explainIdleTurn(snapshot, spent).reason).toBe("out-of-resources");
    // With the resource available the creature isn't out of anything (so it's about reach/targets instead).
    expect(explainIdleTurn(snapshot, ready).reason).toBe("no-reachable-target");
  });

  it("no active enemy left is no-enemies, and a downed one doesn't count as active", () => {
    const actor = combatant("Goblin", goblin, "enemy", 2, 4);
    expect(explainIdleTurn(scene([fighter, goblin], [{ ...target, state: "downed", currentHp: 0 }, actor]), actor).reason).toBe("no-enemies");
  });

  it("an active enemy that can't be acted on is no-reachable-target", () => {
    const actor = combatant("Goblin", goblin, "enemy", 2, 4);
    expect(explainIdleTurn(scene([fighter, goblin], [target, actor]), actor)).toMatchObject({ reason: "no-reachable-target", message: "couldn't reach or target anyone this turn" });
  });
});

describe("a turn with nothing to do, in a fight", () => {
  it("creatures with good attacks aren't warned about once only downed characters remain", () => {
    // A 1-HP fighter is dropped by the first goblin; the other goblins then have no active target.
    const frail: CreatureDefinition = { ...fighter, id: "def-frail", maxHp: 1 };
    const goblins = [combatant("G1", goblin, "enemy", 2, 4), combatant("G2", goblin, "enemy", 2, 3), combatant("G3", goblin, "enemy", 2, 5)];
    const result = runAutomatedEncounter(scene([frail, goblin], [combatant("Fighter", frail, "party", 1, 4), ...goblins]), 4);

    expect(result.outcome.warnings.filter((warning) => /no fully automated action/.test(warning))).toEqual([]);
    expect(result.log.filter((entry) => entry.type === "AutomationWarning" && /no fully automated action/.test(entry.message))).toEqual([]);
    const idle = decisions(result.log, "no-enemies");
    expect(idle.length).toBeGreaterThan(0);
    expect(idle.every((entry) => /^G[123] has no enemies left to act against$/.test(entry.message))).toBe(true);
  });

  it("a creature with no fully automated action still gets the automation warning", () => {
    const unsupported: CreatureDefinition = {
      ...goblin, id: "def-manual2", name: "Manual Thing",
      actions: [{ kind: "unsupported", id: "mystery", name: "Mystery", description: "Something the engine can't run.", actionType: "action", automationSupport: "unsupported" }]
    };
    const result = runAutomatedEncounter(scene([fighter, unsupported], [combatant("Fighter", fighter, "party", 3, 4), combatant("Manual", unsupported, "enemy", 4, 4)]), 2);
    expect(result.outcome.warnings).toContain("Manual has no fully automated action");
    expect(result.log.some((entry) => entry.type === "AutomationWarning" && entry.message === "Manual has no fully automated action")).toBe(true);
  });

  it("a creature that has spent everything it can use is a decision, not a warning", () => {
    const limited: CreatureDefinition = {
      ...goblin, id: "def-limited2", name: "One-Shot", maxHp: 400, armorClass: 30, resources: { charge: 1 },
      actions: [{ ...goblin.actions[0]!, id: "zap", name: "Zap", resourceCost: { resourceId: "charge", amount: 1 } } as CreatureDefinition["actions"][number]]
    };
    const tank: CreatureDefinition = { ...fighter, id: "def-tank", name: "Tank", maxHp: 400, armorClass: 10 };
    const result = runAutomatedEncounter(scene([tank, limited], [combatant("Tank", tank, "party", 4, 4), combatant("OneShot", limited, "enemy", 5, 4, { resources: { charge: 1 } })]), 4);

    const zaps = result.log.filter((entry) => entry.type === "ActionDeclared" && entry.data?.actorId === "OneShot" && entry.data?.actionName === "Zap");
    expect(zaps).toHaveLength(1); // spent on the first turn
    expect(result.outcome.warnings.filter((warning) => /OneShot/.test(warning))).toEqual([]);
    expect(decisions(result.log, "out-of-resources").length).toBeGreaterThan(0);
  });

  it("the original crowded-map scenario is silent: no 'no fully automated action' at all", () => {
    // Twelve goblins against the sample fighter and archer on the default map — 20 of 20 runs used to warn.
    const base = structuredClone(sampleEncounter);
    const sampleGoblin = base.definitions.find((definition) => definition.id === "def-goblin")!;
    const crowd = Array.from({ length: 12 }, (_, i) => combatant(`Gob${i}`, sampleGoblin, "enemy", 6 + (i % 6), Math.floor(i / 6) * 3 + 1));
    base.combatants = [...base.combatants.filter((entry) => entry.faction === "party"), ...crowd];
    for (let seed = 0; seed < 5; seed += 1) {
      const result = runAutomatedEncounter({ ...base, seed: `crowd-${seed}` }, 50);
      expect(result.outcome.warnings.filter((warning) => /no fully automated action/.test(warning)), `seed ${seed}`).toEqual([]);
    }
  });
});
