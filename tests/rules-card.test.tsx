// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { RulesCardProvider, RulesInfo, useRulesCard } from "@/components/rules-card";
import { describeSpell, describeClass, type RulesEntry } from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { BuilderHost } from "@/components/builder/BuilderHost";
import { useBuilderUiStore } from "@/store/builder-ui-store";

// CHARACTER_BUILDER_UX_PLAN.md D3: a rules card on hover (after a pause), on focus, on a first tap; Esc closes it; "Read
// all" pins its full text.

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useBuilderUiStore.getState().close();
});

const fireball = describeSpell("srd:spell:fireball-2024", SRD_BUILD_SOURCES);

function Anchor({ entry, onClick }: { entry: RulesEntry; onClick?: () => void }) {
  const cards = useRulesCard();
  return <button type="button" onClick={onClick} {...cards.bind(entry)}>{entry.title}</button>;
}

const card = () => screen.queryByRole("complementary", { name: /: rules$/ });

/** Goes to a step of the builder window by its rail button. */
const step = (builder: HTMLElement, name: string) =>
  fireEvent.click(within(within(builder).getByRole("navigation", { name: "Builder steps" })).getByRole("button", { name: new RegExp(`^\\d+\\s*${name}`) }));

describe("a rules card", () => {
  it("shows on hover after a pause, and closes when the pointer leaves", () => {
    vi.useFakeTimers();
    render(<RulesCardProvider><Anchor entry={fireball} /></RulesCardProvider>);
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Fireball" }));
    expect(card()).toBeNull();
    act(() => { vi.advanceTimersByTime(320); });
    const shown = card()!;
    expect(within(shown).getByText("3rd-level evocation")).toBeTruthy();
    expect(within(shown).getByText("DEX save · 8d6 fire · 20-ft sphere")).toBeTruthy();
    expect(within(shown).getByText("Runs in the simulator")).toBeTruthy();
    // The anchor names its card while it shows.
    expect(screen.getByRole("button", { name: "Fireball" }).getAttribute("aria-describedby")).toBe(shown.id);
    fireEvent.mouseLeave(screen.getByRole("button", { name: "Fireball" }));
    act(() => { vi.advanceTimersByTime(200); });
    expect(card()).toBeNull();
  });

  it("shows at once on keyboard focus, and Esc closes it", () => {
    render(<RulesCardProvider><Anchor entry={fireball} /></RulesCardProvider>);
    act(() => { screen.getByRole("button", { name: "Fireball" }).focus(); });
    expect(card()).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(card()).toBeNull();
  });

  it("pins its full text: from Read all, or `i` on the anchor", () => {
    const wizard = describeClass(SRD_BUILD_SOURCES.catalog.classes.find((entry) => entry.id === "srd:class:wizard")!);
    const long: RulesEntry = { ...wizard, text: Array.from({ length: 4 }, (_, index) => `Paragraph ${index + 1}.`).join("\n\n") };
    render(<RulesCardProvider><Anchor entry={long} /></RulesCardProvider>);
    const anchor = screen.getByRole("button", { name: "Wizard" });
    act(() => { anchor.focus(); });
    expect(within(card()!).queryByText("Paragraph 3.")).toBeNull();
    fireEvent.click(within(card()!).getByRole("button", { name: "Read all ›" }));
    expect(within(card()!).getByText("Paragraph 4.")).toBeTruthy();
    // Pinned, leaving doesn't close it; its own × does.
    fireEvent.mouseLeave(anchor);
    expect(card()).toBeTruthy();
    fireEvent.click(within(card()!).getByRole("button", { name: "Close Wizard" }));
    expect(card()).toBeNull();
    fireEvent.keyDown(anchor, { key: "i" });
    expect(within(card()!).getByText("Paragraph 4.")).toBeTruthy();
  });

  it("a first tap shows the card instead of choosing; the second chooses", () => {
    const chose = vi.fn();
    render(<RulesCardProvider><Anchor entry={fireball} onClick={chose} /></RulesCardProvider>);
    const anchor = screen.getByRole("button", { name: "Fireball" });
    fireEvent.pointerDown(anchor, { pointerType: "touch" });
    fireEvent.click(anchor);
    expect(card()).toBeTruthy();
    expect(chose).not.toHaveBeenCalled();
    fireEvent.pointerDown(anchor, { pointerType: "touch" });
    fireEvent.click(anchor);
    expect(chose).toHaveBeenCalledTimes(1);
  });

  it("wears the Codex's palette when given one", () => {
    render(<RulesCardProvider palette="light"><RulesInfo entry={fireball} label="About Fireball" /></RulesCardProvider>);
    act(() => { screen.getByRole("button", { name: "About Fireball" }).focus(); });
    const shown = card()!;
    expect(shown.getAttribute("data-dark")).toBe("false");
    expect(shown.style.getPropertyValue("--panel-hi")).toBe("#FFFFFF");
  });
});

describe("rules cards in the builder (Phase 2)", { timeout: 20000 }, () => {
  it("a spell chip shows its card, and the class has an ⓘ", () => {
    useBuilderUiStore.getState().open({ kind: "create", seed: { name: "New Character", classId: "srd:class:fighter", level: 1, backgroundId: "srd:background:acolyte" } });
    render(<BuilderHost onCreated={() => undefined} />);
    const builder = screen.getByRole("dialog", { name: "Character builder" });
    step(builder, "Spells");
    fireEvent.click(within(builder).getByRole("button", { name: /^Two cantrips/, expanded: false }));
    const cantrips = within(builder).getByRole("group", { name: "Two cantrips" });
    const sacredFlame = within(cantrips).getByRole("checkbox", { name: /^Sacred Flame$/ });
    act(() => { sacredFlame.focus(); });
    expect(within(card()!).getByText("Evocation cantrip")).toBeTruthy();
    step(builder, "Class");
    act(() => { within(builder).getByRole("button", { name: "About the Fighter" }).focus(); });
    expect(within(card()!).getByText("d10")).toBeTruthy();
  });
});
