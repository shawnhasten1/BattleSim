// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildBattleReport,
  LEGENDARY_POINTS,
  runAutomatedFromHere,
  runBatchSimulations,
  sampleEncounter,
  type ActionDefinition,
  type EncounterSnapshot,
  type PlayControl,
  type TurnOptionRequest
} from "@/engine";
import { loadSrdMonster } from "@/data/srd/monsters";
import { PlayOverlay } from "@/components/play/PlayOverlay";
import { aimAtCreature, aimAtSquare, pickTurnOption } from "@/hooks/usePlayAim";
import { replayTo } from "@/lib/replay";
import { useEncounterStore } from "@/store/encounter-store";
import { usePlayUiStore } from "@/store/play-ui-store";

/** Legendary and lair actions you play, the DM's hand, and the end (PLAY_MODE_PLAN.md Phase 8). */
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
  vi.unstubAllGlobals();
  useEncounterStore.setState(pristine, true);
  usePlayUiStore.setState(pristineUi, true);
});

const EVERYONE: PlayControl = { factions: { party: "human", enemy: "human" } };
const PARTY: PlayControl = { factions: { party: "human", enemy: "ai" } };

const ERUPTION: ActionDefinition = {
  kind: "area-save", id: "lair-eruption", name: "Magma Eruption", actionType: "action", saveAbility: "dex", dc: 15,
  range: 120, area: { type: "circle", size: 10 }, targeting: { origin: "point", range: 120 },
  damage: [{ dice: "3d6", damageType: "fire" }], halfDamageOnSuccess: true, onSuccess: "half", affects: "hostile",
  automationSupport: "full"
} as ActionDefinition;

/** The fighter and archer against an Adult Red Dragon (in its lair, if asked), everyone played by a person. */
async function dragonFight(options: { lair?: boolean } = {}): Promise<EncounterSnapshot> {
  const dragon = structuredClone((await loadSrdMonster("srd:monster:adult-red-dragon"))!);
  if (options.lair) dragon.lairActions = [structuredClone(ERUPTION)];
  const encounter = structuredClone(sampleEncounter);
  encounter.seed = "play-legendary";
  encounter.map.walls = [];
  encounter.map.terrain = [];
  encounter.map.grid = { ...encounter.map.grid, width: 16, height: 10 };
  encounter.definitions.push(dragon);
  const goblin = encounter.combatants.find((combatant) => combatant.faction === "enemy")!;
  const initiative: Record<string, number> = { "pc-fighter": 20, "pc-archer": 15 };
  encounter.combatants = [
    ...encounter.combatants.filter((combatant) => combatant.faction === "party").map((combatant) => ({ ...combatant, initiative: initiative[combatant.id] })),
    {
      ...structuredClone(goblin), id: "dragon", definitionId: dragon.id, displayName: "Dragon", position: { x: 3, y: 1 },
      currentHp: dragon.maxHp, initiative: 10, resources: { ...(dragon.resources ?? {}) }, ...(options.lair ? { inLair: true } : {})
    }
  ];
  encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!.position = { x: 1, y: 1 };
  useEncounterStore.setState({ encounter, log: [], undoStack: [], redoStack: [], undoLogLengths: [], redoLogTails: [] });
  return encounter;
}

const combatant = (id: string) => store().encounter.combatants.find((candidate) => candidate.id === id)!;
const question = () => store().play?.pending?.request as TurnOptionRequest | undefined;

describe("legendary actions you play", () => {
  it("the dragon takes a Tail Attack at the fighter after its turn; its points come back on its own turn", async () => {
    await dragonFight();
    store().startPlay({ control: EVERYONE, playbackSpeed: 0 });
    expect(store().play?.status).toEqual({ kind: "your-turn", actorId: "pc-fighter" });
    store().playCommand({ kind: "end-turn", actorId: "pc-fighter" });

    // After the fighter's turn, the dragon is asked: everything it can afford, Detect by hand, or pass.
    expect(question()).toMatchObject({ kind: "legendary-action", combatantId: "dragon", afterId: "pc-fighter", pointsLeft: 3 });
    expect(question()!.options.map((option) => [option.name, option.cost, Boolean(option.byHand)])).toEqual([
      ["Tail Attack", 1, false], ["Wing Attack", 2, false], ["Detect", 1, true]
    ]);
    const from = store().log.length;
    pickTurnOption(question()!.options.find((option) => option.name === "Tail Attack")!);
    expect(usePlayUiStore.getState().armed).toMatchObject({ actionId: "tail:legendary", aim: { kind: "creatures" } });
    aimAtCreature("pc-fighter");

    expect(store().play?.pending).toBeUndefined();
    const log = store().log.slice(from);
    expect(log.find((entry) => entry.type === "LegendaryActionUsed")?.message).toBe("Dragon uses Tail Attack (legendary, 1 point)");
    expect(log.some((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "dragon" && entry.data?.targetId === "pc-fighter")).toBe(true);
    expect(combatant("dragon").resources?.[LEGENDARY_POINTS]).toBe(2);

    // After the archer's turn it's asked again (2 left), and passes.
    expect(store().play?.status).toEqual({ kind: "your-turn", actorId: "pc-archer" });
    store().playCommand({ kind: "end-turn", actorId: "pc-archer" });
    expect(question()).toMatchObject({ kind: "legendary-action", afterId: "pc-archer", pointsLeft: 2 });
    store().answerPrompt({ kind: "legendary-action", pick: null });
    // Its own turn: the points are back.
    expect(store().play?.status).toEqual({ kind: "your-turn", actorId: "dragon" });
    expect(combatant("dragon").resources?.[LEGENDARY_POINTS]).toBe(3);
  });

  it("one the engine can't run (Detect) is taken by hand: its points spent, and logged", async () => {
    await dragonFight();
    store().startPlay({ control: EVERYONE, playbackSpeed: 0 });
    store().playCommand({ kind: "end-turn", actorId: "pc-fighter" });
    const from = store().log.length;
    pickTurnOption(question()!.options.find((option) => option.name === "Detect")!);
    expect(store().log.slice(from).find((entry) => entry.type === "ManualActionUsed")?.message).toBe("Dragon uses Detect: resolve it by hand");
    expect(combatant("dragon").resources?.[LEGENDARY_POINTS]).toBe(2);
  });

  it("the card: the options with their costs, aiming one, and back", async () => {
    await dragonFight();
    store().startPlay({ control: EVERYONE, playbackSpeed: 0 });
    store().playCommand({ kind: "end-turn", actorId: "pc-fighter" });
    render(<PlayOverlay />);
    const card = screen.getByRole("dialog", { name: "Dragon: legendary action" });
    expect(within(card).getByText("A legendary action after Fighter's turn (3 left)")).toBeTruthy();
    const options = within(card).getAllByRole("button").map((button) => button.textContent);
    expect(options[0]).toMatch(/^Tail Attack · 1 action/);
    expect(options[1]).toMatch(/^Wing Attack · 2 actions/);
    expect(options[2]).toMatch(/^Detect · 1 actionby hand/);
    expect(options.at(-1)).toBe("Pass");
    await userEvent.click(within(card).getByRole("button", { name: /^Tail Attack/ }));
    expect(within(card).getByText("Aim Tail Attack on the map. Esc goes back.")).toBeTruthy();
    await userEvent.click(within(card).getByRole("button", { name: "Back" }));
    expect(within(card).getByRole("button", { name: "Pass" })).toBeTruthy();
  });
});

describe("lair actions you play", () => {
  it("a lair action picked fires on initiative 20, where it's aimed", async () => {
    await dragonFight({ lair: true });
    store().startPlay({ control: EVERYONE, playbackSpeed: 0 });
    store().playCommand({ kind: "end-turn", actorId: "pc-fighter" });
    // The legendary action after the fighter's turn first: passed.
    store().answerPrompt({ kind: "legendary-action", pick: null });
    // Then initiative 20, before the archer (15): the lair.
    expect(question()).toMatchObject({ kind: "lair-action", combatantId: "dragon" });
    expect(question()!.options.map((option) => option.name)).toEqual(["Magma Eruption"]);
    const from = store().log.length;
    pickTurnOption(question()!.options[0]!);
    aimAtSquare({ x: 1, y: 4 });
    const log = store().log.slice(from);
    expect(log.find((entry) => entry.type === "LairAction")?.message).toBe("Lair action (initiative 20): Dragon uses Magma Eruption");
    expect(log.some((entry) => entry.type === "SaveRolled")).toBe(true);
    expect(store().play?.status).toEqual({ kind: "your-turn", actorId: "pc-archer" });
  });
});

describe("the DM's hand", () => {
  function sample(): EncounterSnapshot {
    const encounter = structuredClone(sampleEncounter);
    encounter.seed = "play-dm";
    encounter.map.walls = [...encounter.map.walls, {
      id: "door-1", start: { x: 7, y: 0 }, end: { x: 7, y: 1 }, blocksMovement: true, blocksSight: true, blocksProjectiles: true, cover: "total", doorState: "closed"
    }];
    const initiative: Record<string, number> = { "pc-fighter": 20, "pc-archer": 15, "enemy-goblin-1": 12, "enemy-goblin-2": 8 };
    encounter.combatants = encounter.combatants.map((entry) => ({ ...entry, initiative: initiative[entry.id] }));
    useEncounterStore.setState({ encounter, log: [], undoStack: [], redoStack: [], undoLogLengths: [], redoLogTails: [], currentEncounterId: "enc-saved" });
    return encounter;
  }

  it("HP, a condition and a door, each logged as the DM's: counted in the report, shown in a replay, kept with a saved run", async () => {
    const setup = sample();
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    const from = store().log.length;
    store().playCommand({ kind: "dm", change: { kind: "hp", combatantId: "enemy-goblin-1", hp: 3 } });
    store().playCommand({ kind: "dm", change: { kind: "condition", combatantId: "pc-fighter", add: "prone" } });
    store().playCommand({ kind: "dm", change: { kind: "door", wallId: "door-1", open: true } });
    store().playCommand({ kind: "dm", change: { kind: "hp", combatantId: "pc-archer", hp: 24, tempHp: 5 } });
    const log = store().log;
    expect(log.slice(from).map((entry) => entry.message)).toEqual([
      "The DM took Goblin 1 down to 3 HP",
      expect.stringMatching(/prone/),
      "The DM opened a door",
      "The DM set Archer's temporary HP to 5"
    ]);
    expect(buildBattleReport(setup, log).dmEdits).toBe(4);
    // A replay from the setup shows each.
    const hpEdit = log.findIndex((entry) => entry.message === "The DM took Goblin 1 down to 3 HP");
    expect(replayTo(setup, log, hpEdit + 1).combatants.find((entry) => entry.id === "enemy-goblin-1")!.currentHp).toBe(3);
    const end = replayTo(setup, log, log.length);
    expect(end.map.walls.find((wall) => wall.id === "door-1")!.doorState).toBe("open");
    expect(end.combatants.find((entry) => entry.id === "pc-fighter")!.conditions?.some((condition) => condition.name === "prone")).toBe(true);
    expect(end.combatants.find((entry) => entry.id === "pc-archer")!.tempHp).toBe(5);
    // Still the fighter's turn: the DM's hand changes nothing about whose turn it is.
    expect(store().play?.status).toEqual({ kind: "your-turn", actorId: "pc-fighter" });

    // The goblins fall to the DM: the fight is over, and the run can be kept with its scene.
    store().playCommand({ kind: "dm", change: { kind: "hp", combatantId: "enemy-goblin-1", hp: 0 } });
    store().playCommand({ kind: "dm", change: { kind: "hp", combatantId: "enemy-goblin-2", hp: 0 } });
    expect(store().play?.status.kind).toBe("over");
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ run: { id: "run-1" } }), { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await store().savePlayedRun()).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/simulation-runs");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ encounterId: "enc-saved", outcome: "party", metrics: { mode: "manual", control: PARTY, dmEdits: 6 } });
    expect(body.snapshot.round).toBe(0);
    expect(body.eventLog).toHaveLength(store().log.length);
  });

  it("saving the scene while playing keeps its setup, not the half-fought board", async () => {
    sample();
    useEncounterStore.setState({ currentProjectId: "project-1" });
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    store().playCommand({ kind: "move", actorId: "pc-fighter", waypoints: [{ x: 2, y: 1 }] });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ projects: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await store().saveCurrentEncounter();
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(init.body));
    expect(body.encounter.combatants.find((entry: { id: string }) => entry.id === "pc-fighter").position).toEqual({ x: 1, y: 1 });
    expect(body.encounter.round).toBe(0);
    expect(store().projectStatus).toMatch(/as it was set up/);
  });
});

describe("odds from here", () => {
  it("the AI plays the rest of the fight from the board as it stands, the open turn first", () => {
    const encounter = structuredClone(sampleEncounter);
    encounter.seed = "odds";
    const initiative: Record<string, number> = { "pc-fighter": 20, "pc-archer": 15, "enemy-goblin-1": 12, "enemy-goblin-2": 8 };
    encounter.combatants = encounter.combatants.map((entry) => ({ ...entry, initiative: initiative[entry.id] }));
    useEncounterStore.setState({ encounter, log: [] });
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    const board = store().encounter;
    expect(board.round).toBe(1);
    const run = runAutomatedFromHere(structuredClone(board));
    // The fighter's open turn is played out first: no new turn opens before it closes.
    expect(run.log[0]!.type).not.toBe("TurnStarted");
    expect(run.outcome.completed).toBe(true);
    const summary = runBatchSimulations(board, 10, { fromHere: true, seedPrefix: "odds" });
    expect(summary.runCount).toBe(10);
    expect(summary.rounds.min).toBeGreaterThanOrEqual(1);
    expect(summary.partyWinRate + summary.enemyWinRate).toBeCloseTo(1, 5);
  });

  // A hundred fights played out: slow under a full parallel run.
  it("is offered in the Combat panel while it's waiting on you", { timeout: 30_000 }, async () => {
    const { CombatPanel } = await import("@/components/sidebar/CombatPanel");
    const encounter = structuredClone(sampleEncounter);
    encounter.seed = "odds-ui";
    useEncounterStore.setState({ encounter, log: [] });
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    render(<CombatPanel />);
    await userEvent.click(screen.getByRole("button", { name: /Odds from here/ }));
    expect(screen.getByRole("status").textContent).toMatch(/^From here: the party wins \d+%, the enemies \d+%, in about [\d.]+ more rounds \(100 runs\)\.$/);
    act(() => undefined);
  });
});
