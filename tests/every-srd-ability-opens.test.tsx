// @vitest-environment happy-dom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreatureDefinition, DeathEffectDefinition, FeatureDefinition, LegendaryActionRef, SpellDefinition, WeaponDefinition } from "@/engine";
import { AbilityEditor } from "@/components/sheet/ability-editor/AbilityEditor";
import { legendaryMode } from "@/lib/ability-editor/legendary";
import { abilityList } from "@/lib/ability-editor/list";
import { abilityRefs, findAbility, refKey, type AbilityRef } from "@/lib/ability-editor/refs";
import { actionOpensInEditor } from "@/lib/ability-editor/spells";

/**
 * Phase 7's done-when: every SRD monster ability opens in the new editor. Every row of every monster's Abilities tab
 * opens it, every ability a trait grants opens in it nested, and one of each kind renders with every section open.
 */

// happy-dom has no file URL for this module: the chunks are found from the project root.
const CHUNKS = join(process.cwd(), "src/data/srd/monsters/generated/chunks");
const MONSTERS: CreatureDefinition[] = readdirSync(CHUNKS).flatMap(
  (file) => (JSON.parse(readFileSync(join(CHUNKS, file), "utf8")) as { definitions: CreatureDefinition[] }).definitions
);

/** What kind of ability a ref is, to pick one of each: its list, and its kind or (a legendary action) what it does. */
function kindOf(monster: CreatureDefinition, ref: AbilityRef): string {
  const record = findAbility(monster, ref)!;
  switch (ref.list) {
    case "legendary": return legendaryMode(record as LegendaryActionRef);
    case "deathEffects": return (record as DeathEffectDefinition).action.kind;
    case "spells": return (record as SpellDefinition).action?.kind ?? "none";
    case "weapons": return (record as WeaponDefinition).attackType;
    case "features":
    case "traits": return (record as FeatureDefinition).category;
    default: return (record as { kind: string }).kind;
  }
}

const SAMPLES: Array<[string, CreatureDefinition, AbilityRef]> = (() => {
  const seen = new Map<string, [string, CreatureDefinition, AbilityRef]>();
  for (const monster of MONSTERS) {
    for (const ref of abilityRefs(monster)) {
      const key = `${ref.list} ${kindOf(monster, ref)}`;
      if (!seen.has(key)) seen.set(key, [`${key} (${monster.name}, ${refKey(ref)})`, monster, ref]);
    }
  }
  return [...seen.values()];
})();

afterEach(() => cleanup());

describe("every SRD monster ability opens in the new editor", { timeout: 60000 }, () => {
  it("opens every row of every monster's Abilities tab in the editor", () => {
    const closed = MONSTERS.flatMap((monster) => abilityList(monster)
      .flatMap((group) => [...group.rows, ...(group.levels ?? []).flatMap((level) => level.rows)])
      .filter((row) => row.opens !== "editor")
      .map((row) => `${monster.name}: ${row.name}`));
    expect(closed).toEqual([]);
  });

  it("opens every ability a trait or an item grants, nested", () => {
    const closed = MONSTERS.flatMap((monster) => [...(monster.features ?? []), ...(monster.traits ?? []), ...(monster.weapons ?? [])]
      .flatMap((parent) => (parent.grantedActions ?? [])
        .filter((action) => action.kind !== "activate-feature" && !actionOpensInEditor(action))
        .map((action) => `${monster.name}: ${parent.name} › ${action.name}`)));
    expect(closed).toEqual([]);
  });

  it("samples every kind of ability there is", () => {
    const kinds = SAMPLES.map(([label]) => label.split(" (")[0]);
    expect(kinds).toEqual(expect.arrayContaining([
      "legendary uses", "legendary own", "legendary reference", "deathEffects area-save", "actions transform", "granted summon", "granted utility"
    ]));
  });

  it.each(SAMPLES)("%s: renders with every section open", async (_, monster, ref) => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    render(<AbilityEditor definition={monster} target={{ mode: "edit", ref }} onClose={() => undefined} />);
    const editor = screen.getByRole("region", { name: /^Edit / });
    await userEvent.click(within(editor).getByRole("button", { name: "Expand all" }));
    const sections = [...editor.querySelectorAll<HTMLElement>("[data-section]")];
    expect(sections.length).toBeGreaterThan(1);
    expect(sections.every((section) => section.querySelector("button")?.getAttribute("aria-expanded") === "true")).toBe(true);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
