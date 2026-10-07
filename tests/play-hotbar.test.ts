import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sampleEncounter, type CreatureDefinition, type EncounterSnapshot, type PlayControl, type Point } from "@/engine";
import { findSrdFeature, findSrdSpell, findSrdWeapon } from "@/data/srd";
import { loadSrdMonster } from "@/data/srd/monsters";
import { FEATURE_TEMPLATES } from "@/lib/ability-editor/templates";
import { hotbarFor, type HotbarButton, type HotbarGroup, type HotbarModel, type HotbarTab } from "@/lib/play/hotbar";
import { targetLine } from "@/lib/play/targeting";
import { aimAtCreature, backOutOfAiming, finishAiming, pressHotbar } from "@/hooks/usePlayAim";
import { blankCharacter, quickBuild, rebuildActor, withSuggestions } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
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
  useEncounterStore.setState({ encounter, log: [], undoStack: [], redoStack: [], undoPlay: [], redoPlay: [] });
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
const group = (model: HotbarModel, id: HotbarTab, groupId: HotbarGroup) => model.tabs.find((entry) => entry.id === id)!.groups.find((entry) => entry.id === groupId)?.buttons ?? [];
const names = (buttons: HotbarButton[]) => buttons.map((button) => button.name);
/** Each tab's groups and the names in them, in order. */
const layout = (model: HotbarModel) => Object.fromEntries(model.tabs.map((entry) => [entry.id, Object.fromEntries(entry.groups.map((inner) => [inner.id, names(inner.buttons)]))]));
const button = (model: HotbarModel, name: string) => model.tabs.flatMap((entry) => entry.buttons).find((candidate) => candidate.name === name)!;
const combatant = (id: string) => store().encounter.combatants.find((candidate) => candidate.id === id)!;

describe("what's on the hotbar", () => {
  it("puts each of a fighter's abilities on the tab of the slot it takes, grouped by what it is, with its cost and variants", () => {
    const board = load();
    const model = hotbarFor(board, "pc-fighter");
    expect(model.tabs.map((entry) => entry.id)).toEqual(["actions", "bonus", "reactions"]);
    expect(layout(model)).toEqual({
      // No Extra Attack button: its swings ride the weapons. Action Surge is free: it goes with the actions.
      actions: {
        attacks: ["Longsword", "Greataxe"],
        features: ["Action Surge"],
        common: ["Dash", "Disengage", "Dodge", "Hide", "Help"]
      },
      // The greataxe's bonus-action swing, Second Wind and Rage.
      bonus: { attacks: ["Greataxe"], features: ["Second Wind", "Rage"] },
      // Reactions aren't buttons: they're asked for when they come up, and the tab sets how.
      reactions: {}
    });
    // A weapon is pressed as a swing of the Attack action: two attacks, the first taking the action.
    expect(button(model, "Longsword")).toMatchObject({ automation: "full", slot: "action", tab: "actions", group: "attacks", routine: { name: "Extra Attack", left: 2, total: 2, open: false } });
    // The greataxe swings plainly or as a power attack.
    const greataxe = group(model, "actions", "attacks").find((entry) => entry.name === "Greataxe")!;
    expect(greataxe.variants.map((variant) => [variant.label, variant.swing])).toEqual([["Normal", {}], ["Power Attack", {}]]);
    expect(greataxe.variants[0]!.aim).toEqual({ kind: "creatures", who: "foes", count: 1, repeat: false, range: 5 });
    // Its bonus-action swing isn't one of the Attack action's: a plain use.
    expect(group(model, "bonus", "attacks")[0]).toMatchObject({ slot: "bonus", tab: "bonus" });
    expect(group(model, "bonus", "attacks")[0]!.routine).toBeUndefined();
    expect(model.routines).toEqual([]);
    // Each feature with what it spends.
    expect([...group(model, "actions", "features"), ...group(model, "bonus", "features")].map((entry) => [entry.name, entry.cost, entry.slot])).toEqual([
      ["Action Surge", "1 action surge", "free"],
      ["Second Wind", "1 second wind", "bonus"],
      ["Rage", "1 rage", "bonus"]
    ]);
    // Common: the actions anyone can take. Hide and Help are by hand; Escape only while grappled.
    expect(group(model, "actions", "common").map((entry) => [entry.name, entry.automation])).toEqual([
      ["Dash", "full"], ["Disengage", "full"], ["Dodge", "full"], ["Hide", "by-hand"], ["Help", "by-hand"]
    ]);
    // The number keys count along a tab's groups in order.
    expect(names(tab(model, "actions"))).toEqual(["Longsword", "Greataxe", "Action Surge", "Dash", "Disengage", "Dodge", "Hide", "Help"]);
    expect(model.tabs.flatMap((entry) => entry.buttons).some((entry) => entry.name.includes("reaction"))).toBe(false);
  });

  it("puts spells, a quickened spell, Cunning Action and a potion on the tab of the slot each takes (HOTBAR_REDESIGN_PLAN.md §1)", () => {
    const board = load((encounter) => {
      const fighterDefinition = encounter.definitions.find((definition) => definition.id === "def-fighter")!;
      fighterDefinition.spells = ["srd:spell:fire-bolt", "srd:spell:fireball", "srd:spell:healing-word", "srd:spell:misty-step"].map((id) => structuredClone(findSrdSpell(id)!));
      fighterDefinition.features = [
        ...(fighterDefinition.features ?? []),
        { ...structuredClone(findSrdFeature("srd:feature:cunning-action")!), id: "f-cunning" },
        { id: "f-quick", name: "Metamagic: Quickened Spell", category: "feature", automationSupport: "full", effects: [{ kind: "metamagic", option: "quickened", resourceCost: { resourceId: "sorcery-points", amount: 2 } }] }
      ];
      fighterDefinition.items = [{
        id: "potions", name: "Potion of Healing", type: "potion", supply: { id: "item:potions", size: 2, unit: "count" }, give: { actionType: "action" },
        grantedActions: [{
          kind: "healing", id: "drink", name: "Potion of Healing", actionType: "bonus", range: 0, healing: [{ dice: "2d4+2" }],
          targeting: { target: "self" }, resourceCost: { resourceId: "item:potions", amount: 1 }, automationSupport: "full"
        }],
        automationSupport: "full"
      }];
      const resources = { "slot-1": 4, "slot-2": 3, "slot-3": 2, "sorcery-points": 5, "item:potions": 2 };
      fighterDefinition.resources = { ...fighterDefinition.resources, ...resources };
      const fighterToken = encounter.combatants.find((candidate) => candidate.id === "pc-fighter")!;
      fighterToken.resources = { ...fighterToken.resources, ...resources };
    });
    const model = hotbarFor(board, "pc-fighter");
    // An action spell under Actions; a bonus-action spell, and Fireball quickened, under Bonus.
    expect(names(group(model, "actions", "spells"))).toEqual(["Fire Bolt", "Fireball"]);
    expect(names(group(model, "bonus", "spells"))).toEqual(["Fire Bolt (Quickened)", "Healing Word", "Misty Step", "Fireball (Quickened)"]);
    expect(group(model, "bonus", "spells").find((entry) => entry.name === "Fireball (Quickened)")!.variants[0]!.actionId).toMatch(/:meta-quickened/);
    // Cunning Action's Dash, Disengage and Hide: common actions, taken with the bonus action.
    expect(names(group(model, "bonus", "common"))).toEqual(["Cunning Action: Dash", "Cunning Action: Disengage", "Cunning Action: Hide"]);
    // A potion drunk with a bonus action and given with an action: a button on each tab, each saying which.
    expect(group(model, "bonus", "items").map((entry) => [entry.name, entry.cost, entry.slot])).toEqual([["Potion of Healing: Drink", "×2", "bonus"]]);
    expect(group(model, "actions", "items").map((entry) => [entry.name, entry.cost, entry.slot])).toEqual([["Potion of Healing: Give", "×2", "action"]]);
    expect(group(model, "actions", "items")[0]!.variants[0]!.aim).toEqual({ kind: "creatures", who: "allies", count: 1, repeat: false, range: 5 });
    // The order of a tab's groups: Attacks, Spells, Features, Items, Common.
    expect(model.tabs.find((entry) => entry.id === "bonus")!.groups.map((entry) => entry.id)).toEqual(["attacks", "spells", "features", "items", "common"]);
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
    const spells = group(model, "actions", "spells");
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
      ["3rd", "No 3rd-level slots left"], ["4th · +1d6", undefined], ["5th · +2d6", undefined]
    ]);
    expect(fireball.defaultVariant).toBe(1);
    expect(fireball.problem).toBeUndefined();
    expect(fireball.variants[0]!.aim).toEqual({ kind: "area" });
    expect(button(model, "Misty Step")).toMatchObject({ slot: "bonus", tab: "bonus", group: "spells" });
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
      ["2nd", { kind: "creatures", who: "foes", count: 3, repeat: true, range: 120 }],
      ["3rd · +1 beam", { kind: "creatures", who: "foes", count: 4, repeat: true, range: 120 }]
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
    pressHotbar(ray, ray.variants.find((variant) => variant.label === "3rd · +1 beam"));
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

  it("a level-5 fighter's weapon takes the Attack action; the swing left stays on its weapons, a step and Second Wind between (HOTBAR_REDESIGN_PLAN.md §3)", () => {
    load((encounter) => {
      toughGoblins(encounter);
      place(encounter, "pc-fighter", { x: 2, y: 1 });
      place(encounter, "enemy-goblin-1", { x: 3, y: 1 });
      place(encounter, "enemy-goblin-2", { x: 3, y: 4 });
    });
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    const from = store().log.length;
    pressHotbar(button(hotbarFor(store().encounter, "pc-fighter"), "Longsword"));
    expect(ui().armed).toMatchObject({ actionId: "longsword", swing: {} });
    aimAtCreature("enemy-goblin-1");
    // One swing made: both weapons have the one left; the rest of the action is gone, the bonus action isn't.
    let model = hotbarFor(store().encounter, "pc-fighter");
    expect(model.routines).toEqual([{ slot: "action", name: "Extra Attack", left: 1, total: 2, open: true }]);
    expect(button(model, "Longsword").routine).toEqual({ name: "Extra Attack", left: 1, total: 2, open: true });
    expect(group(model, "actions", "attacks").find((entry) => entry.name === "Greataxe")!.problem).toBeUndefined();
    // Anything else that takes an action: the action went to the routine (D8).
    expect(button(model, "Dash").problem).toBe("Fighter's action went to Extra Attack");
    expect(button(model, "Second Wind").problem).toBeUndefined();
    // Step next to the other goblin, catch a breath, then swing at it with the greataxe.
    store().playCommand({ kind: "move", actorId: "pc-fighter", waypoints: [{ x: 2, y: 3 }] });
    pressHotbar(button(hotbarFor(store().encounter, "pc-fighter"), "Second Wind"));
    pressHotbar(group(hotbarFor(store().encounter, "pc-fighter"), "actions", "attacks").find((entry) => entry.name === "Greataxe")!);
    aimAtCreature("enemy-goblin-2");
    model = hotbarFor(store().encounter, "pc-fighter");
    expect(model.routines).toEqual([]);
    expect(button(model, "Longsword").problem).toBe("Fighter has already used its action");
    const log = store().log.slice(from);
    const swings = log.filter((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "pc-fighter");
    expect(swings.map((entry) => [entry.data?.targetId, entry.data?.actionId])).toEqual([["enemy-goblin-1", "longsword"], ["enemy-goblin-2", "weapon-action-w-axe"]]);
    const step = log.findIndex((entry) => entry.type === "CombatantMoved" && entry.data?.combatantId === "pc-fighter");
    expect(step).toBeGreaterThan(log.indexOf(swings[0]!));
    expect(step).toBeLessThan(log.indexOf(swings[1]!));
    expect(log.filter((entry) => entry.type === "MultiattackResolved").map((entry) => entry.data?.attacks)).toEqual([2]);
  });

  it("an owlbear's Multiattack: its beak and claws each a swing, and the claws greyed once used", async () => {
    const owlbear = (await loadSrdMonster("srd:monster:owlbear"))!;
    load((encounter) => {
      toughGoblins(encounter);
      encounter.definitions = encounter.definitions.map((definition) => (definition.id === "def-fighter" ? { ...owlbear, id: "def-fighter" } : definition));
      place(encounter, "pc-fighter", { x: 2, y: 2 });
      place(encounter, "enemy-goblin-1", { x: 1, y: 1 });
      place(encounter, "enemy-goblin-2", { x: 2, y: 1 });
      place(encounter, "pc-archer", { x: 0, y: 7 });
    });
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    let model = hotbarFor(store().encounter, "pc-fighter");
    expect(names(group(model, "actions", "attacks"))).toEqual(["Beak", "Claws"]);
    expect(button(model, "Claws").routine).toEqual({ name: "Multiattack", left: 2, total: 2, open: false });
    pressHotbar(button(model, "Claws"));
    aimAtCreature("enemy-goblin-1");
    model = hotbarFor(store().encounter, "pc-fighter");
    expect(button(model, "Claws").problem).toBe("No Claws attack left in Multiattack");
    expect(button(model, "Beak")).toMatchObject({ problem: undefined, routine: { left: 1, open: true } });
  });

  it("a monk's Flurry of Blows: a button of its own that opens it; its second strike rides Unarmed Strike", () => {
    const sources = SRD_BUILD_SOURCES;
    const monk = rebuildActor(blankCharacter("def-fighter", "PC"), withSuggestions(quickBuild(sources, { classId: "srd:class:monk", level: 5 }), sources), sources).definition;
    load((encounter) => {
      toughGoblins(encounter);
      encounter.definitions = encounter.definitions.map((definition) => (definition.id === "def-fighter" ? { ...monk, id: "def-fighter" } : definition));
      const token = encounter.combatants.find((combatant) => combatant.id === "pc-fighter")!;
      token.resources = { ...(monk.resources ?? {}) };
      token.currentHp = monk.maxHp;
      place(encounter, "pc-fighter", { x: 2, y: 1 });
      place(encounter, "enemy-goblin-1", { x: 3, y: 1 });
    });
    store().startPlay({ control: PARTY, playbackSpeed: 0 });
    let model = hotbarFor(store().encounter, "pc-fighter");
    const flurry = button(model, "Flurry of Blows");
    expect(flurry).toMatchObject({ tab: "bonus", group: "attacks", cost: "1 focus point", routine: { name: "Flurry of Blows", total: 2, open: false } });
    const strike = flurry.variants[0]!.actionId;
    expect(flurry.variants[0]!.swing).toEqual({ routineId: flurry.key });
    // Martial Arts' bonus-action strike: a plain use, while no Flurry is open.
    const plain = group(model, "bonus", "attacks").find((entry) => entry !== flurry && entry.variants.some((variant) => variant.actionId === strike))!;
    expect(plain.routine).toBeUndefined();
    pressHotbar(flurry);
    expect(ui().armed).toMatchObject({ actionId: strike, swing: { routineId: flurry.key } });
    aimAtCreature("enemy-goblin-1");
    model = hotbarFor(store().encounter, "pc-fighter");
    expect(model.routines).toEqual([{ slot: "bonus", name: "Flurry of Blows", left: 1, total: 2, open: true }]);
    const second = group(model, "bonus", "attacks").find((entry) => entry.name === plain.name && entry !== button(model, "Flurry of Blows"))!;
    expect(second).toMatchObject({ problem: undefined, routine: { name: "Flurry of Blows", left: 1, open: true } });
    pressHotbar(second);
    aimAtCreature("enemy-goblin-1");
    expect(hotbarFor(store().encounter, "pc-fighter").routines).toEqual([]);
    expect(store().log.filter((entry) => entry.type === "AttackRolled" && entry.data?.attackerId === "pc-fighter")).toHaveLength(2);
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
    expect(taunt).toMatchObject({ automation: "by-hand", tab: "bonus", group: "features" });
    pressHotbar(taunt);
    expect(store().log.at(-1)).toMatchObject({ type: "ManualActionUsed", message: "Fighter uses Taunt: resolve it by hand" });
    expect(combatant("pc-fighter").resources?.taunts).toBe(0);
    expect(button(hotbarFor(store().encounter, "pc-fighter"), "Taunt").problem).toBe("Fighter has already used its bonus action");
  });
});
