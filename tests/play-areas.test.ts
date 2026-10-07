import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createEngineState,
  previewArea,
  resolveAreaSaveAction,
  sampleEncounter,
  type CreatureDefinition,
  type EncounterSnapshot,
  type PlayControl,
  type Point
} from "@/engine";
import { findSrdSpell } from "@/data/srd";
import { hotbarFor, type HotbarModel } from "@/lib/play/hotbar";
import { aimAtCreature, aimAtSquare, areaShapeFor, chooseOption, pressHotbar } from "@/hooks/usePlayAim";
import { useEncounterStore } from "@/store/encounter-store";
import { usePlayUiStore } from "@/store/play-ui-store";

/** Areas, places and options in Play (PLAY_MODE_PLAN.md Phase 6). */
const pristine = useEncounterStore.getState();
const pristineUi = usePlayUiStore.getState();
const store = () => useEncounterStore.getState();
const ui = () => usePlayUiStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  usePlayUiStore.setState(pristineUi, true);
});
afterEach(() => {
  useEncounterStore.setState(pristine, true);
  usePlayUiStore.setState(pristineUi, true);
});

const PARTY: PlayControl = { factions: { party: "human", enemy: "ai" } };
const EVERYONE: PlayControl = { factions: { party: "human", enemy: "human" } };
const INITIATIVE: Record<string, number> = { "pc-fighter": 20, "pc-archer": 15, "enemy-goblin-1": 12, "enemy-goblin-2": 8 };

/** The sample fight with the fighter a caster of `spells` (plenty of slots), goblins that survive a spell or two, no wall. */
function load(spells: string[], change?: (encounter: EncounterSnapshot, fighter: CreatureDefinition) => void): EncounterSnapshot {
  const encounter = structuredClone(sampleEncounter);
  encounter.seed = "play-areas";
  encounter.map.walls = [];
  encounter.map.terrain = [];
  const fighter = encounter.definitions.find((definition) => definition.id === "def-fighter")!;
  fighter.spells = spells.map((id) => structuredClone(findSrdSpell(id)!));
  const slots = { "slot-1": 4, "slot-2": 3, "slot-3": 3, "slot-4": 2 };
  fighter.resources = { ...fighter.resources, ...slots };
  encounter.definitions.find((definition) => definition.id === "def-goblin")!.maxHp = 60;
  encounter.combatants = encounter.combatants.map((combatant) => ({
    ...combatant,
    initiative: INITIATIVE[combatant.id],
    ...(combatant.faction === "enemy" ? { currentHp: 60 } : {}),
    ...(combatant.id === "pc-fighter" ? { resources: { ...combatant.resources, ...slots } } : {})
  }));
  change?.(encounter, fighter);
  useEncounterStore.setState({ encounter, log: [], undoStack: [], redoStack: [], undoPlay: [], redoPlay: [] });
  return encounter;
}

function place(encounter: EncounterSnapshot, id: string, position: Point) {
  encounter.combatants.find((combatant) => combatant.id === id)!.position = position;
}

const button = (model: HotbarModel, name: string) => model.tabs.flatMap((entry) => entry.buttons).find((candidate) => candidate.name === name)!;
const hotbar = () => hotbarFor(store().encounter, "pc-fighter");
const combatant = (id: string) => store().encounter.combatants.find((candidate) => candidate.id === id)!;
const savers = (from: number) => store().log.slice(from).filter((entry) => entry.type === "SaveRolled").map((entry) => String(entry.data?.targetId ?? entry.data?.combatantId));

describe("an area's preview is what it does", () => {
  it("Fireball catches exactly who it hits, wherever it's put", () => {
    const board = load(["srd:spell:fireball"], (encounter) => {
      place(encounter, "pc-fighter", { x: 0, y: 0 });
      place(encounter, "pc-archer", { x: 5, y: 3 });
      place(encounter, "enemy-goblin-1", { x: 8, y: 2 });
      place(encounter, "enemy-goblin-2", { x: 9, y: 6 });
    });
    const fireball = button(hotbarFor(board, "pc-fighter"), "Fireball").variants[0]!.actionId;
    let compared = 0;
    for (let y = 0; y < board.map.grid.height; y += 1) {
      for (let x = 0; x < board.map.grid.width; x += 1) {
        const aim = { x, y };
        const preview = previewArea(board, "pc-fighter", fireball, aim);
        const state = createEngineState(structuredClone(board));
        if (preview.problem) {
          expect(() => resolveAreaSaveAction(state, "pc-fighter", aim, fireball), `(${x}, ${y})`).toThrow();
          continue;
        }
        resolveAreaSaveAction(state, "pc-fighter", aim, fireball);
        const hit = state.log.filter((entry) => entry.type === "SaveRolled").map((entry) => String(entry.data?.targetId ?? entry.data?.combatantId));
        expect(hit.sort(), `(${x}, ${y})`).toEqual(preview.caught.map((caught) => caught.id).sort());
        compared += 1;
      }
    }
    expect(compared).toBeGreaterThan(50);
  });

  it("a cone aimed between two foes catches both, and the archer beside them is flagged as a friend", () => {
    const board = load(["srd:spell:burning-hands"], (encounter) => {
      place(encounter, "pc-fighter", { x: 3, y: 3 });
      place(encounter, "enemy-goblin-1", { x: 5, y: 2 });
      place(encounter, "enemy-goblin-2", { x: 5, y: 4 });
      place(encounter, "pc-archer", { x: 6, y: 3 });
    });
    const cone = button(hotbarFor(board, "pc-fighter"), "Burning Hands");
    expect(cone.variants[0]!.aim).toEqual({ kind: "area" });
    const shape = areaShapeFor(board, "pc-fighter", cone.variants[0]!.actionId, { x: 6, y: 3 })!;
    expect(shape.caught.filter((caught) => caught.hostile).map((caught) => caught.id).sort()).toEqual(["enemy-goblin-1", "enemy-goblin-2"]);
    expect(shape.caught.find((caught) => caught.id === "pc-archer")).toMatchObject({ hostile: false, label: expect.stringMatching(/^\d+%$/) });

    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    pressHotbar(button(hotbar(), "Burning Hands"));
    const from = store().log.length;
    aimAtSquare({ x: 6, y: 3 });
    expect(savers(from).sort()).toEqual(["enemy-goblin-1", "enemy-goblin-2", "pc-archer"]);
    expect(combatant("pc-fighter").resources?.["slot-1"]).toBe(3);
  });

  it("refuses a point out of range, saying why, and keeps aiming", () => {
    load(["srd:spell:fireball"], (encounter) => {
      encounter.map.grid.width = 40;
      place(encounter, "pc-fighter", { x: 0, y: 0 });
    });
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    pressHotbar(button(hotbar(), "Fireball"));
    const from = store().log.length;
    aimAtSquare({ x: 39, y: 0 });
    expect(ui().note).toMatch(/beyond/);
    expect(ui().armed).not.toBeNull();
    expect(store().log).toHaveLength(from);
  });
});

describe("places", () => {
  it("Misty Step takes the caster where it's pointed", () => {
    load(["srd:spell:misty-step"]);
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    const misty = button(hotbar(), "Misty Step");
    expect(misty.variants[0]!.aim).toEqual({ kind: "place", moves: "self" });
    pressHotbar(misty);
    // Onto someone: refused.
    aimAtCreature("pc-archer");
    expect(ui().note).toBe("Archer is there");
    aimAtSquare({ x: 4, y: 0 });
    expect(combatant("pc-fighter").position).toEqual({ x: 4, y: 0 });
    expect(combatant("pc-fighter").actionEconomy?.bonus).toBe(false);
  });

  it("a teleport that moves another: first who, then where", () => {
    load([], (_encounter, fighter) => {
      fighter.actions = [...fighter.actions, {
        kind: "reposition", id: "shove-aside", name: "Shove Aside", actionType: "action", range: 30, targeting: { target: "single" }, automationSupport: "full"
      } as never];
    });
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    pressHotbar(button(hotbar(), "Shove Aside"));
    aimAtSquare({ x: 3, y: 3 });
    expect(ui().note).toBe("First pick who it moves");
    aimAtCreature("pc-archer");
    expect(ui().armed?.picked).toEqual(["pc-archer"]);
    aimAtSquare({ x: 3, y: 3 });
    expect(combatant("pc-archer").position).toEqual({ x: 3, y: 3 });
  });
});

describe("zones", () => {
  it("Moonbeam settles where it's put, then moves with a bonus action", () => {
    load(["srd:spell:moonbeam"], (encounter) => {
      encounter.map.grid.width = 30;
      place(encounter, "enemy-goblin-1", { x: 4, y: 1 });
    });
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    pressHotbar(button(hotbar(), "Moonbeam"));
    aimAtSquare({ x: 4, y: 1 });
    const zone = store().encounter.activeZones?.find((candidate) => candidate.name === "Moonbeam");
    expect(zone?.origin).toEqual({ x: 4, y: 1 });
    // Its own button, on the Bonus tab.
    const move = button(hotbar(), "Move Moonbeam");
    expect(move).toMatchObject({ tab: "bonus", group: "spells", cost: "up to 60 ft" });
    expect(move.variants[0]!.aim).toEqual({ kind: "zone", zoneId: zone!.id, maxFeet: 60 });
    pressHotbar(move);
    aimAtSquare({ x: 20, y: 1 });
    expect(ui().note).toBe("Moonbeam can only move 60 ft");
    aimAtSquare({ x: 6, y: 3 });
    expect(store().encounter.activeZones?.find((candidate) => candidate.id === zone!.id)?.origin).toEqual({ x: 6, y: 3 });
    expect(store().log.at(-1)).toMatchObject({ type: "ZoneMoved" });
    // The bonus action is spent: it can't move again this turn.
    expect(button(hotbar(), "Move Moonbeam").problem).toBe("Fighter has no bonus action to move Moonbeam");
  });
});

describe("options", () => {
  it("a summon picked from its options appears, and plays on its side: by a person, as its summoner is", () => {
    load([], (_encounter, fighter) => {
      fighter.actions = [...fighter.actions, {
        kind: "summon", id: "call-help", name: "Call for Help", actionType: "action", range: 30, choice: "pick", automationSupport: "full",
        options: [{ id: "one", definitionId: "def-archer", label: "An archer", count: 1 }, { id: "two", definitionId: "def-archer", label: "Two archers", count: 2 }]
      } as never];
    });
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    const call = button(hotbar(), "Call for Help");
    expect(call.variants[0]!.aim).toEqual({ kind: "option", options: [{ id: "one", label: "An archer" }, { id: "two", label: "Two archers" }] });
    pressHotbar(call);
    expect(chooseOption("two")).toBe(true);
    const summoned = store().encounter.combatants.filter((candidate) => candidate.summon?.summonerId === "pc-fighter");
    expect(summoned).toHaveLength(2);
    // Through the fight's turns until a summoned archer's: a person's turn.
    for (let guard = 0; guard < 20; guard += 1) {
      const status = store().play!.status;
      if (status.kind === "your-turn" && summoned.some((candidate) => candidate.id === status.actorId)) break;
      if (status.kind === "your-turn") store().playCommand({ kind: "end-turn", actorId: status.actorId });
      else store().continuePlay();
    }
    const status = store().play!.status;
    expect(status.kind === "your-turn" && summoned.some((candidate) => candidate.id === status.actorId)).toBe(true);
  });

  it("everyone played by a person: a goblin's cone still asks nothing of the AI", () => {
    load(["srd:spell:burning-hands"]);
    store().startPlay({ control: EVERYONE, playbackSpeed: 0 });
    expect(store().play?.status).toEqual({ kind: "your-turn", actorId: "pc-fighter" });
  });
});
