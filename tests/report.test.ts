import { describe, expect, it } from "vitest";
import { buildBattleReport, formatResourceId, runAutomatedEncounter, sampleEncounter } from "@/engine";
import type { CombatLogEvent } from "@/engine";

let seq = 0;
function ev(type: CombatLogEvent["type"], data: Record<string, unknown>, round = 1): CombatLogEvent {
  seq += 1;
  return { id: `${type}-${seq}`, round, turnIndex: 0, type, message: `${type}`, data };
}

function reportFrom(log: CombatLogEvent[]) {
  return buildBattleReport(structuredClone(sampleEncounter), log);
}

describe("formatResourceId", () => {
  it("labels spell slots and kebab ids", () => {
    expect(formatResourceId("slot-1")).toBe("L1 slot");
    expect(formatResourceId("slot-3")).toBe("L3 slot");
    expect(formatResourceId("action-surge")).toBe("Action Surge");
    expect(formatResourceId("ki")).toBe("Ki");
    expect(formatResourceId("longsword-1:charge")).toBe("Charge");
  });
});

describe("buildBattleReport — hand-built log", () => {
  const log: CombatLogEvent[] = [
    ev("AttackRolled", { attackerId: "pc-fighter", targetId: "enemy-goblin-1", hit: true, critical: false, damageApplied: 6 }),
    ev("DamageApplied", { targetId: "enemy-goblin-1", sourceId: "pc-fighter", totalApplied: 6, currentHp: 1 }),
    ev("AttackRolled", { attackerId: "pc-archer", targetId: "enemy-goblin-2", hit: false }),
    ev("AttackRolled", { attackerId: "pc-fighter", targetId: "enemy-goblin-2", hit: true, critical: true, damageApplied: 12 }),
    ev("SaveRolled", { attackerId: "pc-archer", targetId: "enemy-goblin-1", success: true, damageApplied: 3 }),
    ev("SaveRolled", { attackerId: "pc-archer", targetId: "enemy-goblin-2", success: false, damageApplied: 7 }),
    ev("AreaSaveResolved", {
      attackerId: "pc-fighter",
      targets: [
        { targetId: "enemy-goblin-1", success: false, damageApplied: 8 },
        { targetId: "enemy-goblin-2", success: true, damageApplied: 4 }
      ]
    }),
    ev("HealingApplied", { healerId: "pc-archer", targetId: "pc-fighter", healingApplied: 5, currentHp: 32 }),
    ev("ActionDeclared", { actorId: "pc-archer", resourceCost: { resourceId: "slot-1", amount: 1 } }),
    ev("ActionDeclared", { actorId: "pc-archer", resourceCost: { resourceId: "slot-1", amount: 1 } }),
    ev("ActionDeclared", { actorId: "pc-archer", resourceCost: { resourceId: "slot-2", amount: 1 } }),
    ev("ConditionApplied", { targetId: "enemy-goblin-1", condition: { name: "prone" } }),
    ev("OpportunityAttackTriggered", { reactorId: "pc-fighter" }),
    ev("ReactionTriggered", { reactorId: "pc-archer" }),
    ev("CombatantDowned", { combatantId: "pc-fighter", killerId: "enemy-goblin-2" }, 2),
    ev("CombatantDefeated", { combatantId: "enemy-goblin-1", killerId: "pc-fighter" }, 2),
    ev("CombatantDied", { combatantId: "pc-fighter" }, 3),
    ev("AutomationWarning", { actionId: "x" }),
    ev("CombatEnded", { winner: "party", rounds: 3 }, 3)
  ];
  log[log.length - 2].message = "Lair action unsupported";

  const report = reportFrom(log);
  const byId = Object.fromEntries(report.actors.map((a) => [a.combatantId, a]));

  it("tallies the attacker's offense", () => {
    const fighter = byId["pc-fighter"];
    expect(fighter.attacksMade).toBe(2);
    expect(fighter.attacksHit).toBe(2);
    expect(fighter.attacksMissed).toBe(0);
    expect(fighter.criticalHits).toBe(1);
    // 6 (attack) + 12 (crit) + 8 (area, goblin-1) + 4 (area, goblin-2)
    expect(fighter.damageDealt).toBe(30);
    expect(fighter.savesForced).toBe(2);
    expect(fighter.savesForcedFailed).toBe(1);
    expect(fighter.opportunityAttacks).toBe(1);
  });

  it("tallies misses and forced saves for the archer", () => {
    const archer = byId["pc-archer"];
    expect(archer.attacksMade).toBe(1);
    expect(archer.attacksMissed).toBe(1);
    expect(archer.savesForced).toBe(2);
    expect(archer.savesForcedFailed).toBe(1);
    expect(archer.damageDealt).toBe(10); // 3 + 7 from SaveRolled
    expect(archer.healingGiven).toBe(5);
    expect(archer.reactionsUsed).toBe(1);
  });

  it("tallies defense, saves rolled, and conditions on the target", () => {
    const goblin1 = byId["enemy-goblin-1"];
    expect(goblin1.damageTaken).toBe(6);
    expect(goblin1.endingHp).toBe(1);
    expect(goblin1.attacksAgainst).toBe(1);
    expect(goblin1.hitsAgainst).toBe(1);
    expect(goblin1.savesRolled).toBe(2); // one SaveRolled + one AreaSaveResolved entry
    expect(goblin1.savesMade).toBe(1);
    expect(goblin1.savesFailed).toBe(1);
    expect(goblin1.conditionsSuffered).toEqual(["prone"]);
    expect(goblin1.finalState).toBe("defeated");
    expect(goblin1.defeatedOnRound).toBe(2);
  });

  it("attributes killing blows and downs", () => {
    expect(byId["pc-fighter"].killingBlows).toBe(1);
    expect(byId["enemy-goblin-2"].killingBlows).toBe(1);
    expect(byId["pc-fighter"].timesDowned).toBe(1);
    expect(byId["pc-fighter"].died).toBe(true);
    expect(byId["pc-fighter"].finalState).toBe("dead");
    expect(byId["pc-fighter"].defeatedOnRound).toBe(2);
  });

  it("aggregates resource spend with readable labels", () => {
    const archer = byId["pc-archer"];
    expect(archer.resourcesSpent).toEqual([
      { resourceId: "slot-1", label: "L1 slot", amount: 2 },
      { resourceId: "slot-2", label: "L2 slot", amount: 1 }
    ]);
    expect(archer.totalResourcePoints).toBe(3);
  });

  it("captures outcome, warnings, and faction totals", () => {
    expect(report.winner).toBe("party");
    expect(report.rounds).toBe(3);
    expect(report.completed).toBe(true);
    expect(report.warnings).toEqual(["Lair action unsupported"]);
    expect(report.factionTotals.party.killingBlows).toBe(1);
    expect(report.factionTotals.enemy.killingBlows).toBe(1);
    expect(report.factionTotals.party.downs).toBe(1);
    expect(report.factionTotals.party.deaths).toBe(1);
  });

  it("returns actors in roster order", () => {
    expect(report.actors.map((a) => a.combatantId)).toEqual([
      "pc-fighter",
      "pc-archer",
      "enemy-goblin-1",
      "enemy-goblin-2"
    ]);
  });
});

describe("buildBattleReport — integration with a full auto run", () => {
  const result = runAutomatedEncounter(structuredClone(sampleEncounter), 50);
  const report = buildBattleReport(structuredClone(sampleEncounter), result.log);

  it("matches the run outcome", () => {
    expect(report.winner).toBe(result.outcome.winner);
    expect(report.rounds).toBe(result.outcome.rounds);
  });

  it("keeps hit + miss consistent with attacks made", () => {
    for (const actor of report.actors) {
      expect(actor.attacksHit + actor.attacksMissed).toBe(actor.attacksMade);
    }
  });

  it("reconciles damage dealt against damage taken", () => {
    const dealt = report.actors.reduce((sum, a) => sum + a.damageDealt, 0);
    const taken = report.actors.reduce((sum, a) => sum + a.damageTaken, 0);
    expect(dealt).toBe(taken);
  });

  it("attributes every killing blow that carries a killer id", () => {
    const killerEvents = result.log.filter(
      (e) => (e.type === "CombatantDowned" || e.type === "CombatantDefeated") && typeof e.data?.killerId === "string"
    ).length;
    const killingBlows = report.actors.reduce((sum, a) => sum + a.killingBlows, 0);
    expect(killingBlows).toBe(killerEvents);
    expect(killingBlows).toBeGreaterThan(0);
  });
});
