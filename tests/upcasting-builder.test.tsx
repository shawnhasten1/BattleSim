// @vitest-environment happy-dom
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ActionDefinition, CreatureDefinition, ReactionTrigger, SpellDefinition } from "@/engine";
import { findSrdSpell } from "@/data/srd";
import { ActionsTab } from "@/components/sheet/sheet-tabs/ActionsTab";
import { TriggerPicker, blankTrigger } from "@/components/sheet/ability-editor/ReactionControls";
import { abilityWarnings } from "@/lib/ability-editor/validate";
import { describeUpcast, higherLevelsText, srdUpcastOffer, srdUpcastOffers, withSrdUpcasts } from "@/lib/ability-editor/upcasting";
import { useEncounterStore } from "@/store/encounter-store";

/**
 * The builder and higher slots (UPCASTING_AND_COUNTERSPELL_PLAN.md Phase 3): any leveled spell already casts with a
 * higher slot, so it says so and stops warning; the SRD's upcasting is offered for a spell of the same name that has
 * none, never applied by itself; a spell's "At Higher Levels" text sits by the controls; and a counter's check is set
 * on its trigger.
 */

const pristine = useEncounterStore.getState();
beforeEach(() => {
  useEncounterStore.setState(pristine, true);
  try { localStorage.clear(); } catch { /* private mode */ }
});
afterEach(() => cleanup());

const store = () => useEncounterStore.getState();
const fighter = () => store().encounter.definitions.find((d) => d.id === "def-fighter")! as CreatureDefinition;

/** Blight as a homebrew sheet has it: no upcasting. */
const homebrewBlight = (extra: Partial<SpellDefinition> = {}): SpellDefinition => ({
  id: "blight", name: "Blight", level: 4, castingTime: "action", range: 30,
  resourceCost: { resourceId: "slot-4", amount: 1 }, automationSupport: "full",
  action: {
    kind: "save", id: "blight-action", name: "Blight", actionType: "action", saveAbility: "con", dc: 15, range: 30,
    damage: [{ dice: "8d8", damageType: "necrotic", magical: true }], onSuccess: "half", halfDamageOnSuccess: true,
    resourceCost: { resourceId: "slot-4", amount: 1 }, automationSupport: "full"
  },
  ...extra
});

const creature = (extra: Partial<CreatureDefinition> = {}): CreatureDefinition => ({
  id: "c", name: "Caster", size: "medium", armorClass: 12, maxHp: 30, speed: 30,
  abilities: { str: 10, dex: 10, con: 10, int: 16, wis: 10, cha: 10 }, actions: [], ...extra
});

describe("the SRD's upcasting, offered", () => {
  it("for a homebrew spell of the same name and level that has none", () => {
    expect(srdUpcastOffer(homebrewBlight())).toMatchObject({
      spellId: "blight", upcast: { perSlotAboveBase: { damageDice: "1d8" } },
      text: "The SRD's Blight adds 1d8 damage per level above 4th."
    });
  });

  it("matching the name the way the library files it ('Acid Arrow' is Melf's)", () => {
    const arrow: SpellDefinition = { ...structuredClone(findSrdSpell("srd:spell:acid-arrow")!), id: "arrow", name: "acid arrow", upcast: undefined };
    if (arrow.action) delete (arrow.action as { upcast?: unknown }).upcast;
    expect(srdUpcastOffer(arrow)?.text).toMatch(/^The SRD's Melf's Acid Arrow adds/);
  });

  it("not for a spell that upcasts its own way, one of another level, or one from another source", () => {
    expect(srdUpcastOffer(homebrewBlight({ upcast: { perSlotAboveBase: { damageDice: "2d8" } } }))).toBeUndefined();
    expect(srdUpcastOffer(homebrewBlight({ upcast: { notModelled: "the DM's call" } }))).toBeUndefined();
    expect(srdUpcastOffer(homebrewBlight({ level: 5 }))).toBeUndefined();
    expect(srdUpcastOffer(homebrewBlight({ source: { provider: "open5e", documentKey: "a5e", documentName: "Level Up" } }))).toBeUndefined();
  });

  it("not when the spell's own action can't use it (a Blight that deals no damage)", () => {
    const quiet = homebrewBlight();
    (quiet.action as Extract<ActionDefinition, { kind: "save" }>).damage = [];
    expect(srdUpcastOffer(quiet)).toBeUndefined();
  });

  it("taken, writes the upcasting where the spell keeps it", () => {
    const spells = [homebrewBlight(), { ...homebrewBlight(), id: "other", name: "Not A Spell" }];
    const offers = srdUpcastOffers({ spells });
    expect(offers.map((offer) => offer.spellId)).toEqual(["blight"]);
    const taken = withSrdUpcasts(spells, offers);
    expect(taken[0]!.upcast).toEqual({ perSlotAboveBase: { damageDice: "1d8" } });
    expect(taken[1]).toBe(spells[1]);
  });

  it("is described in words", () => {
    expect(describeUpcast({ perSlotAboveBase: { targets: 1 } }, 1)).toBe("takes one more creature per level above 1st");
    expect(describeUpcast({ perSlotAboveBase: { damageDice: "1d8" } }, 5, true)).toBe("adds 1d8 healing per level above 5th");
    expect(describeUpcast({ notModelled: "Lasts longer" }, 5)).toBeUndefined();
  });
});

describe("a spell's own 'At Higher Levels' text", () => {
  it("is found as an import leaves it (its paragraph after the description) or headed", () => {
    const imported = "A beam of necrotic energy.\n\nWhen you cast this spell using a spell slot of 5th level or higher, the damage increases by 1d8 for each slot level above 4th.\n\nA withered leaf";
    expect(higherLevelsText(imported)).toMatch(/^When you cast this spell using a spell slot of 5th level/);
    expect(higherLevelsText("It hurts.\n\n**At Higher Levels.** One more target per slot.")).toBe("One more target per slot.");
    expect(higherLevelsText("It hurts.")).toBeUndefined();
  });
});

describe("never usable", () => {
  it("isn't said of a leveled spell whose own slot is missing while a higher one is there", () => {
    const ids = (resources: Record<string, number>) => abilityWarnings(creature({ resources }), "spells", homebrewBlight()).map((warning) => warning.id);
    expect(ids({ "slot-5": 2 })).not.toContain("missing-pool");
    expect(ids({ "slot-3": 2 })).toContain("missing-pool");
  });
});

function LiveTab() {
  const encounter = useEncounterStore((s) => s.encounter);
  return <ActionsTab combatant={encounter.combatants.find((c) => c.id === "pc-fighter")!} definition={encounter.definitions.find((d) => d.id === "def-fighter")!} />;
}

function giveFighter(spells: SpellDefinition[], resources: Record<string, number>) {
  store().updateCreatureDefinition("def-fighter", { spells, resources });
}

async function openUse() {
  const section = screen.getByRole("button", { name: /^Use & cost/ });
  if (section.getAttribute("aria-expanded") !== "true") await userEvent.click(section);
}

describe("in the spell editor", () => {
  it("says a higher slot casts it the same, offers the SRD's, and takes it on Use it", async () => {
    giveFighter([homebrewBlight()], { "slot-4": 3, "slot-5": 2 });
    render(<LiveTab />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Blight" }));
    await openUse();
    expect(screen.getByText("Casting with a higher slot")).toBeTruthy();
    expect(screen.getByText("A higher slot casts it the same.")).toBeTruthy();
    expect(screen.getByText(/The SRD's Blight adds 1d8 damage per level above 4th\./)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Use it" }));
    expect(screen.queryByText("A higher slot casts it the same.")).toBeNull();
    expect((screen.getByLabelText("More damage per slot level") as HTMLInputElement).value).toBe("1d8");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(fighter().spells![0]!.upcast).toEqual({ perSlotAboveBase: { damageDice: "1d8" } });
  });

  it("shows the spell's own text, and keeps what isn't simulated through the dice", async () => {
    const description = "A beam.\n\nWhen you cast this spell using a spell slot of 5th level or higher, the damage increases by 1d8 for each slot level above 4th.";
    giveFighter([homebrewBlight({ description })], { "slot-4": 3, "slot-5": 2 });
    render(<LiveTab />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Blight" }));
    await openUse();
    expect(screen.getByText(/^At higher levels: When you cast this spell using a spell slot of 5th level/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: /^Not simulated/ }));
    await userEvent.type(screen.getByLabelText("What else a higher slot does (not simulated)"), "Withers plants");
    await userEvent.click(screen.getByRole("checkbox", { name: "Stronger with a higher slot" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(fighter().spells![0]!.upcast).toEqual({ perSlotAboveBase: { damageDice: "1d8" }, notModelled: "Withers plants" });
  });
});

describe("a counter's check, on its trigger", () => {
  function Picker({ start, seen }: { start: ReactionTrigger; seen: (trigger: ReactionTrigger) => void }) {
    const [value, setValue] = useState(start);
    return <TriggerPicker value={value} onChange={(next) => { setValue(next); seen(next); }} kinds={["would-be-hit", "enemy-casts-spell"]} />;
  }

  it("starts on for a new counter, and each part can be set on its own", async () => {
    const seen: ReactionTrigger[] = [];
    render(<Picker start={blankTrigger("would-be-hit")} seen={(trigger) => seen.push(trigger)} />);
    await userEvent.selectOptions(screen.getByLabelText("When"), "enemy-casts-spell");
    expect(seen.at(-1)).toEqual({ kind: "enemy-casts-spell", withinFt: 60, checkAbove: { dcBase: 10 } });
    const check = screen.getByRole("checkbox", { name: /Above its slot's level: a check/ }) as HTMLInputElement;
    expect(check.checked).toBe(true);

    await userEvent.type(screen.getByLabelText("Check bonus"), "2");
    expect(seen.at(-1)).toMatchObject({ checkAbove: { dcBase: 10, bonus: 2 } });
    await userEvent.clear(screen.getByLabelText("Check bonus"));
    expect(seen.at(-1)).toMatchObject({ checkAbove: { dcBase: 10 } });
    expect((seen.at(-1) as { checkAbove: object }).checkAbove).not.toHaveProperty("bonus");

    await userEvent.click(check);
    expect(seen.at(-1)).toMatchObject({ checkAbove: false });
    expect(screen.queryByLabelText("Check bonus")).toBeNull();
    await userEvent.click(screen.getByRole("checkbox", { name: /Above its slot's level: a check/ }));
    expect(seen.at(-1)).toMatchObject({ checkAbove: { dcBase: 10 } });
  });

  it("on the library's Counterspell: shown on, saved off when switched off", async () => {
    store().attachSrdSpell("def-fighter", "srd:spell:counterspell");
    store().updateCreatureDefinition("def-fighter", { resources: { "slot-3": 2 } });
    render(<LiveTab />);
    await userEvent.click(screen.getByRole("button", { name: "Edit Counterspell" }));
    await openUse();
    expect(screen.getByText(/A higher slot stops a spell of its own level or lower outright/)).toBeTruthy();
    const check = screen.getByRole("checkbox", { name: /Above its slot's level: a check/ }) as HTMLInputElement;
    expect(check.checked).toBe(true);
    await userEvent.click(check);
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    const saved = fighter().spells!.at(-1)!.action as Extract<ActionDefinition, { kind: "activate-feature" }>;
    expect(saved.reaction?.trigger).toMatchObject({ kind: "enemy-casts-spell", checkAbove: false });
  });
});

describe("the Actions tab's offer", () => {
  it("lists the spells the SRD would give upcasting to, and takes one or all", async () => {
    const cone: SpellDefinition = { ...structuredClone(findSrdSpell("srd:spell:cone-of-cold")!), id: "cone", upcast: undefined };
    if (cone.action) delete (cone.action as { upcast?: unknown }).upcast;
    giveFighter([homebrewBlight(), cone], { "slot-4": 3, "slot-5": 2 });
    render(<LiveTab />);
    expect(screen.getByText(/2 spells could get stronger with a higher slot/)).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Review" }));
    const list = screen.getByRole("list", { name: "SRD upcasting offered" });
    expect(within(list).getByText(/The SRD's Blight adds 1d8 damage/)).toBeTruthy();
    await userEvent.click(within(list).getByRole("button", { name: "Use the SRD's upcasting for Blight" }));
    expect(fighter().spells![0]!.upcast).toEqual({ perSlotAboveBase: { damageDice: "1d8" } });
    expect(screen.getByText(/1 spell could get stronger with a higher slot/)).toBeTruthy();
    store().undo();
    expect(fighter().spells![0]!.upcast).toBeUndefined();
  });
});
