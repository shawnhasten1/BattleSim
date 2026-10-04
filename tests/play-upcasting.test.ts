import { describe, expect, it } from "vitest";
import {
  createEngineState,
  previewSave,
  reactionPolicyKey,
  resolveAreaSaveAction,
  runPlayStep,
  sampleEncounter,
  type CombatantState,
  type CombatCommand,
  type CreatureDefinition,
  type EncounterSnapshot,
  type PlayControl,
  type ReactionRequest,
  type SpellDefinition
} from "@/engine";
import { findSrdSpell } from "@/data/srd";
import { hotbarFor } from "@/lib/play/hotbar";
import { describeQuestion } from "@/lib/play/questions";
import { runStep } from "./helpers/play";

/**
 * Play and higher slots (UPCASTING_AND_COUNTERSPELL_PLAN.md Phase 4): every leveled spell's hotbar button has a chip
 * per slot, saying what each adds; previews follow the chip; a counter is asked for slot by slot with its odds and what
 * the spell would do; and "always" on Counterspell covers it at every slot.
 */

const spell = (id: string): SpellDefinition => structuredClone(findSrdSpell(id) as SpellDefinition);

const blank = (id: string, extra: Partial<CreatureDefinition> = {}): CreatureDefinition => ({
  id, name: id, size: "medium", armorClass: 12, maxHp: 40, speed: 30, type: "humanoid",
  abilities: { str: 10, dex: 14, con: 10, int: 18, wis: 10, cha: 10 }, proficiencyBonus: 3, spellcasting: { ability: "int" },
  actions: [], ...extra
});

type Token = { id: string; def: CreatureDefinition; faction: "party" | "enemy"; at: [number, number]; initiative: number; extra?: Partial<CombatantState> };

function scene(tokens: Token[], seed = "play-upcasting"): EncounterSnapshot {
  const base = structuredClone(sampleEncounter);
  const definitions = [...new Map(tokens.map((token) => [token.def.id, token.def])).values()];
  return {
    ...base, seed, map: { ...base.map, grid: { ...base.map.grid, width: 30, height: 12 }, walls: [], terrain: [] },
    definitions,
    combatants: tokens.map((token): CombatantState => ({
      id: token.id, definitionId: token.def.id, displayName: token.id, faction: token.faction, position: { x: token.at[0], y: token.at[1] },
      currentHp: token.def.maxHp, tempHp: 0, state: "active", tacticsProfile: "basic-melee", resourceStance: "balanced",
      initiative: token.initiative, resources: token.def.resources ? { ...token.def.resources } : undefined, ...token.extra
    }))
  };
}

/** Blight as a homebrew sheet has it (no upcasting), Fireball and Mage Armor from the library. */
const necromancer = (slots: Record<string, number>) => blank("necro", {
  resources: slots,
  spells: ([
    { id: "blight", name: "Blight", level: 4, castingTime: "action", range: 30, resourceCost: { resourceId: "slot-4", amount: 1 }, automationSupport: "full",
      action: { kind: "save", id: "blight-action", name: "Blight", actionType: "action", saveAbility: "con", dc: 15, range: 30,
        damage: [{ dice: "8d8", damageType: "necrotic" }], onSuccess: "half", halfDamageOnSuccess: true, resourceCost: { resourceId: "slot-4", amount: 1 }, automationSupport: "full" } },
    spell("srd:spell:fireball"),
    spell("srd:spell:blight")
  ] as SpellDefinition[]).map((entry, index) => (index === 2 ? { ...entry, id: "srd-blight", name: "Blight (SRD)" } : entry))
});

describe("the hotbar's slot chips", () => {
  it("every leveled spell gets one per slot, what each adds beside it, the lowest left first", () => {
    const board = scene([{ id: "necro", def: necromancer({ "slot-3": 2, "slot-4": 0, "slot-5": 2 }), faction: "enemy", at: [4, 4], initiative: 10 }]);
    const model = hotbarFor(board, "necro");
    const button = (name: string) => model.tabs.flatMap((tab) => tab.buttons).find((entry) => entry.name === name)!;
    const blight = button("Blight");
    expect(blight.variants.map((variant) => [variant.label, variant.problem])).toEqual([["4th", "No 4th-level slots left"], ["5th", undefined]]);
    expect(blight.defaultVariant).toBe(1);
    expect(button("Fireball").variants.map((variant) => variant.label)).toEqual(["3rd", "4th · +1d6", "5th · +2d6"]);
    expect(button("Fireball").defaultVariant).toBe(0);
  });

  it("an activation that spends a slot (a homebrew Mage Armor) shows its slots too, not 'Normal'", () => {
    const armor: SpellDefinition = {
      id: "armor", name: "Mage Armor", level: 1, castingTime: "action", range: "touch", resourceCost: { resourceId: "slot-1", amount: 1 }, automationSupport: "full",
      action: { kind: "activate-feature", id: "armor-action", name: "Mage Armor", actionType: "action", featureId: "armor",
        condition: { name: "custom", modifiers: { armorClass: 3 } }, resourceCost: { resourceId: "slot-1", amount: 1 }, automationSupport: "full" }
    };
    const board = scene([{ id: "necro", def: blank("necro", { resources: { "slot-1": 1, "slot-2": 1 }, spells: [armor] }), faction: "enemy", at: [4, 4], initiative: 10 }]);
    const model = hotbarFor(board, "necro");
    const button = model.tabs.flatMap((tab) => tab.buttons).find((entry) => entry.name === "Mage Armor")!;
    expect(button.variants.map((variant) => variant.label)).toEqual(["1st", "2nd"]);
  });

  it("a reaction that spends a slot is one row on the Reactions tab, however many slots it could use", () => {
    const board = scene([{ id: "necro", def: blank("necro", { resources: { "slot-1": 1, "slot-2": 1 }, spells: [spell("srd:spell:shield")] }), faction: "enemy", at: [4, 4], initiative: 10 }]);
    expect(hotbarFor(board, "necro").reactions.map((reaction) => reaction.key)).toEqual(["srd:spell:shield:action"]);
  });

  it("a preview follows the chip: Blight with a 5th-level slot averages 9d8", () => {
    const board = scene([
      { id: "necro", def: necromancer({ "slot-4": 1, "slot-5": 1 }), faction: "enemy", at: [4, 4], initiative: 10 },
      { id: "pc", def: blank("pc"), faction: "party", at: [6, 4], initiative: 5 }
    ]);
    expect(previewSave(board, "necro", "pc", "srd:spell:blight:action").damageOnFail).toBeCloseTo(36);
    expect(previewSave(board, "necro", "pc", "srd:spell:blight:action:upcast-5").damageOnFail).toBeCloseTo(40.5);
  });
});

/** Four PCs at (10, 5) under an evoker's 5th-level Fireball; the abjurer, out of the blast, can counter. */
function underFireball(abjurerSlots: Record<string, number>, readsSpell = true) {
  const encounter = scene([
    { id: "evoker", def: blank("evoker", { resources: { "slot-5": 1 }, spells: [spell("srd:spell:fireball")] }), faction: "enemy", at: [16, 5], initiative: 20 },
    { id: "abjurer", def: blank("abjurer", { resources: abjurerSlots, spells: [spell("srd:spell:counterspell")] }), faction: "party", at: [4, 5], initiative: 10 },
    ...[[10, 5], [11, 5], [10, 6], [11, 6]].map(([x, y], index): Token => ({ id: `pc-${index + 1}`, def: blank("pc"), faction: "party", at: [x!, y!], initiative: 5 - index }))
  ]);
  if (!readsSpell) encounter.rules = { ...encounter.rules, counterspellReadsSpell: false };
  return encounter;
}

function askedAbout(encounter: EncounterSnapshot): { request: ReactionRequest; board: EncounterSnapshot } {
  const state = createEngineState(encounter);
  let asked: ReactionRequest | undefined;
  state.decide = (request) => {
    if (request.kind === "reaction" && !asked) asked = request;
    return undefined;
  };
  const board = structuredClone(state.snapshot);
  resolveAreaSaveAction(state, "evoker", { x: 10, y: 5 }, "srd:spell:fireball:action:upcast-5");
  return { request: asked!, board };
}

describe("the Counterspell prompt", () => {
  it("says what the spell would do, offers each slot with its odds and slots left, the AI's pick first", () => {
    const { request, board } = askedAbout(underFireball({ "slot-3": 2, "slot-5": 1 }));
    const prompt = describeQuestion(request, board);
    expect(prompt.title).toMatch(/^evoker is casting Fireball \(5th level\) 60 ft\. away\. At pc-1, pc-2, pc-3 and pc-4: ≈\d+ damage each\.$/);
    expect(prompt.options.map((option) => [option.label, option.detail, Boolean(option.primary)])).toEqual([
      ["3rd-level slot", "check DC 15 (50%) · a 3rd-level slot (2 left)", false],
      ["5th-level slot", "certain · a 5th-level slot (1 left)", true],
      ["Don't", undefined, false]
    ]);
    // One "this fight" setting for Counterspell, whichever slot.
    expect(prompt.policies?.map((policy) => [policy.key, policy.label])).toEqual([[reactionPolicyKey("abjurer", "srd:spell:counterspell:action"), "Counterspell"]]);
  });

  it("with the campaign rule off, names no spell and gives each slot's reach instead of odds", () => {
    const { request, board } = askedAbout(underFireball({ "slot-3": 2 }, false));
    const prompt = describeQuestion(request, board);
    expect(prompt.title).toBe("evoker is casting a spell 60 ft. away.");
    expect(prompt.options[0]!.detail).toBe("certain up to 3rd level, a check above · a 3rd-level slot (2 left)");
  });
});

describe("Counterspell set to 'always' for this fight", () => {
  const command = (value: CombatCommand) => ({ kind: "command" as const, command: value });

  it("counters at whichever slot without asking: the AI's, or else the surest", () => {
    for (const [slots, spent] of [[{ "slot-3": 2, "slot-5": 1 }, "slot-5"], [{ "slot-3": 2 }, "slot-3"]] as const) {
      const control: PlayControl = {
        factions: { party: "human", enemy: "human" },
        reactions: { [reactionPolicyKey("abjurer", "srd:spell:counterspell:action")]: "use" }
      };
      const opened = runStep(underFireball({ ...slots }), [], { kind: "advance" }, control).result;
      const cast = command({ kind: "use", actorId: "evoker", actionId: "srd:spell:fireball:action:upcast-5", target: { aim: { x: 10, y: 5 } } });
      const step = runPlayStep({ snapshot: opened.snapshot, log: opened.log, step: cast, control });
      // Asked only about the check's roll (if any), never about whether to counter.
      if (step.kind === "needs-decision") expect(step.request.kind).toBe("roll");
      const done = runStep(opened.snapshot, opened.log, cast, control);
      expect(done.questions.filter((question) => question.kind === "reaction")).toEqual([]);
      const abjurer = done.result.snapshot.combatants.find((combatant) => combatant.id === "abjurer")!;
      expect(abjurer.resources?.[spent]).toBe((slots as Record<string, number>)[spent]! - 1);
    }
  });
});
