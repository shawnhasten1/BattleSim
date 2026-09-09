// @vitest-environment happy-dom
import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { sampleEncounter, type CombatLogEvent } from "@/engine";
import { areaFlashForEvent, combatTextForEvent, hpTone } from "@/lib/combatFeedback";
import { TokenHealthBar } from "@/components/scene/TokenHealthBar";

afterEach(() => {
  document.body.innerHTML = "";
});

function ev(type: CombatLogEvent["type"], data: Record<string, unknown>): CombatLogEvent {
  return { id: `${type}-1`, round: 1, turnIndex: 0, type, message: "", data };
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
