// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ActionDefinition, CreatureDefinition, SpellDefinition } from "@/engine";
import { normalizeOpen5eItem } from "@/adapters";
import { findSrdSpell } from "@/data/srd";
import { SheetWindowsHost } from "@/components/sheet/SheetWindowsHost";
import type { Compendium } from "@/hooks/useCompendium";
import { quickBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { useEncounterStore } from "@/store/encounter-store";
import { useSheetWindowsStore } from "@/store/sheet-windows-store";
import { resetSheetWindows } from "./helpers/sheet";

/*
 * Codex parity (CODEX_PARITY_PLAN.md, Phase 5): everything Standard's sheet lets a DM do, the Codex does too. For a few
 * creatures, this reads every control each sheet shows (every tab, every fold open) by its role and accessible name. A
 * name on Standard must be in the Codex as it is, or under the name ALIASES gives it there, or be in STANDARD_ONLY with
 * the reason it isn't. A control added to Standard later fails here until it's given one of the three.
 */

const ABILITY: Record<string, string> = { STR: "Strength", DEX: "Dexterity", CON: "Constitution", INT: "Intelligence", WIS: "Wisdom", CHA: "Charisma" };
const SKILL_BOX = (name: string) => new RegExp(`^button: ${name}, (not proficient|proficient|expertise|its own number)$`);

/** A Standard control, and the name the same control has in the Codex. */
const ALIASES: Array<{ standard: RegExp; codex: (match: RegExpMatchArray) => string | RegExp }> = [
  { standard: /^textbox: (STR|DEX|CON|INT|WIS|CHA) score$/, codex: (m) => `textbox: ${ABILITY[m[1]!]} score` },
  { standard: /^textbox: (STR|DEX|CON|INT|WIS|CHA) save$/, codex: (m) => `textbox: ${ABILITY[m[1]!]} save bonus` },
  { standard: /^button: (STR|DEX|CON|INT|WIS|CHA) save proficiency$/, codex: (m) => new RegExp(`^button: ${ABILITY[m[1]!]} saving throw, `) },
  { standard: /^textbox: Armor Class$/, codex: () => "textbox: Armor class" },
  { standard: /^textbox: Without armor$/, codex: () => "textbox: AC without armor" },
  { standard: /^textbox: Hit points$/, codex: () => "textbox: Current hit points" },
  { standard: /^textbox: Max HP$/, codex: () => "textbox: Maximum hit points" },
  // Skills: a box per skill that cycles not proficient, proficient, expertise; and its bonus typed.
  { standard: /^button: Skills\b/, codex: () => SKILL_BOX(".+") },
  { standard: /^combobox: Add a skill$/, codex: () => SKILL_BOX(".+") },
  { standard: /^button: Expertise$/, codex: () => SKILL_BOX(".+") },
  { standard: /^button: Remove (.+)$/, codex: (m) => SKILL_BOX(m[1]!) },
  // Senses and languages are in Origin.
  { standard: /^button: Senses & languages\b/, codex: () => "textbox: darkvision range" },
  // Switches: Hovers, an optional rule's Use it, armor's Worn.
  { standard: /^checkbox: Hovers$/, codex: () => "button: Hovers" },
  { standard: /^checkbox: Use it$/, codex: () => /^switch: Use / },
  { standard: /^checkbox: Worn$/, codex: () => /^button: .+, (worn|carried)$/ }
];

/** Standard controls with no place in the Codex, and why. */
const STANDARD_ONLY: Array<{ standard: RegExp; why: string }> = [
  { standard: /^button: About (creature type|size|saving throws|spellcasting ability)$/, why: "Stats' help text: the Codex says it in its own hint lines" }
];

const ROLES = ["button", "checkbox", "combobox", "textbox", "spinbutton", "radio", "switch", "searchbox", "slider", "menuitem"] as const;
const compendium = { status: "", setStatus: () => undefined, attach: async () => undefined } as unknown as Compendium;
const store = () => useEncounterStore.getState();
const creature = (id: string) => store().encounter.definitions.find((definition) => definition.id === id)!;

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

/** Every control a sheet shows for `combatantId`, as "role: name", on every tab with every fold open. */
async function controls(combatantId: string, style: "standard" | "codex"): Promise<Set<string>> {
  resetSheetWindows();
  useSheetWindowsStore.getState().open(combatantId, { style });
  render(<SheetWindowsHost compendium={compendium} />);
  const tablist = style === "standard" ? "Actor sheet sections" : "Codex sections";
  await screen.findByRole("tablist", { name: tablist });
  const sheet = screen.getByRole("dialog");
  const names = new Set<string>();
  const tabs = within(screen.getByRole("tablist", { name: tablist })).getAllByRole("tab").map((tab) => tab.textContent!);
  for (const tab of tabs) {
    await userEvent.click(within(screen.getByRole("tablist", { name: tablist })).getByRole("tab", { name: tab }));
    // Folds open folds (a hosted section inside a panel), so a few passes.
    for (let pass = 0; pass < 3; pass++) {
      const folds = [...sheet.querySelectorAll<HTMLButtonElement>('button[aria-expanded="false"][aria-controls], section[aria-label="Resources"] > button[aria-expanded="false"]')];
      const more = [...sheet.querySelectorAll<HTMLButtonElement>("button")].filter((button) => /^More defenses|^Review$/.test(button.textContent ?? ""));
      for (const fold of [...folds, ...more]) await userEvent.click(fold);
    }
    // Testing Library hands its `name` filter each element's accessible name: collected, never matched.
    for (const role of ROLES) within(sheet).queryAllByRole(role, { name: (name) => { names.add(`${role}: ${name}`); return false; } });
  }
  cleanup();
  return names;
}

/** The Standard names the Codex has no place for. */
function gaps(standard: Set<string>, codex: Set<string>, used: Set<string>): string[] {
  const has = (wanted: string | RegExp) => [...codex].some((name) => (typeof wanted === "string" ? name === wanted : wanted.test(name)));
  return [...standard].filter((name) => {
    if (codex.has(name)) return false;
    const only = STANDARD_ONLY.find((entry) => entry.standard.test(name));
    if (only) {
      used.add(only.standard.source);
      return false;
    }
    for (const alias of ALIASES) {
      const match = name.match(alias.standard);
      if (match && has(alias.codex(match))) {
        used.add(alias.standard.source);
        return false;
      }
    }
    return true;
  });
}

/** The fighter with a bit of everything Standard has a control for. */
function everything() {
  const breath: ActionDefinition = {
    kind: "save", id: "fire-breath", name: "Fire Breath", actionType: "action", saveAbility: "dex", dc: 13, range: 15,
    damage: [{ dice: "4d6", damageType: "fire" }], onSuccess: "half", halfDamageOnSuccess: true,
    usage: { kind: "recharge", recharge: { min: 5 } }, resourceCost: { resourceId: "usage:fire-breath", amount: 1 }, automationSupport: "full"
  };
  const cone: SpellDefinition = { ...structuredClone(findSrdSpell("srd:spell:cone-of-cold")!), id: "cone", upcast: undefined };
  if (cone.action) delete (cone.action as { upcast?: unknown }).upcast;
  act(() => {
    store().attachSrdWeapon("def-fighter", "srd:weapon:rapier");
    store().attachSrdSpell("def-fighter", "srd:spell:magic-missile");
    store().insertAbilityRecord("def-fighter", "items", normalizeOpen5eItem({
      provider: "open5e", resource: "item", slug: "srd_potion-of-healing", key: "srd_potion-of-healing", documentKey: "srd-2014",
      importedAt: "2026-10-05T00:00:00.000Z", payloadVersion: "v2",
      raw: { key: "srd_potion-of-healing", name: "Potion of Healing", desc: "You regain 2d4 + 2 hit points.", category: { key: "potion", name: "Potion" }, document: { key: "srd-2014", name: "SRD 2014" } }
    }));
    const fighter = creature("def-fighter");
    const patch: Partial<CreatureDefinition> = {
      actions: [...fighter.actions, breath],
      spells: [...(fighter.spells ?? []), cone],
      resources: { ...fighter.resources, "slot-1": 2, "slot-5": 1, "usage:fire-breath": 1 },
      skills: { stealth: 3 }, saves: { str: 5 }, movement: { walk: 30, fly: 30, hover: true },
      senses: { darkvision: 60 }, damageAdjustments: [{ type: "resistance", damageType: "fire" }], conditionImmunities: ["charmed"],
      character: { level: 3, classes: [{ name: "Fighter", level: 3 }] },
      traits: [{ id: "variant", name: "Variant", category: "trait", optional: true, automationSupport: "full", grantedActions: [] }],
      legendary: { pool: 3, actions: [{ name: "Swipe", cost: 2, description: "It makes a longsword attack.", actionId: "longsword" }] }
    };
    store().updateCreatureDefinition("def-fighter", patch);
  });
  return "pc-fighter";
}

/** A character made with the builder: worn armor, a build, Level up and down. */
function built() {
  let id = "";
  act(() => { id = store().createCharacter({ name: "Mira", build: quickBuild(SRD_BUILD_SOURCES, { classId: "srd:class:fighter", level: 3 }) }); });
  return store().encounter.combatants.find((combatant) => combatant.definitionId === id)!.id;
}

describe("the Codex has a place for every control on Standard's sheet", () => {
  const used = new Set<string>();

  it.each([
    ["a fighter with a bit of everything", everything],
    ["a built character", built],
    ["a monster", () => "enemy-goblin-1"],
    ["a built caster", () => {
      let id = "";
      act(() => { id = store().createCharacter({ name: "Ilse", build: quickBuild(SRD_BUILD_SOURCES, { classId: "srd:class:wizard", level: 5 }) }); });
      return store().encounter.combatants.find((combatant) => combatant.definitionId === id)!.id;
    }]
  ])("%s", { timeout: 60000 }, async (_label, make) => {
    const id = make();
    const standard = await controls(id, "standard");
    const codex = await controls(id, "codex");
    expect(standard.size).toBeGreaterThan(60);
    expect(gaps(standard, codex, used)).toEqual([]);
  });

  it("keeps no alias or Standard-only entry that nothing needs", () => {
    const entries = [...ALIASES.map((alias) => alias.standard.source), ...STANDARD_ONLY.map((entry) => entry.standard.source)];
    expect(entries.filter((source) => !used.has(source))).toEqual([]);
  });
});
