// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  runPlayStep,
  sampleEncounter,
  type ActionDefinition,
  type EncounterSnapshot,
  type PlayControl,
  type Point,
  type ReactionRequest
} from "@/engine";
import { findSrdSpell } from "@/data/srd";
import { PlayOverlay } from "@/components/play/PlayOverlay";
import { describeQuestion } from "@/lib/play/questions";
import { hotbarFor } from "@/lib/play/hotbar";
import { useEncounterStore } from "@/store/encounter-store";
import { usePlayUiStore } from "@/store/play-ui-store";

/** Questions for a person (PLAY_MODE_PLAN.md Phase 7): their words and numbers, the "this fight" settings, during playback. */
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
const EVERYONE: PlayControl = { factions: { party: "human", enemy: "human" } };

/** Protection for a party member: an attack on a friend within 5 ft gets disadvantage. */
const PROTECTION: ActionDefinition = {
  kind: "activate-feature", id: "protect", name: "Protection", actionType: "reaction",
  reaction: { trigger: { kind: "ally-targeted-by-attack", withinFt: 5 }, priority: "always" },
  featureId: "protection", automationSupport: "full"
} as ActionDefinition;

function board(initiative: Record<string, number>, positions: Record<string, Point>, change?: (encounter: EncounterSnapshot) => void): EncounterSnapshot {
  const encounter = structuredClone(sampleEncounter);
  encounter.seed = "play-prompts";
  encounter.map.walls = [];
  encounter.map.terrain = [];
  encounter.combatants = encounter.combatants.map((combatant) => ({
    ...combatant,
    initiative: initiative[combatant.id] ?? 1,
    ...(positions[combatant.id] ? { position: positions[combatant.id] } : {})
  }));
  change?.(encounter);
  return encounter;
}

function load(encounter: EncounterSnapshot) {
  useEncounterStore.setState({ encounter, log: [], undoStack: [], redoStack: [], undoPlay: [], redoPlay: [] });
}

function drainPlayback(limit = 5000) {
  for (let count = 0; store().play?.playback && count < limit; count += 1) store().advancePlayback();
}

/** Ask the first question of a step, from scratch. */
function firstQuestion(snapshot: EncounterSnapshot, control: PlayControl, step: Parameters<typeof runPlayStep>[0]["step"]) {
  const result = runPlayStep({ snapshot, log: [], step, control });
  if (result.kind !== "needs-decision") throw new Error(`expected a question, got ${result.kind}`);
  return result;
}

describe("the words and numbers of each question", () => {
  it("an opportunity attack: each attack's chance to hit and damage, and the setting for all of its opportunity attacks", () => {
    const start = board({ "pc-fighter": 20 }, { "pc-fighter": { x: 5, y: 4 }, "enemy-goblin-1": { x: 6, y: 4 } });
    const opened = runPlayStep({ snapshot: start, log: [], step: { kind: "advance" }, control: EVERYONE });
    if (opened.kind !== "done") throw new Error("expected the fighter's turn");
    const asked = runPlayStep({ snapshot: opened.snapshot, log: opened.log, step: { kind: "command", command: { kind: "move", actorId: "pc-fighter", waypoints: [{ x: 2, y: 4 }] } }, control: EVERYONE });
    if (asked.kind !== "needs-decision") throw new Error("expected a question");
    const text = describeQuestion(asked.request, asked.board);
    expect(text.title).toBe("Fighter is leaving Goblin 1's reach.");
    expect(text.options.map((option) => option.label)).toEqual(["Scimitar", "Don't"]);
    expect(text.options[0]!.detail).toMatch(/^\d+% to hit · [\d.]+ damage$/);
    expect(text.policies).toEqual([{ key: "enemy-goblin-1:opportunity-attack", label: "Opportunity attacks", use: { kind: "reaction", actionId: "scimitar" } }]);
  });

  it("Hellish Rebuke after a hit: the attacker's chance to fail, the damage, and the slot it spends", () => {
    const start = board({ "enemy-goblin-1": 20, "pc-fighter": 10 }, { "pc-fighter": { x: 5, y: 4 }, "enemy-goblin-1": { x: 6, y: 4 } }, (encounter) => {
      // Whichever of the party the goblin hits can rebuke it.
      for (const id of ["def-fighter", "def-archer"]) {
        const definition = encounter.definitions.find((candidate) => candidate.id === id)!;
        definition.spells = [structuredClone(findSrdSpell("srd:spell:hellish-rebuke")!)];
        definition.resources = { ...definition.resources, "slot-1": 2 };
      }
      for (const id of ["pc-fighter", "pc-archer"]) encounter.combatants.find((combatant) => combatant.id === id)!.resources = { "slot-1": 2 };
      // The goblin always hits.
      const goblin = encounter.definitions.find((definition) => definition.id === "def-goblin")!;
      goblin.actions = goblin.actions.map((action) => (action.kind === "attack" ? { ...action, attackBonus: 100, attackBonusFormula: undefined } : action));
    });
    const asked = firstQuestion(start, PARTY, { kind: "advance" });
    const request = asked.request as ReactionRequest;
    expect(request).toMatchObject({ kind: "reaction", trigger: "hit-by-attack", sourceId: "enemy-goblin-1" });
    const text = describeQuestion(request, asked.board);
    expect(text.title).toMatch(/^Goblin 1 hit (Fighter|Archer) for \d+\.$/);
    expect(text.ask).toBe("Hellish Rebuke Goblin 1?");
    expect(text.options[0]!.detail).toMatch(/^\d+% to fail · [\d.]+ damage · a 1st-level slot \(2 left\)$/);
  });

  it("Protection: who's attacked, how far away, and the disadvantage it gives", () => {
    const start = board({ "enemy-goblin-1": 20 }, { "pc-fighter": { x: 2, y: 2 }, "pc-archer": { x: 2, y: 3 }, "enemy-goblin-1": { x: 3, y: 2 } }, (encounter) => {
      for (const id of ["def-fighter", "def-archer"]) {
        const definition = encounter.definitions.find((candidate) => candidate.id === id)!;
        definition.reactions = [structuredClone(PROTECTION)];
      }
    });
    const asked = firstQuestion(start, PARTY, { kind: "advance" });
    const text = describeQuestion(asked.request, asked.board);
    expect(text.title).toMatch(/^Goblin 1 attacks (Fighter|Archer), 5 ft\. from (Archer|Fighter)\.$/);
    expect(text.ask).toBe("Give the attack disadvantage?");
    expect(text.options[0]).toMatchObject({ label: "Protection", detail: "the attack has disadvantage" });
  });

  it("Counterspell: the spell, its level and how far, and the slot", () => {
    const start = board({}, { "pc-archer": { x: 1, y: 3 }, "enemy-goblin-1": { x: 7, y: 3 } }, (encounter) => {
      const archer = encounter.definitions.find((definition) => definition.id === "def-archer")!;
      archer.spells = [structuredClone(findSrdSpell("srd:spell:counterspell")!)];
      encounter.combatants.find((combatant) => combatant.id === "pc-archer")!.resources = { "slot-3": 2 };
    });
    const counterspell = start.definitions.find((definition) => definition.id === "def-archer")!.spells![0]!.action!;
    const request: ReactionRequest = {
      kind: "reaction", key: "0:reaction:pc-archer", reactorId: "pc-archer", trigger: "enemy-casts-spell", sourceId: "enemy-goblin-1",
      options: [{ actionId: counterspell.id, name: "Counterspell", resourceCost: { resourceId: "slot-3", amount: 1 }, targetId: "enemy-goblin-1" }],
      aiChoice: counterspell.id, context: { spell: { actionId: "fireball", name: "Fireball", level: 3 } }
    };
    const text = describeQuestion(request, start);
    expect(text.title).toBe("Goblin 1 is casting Fireball (3rd level) 30 ft. away.");
    expect(text.options[0]!.detail).toBe("it's countered · a 3rd-level slot (2 left)");
    expect(text.policies).toEqual([{ key: `pc-archer:${counterspell.id}`, label: "Counterspell", use: { kind: "reaction", actionId: counterspell.id } }]);
  });
});

describe("a question during the AI's turn", () => {
  it("waits for the playback to reach it, shows the board then, and the playback carries on after the answer", async () => {
    load(board({ "enemy-goblin-1": 20, "pc-fighter": 15, "pc-archer": 10 }, { "pc-fighter": { x: 2, y: 2 }, "pc-archer": { x: 2, y: 3 }, "enemy-goblin-1": { x: 3, y: 2 } }, (encounter) => {
      for (const id of ["def-fighter", "def-archer"]) {
        encounter.definitions.find((candidate) => candidate.id === id)!.reactions = [structuredClone(PROTECTION)];
      }
    }));
    store().startPlay({ control: PARTY, playbackSpeed: 1 });
    // The goblin's turn: its lead-up to the question plays back first.
    expect(store().play?.pending?.request).toMatchObject({ kind: "reaction", trigger: "ally-targeted-by-attack" });
    expect(store().play?.playback).toMatchObject({ source: "pending", from: 0 });
    const { container } = render(<PlayOverlay />);
    expect(screen.queryByRole("dialog", { name: /can choose/ })).toBeNull();
    act(() => drainPlayback());
    // Played up to the moment: the question shows, over the board as it was then.
    const card = screen.getByRole("dialog", { name: /can choose/ });
    expect(within(card).getByText("Give the attack disadvantage?")).toBeTruthy();
    const questionLog = store().play!.pending!.log.length;
    expect(store().play!.pending!.log.some((entry) => entry.type === "AttackRolled")).toBe(false);
    await userEvent.click(within(card).getByRole("button", { name: /^Protection/ }));
    // The rest of the goblin's turn plays back from where the question was.
    expect(store().play?.playback).toMatchObject({ source: "log", from: questionLog });
    expect(store().log.slice(questionLog).find((entry) => entry.type === "AttackRolled")?.data?.rollMode).toBe("disadvantage");
    act(() => drainPlayback());
    expect(store().play?.status).toEqual({ kind: "your-turn", actorId: "pc-fighter" });
    expect(container).toBeTruthy();
  });
});

describe("this fight's settings", () => {
  it("Always on a question answers it, and sets the reaction so it's taken from then on without asking", async () => {
    load(board({ "pc-fighter": 20 }, { "pc-fighter": { x: 5, y: 4 }, "enemy-goblin-1": { x: 6, y: 4 } }));
    store().startPlay({ control: EVERYONE, playbackSpeed: 0 });
    store().playCommand({ kind: "move", actorId: "pc-fighter", waypoints: [{ x: 2, y: 4 }] });
    render(<PlayOverlay />);
    const card = screen.getByRole("dialog", { name: "Goblin 1 can choose" });
    const setting = within(card).getByRole("radiogroup", { name: "Opportunity attacks, this fight" });
    expect(within(setting).getByRole("radio", { name: "Ask" }).getAttribute("aria-checked")).toBe("true");
    await userEvent.click(within(setting).getByRole("radio", { name: "Always" }));
    expect(screen.queryByRole("dialog", { name: "Goblin 1 can choose" })).toBeNull();
    expect(store().play?.control.reactions).toEqual({ "enemy-goblin-1:opportunity-attack": "use" });
    expect(store().log.some((entry) => entry.type === "OpportunityAttackTriggered")).toBe(true);
  });

  it("Never on a question answers no, and the hotbar's Reactions tab shows and changes the same settings", async () => {
    load(board({ "pc-fighter": 20 }, { "pc-fighter": { x: 5, y: 4 }, "enemy-goblin-1": { x: 6, y: 4 } }));
    store().startPlay({ control: EVERYONE, playbackSpeed: 0 });
    store().playCommand({ kind: "move", actorId: "pc-fighter", waypoints: [{ x: 2, y: 4 }] });
    render(<PlayOverlay />);
    const card = screen.getByRole("dialog", { name: "Goblin 1 can choose" });
    await userEvent.click(within(within(card).getByRole("radiogroup", { name: "Opportunity attacks, this fight" })).getByRole("radio", { name: "Never" }));
    expect(store().log.some((entry) => entry.type === "OpportunityAttackTriggered")).toBe(false);
    expect(store().play?.control.reactions).toEqual({ "enemy-goblin-1:opportunity-attack": "never" });

    // The fighter's own reactions, on its hotbar.
    expect(hotbarFor(store().encounter, "pc-fighter").reactions).toEqual([{ key: "opportunity-attack", name: "Opportunity attacks", detail: "with Longsword" }]);
    const bar = screen.getByRole("region", { name: "Fighter's turn" });
    await userEvent.click(within(bar).getByRole("tab", { name: /^Reactions/ }));
    const row = within(bar).getByRole("radiogroup", { name: "Opportunity attacks, this fight" });
    await userEvent.click(within(row).getByRole("radio", { name: "Never" }));
    expect(store().play?.control.reactions).toMatchObject({ "pc-fighter:opportunity-attack": "never" });
  });
});
