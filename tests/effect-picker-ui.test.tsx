// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FeatureEffect } from "@/engine";
import { EffectPicker } from "@/components/sheet/ability-editor/EffectPicker";
import type { EffectKindSpec, EffectOwner } from "@/lib/ability-editor/effects";

/** EFFECTS_PLAN.md, Phase 0: the Add effect picker, on its own. */

afterEach(() => cleanup());

function open(owner: EffectOwner = "item", offered: (spec: EffectKindSpec) => boolean = () => true) {
  const onPick = vi.fn<(effects: FeatureEffect[]) => void>();
  const onClose = vi.fn();
  render(<EffectPicker offered={offered} owner={owner} onPick={onPick} onClose={onClose} />);
  const picker = within(screen.getByRole("dialog", { name: "Add effect" }));
  return { picker, onPick, onClose, search: picker.getByRole("searchbox", { name: "Search effects" }) as HTMLInputElement };
}

describe("the Add effect picker", () => {
  it("opens on its search, with the usual effects for an item and every group folded", () => {
    const { picker, search } = open("item");
    expect(document.activeElement).toBe(search);
    const common = within(picker.getByRole("group", { name: "Common on an item" }));
    expect(common.getAllByRole("button").map((button) => button.textContent)).toEqual(
      ["AC bonus", "Bonus to saves", "Speed", "Resistance", "Bonus to hit", "Extra damage", "Advantage on saves", "Save DC bonus"]
    );
    const folds = picker.getAllByRole("button", { expanded: false });
    expect(folds.map((fold) => fold.textContent?.replace(/\d+$/, ""))).toEqual(
      ["Movement", "Hit points", "AC & defenses", "Attacks & damage", "Spells", "Saves & d20 rolls", "Actions & turn", "Class & monster mechanics"]
    );
  });

  it("shows a buff's usual effects for a buff", () => {
    const { picker } = open("buff");
    expect(picker.getByRole("group", { name: "Common while it lasts" })).toBeTruthy();
    expect(picker.getByRole("button", { name: "Attacks against it" })).toBeTruthy();
  });

  it("opens one group at a time, its kinds with examples to start from", async () => {
    const { picker } = open();
    await userEvent.click(picker.getByRole("button", { name: /^AC & defenses/ }));
    const defense = within(picker.getByRole("group", { name: "AC & defenses" }));
    expect(defense.getByRole("button", { name: /^AC without armor/ })).toBeTruthy();
    expect(defense.getByRole("button", { name: "Mage Armor" })).toBeTruthy();
    await userEvent.click(picker.getByRole("button", { name: /^Spells/ }));
    expect(picker.queryByRole("group", { name: "AC & defenses" })).toBeNull();
    expect(picker.getByRole("group", { name: "Spells" })).toBeTruthy();
  });

  it("adds a kind's blank from the Common row, and an example filled in", async () => {
    const { picker, onPick } = open();
    await userEvent.click(picker.getByRole("button", { name: "AC bonus" }));
    expect(onPick).toHaveBeenLastCalledWith([{ kind: "armor-class-bonus", bonus: { base: 1 } }]);
    await userEvent.click(picker.getByRole("button", { name: /^AC & defenses/ }));
    await userEvent.click(picker.getByRole("button", { name: "Bludgeoning, piercing and slashing resistance, like Rage" }));
    expect(onPick.mock.lastCall![0].map((effect) => effect.kind === "damage-adjustment" && effect.adjustment.damageType)).toEqual(["bludgeoning", "piercing", "slashing"]);
  });

  it("searches, and Enter adds the best match: here an example", async () => {
    const { picker, search, onPick } = open();
    await userEvent.type(search, "pack tac");
    expect(picker.queryByRole("group", { name: "Common on an item" })).toBeNull();
    expect(picker.getByRole("button", { name: /^Advantage on its attacks/ })).toBeTruthy();
    await userEvent.keyboard("{Enter}");
    expect(onPick).toHaveBeenLastCalledWith([{ kind: "attack-advantage", condition: "ally-adjacent-to-target" }]);
  });

  it("says what to do when nothing matches", async () => {
    const { picker, search } = open();
    await userEvent.type(search, "xylophone");
    expect(picker.getByRole("status").textContent).toMatch(/Nothing here matches “xylophone”.*Reference only/s);
  });

  it("moves with the arrow keys; Escape clears the search, then closes", async () => {
    const { picker, search, onClose } = open();
    await userEvent.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(picker.getByRole("button", { name: "AC bonus" }));
    await userEvent.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(search);
    await userEvent.type(search, "regen");
    await userEvent.keyboard("{Escape}");
    expect(search.value).toBe("");
    expect(onClose).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("leaves out what can't go here", async () => {
    const { picker, search } = open("feature", (spec) => !spec.conditionOnly);
    await userEvent.type(search, "hunter's mark");
    expect(picker.queryByRole("button", { name: /^Hunter's Mark/ })).toBeNull();
  });
});
