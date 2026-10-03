import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleEncounter, type CreatureDefinition, type EncounterSnapshot, type PlayControl, type Point } from "@/engine";
import { findSrdFeature, findSrdSpell, findSrdWeapon } from "@/data/srd";
import { loadSrdMonster } from "@/data/srd/monsters";
import { FEATURE_TEMPLATES } from "@/lib/ability-editor/templates";
import { hotbarFor, type HotbarButton, type HotbarModel, type HotbarTab } from "@/lib/play/hotbar";
import { targetLine } from "@/lib/play/targeting";
import { aimAtCreature, backOutOfAiming, finishAiming, planSwingStep, pressHotbar } from "@/hooks/usePlayAim";
import { swingQuestion } from "@/hooks/usePlayMove";
import { useEncounterStore } from "@/store/encounter-store";
import { usePlayUiStore } from "@/store/play-ui-store";

/** The hotbar (PLAY_MODE_PLAN.md Phase 5): what's on it, and using it — aimed at creatures, upcast, swing by swing, by hand. */
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
const INITIATIVE: Record<string, number> = { "pc-fighter": 20, "pc-archer": 15, "enemy-goblin-1": 12, "enemy-goblin-2": 8 };

/** The sample fighter with Rage, Extra Attack and a greataxe that can power-attack and swing as a bonus action. */
function fighter(base: CreatureDefinition): CreatureDefinition {
  const rage = { ...FEATURE_TEMPLATES.find((template) => template.label === "Rage")!.record([]), id: "f-rage" };
  const extra = { ...structuredClone(findSrdFeature("srd:feature:extra-attack")!), id: "f-extra" };
  const greataxe = {
    ...structuredClone(findSrdWeapon("srd:weapon:greataxe")!),
    id: "w-axe",
    actionId: "weapon-action-w-axe",
    powerAttack: true,
    usableAs: ["action", "bonus", "reaction"] as Array<"action" | "bonus" | "reaction">
  };
  return { ...base, features: [...(base.features ?? []), rage, extra], weapons: [greataxe], resources: { ...base.resources, rage: 3 } };
}

/** The sample fight with the fighter made `fighter()`, everyone placed as `positions` says, the fighter first. */
function load(change?: (encounter: EncounterSnapshot) => void): EncounterSnapshot {
  const encounter = structuredClone(sampleEncounter);
  encounter.seed = "play-hotbar";
  encounter.map.walls = [];
  encounter.definitions = encounter.definitions.map((definition) => (definition.id === "def-fighter" ? fighter(definition) : definition));
  encounter.combatants = encounter.combatants.map((combatant) => ({
    ...combatant,
    initiative: INITIATIVE[combatant.id],
    resources: combatant.id === "pc-fighter" ? { ...combatant.resources, rage: 3 } : combatant.resources
  }));
  change?.(encounter);
  useEncounterStore.setState({ encounter, log: [], undoStack: [], redoStack: [], undoLogLengths: [], redoLogTails: [] });
  return encounter;
}

function place(encounter: EncounterSnapshot, id: string, position: Point) {
  encounter.combatants.find((combatant) => combatant.id === id)!.position = position;
}

/** Goblins that live through a few rays (a ray at a creature already dead is lost). */
function toughGoblins(encounter: EncounterSnapshot) {
  encounter.definitions.find((definition) => definition.id === "def-goblin")!.maxHp = 80;
  for (const goblin of encounter.combatants.filter((candidate) => candidate.faction === "enemy")) goblin.currentHp = 80;
}

const tab = (model: HotbarModel, id: HotbarTab) => model.tabs.find((entry) => entry.id === id)!.buttons;
const names = (buttons: HotbarButton[]) => buttons.map((button) => button.name);
const button = (model: HotbarModel, name: string) => model.tabs.flatMap((entry) => entry.buttons).find((candidate) => candidate.name === name)!;
const combatant = (id: string) => store().encounter.combatants.find((candidate) => candidate.id === id)!;

describe("what's on the hotbar", () => {
  it("puts each of a fighter's abilities on its tab, with its cost and variants", () => {
    const board = load();
    const model = hotbarFor(board, "pc-fighter");
    // A multiattack heads the attacks, as in a statblock.
    expect(names(tab(model, "attacks"))).toEqual(["Extra Attack", "Longsword", "Greataxe"]);
    expect(button(model, "Extra Attack")).toMatchObject({ cost: "2 attacks", automation: "full", slot: "action" });
    expect(button(model, "Extra Attack").variants[0]!.aim).toEqual({ kind: "routine", range: 5 });
    // The greataxe swings plainly or as a power attack; its bonus-action copy is on the Bonus tab.
    const greataxe = tab(model, "attacks").find((entry) => entry.name === "Greataxe")!;
    expect(greataxe.variants.map((variant) => variant.label)).toEqual(["Normal", "Power Attack"]);
    expect(greataxe.variants[0]!.aim).toEqual({ kind: "creatures", who: "foes", count: 1, repeat: false, range: 5 });
    expect(names(tab(model, "bonus"))).toEqual(["Greataxe"]);
    expect(tab(model, "bonus")[0]!.slot).toBe("bonus");
    // Features: Second Wind, Action Surge, Rage — each with what it spends.
    expect(tab(model, "features").map((entry) => [entry.name, entry.cost, entry.slot])).toEqual([
      ["Second Wind", "1 second wind", "bonus"],
      ["Action Surge", "1 action surge", "free"],
      ["Rage", "1 rage", "bonus"]
    ]);
    // Common: the actions anyone can take. Hide and Help are by hand; Escape only while grappled.
    expect(tab(model, "common").map((entry) => [entry.name, entry.automation])).toEqual([
      ["Dash", "full"], ["Disengage", "full"], ["Dodge", "full"], ["Hide", "by-hand"], ["Help", "by-hand"]
    ]);
    // Reactions aren't on it: they're asked for when they come up.
    expect(model.tabs.flatMap((entry) => entry.buttons).some((entry) => entry.name.includes("reaction"))).toBe(false);
  });

  it("greys out what can't be used now, saying why", () => {
    const board = load((encounter) => {
      const fighterToken = encounter.combatants.find((candidate) => candidate.id === "pc-fighter")!;
      fighterToken.actionEconomy = { action: false, bonus: true, reaction: true };
      fighterToken.resources = { ...fighterToken.resources, rage: 0 };
    });
    const model = hotbarFor(board, "pc-fighter");
    expect(button(model, "Longsword").problem).toBe("Fighter has already used its action");
    expect(button(model, "Dash").problem).toBe("Fighter has already used its action");
    expect(button(model, "Rage").problem).toBe("Not enough rage left");
    // A free action and a bonus action still go.
    expect(button(model, "Action Surge").problem).toBeUndefined();
    expect(button(model, "Second Wind").problem).toBeUndefined();
  });

  it("lists a mage's spells by level, its slots, the slot each can be cast at, and what each aims at", async () => {
    const mage = (await loadSrdMonster("srd:monster:mage"))!;
    const board = load((encounter) => {
      encounter.definitions.push(mage);
      encounter.combatants.push({ ...structuredClone(encounter.combatants[0]!), id: "mage", definitionId: mage.id, displayName: "Mage", position: { x: 4, y: 6 }, initiative: 1, resources: { ...mage.resources, "slot-3": 0 } });
    });
    const model = hotbarFor(board, "mage");
    const spells = tab(model, "spells");
    // Cantrips first, then by level; Shield and Counterspell are reactions, asked for when they come up.
    expect(spells.map((entry) => entry.spellLevel)).toEqual([...spells.map((entry) => entry.spellLevel)].sort((a, b) => (a ?? 0) - (b ?? 0)));
    expect(names(spells)).not.toContain("Shield");
    expect(names(spells)).not.toContain("Counterspell");
    expect(model.slots).toEqual([
      { level: 1, left: 4, full: 4 }, { level: 2, left: 3, full: 3 }, { level: 3, left: 0, full: 3 }, { level: 4, left: 3, full: 3 }, { level: 5, left: 1, full: 1 }
    ]);
    // No 3rd-level slot left: Fireball goes at 4th.
    const fireball = button(model, "Fireball");
    expect(fireball.variants.map((variant) => [variant.label, variant.problem])).toEqual([
      ["Level 3", "No 3rd-level slots left"], ["Level 4", undefined], ["Level 5", undefined]
    ]);
    expect(fireball.defaultVariant).toBe(1);
    expect(fireball.problem).toBeUndefined();
    expect(fireball.variants[0]!.aim).toEqual({ kind: "area" });
    expect(button(model, "Misty Step")).toMatchObject({ slot: "bonus" });
    expect(button(model, "Misty Step").variants[0]!.aim).toEqual({ kind: "place", moves: "self" });
  });

  it("aims rays, an upcast Hold Person and Bless at as many creatures as they take", () => {
    const board = load((encounter) => {
      const archer = encounter.definitions.find((definition) => definition.id === "def-archer")!;
      archer.spells = ["srd:spell:scorching-ray", "srd:spell:hold-person", "srd:spell:bless"].map((id) => structuredClone(findSrdSpell(id)!));
      archer.resources = { ...archer.resources, "slot-1": 2, "slot-2": 2, "slot-3": 1 };
    });
    const model = hotbarFor(board, "pc-archer");
    expect(button(model, "Scorching Ray").variants.map((variant) => [variant.label, variant.aim])).toEqual([
      ["Level 2", { kind: "creatures", who: "foes", count: 3, repeat: true, range: 120 }],
      ["Level 3", { kind: "creatures", who: "foes", count: 4, repeat: true, range: 120 }]
    ]);
    expect(button(model, "Hold Person").variants.map((variant) => variant.aim)).toEqual([
      { kind: "creatures", who: "foes", count: 1, repeat: false, range: 60 },
      { kind: "creatures", who: "foes", count: 2, repeat: false, range: 60 }
    ]);
    expect(button(model, "Bless").variants[0]!.aim).toEqual({ kind: "creatures", who: "allies", count: 3, repeat: false, range: 30 });
    expect(button(model, "Bless").concentration).toBe(true);
  });
});

describe("what aiming says", () => {
  it("over a creature: the chance to hit, the AC and the damage, or why it can't", () => {
    const board = load((encounter) => place(encounter, "enemy-goblin-1", { x: 2, y: 1 }));
    expect(targetLine(board, "pc-fighter", "longsword", "enemy-goblin-1")).toEqual({
      ok: true,
      text: expect.stringMatching(/^\d+% to hit · \+\d+ against AC \d+ · [\d.]+ damage on a hit$/)
    });
    expect(targetLine(board, "pc-fighter", "longsword", "enemy-goblin-2")).toEqual({ ok: false, text: expect.stringMatching(/beyond|reach|range/) });
  });
});

describe("using the hotbar", () => {
  it("fires an upcast Scorching Ray's four rays at the creatures picked, one picked twice, spending the 3rd-level slot", () => {
    load((encounter) => {
      toughGoblins(encounter);
      const fighterDefinition = encounter.definitions.find((definition) => definition.id === "def-fighter")!;
      fighterDefinition.spells = [structuredClone(findSrdSpell("srd:spell:scorching-ray")!)];
      fighterDefinition.resources = { ...fighterDefinition.resources, "slot-2": 1, "slot-3": 1 };
      const fighterToken = encounter.combatants.find((candidate) => candidate.id === "pc-fighter")!;
      fighterToken.resources = { ...fighterToken.resources, "slot-2": 1, "slot-3": 1 };
    });
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    const ray = button(hotbarFor(store().encounter, "pc-fighter"), "Scorching Ray");
    pressHotbar(ray, ray.variants.find((variant) => variant.label === "Level 3"));
    expect(ui().armed).toMatchObject({ actionId: "srd:spell:scorching-ray:action:upcast-3", picked: [] });
    const from = store().log.length;
    aimAtCreature("enemy-goblin-1");
    aimAtCreature("enemy-goblin-1");
    aimAtCreature("enemy-goblin-2");
    expect(ui().armed?.picked).toEqual(["enemy-goblin-1", "enemy-goblin-1", "enemy-goblin-2"]);
    expect(store().log).toHaveLength(from);
    // The fourth pick fires it.
    aimAtCreature("enemy-goblin-2");
    expect(ui().armed).toBeNull();
    const rays = store().log.slice(from).filter((entry) => entry.type === "AttackRolled");
    expect(rays.map((entry) => entry.data?.targetId)).toEqual(["enemy-goblin-1", "enemy-goblin-1", "enemy-goblin-2", "enemy-goblin-2"]);
    expect(combatant("pc-fighter").resources).toMatchObject({ "slot-2": 1, "slot-3": 0 });
  });

  it("Enter fires at fewer than it could take; Esc takes back a pick, then puts it away", () => {
    load((encounter) => {
      toughGoblins(encounter);
      const fighterDefinition = encounter.definitions.find((definition) => definition.id === "def-fighter")!;
      fighterDefinition.spells = [structuredClone(findSrdSpell("srd:spell:scorching-ray")!)];
      fighterDefinition.resources = { ...fighterDefinition.resources, "slot-2": 1 };
      const fighterToken = encounter.combatants.find((candidate) => candidate.id === "pc-fighter")!;
      fighterToken.resources = { ...fighterToken.resources, "slot-2": 1 };
    });
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    pressHotbar(button(hotbarFor(store().encounter, "pc-fighter"), "Scorching Ray"));
    aimAtCreature("enemy-goblin-1");
    aimAtCreature("enemy-goblin-2");
    expect(backOutOfAiming()).toBe(true);
    expect(ui().armed?.picked).toEqual(["enemy-goblin-1"]);
    const from = store().log.length;
    expect(finishAiming()).toBe(true);
    // Three rays, all at the one creature picked.
    expect(store().log.slice(from).filter((entry) => entry.type === "AttackRolled").map((entry) => entry.data?.targetId)).toEqual(["enemy-goblin-1", "enemy-goblin-1", "enemy-goblin-1"]);
    // Nothing armed: Esc does nothing more.
    expect(backOutOfAiming()).toBe(false);
  });

  it("refuses a creature out of range, saying why, and keeps aiming", () => {
    load();
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    pressHotbar(button(hotbarFor(store().encounter, "pc-fighter"), "Longsword"));
    const from = store().log.length;
    aimAtCreature("enemy-goblin-1");
    expect(ui().note).toMatch(/beyond|reach|range/);
    expect(ui().armed).not.toBeNull();
    expect(store().log).toHaveLength(from);
  });

  it("a level-5 fighter's Attack makes two swings, stepping between them", () => {
    load((encounter) => {
      place(encounter, "pc-fighter", { x: 2, y: 1 });
      place(encounter, "enemy-goblin-1", { x: 3, y: 1 });
      place(encounter, "enemy-goblin-2", { x: 3, y: 4 });
    });
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    const from = store().log.length;
    pressHotbar(button(hotbarFor(store().encounter, "pc-fighter"), "Extra Attack"));
    aimAtCreature("enemy-goblin-1");
    // The first swing is made; the second waits for a person.
    const swing = swingQuestion(store());
    expect(swing?.request).toMatchObject({ kind: "multiattack-swing", swing: 2, of: 2, attackerId: "pc-fighter" });
    // Step next to the other goblin, then swing at it.
    expect(planSwingStep({ x: 2, y: 3 }, true)).toBe(true);
    aimAtCreature("enemy-goblin-2");
    expect(swingQuestion(store())).toBeNull();
    const log = store().log.slice(from);
    const swings = log.filter((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "pc-fighter");
    expect(swings.map((entry) => entry.data?.targetId)).toEqual(["enemy-goblin-1", "enemy-goblin-2"]);
    const step = log.findIndex((entry) => entry.type === "CombatantMoved" && entry.data?.combatantId === "pc-fighter");
    expect(step).toBeGreaterThan(log.indexOf(swings[0]!));
    expect(step).toBeLessThan(log.indexOf(swings[1]!));
    expect(combatant("pc-fighter").position).toEqual({ x: 2, y: 3 });
  });

  it("uses an ability the engine doesn't run by hand: its slot and cost are spent, and it's logged", () => {
    load((encounter) => {
      const fighterDefinition = encounter.definitions.find((definition) => definition.id === "def-fighter")!;
      fighterDefinition.bonusActions = [{
        kind: "unsupported", id: "taunt", name: "Taunt", actionType: "bonus", description: "The target has disadvantage on attacks against others.",
        resourceCost: { resourceId: "taunts", amount: 1 }, automationSupport: "unsupported"
      } as never];
      fighterDefinition.resources = { ...fighterDefinition.resources, taunts: 1 };
      const fighterToken = encounter.combatants.find((candidate) => candidate.id === "pc-fighter")!;
      fighterToken.resources = { ...fighterToken.resources, taunts: 1 };
    });
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    const taunt = button(hotbarFor(store().encounter, "pc-fighter"), "Taunt");
    expect(taunt).toMatchObject({ automation: "by-hand", tab: "bonus" });
    pressHotbar(taunt);
    expect(store().log.at(-1)).toMatchObject({ type: "ManualActionUsed", message: "Fighter uses Taunt: resolve it by hand" });
    expect(combatant("pc-fighter").resources?.taunts).toBe(0);
    expect(button(hotbarFor(store().encounter, "pc-fighter"), "Taunt").problem).toBe("Fighter has already used its bonus action");
  });
});
