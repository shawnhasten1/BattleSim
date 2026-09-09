import { describe, expect, it } from "vitest";
import { runAutomatedEncounter, sampleEncounter } from "@/engine";
import type { CombatantState, EncounterSnapshot } from "@/engine";
import { clampReplayIndex, describeEvent, dwellForEvent, replayTo } from "@/lib/replay";

function boardSignature(snapshot: EncounterSnapshot) {
  return {
    round: snapshot.round,
    turnIndex: snapshot.turnIndex,
    combatants: [...snapshot.combatants]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((combatant: CombatantState) => ({
        id: combatant.id,
        position: combatant.position,
        currentHp: combatant.currentHp,
        tempHp: combatant.tempHp,
        state: combatant.state,
        deathSaves: combatant.deathSaves ?? null,
        conditions: (combatant.conditions ?? []).map((condition) => condition.id).sort()
      }))
  };
}

describe("replayTo", () => {
  it("folds the full event log back to the engine's final snapshot", () => {
    const base = structuredClone(sampleEncounter);
    const result = runAutomatedEncounter(structuredClone(sampleEncounter), 50);

    const replayed = replayTo(base, result.log, result.log.length);

    expect(boardSignature(replayed)).toEqual(boardSignature(result.snapshot));
  });

  it("is a pure function of (base, log, index) — repeated calls match", () => {
    const base = structuredClone(sampleEncounter);
    const result = runAutomatedEncounter(structuredClone(sampleEncounter), 50);

    const mid = Math.floor(result.log.length / 2);
    const first = replayTo(base, result.log, mid);
    const second = replayTo(base, result.log, mid);

    expect(boardSignature(first)).toEqual(boardSignature(second));
    // base is never mutated
    expect(base).toEqual(sampleEncounter);
  });

  it("index 0 is the untouched pre-run board in its original order", () => {
    const base = structuredClone(sampleEncounter);
    const result = runAutomatedEncounter(structuredClone(sampleEncounter), 50);

    const atStart = replayTo(base, result.log, 0);

    expect(atStart.combatants.map((c) => c.id)).toEqual(sampleEncounter.combatants.map((c) => c.id));
    expect(atStart.round).toBe(sampleEncounter.round);
  });

  it("re-orders combatants to initiative order once InitiativeRolled is applied", () => {
    const base = structuredClone(sampleEncounter);
    const result = runAutomatedEncounter(structuredClone(sampleEncounter), 50);
    const initiativeAt = result.log.findIndex((entry) => entry.type === "InitiativeRolled");
    expect(initiativeAt).toBeGreaterThanOrEqual(0);

    const afterInitiative = replayTo(base, result.log, initiativeAt + 1);
    const order = result.log[initiativeAt]?.data?.order as string[];

    expect(afterInitiative.combatants.map((c) => c.id)).toEqual(order);
    expect(afterInitiative.combatants.every((c) => typeof c.initiative === "number")).toBe(true);
  });

  it("HP only ever moves as the log dictates, monotonic frame-to-frame", () => {
    const base = structuredClone(sampleEncounter);
    const result = runAutomatedEncounter(structuredClone(sampleEncounter), 50);

    let previous = replayTo(base, result.log, 0);
    for (let index = 1; index <= result.log.length; index += 1) {
      const next = replayTo(base, result.log, index);
      const entry = result.log[index - 1];
      if (entry.type !== "DamageApplied" && entry.type !== "HealingApplied") {
        for (const combatant of next.combatants) {
          const before = previous.combatants.find((c) => c.id === combatant.id);
          expect(combatant.currentHp).toBe(before?.currentHp);
        }
      }
      previous = next;
    }
  });
});

describe("replay helpers", () => {
  it("clampReplayIndex keeps the cursor inside [0, logLength]", () => {
    expect(clampReplayIndex(-5, 10)).toBe(0);
    expect(clampReplayIndex(4.6, 10)).toBe(5);
    expect(clampReplayIndex(999, 10)).toBe(10);
    expect(clampReplayIndex(Number.NaN, 10)).toBe(0);
  });

  it("dwellForEvent gives decisions and deaths more time than bookkeeping", () => {
    const decision = dwellForEvent({ type: "AiDecision" } as never);
    const bookkeeping = dwellForEvent({ type: "ConcentrationChecked" } as never);
    expect(decision).toBeGreaterThan(bookkeeping);
    expect(dwellForEvent(undefined)).toBe(0);
  });

  it("describeEvent prefers the event message, falls back to a phrase", () => {
    expect(describeEvent(undefined)).toBe("Encounter start");
    expect(describeEvent({ type: "AiDecision", message: "Goblin chose Scimitar" } as never)).toBe("Goblin chose Scimitar");
    expect(describeEvent({ type: "ConditionExpired", message: "", data: { condition: { name: "prone" } } } as never)).toBe("Lost prone");
  });
});
