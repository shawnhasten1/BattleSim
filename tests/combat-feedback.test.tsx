// @vitest-environment happy-dom
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { sampleEncounter, type CombatLogEvent } from "@/engine";
import { areaFlashForEvent, combatTextForEvent, hpTone, selectStepBatchCues } from "@/lib/combatFeedback";
import { TokenHealthBar } from "@/components/scene/TokenHealthBar";

afterEach(() => {
  document.body.innerHTML = "";
});

function ev(type: CombatLogEvent["type"], data: Record<string, unknown>): CombatLogEvent {
  return { id: `${type}-1`, round: 1, turnIndex: 0, type, message: "", data };
}

function evId(id: string, type: CombatLogEvent["type"], data: Record<string, unknown> = {}): CombatLogEvent {
  return { id, round: 1, turnIndex: 0, type, message: "", data };
}

describe("hpTone", () => {
  it("bands the ratio green / amber / red", () => {
    expect(hpTone(1)).toBe("high");
    expect(hpTone(0.61)).toBe("high");
    expect(hpTone(0.6)).toBe("mid");
    expect(hpTone(0.31)).toBe("mid");
    expect(hpTone(0.3)).toBe("low");
    expect(hpTone(0)).toBe("low");
  });

  it("treats any non-finite ratio as critical", () => {
    expect(hpTone(Number.NaN)).toBe("low");
    expect(hpTone(Number.POSITIVE_INFINITY)).toBe("low");
  });
});

describe("combatTextForEvent", () => {
  it("raises a cue for notable actions only", () => {
    expect(combatTextForEvent(ev("ActionDeclared", { actorId: "a1", actionName: "Fireball", actionKind: "area-save" })))
      .toEqual({ anchorId: "a1", text: "Fireball", kind: "action" });
    expect(combatTextForEvent(ev("ActionDeclared", { actorId: "a1", actionName: "Second Wind", actionKind: "attack", resourceCost: { resourceId: "sw", amount: 1 } })))
      .toEqual({ anchorId: "a1", text: "Second Wind", kind: "action" });
    // plain weapon swing → nothing
    expect(combatTextForEvent(ev("ActionDeclared", { actorId: "a1", actionName: "Longsword", actionKind: "attack" })))
      .toBeNull();
  });

  it("labels an off-turn reaction attack (opportunity attack) even though it is a plain attack", () => {
    expect(combatTextForEvent(ev("ActionDeclared", { actorId: "golem", actionName: "Slam", actionKind: "attack", actionType: "reaction" })))
      .toEqual({ anchorId: "golem", text: "Slam", kind: "reaction" });
    // a normal-turn swing of the same attack still stays silent
    expect(combatTextForEvent(ev("ActionDeclared", { actorId: "golem", actionName: "Slam", actionKind: "attack", actionType: "action" })))
      .toBeNull();
  });

  it("formats damage and healing on the target, skipping zeroes", () => {
    expect(combatTextForEvent(ev("DamageApplied", { targetId: "t1", totalApplied: 7 })))
      .toEqual({ anchorId: "t1", text: "-7", kind: "damage" });
    expect(combatTextForEvent(ev("HealingApplied", { targetId: "t1", healingApplied: 5 })))
      .toEqual({ anchorId: "t1", text: "+5", kind: "heal" });
    expect(combatTextForEvent(ev("DamageApplied", { targetId: "t1", totalApplied: 0 }))).toBeNull();
    expect(combatTextForEvent(ev("HealingApplied", { targetId: "t1", healingApplied: 0 }))).toBeNull();
  });

  it("ignores events with no anchor id and unrelated types", () => {
    expect(combatTextForEvent(ev("DamageApplied", { totalApplied: 7 }))).toBeNull();
    expect(combatTextForEvent(ev("CombatantMoved", { combatantId: "c1" }))).toBeNull();
    expect(combatTextForEvent(ev("TurnStarted", { combatantId: "c1" }))).toBeNull();
  });

  function attackRolled(overrides: Record<string, unknown>) {
    return ev("AttackRolled", {
      targetId: "t1",
      attackRoll: { expression: "1d20", rolls: [{ sides: 20, value: 17, sign: 1 }], modifier: 0, total: 17 },
      total: 22,
      targetAc: 15,
      hit: true,
      critical: false,
      ...overrides
    });
  }

  it("formats an attack roll vs AC, labeling hit / crit / miss", () => {
    expect(combatTextForEvent(attackRolled({}))).toEqual({ anchorId: "t1", text: "17 + 5 = 22 vs AC 15 — HIT", kind: "attack-hit" });

    expect(combatTextForEvent(attackRolled({
      attackRoll: { expression: "1d20", rolls: [{ sides: 20, value: 20, sign: 1 }], modifier: 0, total: 20 },
      total: 25, hit: true, critical: true
    }))).toEqual({ anchorId: "t1", text: "20 + 5 = 25 vs AC 15 — CRIT!", kind: "attack-crit" });

    // natural 1 always misses (5e auto-fail) — called out distinctly from an ordinary low roll
    expect(combatTextForEvent(attackRolled({
      attackRoll: { expression: "1d20", rolls: [{ sides: 20, value: 1, sign: 1 }], modifier: 0, total: 1 },
      total: 6, hit: false, critical: false
    }))).toEqual({ anchorId: "t1", text: "1 + 5 = 6 vs AC 15 — MISS (1)", kind: "attack-miss" });

    expect(combatTextForEvent(attackRolled({
      attackRoll: { expression: "1d20", rolls: [{ sides: 20, value: 10, sign: 1 }], modifier: 0, total: 10 },
      total: 15, targetAc: 18, hit: false, critical: false
    }))).toEqual({ anchorId: "t1", text: "10 + 5 = 15 vs AC 18 — MISS", kind: "attack-miss" });
  });

  it("omits the modifier when the roll had none, and skips auto-hit / malformed attack events", () => {
    expect(combatTextForEvent(attackRolled({
      attackRoll: { expression: "1d20", rolls: [{ sides: 20, value: 17, sign: 1 }], modifier: 0, total: 17 },
      total: 17
    }))).toEqual({ anchorId: "t1", text: "17 vs AC 15 — HIT", kind: "attack-hit" });

    expect(combatTextForEvent(ev("AttackRolled", { targetId: "t1", autoHit: true, hit: true, critical: false }))).toBeNull();
    expect(combatTextForEvent(ev("AttackRolled", { targetId: "t1" }))).toBeNull();
  });

  it("formats a saving throw vs DC, labeling save / fail", () => {
    const saveRoll = { expression: "1d20+5", rolls: [{ sides: 20, value: 13, sign: 1 }], modifier: 5, total: 18 };
    expect(combatTextForEvent(ev("SaveRolled", { targetId: "t1", saveRoll, total: 18, dc: 15, success: true })))
      .toEqual({ anchorId: "t1", text: "13 + 5 = 18 vs DC 15 — SAVE", kind: "save-pass" });
    expect(combatTextForEvent(ev("SaveRolled", { targetId: "t1", saveRoll, total: 18, dc: 20, success: false })))
      .toEqual({ anchorId: "t1", text: "13 + 5 = 18 vs DC 20 — FAIL", kind: "save-fail" });
    expect(combatTextForEvent(ev("SaveRolled", { targetId: "t1" }))).toBeNull();
  });
});

describe("selectStepBatchCues", () => {
  it("never drops an ActionDeclared even when the cap would otherwise trim it away", () => {
    // A 4-target spell: 1 declare + (save, damage) per target = 9 cue-worthy
    // events, well past a cap of 6. The declare is the oldest event, so a
    // naive "keep the last N" would drop exactly the one cue that announces
    // what's happening.
    const turn = [
      evId("d1", "ActionDeclared", { actorId: "caster", actionName: "Fireball", actionKind: "area-save" }),
      evId("s1", "SaveRolled", { targetId: "t1" }),
      evId("dmg1", "DamageApplied", { targetId: "t1", totalApplied: 9 }),
      evId("s2", "SaveRolled", { targetId: "t2" }),
      evId("dmg2", "DamageApplied", { targetId: "t2", totalApplied: 9 }),
      evId("s3", "SaveRolled", { targetId: "t3" }),
      evId("dmg3", "DamageApplied", { targetId: "t3", totalApplied: 9 }),
      evId("s4", "SaveRolled", { targetId: "t4" }),
      evId("dmg4", "DamageApplied", { targetId: "t4", totalApplied: 9 })
    ];
    const kept = selectStepBatchCues(turn, 6);
    // The declare survives, and the cap trims only the oldest non-declare
    // pair (t1's save + damage), keeping the most recent 6 of the rest —
    // both in original chronological order.
    expect(kept.map((event) => event.id)).toEqual(["d1", "s2", "dmg2", "s3", "dmg3", "s4", "dmg4"]);
  });

  it("keeps everything when the turn is within the cap", () => {
    const turn = [
      evId("d1", "ActionDeclared", { actorId: "a1", actionName: "Longsword", actionKind: "attack" }),
      evId("a1", "AttackRolled", { targetId: "t1" }),
      evId("dmg1", "DamageApplied", { targetId: "t1", totalApplied: 5 })
    ];
    expect(selectStepBatchCues(turn, 6).map((event) => event.id)).toEqual(["d1", "a1", "dmg1"]);
  });

  it("drops non-cue event types entirely, without counting them against the cap", () => {
    const turn = [
      evId("t1", "TurnStarted", { combatantId: "a1" }),
      evId("m1", "CombatantMoved", { combatantId: "a1" }),
      evId("ai1", "AiDecision", { actorId: "a1" }),
      evId("d1", "ActionDeclared", { actorId: "a1", actionName: "Fireball", actionKind: "area-save" }),
      evId("s1", "SaveRolled", { targetId: "t1" })
    ];
    expect(selectStepBatchCues(turn, 6).map((event) => event.id)).toEqual(["d1", "s1"]);
  });
});

describe("areaFlashForEvent", () => {
  const map = sampleEncounter.map; // 12 x 8, 5 ft / square

  it("resolves the covered cells and damage type for an area ActionDeclared", () => {
    const flash = areaFlashForEvent(
      ev("ActionDeclared", {
        actorId: "a1",
        actionKind: "area-save",
        origin: { x: 5, y: 4 },
        area: { type: "circle", size: 10 },
        damageType: "fire"
      }),
      map
    );
    expect(flash).not.toBeNull();
    expect(flash!.origin).toEqual({ x: 5, y: 4 });
    expect(flash!.damageType).toBe("fire");
    expect(flash!.cells.length).toBeGreaterThan(0);
    expect(flash!.cells).toContainEqual({ x: 5, y: 4 });
    expect(flash!.cells.every((c) => c.x >= 0 && c.x < 12 && c.y >= 0 && c.y < 8)).toBe(true);
  });

  it("honours cone direction", () => {
    const east = areaFlashForEvent(
      ev("ActionDeclared", { actorId: "a1", origin: { x: 2, y: 4 }, area: { type: "cone", size: 15, direction: "east" } }),
      map
    );
    const west = areaFlashForEvent(
      ev("ActionDeclared", { actorId: "a1", origin: { x: 2, y: 4 }, area: { type: "cone", size: 15, direction: "west" } }),
      map
    );
    expect(east!.cells.every((c) => c.x >= 2)).toBe(true);
    expect(west!.cells.every((c) => c.x <= 2)).toBe(true);
    expect(east!.cells).not.toEqual(west!.cells);
  });

  it("rotates the cone toward a stamped aim vector instead of the cardinal fallback", () => {
    const aimed = areaFlashForEvent(
      ev("ActionDeclared", {
        actorId: "a1",
        actionKind: "area-save",
        origin: { x: 5, y: 4 },
        area: { type: "cone", size: 20 },
        aimVector: { x: 0, y: 1 }
      }),
      map
    );
    // aimed straight down — every covered cell is at or below the origin row,
    // not the east-pointing default a bare `cone` template would give.
    expect(aimed!.cells.every((c) => c.y >= 4)).toBe(true);
    expect(aimed!.cells.some((c) => c.x < 5)).toBe(true);
    expect(aimed!.cells.some((c) => c.x > 5)).toBe(true);
  });

  it("treats an unresolved 'same-as-attack' type as generic (null)", () => {
    const flash = areaFlashForEvent(
      ev("ActionDeclared", { actorId: "a1", origin: { x: 3, y: 3 }, area: { type: "square", size: 10 }, damageType: "same-as-attack" }),
      map
    );
    expect(flash!.damageType).toBeNull();
  });

  it("returns null without a usable area or origin, and for non-actions", () => {
    expect(areaFlashForEvent(ev("ActionDeclared", { actorId: "a1", origin: { x: 1, y: 1 } }), map)).toBeNull();
    expect(areaFlashForEvent(ev("ActionDeclared", { actorId: "a1", area: { type: "circle", size: 10 } }), map)).toBeNull();
    expect(areaFlashForEvent(ev("DamageApplied", { targetId: "t1", totalApplied: 5, area: { type: "circle", size: 10 }, origin: { x: 1, y: 1 } }), map)).toBeNull();
  });
});

describe("TokenHealthBar", () => {
  const box = { x: 100, y: 200, size: 44 };
  function fill(container: HTMLElement) {
    return container.querySelector("i") as HTMLElement;
  }

  it("fills to the current / max ratio and tags the tone", () => {
    const { container } = render(<TokenHealthBar current={9} max={12} {...box} />);
    expect(fill(container).style.width).toBe("75%");
    expect(container.querySelector(".token-hp")?.className).toContain("tone-high");
  });

  it("positions itself just below the token box", () => {
    const { container } = render(<TokenHealthBar current={9} max={12} {...box} />);
    const bar = container.querySelector(".token-hp") as HTMLElement;
    expect(bar.style.left).toBe("102px");
    expect(bar.style.top).toBe("247px");
    expect(bar.style.width).toBe("40px");
  });

  it("clamps out-of-range hp to 0-100%", () => {
    const over = render(<TokenHealthBar current={40} max={10} {...box} />);
    expect(fill(over.container).style.width).toBe("100%");
    over.unmount();
    const under = render(<TokenHealthBar current={-3} max={10} {...box} />);
    expect(fill(under.container).style.width).toBe("0%");
  });

  it("switches tone bands with hp", () => {
    const mid = render(<TokenHealthBar current={5} max={10} {...box} />);
    expect(mid.container.querySelector(".token-hp")?.className).toContain("tone-mid");
    mid.unmount();
    const low = render(<TokenHealthBar current={2} max={10} {...box} />);
    expect(low.container.querySelector(".token-hp")?.className).toContain("tone-low");
  });

  it("adds the `out` class for downed / dead tokens", () => {
    const { container } = render(<TokenHealthBar current={0} max={10} out {...box} />);
    expect(container.querySelector(".token-hp")?.className).toContain("out");
  });

  it("renders nothing without a usable max", () => {
    const { container } = render(<TokenHealthBar current={5} max={0} {...box} />);
    expect(container.querySelector(".token-hp")).toBeNull();
  });
});
