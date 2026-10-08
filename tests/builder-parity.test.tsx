// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BuilderHost } from "@/components/builder/BuilderHost";
import { quickBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { useBuilderUiStore } from "@/store/builder-ui-store";
import { useCatalogStore } from "@/store/catalog-store";
import { useEncounterStore } from "@/store/encounter-store";

/*
 * Builder parity (CHARACTER_BUILDER_UX_PLAN.md D1, §7): the builder's two looks are one builder. For the plan's three
 * characters, this reads every control each look shows on every step, by its role and accessible name, and the two
 * lists must be equal: unlike the sheet's parity test, with no exceptions. (The window's title bar, where the look and
 * the Codex's colours are switched, isn't the builder's content.) A control added to one look and not the other fails.
 */

const ROLES = ["button", "checkbox", "combobox", "textbox", "spinbutton", "radio", "switch", "searchbox", "slider", "menuitem", "tab"] as const;

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  useBuilderUiStore.setState({ window: null, homebrew: false });
  useCatalogStore.getState().setEntries([]);
  try { localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => {
  cleanup();
  useBuilderUiStore.getState().close();
});

type Seed = { name: string; classId: string; level: number; backgroundId?: string; speciesId?: string };

/** Every control the builder shows for `seed` in `look`, as "step › role: name", on every step its rail lists. */
async function controls(seed: Seed, look: "Standard" | "Codex"): Promise<Set<string>> {
  useBuilderUiStore.getState().open({ kind: "create", seed });
  render(<BuilderHost onCreated={() => undefined} />);
  const builder = screen.getByRole("dialog", { name: "Character builder" });
  await userEvent.click(within(within(builder).getByRole("group", { name: "Builder look" })).getByRole("button", { name: look }));
  const names = new Set<string>();
  const content = () => builder.querySelector<HTMLElement>("[data-look]")!;
  const rail = () => within(builder).getByRole("navigation", { name: "Builder steps" });
  const steps = within(rail()).getAllByRole("button").map((button) => /^\d+\s*(\w+)/.exec(button.textContent ?? "")?.[1]).filter(Boolean) as string[];
  expect(steps).toContain("Review");
  for (const step of steps) {
    await userEvent.click(within(rail()).getByRole("button", { name: new RegExp(`^\\d+\\s*${step}`) }));
    for (const role of ROLES) {
      for (const control of within(content()).queryAllByRole(role)) {
        const name = control.getAttribute("aria-label") ?? control.textContent ?? "";
        names.add(`${step} › ${role}: ${name.replace(/\s+/g, " ").trim()}`);
      }
    }
  }
  cleanup();
  useBuilderUiStore.getState().close();
  return names;
}

const SEEDS: Seed[] = [
  { name: "Tamsin", classId: "srd:class:wizard", level: 5, backgroundId: "srd:background:sage", speciesId: "srd:species:dwarf" },
  { name: "Ilse", classId: "srd:class:cleric-2014", level: 5, backgroundId: "srd:background:acolyte-2014", speciesId: "srd:species:dwarf-2014" },
  { name: "Brakka", classId: "srd:class:fighter", level: 5, backgroundId: "srd:background:soldier" }
];

describe("the builder's two looks offer the same controls", { timeout: 60000 }, () => {
  for (const seed of SEEDS) {
    it(`${seed.name}: ${seed.classId.replace("srd:class:", "")} ${seed.level}`, async () => {
      const standard = await controls(seed, "Standard");
      const codex = await controls(seed, "Codex");
      expect([...standard].filter((name) => !codex.has(name))).toEqual([]);
      expect([...codex].filter((name) => !standard.has(name))).toEqual([]);
      // Something was read: every step's rail and footer at least.
      expect(standard.size).toBeGreaterThan(40);
    });
  }
});

/** Every control Level up shows for a character built from `seed` in `look`, with its folds open. */
async function levelUpControls(seed: Seed, look: "Standard" | "Codex"): Promise<Set<string>> {
  useEncounterStore.setState(pristine, true);
  const id = useEncounterStore.getState().createCharacter({ name: seed.name, build: quickBuild(SRD_BUILD_SOURCES, seed) });
  useBuilderUiStore.getState().open({ kind: "level-up", definitionId: id });
  render(<BuilderHost onCreated={() => undefined} />);
  const dialog = screen.getByRole("dialog", { name: "Level up" });
  await userEvent.click(within(within(dialog).getByRole("group", { name: "Builder look" })).getByRole("button", { name: look }));
  const content = () => dialog.querySelector<HTMLElement>("[data-look]")!;
  await userEvent.click(within(content()).getByRole("button", { name: "Multiclass…" }));
  await userEvent.click(within(content()).getByRole("button", { name: /^What changes/ }));
  const names = new Set<string>();
  for (const role of ROLES) {
    for (const control of within(content()).queryAllByRole(role)) {
      names.add(`${role}: ${(control.getAttribute("aria-label") ?? control.textContent ?? "").replace(/\s+/g, " ").trim()}`);
    }
  }
  cleanup();
  useBuilderUiStore.getState().close();
  return names;
}

describe("Level up's two looks offer the same controls", { timeout: 60000 }, () => {
  for (const seed of [SEEDS[0]!, { ...SEEDS[2]!, level: 3 }]) {
    it(`${seed.name}: ${seed.classId.replace("srd:class:", "")} ${seed.level} → ${seed.level + 1}`, async () => {
      const standard = await levelUpControls(seed, "Standard");
      const codex = await levelUpControls(seed, "Codex");
      expect([...standard].filter((name) => !codex.has(name))).toEqual([]);
      expect([...codex].filter((name) => !standard.has(name))).toEqual([]);
      expect(standard.size).toBeGreaterThan(15);
    });
  }
});
