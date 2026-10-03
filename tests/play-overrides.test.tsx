// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildBattleReport, sampleEncounter, type ActionDefinition, type CombatLogEvent, type EncounterSnapshot, type PlayControl, type Point, type RollRequest } from "@/engine";
import { findSrdSpell } from "@/data/srd";
import { PlayOverlay } from "@/components/play/PlayOverlay";
import { describeRoll, overrideChoices, recentRolls, rollsByLogIndex, type RollItem } from "@/lib/play/rolls";
import { aimAtSquare, pressHotbar } from "@/hooks/usePlayAim";
import { hotbarFor } from "@/lib/play/hotbar";
import { useEncounterStore } from "@/store/encounter-store";
import { usePlayUiStore } from "@/store/play-ui-store";

/** Overruling a roll in Play (PLAY_MODE_PLAN.md Phase 9). */
const pristine = useEncounterStore.getState();
const pristineUi = usePlayUiStore.getState();
const store = () => useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  usePlayUiStore.setState(pristineUi, true);
  try { localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => {
  cleanup();
  useEncounterStore.setState(pristine, true);
  usePlayUiStore.setState(pristineUi, true);
});

const PARTY: PlayControl = { factions: { party: "human", enemy: "ai" } };

function load(initiative: Record<string, number>, positions: Record<string, Point>, change?: (encounter: EncounterSnapshot) => void): EncounterSnapshot {
  const encounter = structuredClone(sampleEncounter);
  encounter.seed = "play-overrides";
  encounter.map.walls = [];
  encounter.map.terrain = [];
  encounter.combatants = encounter.combatants.map((combatant) => ({
    ...combatant,
    initiative: initiative[combatant.id] ?? 1,
    ...(positions[combatant.id] ? { position: positions[combatant.id] } : {})
  }));
  change?.(encounter);
  useEncounterStore.setState({ encounter, log: [], undoStack: [], redoStack: [], undoPlay: [], redoPlay: [] });
  return encounter;
}

const hp = (id: string) => store().encounter.combatants.find((combatant) => combatant.id === id)!.currentHp;

describe("an AI's attack overruled", () => {
  /** The goblin swings at a fighter it can't hit, and then it's the archer's turn: the miss is one of the rolls to overrule. */
  function missFight(): RollItem {
    load({ "pc-fighter": 20, "enemy-goblin-1": 15, "pc-archer": 10 }, { "pc-fighter": { x: 2, y: 2 }, "enemy-goblin-1": { x: 3, y: 2 }, "enemy-goblin-2": { x: 11, y: 7 } }, (encounter) => {
      // The fighter is near impossible to hit: the goblin's attack misses.
      encounter.definitions.find((definition) => definition.id === "def-fighter")!.armorClass = 30;
    });
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    store().playCommand({ kind: "end-turn", actorId: "pc-fighter" });
    expect(store().play?.status).toEqual({ kind: "your-turn", actorId: "pc-archer" });
    const miss = recentRolls(store().play).find((item) => item.request.purpose === "attack" && item.request.rollerId === "enemy-goblin-1" && item.request.outcome === "failure");
    expect(miss).toBeDefined();
    return miss!;
  }
  /** That roll as the strip has it now. */
  const now = (item: RollItem) => recentRolls(store().play).find((other) => other.stepIndex === item.stepIndex && other.key === item.key);

  it("a miss made a hit damages the fighter, and the turns after it play again from there", () => {
    const miss = missFight();
    expect(overrideChoices(miss.request).map((choice) => choice.label)).toEqual(["Hit", "Critical hit"]);
    const before = hp("pc-fighter");
    const stepFrom = store().play!.recent![miss.stepIndex]!.from;
    const original = store().log;

    store().overrideRoll(miss.stepIndex, miss.key, "success");
    const log = store().log;
    const attack = log.findIndex((entry, index) => index >= stepFrom && entry.type === "AttackRolled" && entry.data?.attackerId === "enemy-goblin-1");
    expect(log[attack]).toMatchObject({ data: { hit: true, overridden: "success" } });
    expect(log[attack]!.message).toMatch(/\(DM override\)$/);
    // The number rolled is kept.
    expect(log[attack]!.data?.total).toBe(miss.request.total);
    expect(hp("pc-fighter")).toBeLessThan(before);
    // The turns after it played again: it's the archer's turn once more, and the report counts the override.
    expect(store().play?.status).toEqual({ kind: "your-turn", actorId: "pc-archer" });
    expect(buildBattleReport(store().playSetup!, log).overrides).toBe(1);

    // Undo puts the roll back the way it came out, the log as it was, and the rolls to overrule; redo, the override.
    store().undo();
    expect(hp("pc-fighter")).toBe(before);
    expect(store().log).toEqual(original);
    expect(store().play?.status).toEqual({ kind: "your-turn", actorId: "pc-archer" });
    expect(now(miss)).toEqual(miss);
    store().redo();
    expect(store().log).toEqual(log);
    expect(hp("pc-fighter")).toBeLessThan(before);
    expect(now(miss)).toMatchObject({ request: { outcome: "success" }, rolled: "failure" });
  });

  it("the strip shows a roll as ruled; ruled back to how the dice had it, it's no override", () => {
    const miss = missFight();
    const original = store().log;
    const before = hp("pc-fighter");
    store().overrideRoll(miss.stepIndex, miss.key, "success");
    const ruled = now(miss)!;
    expect(ruled).toMatchObject({ request: { outcome: "success" }, rolled: "failure" });
    expect(overrideChoices(ruled.request).map((choice) => choice.label)).toEqual(["Critical hit", "Miss"]);
    expect(describeRoll(ruled.request, store().encounter, ruled.rolled)).toMatch(/, hit \(DM override; the dice said miss\)$/);

    store().overrideRoll(ruled.stepIndex, ruled.key, "failure");
    expect(now(miss)).toEqual(miss);
    expect(store().log.some((entry) => entry.data?.overridden)).toBe(false);
    // The same dice: the fight as it was.
    expect(store().log).toEqual(original);
    expect(hp("pc-fighter")).toBe(before);
  });

  it("an edit by hand ends overruling the rolls before it; undoing the edit brings them back", () => {
    const miss = missFight();
    store().updateCombatant("pc-archer", { tempHp: 3 });
    expect(recentRolls(store().play)).toEqual([]);
    store().undo();
    expect(now(miss)).toEqual(miss);
  });
});

describe("a save overruled", () => {
  it("a goblin's failed save against Fireball made a success takes half the damage", () => {
    load({ "pc-fighter": 20 }, { "pc-fighter": { x: 0, y: 0 }, "enemy-goblin-1": { x: 8, y: 2 }, "enemy-goblin-2": { x: 9, y: 3 } }, (encounter) => {
      const fighter = encounter.definitions.find((definition) => definition.id === "def-fighter")!;
      fighter.spells = [structuredClone(findSrdSpell("srd:spell:fireball")!)];
      fighter.resources = { ...fighter.resources, "slot-3": 1 };
      encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!.resources = { "slot-3": 1 };
      // Goblins that can't dodge and live through it.
      const goblin = encounter.definitions.find((definition) => definition.id === "def-goblin")!;
      goblin.abilities = { ...goblin.abilities, dex: 1 };
      goblin.maxHp = 200;
      for (const combatant of encounter.combatants.filter((entry) => entry.faction === "enemy")) combatant.currentHp = 200;
    });
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    pressHotbar(hotbarFor(store().encounter, "pc-fighter").tabs.flatMap((tab) => tab.buttons).find((button) => button.name === "Fireball")!);
    aimAtSquare({ x: 8, y: 2 });
    const save = recentRolls(store().play).find((item) => item.request.purpose === "save" && item.request.rollerId === "enemy-goblin-1");
    expect(save?.request.outcome).toBe("failure");
    const full = 200 - hp("enemy-goblin-1");
    expect(full).toBeGreaterThan(1);

    store().overrideRoll(save!.stepIndex, save!.key, "success");
    expect(200 - hp("enemy-goblin-1")).toBe(Math.floor(full / 2));
    const saveLog = store().log.find((entry) => entry.type === "SaveRolled" && entry.data?.targetId === "enemy-goblin-1");
    expect(saveLog).toMatchObject({ data: { overridden: "success" } });
    expect(saveLog!.message).toMatch(/\(DM override\)$/);
    // The other goblin's save was untouched.
    expect(store().log.find((entry) => entry.type === "SaveRolled" && entry.data?.targetId === "enemy-goblin-2")?.data?.overridden).toBeUndefined();
  });
});

describe("a legendary creature's save overruled", () => {
  it("made a failure, it can still be turned by Legendary Resistance", () => {
    load({ "pc-fighter": 20 }, { "pc-fighter": { x: 0, y: 0 }, "enemy-goblin-1": { x: 8, y: 2 }, "enemy-goblin-2": { x: 14, y: 9 } }, (encounter) => {
      const fighter = encounter.definitions.find((definition) => definition.id === "def-fighter")!;
      fighter.spells = [structuredClone(findSrdSpell("srd:spell:fireball")!)];
      fighter.resources = { ...fighter.resources, "slot-3": 1 };
      encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!.resources = { "slot-3": 1 };
      // A goblin that can't fail a Dex save, lives through it, and spends Legendary Resistance whenever it can.
      const goblin = encounter.definitions.find((definition) => definition.id === "def-goblin")!;
      goblin.saves = { ...goblin.saves, dex: 100 };
      goblin.maxHp = 200;
      goblin.traits = [...(goblin.traits ?? []), { id: "lr", name: "Legendary Resistance (3/Day)", category: "trait", automationSupport: "full", effects: [{ kind: "auto-succeed-save", resourceId: "legendary-resistance" }] }];
      goblin.resources = { ...goblin.resources, "legendary-resistance": 3 };
      const boss = encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-1")!;
      Object.assign(boss, { currentHp: 200, resourceStance: "liberal", resources: { ...boss.resources, "legendary-resistance": 3 } });
    });
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    pressHotbar(hotbarFor(store().encounter, "pc-fighter").tabs.flatMap((tab) => tab.buttons).find((button) => button.name === "Fireball")!);
    aimAtSquare({ x: 8, y: 2 });
    const save = recentRolls(store().play).find((item) => item.request.purpose === "save" && item.request.rollerId === "enemy-goblin-1");
    expect(save?.request.outcome).toBe("success");
    const half = 200 - hp("enemy-goblin-1");

    store().overrideRoll(save!.stepIndex, save!.key, "failure");
    const goblin = () => store().encounter.combatants.find((combatant) => combatant.id === "enemy-goblin-1")!;
    expect(store().log.some((entry) => entry.type === "LegendaryResistanceUsed" && entry.data?.combatantId === "enemy-goblin-1")).toBe(true);
    expect(goblin().resources?.["legendary-resistance"]).toBe(2);
    // It succeeds after all: the same dice, half the damage.
    expect(200 - hp("enemy-goblin-1")).toBe(half);
    expect(store().log.find((entry) => entry.type === "SaveRolled" && entry.data?.targetId === "enemy-goblin-1")).toMatchObject({ data: { overridden: "failure" } });
  });
});

describe("the rolls during a playback", () => {
  it("each shows as the playback reaches it, and none can be overruled until it's done", () => {
    load({ "pc-fighter": 20, "enemy-goblin-1": 15, "pc-archer": 10 }, { "pc-fighter": { x: 2, y: 2 }, "enemy-goblin-1": { x: 3, y: 2 }, "enemy-goblin-2": { x: 11, y: 7 } }, (encounter) => {
      encounter.definitions.find((definition) => definition.id === "def-fighter")!.armorClass = 30;
    });
    store().startPlay({ control: PARTY, playbackSpeed: 1 });
    // The fight's first turn starting plays back too.
    while (store().play?.playback) store().advancePlayback();
    store().playCommand({ kind: "end-turn", actorId: "pc-fighter" });
    expect(store().play?.playback).toBeDefined();
    expect(recentRolls(store().play)).toEqual([]);
    for (let guard = 0; guard < 100 && recentRolls(store().play).length === 0 && store().play?.playback; guard += 1) store().advancePlayback();
    const shown = recentRolls(store().play)[0];
    expect(shown?.request).toMatchObject({ purpose: "attack", rollerId: "enemy-goblin-1" });
    expect(store().play?.playback).toBeDefined();
    store().overrideRoll(shown!.stepIndex, shown!.key, "success");
    expect(store().log.some((entry) => entry.data?.overridden)).toBe(false);
    // Played out, it can.
    store().skipPlayback();
    expect(store().play?.playback).toBeUndefined();
    const item = recentRolls(store().play).find((other) => other.key === shown!.key && other.stepIndex === shown!.stepIndex)!;
    store().overrideRoll(item.stepIndex, item.key, "success");
    expect(store().log.some((entry) => entry.data?.overridden)).toBe(true);
  });
});

describe("a question after the overruled roll", () => {
  /** A goblin that slashes twice and always hits, beside a fighter who can rebuke each hit. */
  function rebukeFight() {
    load({ "enemy-goblin-1": 20, "pc-fighter": 15 }, { "pc-fighter": { x: 2, y: 2 }, "enemy-goblin-1": { x: 3, y: 2 }, "pc-archer": { x: 0, y: 7 }, "enemy-goblin-2": { x: 11, y: 7 } }, (encounter) => {
      const fighter = encounter.definitions.find((definition) => definition.id === "def-fighter")!;
      fighter.spells = [structuredClone(findSrdSpell("srd:spell:hellish-rebuke")!)];
      fighter.resources = { ...fighter.resources, "slot-1": 2 };
      encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!.resources = { "slot-1": 2 };
      const goblin = encounter.definitions.find((definition) => definition.id === "def-goblin")!;
      goblin.actions = [
        ...goblin.actions.map((action) => (action.kind === "attack" && action.id === "scimitar" ? { ...action, attackBonus: 100, attackBonusFormula: undefined } : action)),
        { kind: "multiattack", id: "two-slashes", name: "Two Slashes", actionType: "action", attacks: [{ actionId: "scimitar", count: 2 }], automationSupport: "full" } as ActionDefinition
      ];
    });
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    // Two hits, two questions: the fighter doesn't rebuke either.
    for (let count = 0; count < 2; count += 1) {
      expect(store().play?.pending?.request).toMatchObject({ kind: "reaction", trigger: "hit-by-attack", reactorId: "pc-fighter" });
      store().answerPrompt({ kind: "reaction", actionId: null });
    }
    expect(store().play?.status).toEqual({ kind: "your-turn", actorId: "pc-fighter" });
    return recentRolls(store().play).filter((item) => item.request.purpose === "attack" && item.request.rollerId === "enemy-goblin-1").reverse();
  }

  it("comes back if it still happens: the first slash (a natural 20) made a plain hit still hits, and is asked about again", () => {
    const [first] = rebukeFight();
    expect(first!.request.outcome).toBe("critical");
    store().overrideRoll(first!.stepIndex, first!.key, "success");
    expect(store().play?.pending?.request).toMatchObject({ kind: "reaction", trigger: "hit-by-attack", reactorId: "pc-fighter" });
    // The step is open again, from before the first slash: nothing of it is on the board yet.
    expect(store().log.some((entry) => entry.type === "AttackRolled")).toBe(false);
    // Answered again: the rest of the step runs on (the second slash may or may not land, its dice moved by the first's).
    while (store().play?.pending) store().answerPrompt({ kind: "reaction", actionId: null });
    expect(store().play?.status).toEqual({ kind: "your-turn", actorId: "pc-fighter" });
    expect(store().log.find((entry) => entry.type === "AttackRolled")).toMatchObject({ data: { hit: true, critical: false, overridden: "success" } });
  });

  it("doesn't if it no longer does: the second slash made a miss, nothing to rebuke", () => {
    const [, second] = rebukeFight();
    store().overrideRoll(second!.stepIndex, second!.key, "failure");
    expect(store().play?.pending).toBeUndefined();
    expect(store().play?.status).toEqual({ kind: "your-turn", actorId: "pc-fighter" });
    const attacks = store().log.filter((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "enemy-goblin-1");
    expect(attacks.map((entry) => entry.data?.hit)).toEqual([true, false]);
  });
});

describe("a question's roll overruled", () => {
  it("Shield's question: the hit made a miss, and there's nothing left to ask", async () => {
    // A fight where the goblin's swing hits the fighter by less than 5: Shield's question. Just the two of them, or
    // the goblin shoots the archer.
    let asked = false;
    for (let attempt = 0; attempt < 40 && !asked; attempt += 1) {
      useEncounterStore.setState(pristine, true);
      load({ "enemy-goblin-1": 20, "pc-fighter": 15 }, { "pc-fighter": { x: 2, y: 2 }, "enemy-goblin-1": { x: 3, y: 2 } }, (encounter) => {
        encounter.combatants = encounter.combatants.filter((combatant) => combatant.id === "pc-fighter" || combatant.id === "enemy-goblin-1");
        encounter.seed = `play-overrides-shield-${attempt}`;
        const fighter = encounter.definitions.find((definition) => definition.id === "def-fighter")!;
        fighter.spells = [structuredClone(findSrdSpell("srd:spell:shield")!)];
        fighter.resources = { ...fighter.resources, "slot-1": 2 };
        encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!.resources = { "slot-1": 2 };
      });
      store().startPlay({ control: PARTY, playbackSpeed: 0 });
      const request = store().play?.pending?.request;
      asked = request?.kind === "reaction" && request.trigger === "would-be-hit";
    }
    expect(asked).toBe(true);
    render(<PlayOverlay />);
    await userEvent.click(screen.getByRole("button", { name: "Overrule the roll…" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Miss" }));
    expect(store().play?.pending).toBeUndefined();
    expect(store().play?.status).toEqual({ kind: "your-turn", actorId: "pc-fighter" });
    expect(store().log.find((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "enemy-goblin-1")).toMatchObject({ data: { hit: false, overridden: "failure" } });
    // The slot wasn't spent.
    expect(store().encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!.resources?.["slot-1"]).toBe(2);
  });
});

describe("which log entry is which roll", () => {
  it("a save to keep concentrating is its ConcentrationChecked entry, whatever comes first; each save its own", () => {
    const entry = (type: CombatLogEvent["type"], data: Record<string, unknown>): CombatLogEvent => ({ id: `${type}-x`, round: 1, turnIndex: 0, type, message: type, data });
    // A blast's damage breaks the mage's concentration check before the blast's own save is logged; a second blast after.
    const log = [
      entry("ActionDeclared", { attackerId: "goblin" }),
      entry("DamageApplied", { targetId: "mage" }),
      entry("ConcentrationChecked", { combatantId: "mage" }),
      entry("SaveRolled", { targetId: "mage" }),
      entry("SaveRolled", { targetId: "mage" })
    ];
    const roll = (key: string, purpose: RollRequest["purpose"], logLength: number): RollItem => ({
      stepIndex: 0, key, logLength,
      request: { kind: "roll", key, rollerId: "mage", purpose, natural: 10, total: 12, against: 15, outcome: "failure" } as RollRequest
    });
    const save = roll("0:roll:mage", "save", 1);
    const concentration = roll("1:roll:mage", "concentration", 1);
    const second = roll("2:roll:mage", "save", 4);
    const byIndex = rollsByLogIndex(log, [second, concentration, save]);
    expect([byIndex.get(2)?.key, byIndex.get(3)?.key, byIndex.get(4)?.key]).toEqual([concentration.key, save.key, second.key]);
  });
});

describe("on screen", () => {
  it("the rolls since the last command, newest first, each with a menu that overrules it; and in the Combat panel's log", async () => {
    load({ "pc-fighter": 20, "enemy-goblin-1": 15, "pc-archer": 10 }, { "pc-fighter": { x: 2, y: 2 }, "enemy-goblin-1": { x: 3, y: 2 }, "enemy-goblin-2": { x: 11, y: 7 } }, (encounter) => {
      encounter.definitions.find((definition) => definition.id === "def-fighter")!.armorClass = 30;
    });
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    store().playCommand({ kind: "end-turn", actorId: "pc-fighter" });
    render(<PlayOverlay />);
    const strip = screen.getByRole("list", { name: "Rolls since your last command" });
    const chips = within(strip).getAllByRole("listitem");
    expect(chips[0]!.textContent).toMatch(/^Goblin 1 → Fighter: \d+ vs AC 30, miss/);
    const items = recentRolls(store().play);
    expect(describeRoll(items[0]!.request, store().encounter)).toMatch(/^Goblin 1 → Fighter \(Scimitar\): \d+ \+ \d+ = \d+ against AC 30, miss$/);
    // The log entry it is.
    const byIndex = rollsByLogIndex(store().log, items);
    expect([...byIndex.values()].some((item) => item.key === items[0]!.key)).toBe(true);

    await userEvent.click(within(chips[0]!).getByRole("button", { name: /^Overrule:/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Critical hit" }));
    expect(store().log.find((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "enemy-goblin-1")).toMatchObject({ data: { critical: true, overridden: "critical" } });
  });
});
