// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseCombatantPackage, type CreatureDefinition } from "@/engine";
import { CreateTokenModal } from "@/components/modals/CreateTokenModal";
import { BuilderHost } from "@/components/builder/BuilderHost";
import { StatsTab } from "@/components/sheet/sheet-tabs/StatsTab";
import type { Compendium } from "@/hooks/useCompendium";
import { quickBuild, readBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { useBuilderUiStore } from "@/store/builder-ui-store";
import { useEncounterStore } from "@/store/encounter-store";

/** PC builder plan, Phase 2: making a character, leveling it up, and what the sheet and the store do with a build. */

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  useBuilderUiStore.setState({ window: null });
  try { localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => cleanup());

const store = () => useEncounterStore.getState();
const compendium = { status: "", setStatus: vi.fn(), importCreature: vi.fn() } as unknown as Compendium;
const definitionNamed = (name: string) => store().encounter.definitions.find((definition) => definition.name === name)!;
const tokenOf = (definition: CreatureDefinition) => store().encounter.combatants.find((combatant) => combatant.definitionId === definition.id)!;

function createRogue(level: number, name = "Vex") {
  const id = store().createCharacter({ name, build: quickBuild(SRD_BUILD_SOURCES, { classId: "srd:class:rogue", level }) });
  return store().encounter.definitions.find((definition) => definition.id === id)!;
}

describe("Create Token › Character", { timeout: 20000 }, () => {
  it("Quick build makes a party character, named as typed, built to its level", async () => {
    const onCreated = vi.fn();
    render(<CreateTokenModal compendium={compendium} onClose={() => undefined} onCreated={onCreated} />);
    await userEvent.click(screen.getByRole("tab", { name: "Character" }));
    const name = screen.getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Brakka");
    await userEvent.selectOptions(screen.getByLabelText("Class"), "srd:class:fighter");
    await userEvent.selectOptions(screen.getByLabelText("Level"), "5");
    await userEvent.click(screen.getByRole("button", { name: /quick build/i }));

    const brakka = definitionNamed("Brakka");
    expect(brakka.character?.level).toBe(5);
    expect(readBuild(brakka)?.levels).toHaveLength(5);
    expect(brakka.features?.some((feature) => feature.name === "Extra Attack")).toBe(true);
    const token = tokenOf(brakka);
    expect(token.faction).toBe("party");
    expect(token.displayName).toBe("Brakka");
    expect(token.currentHp).toBe(brakka.maxHp);
    expect(token.resources).toEqual(brakka.resources);
    expect(onCreated).toHaveBeenCalled();
  });

  it("Step through opens the builder with every choice suggested, and creates the character from it", async () => {
    const onCreated = vi.fn();
    render(<CreateTokenModal compendium={compendium} onClose={() => undefined} />);
    await userEvent.click(screen.getByRole("tab", { name: "Character" }));
    await userEvent.selectOptions(screen.getByLabelText("Class"), "srd:class:rogue");
    await userEvent.click(screen.getByRole("button", { name: /step through/i }));
    expect(useBuilderUiStore.getState().window).toMatchObject({ kind: "create", seed: { classId: "srd:class:rogue", level: 1 } });

    cleanup();
    render(<BuilderHost onCreated={onCreated} />);
    const builder = screen.getByRole("dialog", { name: "Character builder" });
    expect(within(builder).getByText("All made")).toBeTruthy();
    // Change one choice: the first class skill.
    const skills = within(builder).getByRole("group", { name: "Class skills" });
    const checked = within(skills).getAllByRole("checkbox").filter((box) => (box as HTMLInputElement).checked);
    await userEvent.click(checked[0]!);
    expect(within(builder).getByText("1 still to choose")).toBeTruthy();
    await userEvent.click(within(builder).getByRole("button", { name: "Suggest the rest" }));
    await userEvent.click(within(builder).getByRole("button", { name: "Create character" }));
    const rogue = definitionNamed("New Character");
    expect(readBuild(rogue)?.levels[0]?.classId).toBe("srd:class:rogue");
    expect(onCreated).toHaveBeenCalled();
    expect(useBuilderUiStore.getState().window).toBeNull();
  });
});

describe("spells in the builder (Phase 5a)", { timeout: 20000 }, () => {
  it("offers Magic Initiate's spells by level, marks the reference-only ones, and puts the choice on the actor", async () => {
    useBuilderUiStore.getState().open({ kind: "create", seed: { name: "New Character", classId: "srd:class:fighter", level: 1, backgroundId: "srd:background:acolyte" } });
    render(<BuilderHost onCreated={() => undefined} />);
    const builder = screen.getByRole("dialog", { name: "Character builder" });
    const cantrips = within(builder).getByRole("group", { name: "Two cantrips: Cantrips" });
    const box = (name: RegExp) => within(cantrips).getByRole("checkbox", { name }) as HTMLInputElement;
    expect(box(/^Sacred Flame$/).checked).toBe(true);
    // A cantrip the simulator doesn't cast is marked.
    expect(within(cantrips).getByText(/^Guidance/).closest("label")!.textContent).toBe("Guidance ref");
    await userEvent.click(box(/^Guidance/));
    expect(within(builder).getByText("1 still to choose")).toBeTruthy();
    await userEvent.click(box(/^Spare the Dying/));
    expect(within(builder).getByText("All made")).toBeTruthy();
    // The 1st-level spell: only 1st-level cleric spells.
    const spell = within(builder).getByRole("group", { name: "A 1st-level spell, always prepared: 1st level" });
    await userEvent.click(within(spell).getByRole("checkbox", { name: /^Bless$/ }));
    const chosen = within(spell).getAllByRole("checkbox").filter((input) => (input as HTMLInputElement).checked);
    expect(chosen).toHaveLength(1);
    await userEvent.click(chosen[0]!);
    await userEvent.click(within(spell).getByRole("checkbox", { name: /^Bless$/ }));
    await userEvent.click(within(builder).getByRole("button", { name: "Create character" }));
    const fighter = definitionNamed("New Character");
    expect(fighter.spells?.map((entry) => entry.name).sort()).toEqual(["Bless (free)", "Sacred Flame", "Spare the Dying"]);
  });
});

describe("leveling up", { timeout: 20000 }, () => {
  it("the Level up window shows the level's choices filled in and what changes, and applies it as one step", async () => {
    const rogue = createRogue(3);
    useBuilderUiStore.getState().open({ kind: "level-up", definitionId: rogue.id });
    render(<BuilderHost onCreated={() => undefined} />);
    const dialog = screen.getByRole("dialog", { name: "Level up" });
    expect(dialog.textContent).toMatch(/Rogue 3 \(Thief\) · Criminal → Rogue 4/);
    // 4th level asks for a feat, already filled in.
    const feat = within(dialog).getByLabelText("Ability Score Improvement or another feat") as HTMLSelectElement;
    expect(feat.value).toBe("srd:feat:ability-score-improvement");
    expect(within(dialog).getByRole("list", { name: "Changes" }).textContent).toContain("Gains Ability Score Improvement (4th level)");

    const depth = store().undoStack.length;
    await userEvent.click(within(dialog).getByRole("button", { name: "Level up to 4" }));
    const after = store().encounter.definitions.find((definition) => definition.id === rogue.id)!;
    expect(after.character?.level).toBe(4);
    expect(store().undoStack.length).toBe(depth + 1);
    store().undo();
    expect(store().encounter.definitions.find((definition) => definition.id === rogue.id)!.character?.level).toBe(3);
  });

  it("tokens at full follow the new maximums; a hurt token keeps its hit points", () => {
    const rogue = createRogue(4);
    const token = tokenOf(rogue);
    const hurt = { ...token, id: "hurt", currentHp: 5 };
    useEncounterStore.setState((state) => ({ encounter: { ...state.encounter, combatants: [...state.encounter.combatants, hurt] } }));
    const build = readBuild(rogue)!;
    store().rebuildCharacter(rogue.id, quickBuild(SRD_BUILD_SOURCES, { classId: "srd:class:rogue", level: 5 }).levels.length === 5
      ? { ...build, levels: [...build.levels, { classId: "srd:class:rogue", choices: {} }] }
      : build);
    const after = store().encounter.definitions.find((definition) => definition.id === rogue.id)!;
    expect(after.maxHp).toBeGreaterThan(rogue.maxHp);
    expect(store().encounter.combatants.find((combatant) => combatant.id === token.id)!.currentHp).toBe(after.maxHp);
    expect(store().encounter.combatants.find((combatant) => combatant.id === "hurt")!.currentHp).toBe(5);
  });

  it("Stats › Class & level offers Level up, Level down and the builder", async () => {
    const rogue = createRogue(2);
    const token = tokenOf(rogue);
    function Live() {
      const encounter = useEncounterStore((s) => s.encounter);
      return <StatsTab combatant={encounter.combatants.find((c) => c.id === token.id)!} definition={encounter.definitions.find((d) => d.id === rogue.id)!} />;
    }
    render(<Live />);
    await userEvent.click(screen.getByRole("button", { name: /^Class & level/ }));
    await userEvent.click(screen.getByRole("button", { name: "Level up…" }));
    expect(useBuilderUiStore.getState().window).toEqual({ kind: "level-up", definitionId: rogue.id });
    await userEvent.click(screen.getByRole("button", { name: "Level down" }));
    expect(store().encounter.definitions.find((definition) => definition.id === rogue.id)!.character?.level).toBe(1);
    await userEvent.click(screen.getByRole("button", { name: "Open in the builder…" }));
    expect(useBuilderUiStore.getState().window).toEqual({ kind: "edit", definitionId: rogue.id });
  });
});

describe("editing a built character by hand (plan D6)", () => {
  it("a typed score moves the base score, so the bonuses on top and the next level keep it", () => {
    const rogue = createRogue(4);
    const dex = rogue.abilities.dex;
    store().updateCreatureAbility(rogue.id, "str", rogue.abilities.str + 2);
    const after = store().encounter.definitions.find((definition) => definition.id === rogue.id)!;
    expect(after.abilities.str).toBe(rogue.abilities.str + 2);
    expect(after.abilities.dex).toBe(dex);
    expect(readBuild(after)!.abilities.base.str).toBe(readBuild(rogue)!.abilities.base.str + 2);
  });

  it("a typed max HP becomes an adjustment the build keeps", () => {
    const rogue = createRogue(3);
    store().updateCreatureDefinition(rogue.id, { maxHp: rogue.maxHp + 7 });
    const after = store().encounter.definitions.find((definition) => definition.id === rogue.id)!;
    expect(after.maxHp).toBe(rogue.maxHp + 7);
    expect(readBuild(after)!.hp.adjust).toBe(7);
  });
});

describe("export and import", () => {
  it("keeps the build, and drops one that doesn't check out", () => {
    const rogue = createRogue(2);
    const exported = parseCombatantPackage(JSON.parse(JSON.stringify({ kind: "battle-sim-combatant", schemaVersion: 1, definition: rogue })));
    const kept = store().importCombatantPackage(exported);
    expect(readBuild(store().encounter.definitions.find((definition) => definition.id === kept))?.levels).toHaveLength(2);

    const broken = { ...rogue, character: { ...rogue.character, build: { version: 1, levels: [] } } };
    const dropped = store().importCombatantPackage(parseCombatantPackage(JSON.parse(JSON.stringify({ kind: "battle-sim-combatant", schemaVersion: 1, definition: broken }))));
    const imported = store().encounter.definitions.find((definition) => definition.id === dropped)!;
    expect(imported.character?.build).toBeUndefined();
    expect(imported.character?.level).toBe(2);
    expect(store().log.at(-1)?.message).toMatch(/character build was dropped/);
  });
});

describe("the Abilities list", () => {
  it("marks what the builder made with what gave it", async () => {
    const { abilityList } = await import("@/lib/ability-editor/list");
    const rogue = createRogue(3);
    const rows = abilityList(rogue).flatMap((group) => group.rows);
    const chipsOf = (name: string) => rows.find((row) => row.name === name)?.chips;
    expect(chipsOf("Sneak Attack")).toContain("from Rogue");
    expect(chipsOf("Fast Hands")).toContain("from Thief");
    expect(chipsOf("Savage Attacker") ?? chipsOf("Alert")).toContain("from feat");
    expect(rows.find((row) => row.name === "Shortbow")?.chips.some((chip) => chip.startsWith("from"))).toBe(false);
  });
});
