// @vitest-environment happy-dom
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import type { DamageAdjustment, FeatureEffect } from "@/engine";
import { FeatureEffectEditor } from "@/components/sheet/builders/FeatureEffectEditor";
import { flattenGroups, groupAdjustments } from "@/components/sheet/builders/DamageAdjustmentGroup";
import { weaponDraftFromDefinition, weaponFromDraft } from "@/components/sheet/builders/schemas";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("damage adjustment groups", () => {
  const adjustments: DamageAdjustment[] = [
    { type: "resistance", damageType: "bludgeoning", nonMagicalOnly: true, exceptMaterials: ["silvered"] },
    { type: "resistance", damageType: "piercing", nonMagicalOnly: true, exceptMaterials: ["silvered"] },
    { type: "resistance", damageType: "fire" },
    { type: "absorb", damageType: "lightning" }
  ];

  it("groups by type, non-magical flag and material exceptions, and round-trips", () => {
    const groups = groupAdjustments(adjustments);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toMatchObject({ type: "resistance", damageTypes: ["bludgeoning", "piercing"], nonMagicalOnly: true, exceptMaterials: ["silvered"] });
    expect(flattenGroups(groups)).toEqual(adjustments);
  });

  it("drops material exceptions when the group is no longer non-magical-only", () => {
    const [group] = groupAdjustments([adjustments[0]!]);
    expect(flattenGroups([{ ...group!, nonMagicalOnly: undefined }])).toEqual([{ type: "resistance", damageType: "bludgeoning" }]);
  });
});

function Harness({ initial }: { initial: FeatureEffect[] }) {
  const [effects, setEffects] = useState(initial);
  return (
    <>
      <FeatureEffectEditor value={effects} onChange={setEffects} />
      <output data-testid="effects">{JSON.stringify(effects)}</output>
    </>
  );
}
const current = (): FeatureEffect[] => JSON.parse(screen.getByTestId("effects").textContent!);

describe("feature effect editor", () => {
  it("keeps a material exception through an edit (it used to be dropped)", async () => {
    render(<Harness initial={[{ kind: "damage-adjustment", condition: "always", adjustment: { type: "resistance", damageType: "slashing", nonMagicalOnly: true, exceptMaterials: ["adamantine"] } }]} />);
    expect((screen.getByLabelText("not adamantine") as HTMLInputElement).checked).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "piercing" }));
    const effects = current();
    expect(effects).toHaveLength(2);
    expect(effects.every((effect) => effect.kind === "damage-adjustment" && effect.adjustment.exceptMaterials?.[0] === "adamantine")).toBe(true);
  });

  it("offers absorb as an adjustment", async () => {
    render(<Harness initial={[{ kind: "damage-adjustment", condition: "always", adjustment: { type: "resistance", damageType: "fire" } }]} />);
    await userEvent.selectOptions(screen.getByLabelText("Adjustment"), "absorb");
    expect(current()[0]).toMatchObject({ adjustment: { type: "absorb", damageType: "fire" } });
  });

  it("scopes save advantage to magic and to a condition", async () => {
    render(<Harness initial={[{ kind: "save-advantage" }]} />);
    await userEvent.selectOptions(screen.getByLabelText("Save source"), "magical");
    await userEvent.click(screen.getByRole("button", { name: "charmed" }));
    await userEvent.click(screen.getByRole("button", { name: "WIS" }));
    expect(current()[0]).toEqual({ kind: "save-advantage", abilities: ["wis"], against: { source: "magical", conditions: ["charmed"] } });
    // Clearing every scope returns to an unscoped effect.
    await userEvent.selectOptions(screen.getByLabelText("Save source"), "any");
    await userEvent.click(screen.getByRole("button", { name: "charmed" }));
    await userEvent.click(screen.getByRole("button", { name: "WIS" }));
    expect(current()[0]).toEqual({ kind: "save-advantage" });
  });

  it("reads back a generated multi-ability, magic-scoped effect (Gnome Cunning)", () => {
    render(<Harness initial={[{ kind: "save-advantage", abilities: ["int", "wis", "cha"], against: { source: "magical" } }]} />);
    expect((screen.getByLabelText("Save source") as HTMLSelectElement).value).toBe("magical");
    expect(screen.getByRole("button", { name: "INT" }).className).not.toBe("");
  });
});

describe("weapon material", () => {
  const weapon = { id: "w", name: "Dagger", attackType: "melee" as const, ability: "str" as const, range: 5, reach: 5, damage: [{ dice: "1d4", damageType: "piercing" as const }], material: "silvered" as const };

  it("round-trips through the builder draft", () => {
    const draft = weaponDraftFromDefinition(weapon);
    expect(draft.material).toBe("silvered");
    expect(weaponFromDraft(draft).material).toBe("silvered");
    expect(weaponFromDraft({ ...draft, material: "none" }).material).toBeUndefined();
  });
});

describe("limited-use effect editors", () => {
  it("edits regeneration", async () => {
    render(<Harness initial={[{ kind: "hp-regen", amount: 10 }]} />);
    await userEvent.click(screen.getByLabelText(/even at 0 HP/));
    await userEvent.click(screen.getByRole("button", { name: "acid" }));
    await userEvent.click(screen.getByRole("button", { name: "fire" }));
    expect(current()[0]).toEqual({ kind: "hp-regen", amount: 10, worksAtZero: true, suppressedByDamageTypes: ["acid", "fire"] });
  });

  it("edits Undead Fortitude and Relentless shapes", async () => {
    render(<Harness initial={[{ kind: "survive-lethal", save: { ability: "con", dcBase: 5 } }]} />);
    await userEvent.click(screen.getByLabelText(/not against radiant/));
    await userEvent.click(screen.getByLabelText(/not against a critical/));
    expect(current()[0]).toEqual({ kind: "survive-lethal", save: { ability: "con", dcBase: 5 }, excludedDamageTypes: ["radiant"], excludeCritical: true });
    await userEvent.click(screen.getByLabelText(/needs a saving throw/));
    await userEvent.type(screen.getByLabelText("Largest hit covered"), "7");
    expect(current()[0]).toMatchObject({ maxDamage: 7 });
    expect((current()[0] as { save?: unknown }).save).toBeUndefined();
  });

  it("edits Legendary Resistance", async () => {
    render(<Harness initial={[{ kind: "auto-succeed-save", resourceId: "legendary-resistance" }]} />);
    await userEvent.selectOptions(screen.getByLabelText("Save source"), "magical");
    expect(current()[0]).toEqual({ kind: "auto-succeed-save", resourceId: "legendary-resistance", against: { source: "magical" } });
  });
});
