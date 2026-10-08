// @vitest-environment happy-dom
import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BuilderHost } from "@/components/builder/BuilderHost";
import { quickBuild } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { useBuilderUiStore } from "@/store/builder-ui-store";
import { useCatalogStore } from "@/store/catalog-store";
import { useEncounterStore } from "@/store/encounter-store";

// CHARACTER_BUILDER_UX_PLAN.md §3.5: the Equipment step. Packages as cards, a 2014 class's lines and weapon tables, and
// what reaches the sheet (weapons and armor), each with its card.

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

async function openEquipment(seed: { name: string; classId: string; level: number; backgroundId?: string }) {
  useBuilderUiStore.getState().open({ kind: "create", seed });
  render(<BuilderHost onCreated={() => undefined} />);
  const builder = screen.getByRole("dialog", { name: "Character builder" });
  await userEvent.click(within(within(builder).getByRole("navigation", { name: "Builder steps" })).getByRole("button", { name: /^\d+\s*Equipment/ }));
  return builder;
}
const card = () => screen.queryByRole("complementary", { name: /: rules$/ });
const gear = (builder: HTMLElement) => within(builder).getByRole("region", { name: "What reaches the sheet" });

describe("the Equipment step", { timeout: 30000 }, () => {
  it("offers a 2024 class's and background's packages as cards, and lists the weapons and armor they give", async () => {
    const builder = await openEquipment({ name: "Tamsin", classId: "srd:class:wizard", level: 1, backgroundId: "srd:background:sage" });
    const packages = within(builder).getByRole("radiogroup", { name: "Wizard's starting equipment" });
    expect(within(packages).getByRole("radio", { name: /^A: Two daggers, a quarterstaff/ }).getAttribute("aria-checked")).toBe("true");
    expect(within(builder).getByRole("radiogroup", { name: "Sage's starting equipment" })).toBeTruthy();
    expect(gear(builder).textContent).toMatch(/Dagger ×2/);
    act(() => { within(gear(builder)).getByRole("button", { name: /Dagger ×2/ }).focus(); });
    expect(card()!.textContent).toMatch(/1d4 piercing/);
    // Package B is gold: the class gives no weapons, and the preview loses them.
    await userEvent.click(within(packages).getByRole("radio", { name: "B: 55 GP" }));
    expect(gear(builder).textContent).not.toMatch(/Dagger/);
    await userEvent.click(within(packages).getByRole("radio", { name: "None" }));
    expect(within(packages).getByRole("radio", { name: "None" }).getAttribute("aria-checked")).toBe("true");
    expect(gear(builder).textContent).toMatch(/Only weapons and armor reach the sheet/);
  });

  it("offers a 2014 class's lines as cards, and a table for each martial weapon to choose", async () => {
    const builder = await openEquipment({ name: "Brakka", classId: "srd:class:fighter-2014", level: 1, backgroundId: "srd:background:acolyte-2014" });
    const armor = within(builder).getByRole("radiogroup", { name: "Equipment line 1" });
    expect(within(armor).getByRole("radio", { name: "(a) Chain mail" }).getAttribute("aria-checked")).toBe("true");
    expect(gear(builder).textContent).toMatch(/Chain Mail/i);
    act(() => { within(gear(builder)).getByRole("button", { name: /Chain Mail/i }).focus(); });
    expect(card()!.textContent).toMatch(/Armor class\s*16/);
    // Two martial weapons: two tables.
    await userEvent.click(within(within(builder).getByRole("radiogroup", { name: "Equipment line 2" })).getByRole("radio", { name: "(b) Two martial weapons" }));
    const second = within(builder).getByRole("radiogroup", { name: "Equipment line 2: weapon 2" });
    await userEvent.click(within(second).getByRole("radio", { name: "Warhammer" }));
    expect((within(second).getByRole("radio", { name: "Warhammer" }) as HTMLInputElement).checked).toBe(true);
    expect(gear(builder).textContent).toMatch(/Warhammer/);
    // The 2014 background's gear is in its text.
    expect(within(builder).getByRole("region", { name: "Background equipment" }).textContent).toMatch(/listed in its text/);
  });

  it("says a built character's equipment was set when it was made", async () => {
    const id = useEncounterStore.getState().createCharacter({ name: "Vex", build: quickBuild(SRD_BUILD_SOURCES, { classId: "srd:class:rogue", level: 2 }) });
    useBuilderUiStore.getState().open({ kind: "edit", definitionId: id });
    render(<BuilderHost onCreated={() => undefined} />);
    const builder = screen.getByRole("dialog", { name: "Character builder" });
    await userEvent.click(within(within(builder).getByRole("navigation", { name: "Builder steps" })).getByRole("button", { name: /^\d+\s*Equipment/ }));
    expect(builder.textContent).toMatch(/Equipment was set when the character was made/);
    expect(within(builder).queryByRole("radiogroup", { name: /starting equipment/ })).toBeNull();
  });
});
