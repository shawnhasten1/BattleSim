// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { armorClassOf, type CombatantState } from "@/engine";
import { SheetWindowsHost } from "@/components/sheet/SheetWindowsHost";
import type { Compendium } from "@/hooks/useCompendium";
import { CODEX_PALETTE_IDS, CODEX_PALETTES, contrastRatio } from "@/lib/actor-sheet/codex";
import { quickBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { useBuilderUiStore } from "@/store/builder-ui-store";
import { useEncounterStore } from "@/store/encounter-store";
import { useSheetWindowsStore } from "@/store/sheet-windows-store";
import { renderSheet, resetSheetWindows, sheetWindows } from "./helpers/sheet";

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  resetSheetWindows();
  window.localStorage.clear();
  useSheetWindowsStore.setState({ palette: "ember" });
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const compendium = { status: "", setStatus: () => undefined, attach: async () => undefined } as unknown as Compendium;
const store = () => useEncounterStore.getState();
const token = (id: string) => store().encounter.combatants.find((combatant) => combatant.id === id)!;
const creature = (id: string) => store().encounter.definitions.find((definition) => definition.id === id)!;

/** The Codex of `combatantId`'s creature, once its lazily loaded code has arrived. */
async function openCodex(combatantId: string) {
  useEncounterStore.setState({ undoStack: [] });
  useSheetWindowsStore.getState().open(combatantId, { style: "codex" });
  render(<SheetWindowsHost compendium={compendium} />);
  await screen.findByRole("group", { name: "Hit points" });
}

function patchToken(id: string, patch: Partial<CombatantState>) {
  useEncounterStore.setState((state) => ({
    encounter: { ...state.encounter, combatants: state.encounter.combatants.map((combatant) => (combatant.id === id ? { ...combatant, ...patch } : combatant)) }
  }));
}

describe("the Codex's numbers", () => {
  it("shows the creature's scores, modifiers and derived values", async () => {
    await openCodex("pc-fighter");
    expect((screen.getByLabelText("Strength score") as HTMLInputElement).value).toBe("16");
    expect(screen.getByLabelText("Strength modifier").textContent).toBe("+3");
    expect(screen.getByLabelText("Initiative").textContent).toBe("+1");
    expect(screen.getByLabelText("Proficiency bonus").textContent).toBe("+2");
    expect(screen.getByLabelText("Passive Perception").textContent).toBe("10");
  });

  it("reads initiative the way the roll does, features and all", async () => {
    useEncounterStore.setState((state) => ({
      encounter: {
        ...state.encounter,
        definitions: state.encounter.definitions.map((definition) => definition.id === "def-fighter"
          ? { ...definition, features: [...(definition.features ?? []), { id: "alert", name: "Alert", effects: [{ kind: "initiative", bonus: { base: 2 } }] } as never] }
          : definition)
      }
    }));
    await openCodex("pc-fighter");
    expect(screen.getByLabelText("Initiative").textContent).toBe("+3");
  });
});

describe("editing on the Codex", () => {
  it("types a score in as one undo step, and steps it with − and +", async () => {
    await openCodex("pc-fighter");
    const strength = screen.getByLabelText("Strength score");
    await userEvent.clear(strength);
    await userEvent.type(strength, "18");
    expect(creature("def-fighter").abilities.str).toBe(18);
    await userEvent.click(screen.getByRole("button", { name: "Raise Dexterity" }));
    expect(creature("def-fighter").abilities.dex).toBe(13);
    act(() => store().undo());
    act(() => store().undo());
    expect(creature("def-fighter").abilities.str).toBe(16);
  });

  it("switches a save's proficiency with its orb, as Stats' ◆ does", async () => {
    await openCodex("pc-fighter");
    await userEvent.click(screen.getByRole("button", { name: "Strength saving throw, not proficient" }));
    expect(creature("def-fighter").saves?.str).toBe(5);
    await userEvent.click(screen.getByRole("button", { name: "Strength saving throw, proficient" }));
    expect(creature("def-fighter").saves?.str).toBeUndefined();
  });

  it("cycles a skill's orb: proficient, expertise, then none", async () => {
    await openCodex("pc-fighter");
    await userEvent.click(screen.getByRole("button", { name: "Athletics, not proficient" }));
    expect(creature("def-fighter").skills?.athletics).toBe(5);
    await userEvent.click(screen.getByRole("button", { name: "Athletics, proficient" }));
    expect(creature("def-fighter").skills?.athletics).toBe(7);
    await userEvent.click(screen.getByRole("button", { name: "Athletics, expertise" }));
    expect(creature("def-fighter").skills?.athletics).toBeUndefined();
  });

  it("renames the creature and sets its alignment", async () => {
    await openCodex("pc-fighter");
    const name = screen.getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Brannoc");
    await userEvent.type(screen.getByLabelText("Alignment"), "lawful good");
    expect(creature("def-fighter").name).toBe("Brannoc");
    expect(creature("def-fighter").alignment).toBe("lawful good");
  });

  it("edits HP and temp HP for the token shown, and no other", async () => {
    await openCodex("enemy-goblin-1");
    await userEvent.click(screen.getByRole("button", { name: "Lose 1 hit point" }));
    expect(token("enemy-goblin-1").currentHp).toBe(6);
    expect(token("enemy-goblin-2").currentHp).toBe(7);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Token shown" }), "enemy-goblin-2");
    const hp = screen.getByLabelText("Current hit points");
    await userEvent.clear(hp);
    await userEvent.type(hp, "3");
    await userEvent.type(screen.getByLabelText("Temporary hit points"), "4");
    expect(token("enemy-goblin-2").currentHp).toBe(3);
    expect(token("enemy-goblin-2").tempHp).toBe(4);
    expect(token("enemy-goblin-1").currentHp).toBe(6);
  });

  it("puts a condition on the token shown", async () => {
    await openCodex("pc-fighter");
    await userEvent.click(screen.getByRole("button", { name: "+ Condition" }));
    await userEvent.click(screen.getAllByRole("menuitem").find((item) => item.textContent?.startsWith("Prone"))!);
    expect(token("pc-fighter").conditions?.map((condition) => condition.name)).toContain("prone");
  });
});

describe("a built character on the Codex", () => {
  function buildFighter() {
    const build = quickBuild(SRD_BUILD_SOURCES, { classId: "srd:class:fighter", level: 3 });
    let id = "";
    act(() => { id = store().createCharacter({ name: "Mira", build }); });
    return store().encounter.combatants.find((combatant) => combatant.definitionId === id)!;
  }

  it("reads its class, level, background and hit dice from the build, read-only", async () => {
    const mira = buildFighter();
    await openCodex(mira.id);
    const hero = within(screen.getByRole("region", { name: "Who it is" }));
    expect(hero.getByText(/at heart/).closest("p")!.textContent).toMatch(/^A level 3 Fighter \(Champion\)/);
    expect(screen.getByText("3d10")).toBeTruthy();
    // Nothing to type the class or level into.
    expect(hero.getAllByRole("textbox").map((box) => box.getAttribute("aria-label"))).toEqual(["Name", "Alignment"]);
  });

  it("levels up from the hero, in the builder", async () => {
    const mira = buildFighter();
    await openCodex(mira.id);
    await userEvent.click(screen.getByRole("button", { name: "Level up…" }));
    expect(useBuilderUiStore.getState().window).toEqual({ kind: "level-up", definitionId: mira.definitionId });
    act(() => useBuilderUiStore.getState().close());
  });

  it("shows worn armor's AC, not a box to type it in", async () => {
    const mira = buildFighter();
    await openCodex(mira.id);
    const definition = creature(mira.definitionId);
    const armored = armorClassOf(definition, mira);
    expect(armored.armor).toBeTruthy();
    const ac = screen.getByLabelText("Armor class");
    expect(ac.tagName).toBe("OUTPUT");
    expect(ac.textContent).toBe(String(armored.total));
  });

  it("shows its death saves as read-only orbs", async () => {
    const mira = buildFighter();
    patchToken(mira.id, { deathSaves: { successes: 2, failures: 1, stable: false } });
    await openCodex(mira.id);
    expect(screen.getByRole("img", { name: "Death save successes: 2 of 3" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Death save failures: 1 of 3" })).toBeTruthy();
  });

  it("has no death saves for a monster", async () => {
    await openCodex("enemy-goblin-1");
    expect(screen.queryByRole("group", { name: "Death saves" })).toBeNull();
  });
});

describe("choosing a style", () => {
  it("switches a window to the Codex and back, remembered for that kind of actor", async () => {
    renderSheet(compendium, "pc-fighter");
    await userEvent.click(screen.getByRole("button", { name: "Codex" }));
    await screen.findByRole("group", { name: "Hit points" });
    expect(sheetWindows()[0]!.style).toBe("codex");
    // Another player character opens in the Codex now; a monster still opens in Standard.
    act(() => { useSheetWindowsStore.getState().open("pc-archer"); });
    act(() => { useSheetWindowsStore.getState().open("enemy-goblin-1"); });
    expect(sheetWindows().map((entry) => entry.style)).toEqual(["codex", "codex", "standard"]);
  });

  it("asks before leaving an ability with unsaved changes for the Codex", async () => {
    renderSheet(compendium, "pc-fighter");
    await userEvent.click(screen.getByRole("tab", { name: "Abilities" }));
    await userEvent.click(screen.getByRole("button", { name: "Edit Longsword" }));
    await userEvent.type(screen.getByLabelText("Name"), "!");
    await userEvent.click(screen.getByRole("button", { name: "Codex" }));
    expect(screen.getByRole("alertdialog", { name: "Unsaved changes" })).toBeTruthy();
    expect(sheetWindows()[0]!.style).toBe("standard");
  });

  it("changes every Codex's palette from the ⋯ menu, per browser", async () => {
    await openCodex("pc-fighter");
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(screen.getAllByRole("menuitem").find((item) => item.textContent?.includes("Parchment"))!);
    expect(document.querySelector("[data-palette]")!.getAttribute("data-palette")).toBe("parchment");
    expect(JSON.parse(window.localStorage.getItem("battlesim:codex-palette") ?? "null")).toBe("parchment");
  });
});

describe("the Codex's abilities, spells and equipment", () => {
  function build(classId: string, name: string, level = 3) {
    const recipe = quickBuild(SRD_BUILD_SOURCES, { classId, level });
    let id = "";
    act(() => { id = store().createCharacter({ name, build: recipe }); });
    return store().encounter.combatants.find((combatant) => combatant.definitionId === id)!;
  }

  it("lists the Abilities list's rows, with Standard's statblock line", async () => {
    await openCodex("pc-fighter");
    const actions = within(screen.getByRole("region", { name: "Attacks & actions" }));
    expect(actions.getByText("Longsword")).toBeTruthy();
    expect(actions.getByRole("button", { name: "Edit Longsword" })).toBeTruthy();
  });

  it("edits a row on Standard's Abilities tab, in the same window, and comes back", async () => {
    await openCodex("pc-fighter");
    await userEvent.click(screen.getByRole("button", { name: "Edit Longsword" }));
    expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Longsword");
    expect(screen.getByRole("tab", { name: "Abilities" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "Standard" }).getAttribute("aria-pressed")).toBe("true");
    // The window is still the Codex's: back is one click.
    expect(sheetWindows()[0]!.style).toBe("codex");
    await userEvent.click(screen.getByRole("button", { name: "← Back to the Codex" }));
    expect(await screen.findByRole("group", { name: "Hit points" })).toBeTruthy();
    expect(screen.queryByRole("tab", { name: "Abilities" })).toBeNull();
  });

  it("asks before going back with the edit unsaved", async () => {
    await openCodex("pc-fighter");
    await userEvent.click(screen.getByRole("button", { name: "Edit Longsword" }));
    await userEvent.type(screen.getByLabelText("Name"), " of Doom");
    await userEvent.click(screen.getByRole("button", { name: "Codex" }));
    const prompt = screen.getByRole("alertdialog", { name: "Unsaved changes" });
    await userEvent.click(within(prompt).getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("group", { name: "Hit points" })).toBeTruthy();
    expect(screen.getByText("Longsword of Doom")).toBeTruthy();
  });

  it("spends and gives back a slot on the token shown, and no other", async () => {
    const wizard = build("srd:class:wizard", "Ilse");
    act(() => store().duplicateCombatant(wizard.id));
    const copy = store().encounter.combatants.find((combatant) => combatant.definitionId === wizard.definitionId && combatant.id !== wizard.id)!;
    await openCodex(wizard.id);
    const spells = within(screen.getByRole("region", { name: "Spellcasting" }));
    expect(spells.getByRole("group", { name: "Level 1 spell slots: 4 of 4" })).toBeTruthy();
    await userEvent.click(spells.getByRole("button", { name: "Level 1 slot 4, there: spend it" }));
    expect(token(wizard.id).resources?.["slot-1"]).toBe(3);
    expect(token(copy.id).resources?.["slot-1"]).toBe(4);
    await userEvent.click(spells.getByRole("button", { name: "Level 1 slot 4, spent: get it back" }));
    expect(token(wizard.id).resources?.["slot-1"]).toBe(4);
    expect(spells.getByLabelText("Spell save DC").textContent).toMatch(/^\d+$/);
  });

  it("leaves out what a creature hasn't got: a fighter has no spellcasting", async () => {
    const fighter = build("srd:class:fighter", "Mira");
    await openCodex(fighter.id);
    expect(screen.queryByRole("region", { name: "Spellcasting" })).toBeNull();
    const equipment = within(screen.getByRole("region", { name: "Equipment" }));
    expect(equipment.getAllByText("worn").length).toBeGreaterThan(0);
  });

  it("keeps a monster's card short: no equipment, no spellcasting", async () => {
    await openCodex("enemy-goblin-1");
    expect(screen.queryByRole("region", { name: "Equipment" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Spellcasting" })).toBeNull();
    expect(screen.getByRole("region", { name: "Attacks & actions" })).toBeTruthy();
  });
});

describe("the palettes", () => {
  it.each(CODEX_PALETTE_IDS)("%s keeps text readable on its panels", (id) => {
    const tokens = CODEX_PALETTES[id].tokens;
    for (const surface of [tokens["--panel"]!, tokens["--panel-2"]!]) {
      expect(contrastRatio(tokens["--ink"]!, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens["--muted"]!, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens["--accent"]!, surface)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(tokens["--gild"]!, surface)).toBeGreaterThanOrEqual(3);
    }
  });
});
