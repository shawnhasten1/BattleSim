// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { armorClassOf, type CombatantState } from "@/engine";
import { SheetWindowsHost } from "@/components/sheet/SheetWindowsHost";
import type { Compendium } from "@/hooks/useCompendium";
import { CODEX_PALETTE_IDS, CODEX_PALETTES, contrastRatio, paletteFrom } from "@/lib/actor-sheet/codex";
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
  useSheetWindowsStore.setState({ palette: "dark" });
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const compendium = { status: "", setStatus: () => undefined, attach: async () => undefined } as unknown as Compendium;
const store = () => useEncounterStore.getState();
const token = (id: string) => store().encounter.combatants.find((combatant) => combatant.id === id)!;
const creature = (id: string) => store().encounter.definitions.find((definition) => definition.id === id)!;
const codexTab = (name: string) => within(screen.getByRole("tablist", { name: "Codex sections" })).getByRole("tab", { name });

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

/** A character made with the builder, on the map. */
function build(classId: string, name: string, level = 3) {
  const recipe = quickBuild(SRD_BUILD_SOURCES, { classId, level });
  let id = "";
  act(() => { id = store().createCharacter({ name, build: recipe }); });
  return store().encounter.combatants.find((combatant) => combatant.definitionId === id)!;
}

describe("the Codex's numbers", () => {
  it("shows the creature's scores, modifiers and derived values", async () => {
    await openCodex("pc-fighter");
    expect((screen.getByLabelText("Strength score") as HTMLInputElement).value).toBe("16");
    expect(screen.getByLabelText("Strength modifier").textContent).toBe("+3");
    expect(screen.getByLabelText("Initiative").textContent).toBe("+1");
    expect(screen.getByLabelText("Proficiency bonus").textContent).toBe("+2");
    expect(screen.getByTitle("Passive Perception").textContent).toBe("10");
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
  it("types a score in as one undo step", async () => {
    await openCodex("pc-fighter");
    const strength = screen.getByLabelText("Strength score");
    await userEvent.clear(strength);
    await userEvent.type(strength, "18");
    const dexterity = screen.getByLabelText("Dexterity score");
    await userEvent.clear(dexterity);
    await userEvent.type(dexterity, "13");
    expect(creature("def-fighter").abilities.str).toBe(18);
    expect(creature("def-fighter").abilities.dex).toBe(13);
    act(() => store().undo());
    act(() => store().undo());
    expect(creature("def-fighter").abilities.str).toBe(16);
  });

  it("switches a save's proficiency with its box, as Stats' ◆ does", async () => {
    await openCodex("pc-fighter");
    await userEvent.click(screen.getByRole("button", { name: "Strength saving throw, not proficient" }));
    expect(creature("def-fighter").saves?.str).toBe(5);
    await userEvent.click(screen.getByRole("button", { name: "Strength saving throw, proficient" }));
    expect(creature("def-fighter").saves?.str).toBeUndefined();
  });

  it("cycles a skill's box: proficient, expertise, then none, with its passive alongside", async () => {
    await openCodex("pc-fighter");
    await userEvent.click(screen.getByRole("button", { name: "Athletics, not proficient" }));
    expect(creature("def-fighter").skills?.athletics).toBe(5);
    expect(screen.getByTitle("Passive Athletics").textContent).toBe("15");
    await userEvent.click(screen.getByRole("button", { name: "Athletics, proficient" }));
    expect(creature("def-fighter").skills?.athletics).toBe(7);
    await userEvent.click(screen.getByRole("button", { name: "Athletics, expertise" }));
    expect(creature("def-fighter").skills?.athletics).toBeUndefined();
  });

  it("renames the creature and sets its alignment, type and languages", async () => {
    await openCodex("pc-fighter");
    const name = screen.getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Brannoc");
    await userEvent.type(screen.getByLabelText("Alignment"), "lawful good");
    await userEvent.selectOptions(screen.getByLabelText("Creature type"), "fey");
    await userEvent.type(screen.getByLabelText("Languages"), "Common, Sylvan");
    const fighter = creature("def-fighter");
    expect(fighter.name).toBe("Brannoc");
    expect(fighter.alignment).toBe("lawful good");
    expect(fighter.type).toBe("fey");
    expect(fighter.languages).toBe("Common, Sylvan");
  });

  it("edits HP and temp HP for the token shown, and no other", async () => {
    await openCodex("enemy-goblin-1");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Token shown" }), "enemy-goblin-2");
    const hp = screen.getByLabelText("Current hit points");
    await userEvent.clear(hp);
    await userEvent.type(hp, "3");
    await userEvent.type(screen.getByLabelText("Temporary hit points"), "4");
    expect(token("enemy-goblin-2").currentHp).toBe(3);
    expect(token("enemy-goblin-2").tempHp).toBe(4);
    expect(token("enemy-goblin-1").currentHp).toBe(7);
  });

  it("puts a condition on the token shown", async () => {
    await openCodex("pc-fighter");
    await userEvent.click(screen.getByRole("button", { name: "+ Condition" }));
    await userEvent.click(screen.getAllByRole("menuitem").find((item) => item.textContent?.startsWith("Prone"))!);
    expect(token("pc-fighter").conditions?.map((condition) => condition.name)).toContain("prone");
  });

  it("adds and removes damage and condition defenses as tags", async () => {
    await openCodex("pc-fighter");
    await userEvent.selectOptions(screen.getByLabelText("Add resistance"), "fire");
    expect(creature("def-fighter").damageAdjustments).toEqual([{ type: "resistance", damageType: "fire" }]);
    await userEvent.selectOptions(screen.getByLabelText("Add immunity"), "condition:poisoned");
    expect(creature("def-fighter").conditionImmunities).toEqual(["poisoned"]);
    await userEvent.click(screen.getByRole("button", { name: "Remove resistance to fire" }));
    await userEvent.click(screen.getByRole("button", { name: "Remove immunity to poisoned" }));
    expect(creature("def-fighter").damageAdjustments).toBeUndefined();
    expect(creature("def-fighter").conditionImmunities).toBeUndefined();
  });

  it("removes a qualified defense exactly, leaving the rest", async () => {
    useEncounterStore.setState((state) => ({
      encounter: {
        ...state.encounter,
        definitions: state.encounter.definitions.map((definition) => definition.id === "def-fighter"
          ? { ...definition, damageAdjustments: [{ type: "resistance", damageType: "slashing", nonMagicalOnly: true }, { type: "resistance", damageType: "cold" }] }
          : definition)
      }
    }));
    await openCodex("pc-fighter");
    await userEvent.click(screen.getByRole("button", { name: "Remove resistance to slashing (nonmagical)" }));
    expect(creature("def-fighter").damageAdjustments).toEqual([{ type: "resistance", damageType: "cold" }]);
  });
});

describe("a built character on the Codex", () => {
  it("reads its class, level, background and hit dice from the build, read-only", async () => {
    const mira = build("srd:class:fighter", "Mira");
    await openCodex(mira.id);
    const banner = within(screen.getByRole("region", { name: "Name and level" }));
    expect(banner.getByTitle("What it is").textContent).toBe("Fighter (Champion)");
    expect(banner.getByLabelText("Level").tagName).toBe("OUTPUT");
    expect(banner.getByLabelText("Level").textContent).toBe("3");
    expect(screen.getByText("3d10")).toBeTruthy();
    // Nothing to type the class or level into.
    expect(banner.getAllByRole("textbox").map((box) => box.getAttribute("aria-label"))).toEqual(["Name", "Alignment"]);
  });

  it("levels up from the banner, in the builder", async () => {
    const mira = build("srd:class:fighter", "Mira");
    await openCodex(mira.id);
    await userEvent.click(screen.getByRole("button", { name: "Level up…" }));
    expect(useBuilderUiStore.getState().window).toEqual({ kind: "level-up", definitionId: mira.definitionId });
    act(() => useBuilderUiStore.getState().close());
  });

  it("shows worn armor's AC, and the Items tab's box takes it off and puts it back on", async () => {
    const mira = build("srd:class:fighter", "Mira");
    await openCodex(mira.id);
    const armored = armorClassOf(creature(mira.definitionId), mira);
    expect(armored.armor).toBeTruthy();
    expect(screen.getByLabelText("Armor class").tagName).toBe("OUTPUT");
    expect(screen.getByLabelText("Armor class").textContent).toBe(String(armored.total));

    await userEvent.click(codexTab("Items"));
    const armor = within(screen.getByRole("group", { name: "Armor & shields" }));
    const worn = armor.getAllByRole("button", { pressed: true })[0]!;
    const name = worn.getAttribute("aria-label")!.replace(/, worn$/, "");
    await userEvent.click(worn);
    expect(armor.getByRole("button", { name: `${name}, carried` })).toBeTruthy();
    expect(armorClassOf(creature(mira.definitionId), token(mira.id)).total).toBeLessThan(armored.total);
    await userEvent.click(armor.getByRole("button", { name: `${name}, carried` }));
    expect(armorClassOf(creature(mira.definitionId), token(mira.id)).total).toBe(armored.total);
  });

  it("shows its death saves as read-only boxes", async () => {
    const mira = build("srd:class:fighter", "Mira");
    patchToken(mira.id, { deathSaves: { successes: 2, failures: 1, stable: false } });
    await openCodex(mira.id);
    expect(screen.getByRole("img", { name: "Death save successes: 2 of 3" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Death save failures: 1 of 3" })).toBeTruthy();
  });

  it("types a hand-made character's level into the dial", async () => {
    useEncounterStore.setState((state) => ({
      encounter: {
        ...state.encounter,
        definitions: state.encounter.definitions.map((definition) => definition.id === "def-fighter"
          ? { ...definition, character: { level: 2, classes: [{ name: "Fighter", level: 2 }] } }
          : definition)
      }
    }));
    await openCodex("pc-fighter");
    const level = within(screen.getByRole("region", { name: "Name and level" })).getByLabelText("Level");
    await userEvent.clear(level);
    await userEvent.type(level, "4");
    expect(creature("def-fighter").character?.level).toBe(4);
  });
});

describe("a monster on the Codex", () => {
  it("shows its challenge in the dial, no death saves, and only the tabs it needs", async () => {
    useEncounterStore.setState((state) => ({
      encounter: { ...state.encounter, definitions: state.encounter.definitions.map((definition) => definition.id === "def-goblin" ? { ...definition, challengeRating: 0.25 } : definition) }
    }));
    await openCodex("enemy-goblin-1");
    expect(screen.getByLabelText("Challenge rating").textContent).toBe("1/4");
    expect(screen.queryByRole("group", { name: "Death saves" })).toBeNull();
    expect(within(screen.getByRole("tablist", { name: "Codex sections" })).getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["Details", "Abilities"]);
  });
});

describe("the Codex's tabs", () => {
  it("opens an ability in the ability editor inside the Codex, and Save brings its tab back", async () => {
    await openCodex("pc-fighter");
    await userEvent.click(codexTab("Abilities"));
    const actions = within(screen.getByRole("group", { name: "Actions" }));
    await userEvent.click(actions.getByRole("button", { name: "Longsword details" }));
    expect(actions.getByText(/to hit/)).toBeTruthy();

    await userEvent.click(actions.getByRole("button", { name: "Edit Longsword" }));
    const editor = screen.getByRole("region", { name: "Edit Longsword" });
    // In the Codex, in its colours: the banner stays, Standard's tabs never show, and the window is still the Codex.
    expect(editor.closest("[data-palette]")).not.toBeNull();
    expect(screen.getByRole("region", { name: "Name and level" })).toBeTruthy();
    expect(screen.queryByRole("tablist", { name: "Actor sheet sections" })).toBeNull();
    expect(screen.queryByRole("tablist", { name: "Codex sections" })).toBeNull();
    expect(screen.getByRole("button", { name: "Codex" }).getAttribute("aria-pressed")).toBe("true");
    expect(sheetWindows()[0]!.style).toBe("codex");

    const save = within(editor).getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    const name = within(editor).getByLabelText("Name") as HTMLInputElement;
    await userEvent.clear(name);
    await userEvent.type(name, "Arming Sword");
    expect(sheetWindows()[0]!.dirty).toBe(true);
    await userEvent.click(save);

    expect(creature("def-fighter").actions.find((action) => action.id === "longsword")!.name).toBe("Arming Sword");
    expect(screen.queryByRole("region", { name: /^Edit / })).toBeNull();
    expect(codexTab("Abilities").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Edit Arming Sword");
  });

  it("Cancel leaves the ability as it was", async () => {
    await openCodex("pc-fighter");
    await userEvent.click(codexTab("Abilities"));
    await userEvent.click(screen.getByRole("button", { name: "Edit Longsword" }));
    const editor = screen.getByRole("region", { name: "Edit Longsword" });
    await userEvent.type(within(editor).getByLabelText("Name"), "!");
    await userEvent.click(within(editor).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("region", { name: /^Edit / })).toBeNull();
    expect(creature("def-fighter").actions.find((action) => action.id === "longsword")!.name).toBe("Longsword");
  });

  it("asks before leaving the Codex with the editor's changes unsaved", async () => {
    await openCodex("pc-fighter");
    await userEvent.click(codexTab("Abilities"));
    await userEvent.click(screen.getByRole("button", { name: "Edit Longsword" }));
    await userEvent.type(within(screen.getByRole("region", { name: "Edit Longsword" })).getByLabelText("Name"), " of Doom");
    await userEvent.click(screen.getByRole("button", { name: "Standard" }));
    const prompt = screen.getByRole("alertdialog", { name: "Unsaved changes" });
    expect(sheetWindows()[0]!.style).toBe("codex");
    await userEvent.click(within(prompt).getByRole("button", { name: "Save" }));
    expect(sheetWindows()[0]!.style).toBe("standard");
    expect(creature("def-fighter").actions.find((action) => action.id === "longsword")!.name).toBe("Longsword of Doom");
  });

  it("opens a spell from the Spells tab in the editor too", async () => {
    const wizard = build("srd:class:wizard", "Ilse");
    await openCodex(wizard.id);
    await userEvent.click(codexTab("Spells"));
    const edit = within(screen.getByRole("region", { name: "Spellcasting" })).getAllByRole("button", { name: /^Edit / })[0]!;
    const spell = edit.getAttribute("aria-label")!.replace(/^Edit /, "");
    await userEvent.click(edit);
    expect(screen.getByRole("region", { name: `Edit ${spell}` })).toBeTruthy();
    // Its back link goes back to the tab it came from.
    await userEvent.click(screen.getByRole("button", { name: "Back to spells" }));
    expect(codexTab("Spells").getAttribute("aria-selected")).toBe("true");
  });

  it("puts a character's weapons under Attacks, with their lines in view", async () => {
    const mira = build("srd:class:fighter", "Mira");
    await openCodex(mira.id);
    await userEvent.click(codexTab("Abilities"));
    const attacks = within(screen.getByRole("region", { name: "Attacks" }));
    expect(attacks.getAllByRole("button", { name: /^Edit / }).length).toBeGreaterThan(0);
    expect(attacks.getAllByText(/to hit/).length).toBeGreaterThan(0);
  });

  it("spends and gives back a slot on the token shown, and no other", async () => {
    const wizard = build("srd:class:wizard", "Ilse");
    act(() => store().duplicateCombatant(wizard.id));
    const copy = store().encounter.combatants.find((combatant) => combatant.definitionId === wizard.definitionId && combatant.id !== wizard.id)!;
    await openCodex(wizard.id);
    await userEvent.click(codexTab("Spells"));
    const spells = within(screen.getByRole("region", { name: "Spellcasting" }));
    expect(spells.getByRole("group", { name: "Level 1 spell slots: 4 of 4" })).toBeTruthy();
    await userEvent.click(spells.getByRole("button", { name: "Level 1 slot 4, there: spend it" }));
    expect(token(wizard.id).resources?.["slot-1"]).toBe(3);
    expect(token(copy.id).resources?.["slot-1"]).toBe(4);
    await userEvent.click(spells.getByRole("button", { name: "Level 1 slot 4, spent: get it back" }));
    expect(token(wizard.id).resources?.["slot-1"]).toBe(4);
    expect(spells.getByLabelText("Spell save DC").textContent).toMatch(/^\d+$/);
  });

  it("are remembered, per browser", async () => {
    const wizard = build("srd:class:wizard", "Ilse");
    await openCodex(wizard.id);
    await userEvent.click(codexTab("Spells"));
    cleanup();
    resetSheetWindows();
    await openCodex(wizard.id);
    expect(codexTab("Spells").getAttribute("aria-selected")).toBe("true");
  });
});

describe("Add ability in the Codex", () => {
  it("opens in the Codex, and a library row's + adds it at once", async () => {
    await openCodex("pc-fighter");
    await userEvent.click(codexTab("Abilities"));
    await userEvent.click(screen.getByRole("button", { name: "Add ability" }));
    const add = screen.getByRole("region", { name: "Add ability" });
    expect(add.closest("[data-palette]")).not.toBeNull();
    expect(screen.queryByRole("tablist", { name: "Codex sections" })).toBeNull();
    await userEvent.type(within(add).getByRole("searchbox", { name: "Search abilities" }), "dagger");
    await userEvent.click(within(add).getByRole("button", { name: "Add Dagger" }));
    expect(creature("def-fighter").weapons?.map((weapon) => weapon.name)).toContain("Dagger");
    expect(within(add).getByRole("status").textContent).toContain("Added Dagger.");
    await userEvent.click(screen.getByRole("button", { name: "Close Add ability" }));
    expect(codexTab("Abilities").getAttribute("aria-selected")).toBe("true");
  });

  it("starts something from scratch in the editor, and shows it on its tab once saved", async () => {
    await openCodex("pc-fighter");
    await userEvent.click(codexTab("Abilities"));
    await userEvent.click(screen.getByRole("button", { name: "Add ability" }));
    await userEvent.click(within(screen.getByRole("region", { name: "Start from scratch" })).getByRole("button", { name: "Trait or feature" }));
    const editor = screen.getByRole("region", { name: /^Edit / });
    expect(editor.closest("[data-palette]")).not.toBeNull();
    const name = within(editor).getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Keen Senses");
    await userEvent.click(within(editor).getByRole("button", { name: "Add to sheet" }));
    expect([...(creature("def-fighter").features ?? []), ...(creature("def-fighter").traits ?? [])].map((feature) => feature.name)).toContain("Keen Senses");
    expect(screen.queryByRole("region", { name: /^Edit / })).toBeNull();
    expect(codexTab("Abilities").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Edit Keen Senses");
  });

  it("opens on Spells from the Spells tab, and a spell added there lands on it", async () => {
    const wizard = build("srd:class:wizard", "Ilse");
    await openCodex(wizard.id);
    await userEvent.click(codexTab("Spells"));
    await userEvent.click(screen.getByRole("button", { name: "Add spell" }));
    const add = screen.getByRole("region", { name: "Add ability" });
    expect(within(add).getByRole("button", { name: "Spells" }).getAttribute("aria-pressed")).toBe("true");
    await userEvent.type(within(add).getByRole("searchbox", { name: "Search abilities" }), "light");
    const library = within(within(add).getByRole("region", { name: "Library" }));
    const first = library.getAllByRole("button", { name: /^Add / })[0]!;
    const spell = first.getAttribute("aria-label")!.replace(/^Add /, "");
    await userEvent.click(library.getByText(spell));
    const editor = screen.getByRole("region", { name: `Edit ${spell}` });
    await userEvent.click(within(editor).getByRole("button", { name: "Add to sheet" }));
    expect(codexTab("Spells").getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement?.getAttribute("aria-label")).toBe(`Edit ${spell}`);
  });

  it("opens on Items from the Items tab", async () => {
    const fighter = build("srd:class:fighter", "Mira");
    await openCodex(fighter.id);
    await userEvent.click(codexTab("Items"));
    await userEvent.click(screen.getByRole("button", { name: "Add item" }));
    expect(within(screen.getByRole("region", { name: "Add ability" })).getByRole("button", { name: "Items" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("choosing a style", () => {
  it("switches a window to the Codex and back, remembered for that kind of actor", async () => {
    renderSheet(compendium, "pc-fighter");
    await userEvent.click(screen.getByRole("button", { name: "Codex" }));
    await screen.findByRole("group", { name: "Hit points" });
    expect(sheetWindows()[0]!.style).toBe("codex");
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

  it("switches every Codex between dark and light from the ⋯ menu, per browser", async () => {
    await openCodex("pc-fighter");
    await userEvent.click(screen.getByRole("button", { name: "More actions" }));
    await userEvent.click(screen.getAllByRole("menuitem").find((item) => item.textContent?.includes("Light"))!);
    expect(document.querySelector("[data-palette]")!.getAttribute("data-palette")).toBe("light");
    expect(JSON.parse(window.localStorage.getItem("battlesim:codex-palette") ?? "null")).toBe("light");
  });
});

describe("the palettes", () => {
  it.each(CODEX_PALETTE_IDS)("%s keeps text readable on its panels", (id) => {
    const tokens = CODEX_PALETTES[id].tokens;
    for (const surface of [tokens["--panel"]!, tokens["--panel-2"]!]) {
      expect(contrastRatio(tokens["--ink"]!, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens["--muted"]!, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens["--cu"]!, surface)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(tokens["--faint"]!, surface)).toBeGreaterThanOrEqual(3);
      // The ability editor's warning and "simulated" text, in the Codex.
      expect(contrastRatio(tokens["--warn"]!, surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tokens["--good"]!, surface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("carries a palette over from the old Codex: Parchment is Light, the others Dark", () => {
    expect(paletteFrom("parchment")).toBe("light");
    expect(paletteFrom("ember")).toBe("dark");
    expect(paletteFrom("faerie")).toBe("dark");
    expect(paletteFrom(undefined)).toBe("dark");
  });
});
