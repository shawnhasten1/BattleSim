import { describe, expect, it } from "vitest";
import { createEngineState, resolveAreaSaveAction, resolveAttack, sampleEncounter } from "@/engine";
import type { CoverLevel, EncounterSnapshot, WallSegment } from "@/engine";

function baseEncounter(): EncounterSnapshot {
  const encounter = structuredClone(sampleEncounter);
  encounter.seed = "cover";
  encounter.map.walls = [];
  encounter.map.terrain = [];
  // archer at (1,3) firing east at goblin-1 at (8,2)
  encounter.combatants.find((c) => c.id === "pc-archer")!.position = { x: 1, y: 3 };
  encounter.combatants.find((c) => c.id === "enemy-goblin-1")!.position = { x: 8, y: 3 };
  return encounter;
}

function vWall(cover: CoverLevel): WallSegment {
  return {
    id: "cover-wall",
    start: { x: 5, y: 0 },
    end: { x: 5, y: 7 },
    blocksMovement: cover === "total",
    blocksSight: cover === "total",
    blocksProjectiles: cover === "total",
    cover
  };
}

function shoot(encounter: EncounterSnapshot) {
  const state = createEngineState(encounter);
  const result = resolveAttack(state, "pc-archer", "enemy-goblin-1", "shortbow");
  const rolled = state.log.find((e) => e.type === "AttackRolled");
  return { result, rolled };
}

describe("cover in combat", () => {
  it("adds +2 AC and tags the event for a half-cover wall, shot still lands", () => {
    const clear = shoot(baseEncounter());
    const covered = shoot((() => { const e = baseEncounter(); e.map.walls = [vWall("half")]; return e; })());

    expect(clear.rolled!.data!.cover).toBe("none");
    expect(covered.rolled!.data!.cover).toBe("half");
    expect(covered.rolled!.data!.coverAcBonus).toBe(2);
    expect(Number(covered.rolled!.data!.targetAc)).toBe(Number(clear.rolled!.data!.targetAc) + 2);
    expect(covered.rolled!.data!.coverSources).toContain("low wall");
  });

  it("gives +5 for a three-quarters wall", () => {
    const covered = shoot((() => { const e = baseEncounter(); e.map.walls = [vWall("three-quarters")]; return e; })());
    expect(covered.rolled!.data!.cover).toBe("three-quarters");
    expect(covered.rolled!.data!.coverAcBonus).toBe(5);
  });

  it("refuses the shot through total cover", () => {
    const e = baseEncounter();
    e.map.walls = [vWall("total")];
    const state = createEngineState(e);
    expect(() => resolveAttack(state, "pc-archer", "enemy-goblin-1", "shortbow")).toThrow();
  });

  it("a low wall with blocksProjectiles on refuses the shot; off allows it", () => {
    const blocked = baseEncounter();
    blocked.map.walls = [{ ...vWall("half"), blocksProjectiles: true }];
    expect(() => resolveAttack(createEngineState(blocked), "pc-archer", "enemy-goblin-1", "shortbow")).toThrow();

    const open = baseEncounter();
    open.map.walls = [{ ...vWall("half"), blocksProjectiles: false }];
    const { rolled } = shoot(open);
    expect(rolled!.data!.cover).toBe("half");
  });

  it("ignores cover when rules.cover is off", () => {
    const e = baseEncounter();
    e.map.walls = [vWall("three-quarters")];
    e.rules.cover = false;
    const { rolled } = shoot(e);
    expect(rolled!.data!.cover).toBe("none");
    expect(rolled!.data!.coverAcBonus).toBe(0);
  });

  it("does not apply cover to melee attacks", () => {
    const e = baseEncounter();
    e.map.walls = [vWall("three-quarters")];
    // goblin-2 has a melee scimitar; stand it next to the archer with the wall irrelevant to melee
    const g2 = e.combatants.find((c) => c.id === "enemy-goblin-2")!;
    g2.position = { x: 2, y: 3 };
    const state = createEngineState(e);
    resolveAttack(state, "enemy-goblin-2", "pc-archer", "scimitar");
    const rolled = state.log.find((ev) => ev.type === "AttackRolled");
    expect(rolled!.data!.cover).toBe("none");
    expect(rolled!.data!.coverAcBonus).toBe(0);
  });
});

describe("cover on area saves", () => {
  function burningHandsEncounter(saveAbility: "dex" | "con"): EncounterSnapshot {
    const e = baseEncounter();
    e.definitions.find((d) => d.id === "def-archer")!.actions.push({
      kind: "area-save",
      id: "blast",
      name: "Blast",
      actionType: "action",
      saveAbility,
      dc: 14,
      range: 60,
      area: { type: "circle", size: 25 },
      damage: [{ dice: "6d6", damageType: "fire" }],
      halfDamageOnSuccess: true,
      affects: "hostile",
      automationSupport: "full"
    });
    return e;
  }

  it("adds +2 to a Dex save for a target behind half cover from the blast origin", () => {
    const e = burningHandsEncounter("dex");
    e.map.walls = [vWall("half")]; // between origin (4,3) and goblin (8,3)
    const state = createEngineState(e);
    resolveAreaSaveAction(state, "pc-archer", { x: 4, y: 3 }, "blast");
    const save = state.log.find((ev) => ev.type === "SaveRolled" && ev.data?.targetId === "enemy-goblin-1");
    expect(save).toBeDefined();
    expect(save!.data!.cover).toBe("half");
    expect(save!.data!.coverSaveBonus).toBe(2);
  });

  it("does not add a cover bonus to a non-Dex save", () => {
    const e = burningHandsEncounter("con");
    e.map.walls = [vWall("half")];
    const state = createEngineState(e);
    resolveAreaSaveAction(state, "pc-archer", { x: 4, y: 3 }, "blast");
    const save = state.log.find((ev) => ev.type === "SaveRolled" && ev.data?.targetId === "enemy-goblin-1");
    expect(save!.data!.coverSaveBonus).toBe(0);
  });
});
