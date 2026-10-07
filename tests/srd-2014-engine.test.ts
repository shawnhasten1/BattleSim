import { describe, expect, it } from "vitest";
import { canPayFor, getExecutableActions, type CombatantState } from "@/engine";
import { blankCharacter, quickBuild, rebuildActor, withChoice, withSuggestions } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";

/**
 * EDITIONS_PLAN.md Phase 10: the engine families the 2014 features needed, each closing a gap code in
 * `src/data/srd/2014/coverage.ts`, and the 2014 features that use them.
 */

const sources = SRD_BUILD_SOURCES;

describe("a spell cast with a slot, but once a day (10a: once-a-day-slot)", () => {
  it("a 2014 warlock's Mire the Mind: Slow with its slot and its own once-a-day pool, at any slot it has", () => {
    let build = withSuggestions(quickBuild(sources, { classId: "srd:class:warlock-2014", level: 7 }), sources);
    build = withChoice(build, { kind: "level", index: 4 }, ["eldritch-invocations"], ["mire-the-mind"]);
    const actor = rebuildActor(blankCharacter("pc", "Warlock"), build, sources).definition;
    expect(actor.spells!.find((spell) => spell.name === "Slow (Mire the Mind)")).toMatchObject({ level: 3 });
    expect(actor.spells!.some((spell) => spell.name === "Slow")).toBe(false);
    const copies = getExecutableActions(actor).filter((action) => action.name.startsWith("Slow (Mire the Mind)"));
    // Its pact slots are 4th level at 7th: the 4th-level copy, each spending the slot and the pool.
    expect(copies.length).toBeGreaterThan(0);
    for (const copy of copies) expect(copy).toMatchObject({ extraCost: { resourceId: "slow-free-casts", amount: 1 } });
    const fourth = copies.find((copy) => "resourceCost" in copy && copy.resourceCost?.resourceId === "slot-4")!;
    const holder = (resources: Record<string, number>) => ({ resources } as unknown as CombatantState);
    expect(canPayFor(holder({ "slot-4": 2, "slow-free-casts": 1 }), fourth as never)).toBe(true);
    expect(canPayFor(holder({ "slot-4": 2, "slow-free-casts": 0 }), fourth as never)).toBe(false);
    expect(canPayFor(holder({ "slot-4": 0, "slow-free-casts": 1 }), fourth as never)).toBe(false);
  });
});
