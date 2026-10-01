import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ActionDefinition, CombatantState, CreatureDefinition } from "@/engine";
import { SRD_MONSTER_INDEX, loadSrdMonster } from "@/data/srd/monsters";
import { fullOf, poolTitle, refilledResources, resourceRows, resourceSummary, withResourceSize } from "@/lib/actor-sheet/resources";
import { actionStatblock } from "@/lib/statblock";
import { useEncounterStore } from "@/store/encounter-store";

const pristine = useEncounterStore.getState();
beforeEach(() => useEncounterStore.setState(pristine, true));

const store = () => useEncounterStore.getState();
const definition = (id: string) => store().encounter.definitions.find((candidate) => candidate.id === id)!;
const token = (id: string) => store().encounter.combatants.find((combatant) => combatant.id === id)!;

/** Puts `patch` on a creature, outside the undo history. */
function patchDefinition(id: string, patch: Partial<CreatureDefinition>) {
  useEncounterStore.setState((state) => ({
    encounter: { ...state.encounter, definitions: state.encounter.definitions.map((candidate) => (candidate.id === id ? { ...candidate, ...patch } : candidate)) }
  }));
}
function patchToken(id: string, patch: Partial<CombatantState>) {
  useEncounterStore.setState((state) => ({
    encounter: { ...state.encounter, combatants: state.encounter.combatants.map((combatant) => (combatant.id === id ? { ...combatant, ...patch } : combatant)) }
  }));
}

/** A per-day ability on its own pool, as the editor saves one. */
const salve = (uses = 3): ActionDefinition => ({
  kind: "healing", id: "salve", name: "Salve", actionType: "action", range: 0, healing: [{ dice: "1d4" }], targeting: { target: "self" },
  usage: { kind: "uses", uses }, resourceCost: { resourceId: "usage:salve", amount: 1 }, automationSupport: "full"
});

const srd = new Map<string, CreatureDefinition>();
beforeAll(async () => {
  for (const entry of SRD_MONSTER_INDEX) srd.set(entry.id, (await loadSrdMonster(entry.id))!);
}, 60000);

describe("the rows", () => {
  it("list a caster's slots by level, and the levels its spells need that it hasn't", async () => {
    const mage = srd.get("srd:monster:mage")!;
    expect(resourceRows(mage).filter((row) => row.kind === "slot").map((row) => `${row.label} ${row.full}`)).toEqual([
      "1st-level spell slots 4", "2nd-level spell slots 3", "3rd-level spell slots 3", "4th-level spell slots 3", "5th-level spell slots 1"
    ]);
    store().attachSrdSpell("def-fighter", "srd:spell:fireball");
    const missing = resourceRows(definition("def-fighter"), token("pc-fighter")).find((row) => row.id === "slot-3")!;
    expect(missing).toMatchObject({ label: "3rd-level spell slots", full: 0, missing: true, note: "Fireball needs them" });
  });

  it("name a pool for what spends it, and say what nothing spends any more", () => {
    patchDefinition("def-fighter", { resources: { ...definition("def-fighter").resources, "usage:gone": 1, mystery: 2 } });
    const rows = resourceRows(definition("def-fighter"), token("pc-fighter"));
    expect(rows.filter((row) => !row.unused).map((row) => row.label)).toEqual(["Second Wind", "Action Surge"]);
    expect(rows.filter((row) => row.unused).map((row) => row.label).sort()).toEqual(["Gone", "Mystery"]);
  });

  it("call a pool by the name it was given, and say what spends it when that's something else", () => {
    expect(poolTitle("ki-points")).toBe("Ki points");
    expect(poolTitle("usage:fire-breath")).toBe("Fire breath");
    patchDefinition("def-fighter", { resources: { ...definition("def-fighter").resources, "ki-points": 5 } });
    expect(resourceRows(definition("def-fighter")).find((row) => row.id === "ki-points")).toMatchObject({ label: "Ki points", unused: true });
  });

  it("read what a token has left as the engine does: a count it lacks is none", () => {
    patchToken("pc-fighter", { resources: {} });
    expect(resourceRows(definition("def-fighter"), token("pc-fighter")).map((row) => row.left)).toEqual([0, 0]);
  });

  it("give a weapon's charges and how they come back", () => {
    store().attachSrdWeapon("def-fighter", "srd:weapon:fear-sword");
    const charges = resourceRows(definition("def-fighter")).find((row) => row.kind === "charges")!;
    expect(charges).toMatchObject({ label: "The Fear Sword charges", full: 1, note: "regains them at dawn" });
  });

  it("never show a resource id, on any SRD monster", () => {
    for (const monster of srd.values()) {
      const rows = resourceRows(monster);
      const text = [resourceSummary(rows), ...rows.flatMap((row) => [row.label, row.spentBy ?? "", row.note ?? ""])].join(" | ");
      expect(text, monster.name).not.toMatch(/slot-\d|usage:|legendary-points/);
    }
  });
});

describe("a full size", () => {
  it("of uses changes the ability's own count and its statblock line, so the editor agrees", () => {
    // The Unicorn's Healing Touch (3/Day).
    const unicorn = srd.get("srd:monster:unicorn")!;
    expect(fullOf(unicorn, "usage:healing-touch")).toBe(3);
    const sized = withResourceSize(unicorn, "usage:healing-touch", 2);
    expect(sized.resources!["usage:healing-touch"]).toBe(2);
    const touch = sized.actions.find((action) => action.name === "Healing Touch")!;
    expect("usage" in touch && touch.usage?.uses).toBe(2);
    expect(actionStatblock(touch, sized).title).toBe("Healing Touch (2/Day)");
  });

  it("of a weapon's charges changes the weapon's, and of legendary actions the creature's pool", () => {
    store().attachSrdWeapon("def-fighter", "srd:weapon:fear-sword");
    const id = resourceRows(definition("def-fighter")).find((row) => row.kind === "charges")!.id;
    expect(withResourceSize(definition("def-fighter"), id, 3).weapons!.find((weapon) => weapon.charges)!.charges!.max).toBe(3);
    const legendary = { ...definition("def-fighter"), legendary: { pool: 3, actions: [] } };
    expect(withResourceSize(legendary, "legendary-points", 2).legendary!.pool).toBe(2);
    expect(fullOf(legendary, "legendary-points")).toBe(3);
  });
});

describe("the store", () => {
  beforeEach(() => {
    // Two goblins with 3 uses each: Goblin 1 has used one.
    patchDefinition("def-goblin", { actions: [...definition("def-goblin").actions, salve(3)], resources: { "usage:salve": 3 } });
    patchToken("enemy-goblin-1", { resources: { "usage:salve": 2 } });
    patchToken("enemy-goblin-2", { resources: { "usage:salve": 3 } });
    useEncounterStore.setState({ undoStack: [] });
  });

  it("sizes a pool: tokens that were full follow, the others keep what they have, capped", () => {
    store().setResourceSize("def-goblin", "usage:salve", 5);
    expect([token("enemy-goblin-1").resources!["usage:salve"], token("enemy-goblin-2").resources!["usage:salve"]]).toEqual([2, 5]);
    store().setResourceSize("def-goblin", "usage:salve", 1);
    expect([token("enemy-goblin-1").resources!["usage:salve"], token("enemy-goblin-2").resources!["usage:salve"]]).toEqual([1, 1]);
  });

  it("typed a digit at a time, measures the tokens from before the edit, as one undo step", () => {
    store().mergeEdits("full", () => store().setResourceSize("def-goblin", "usage:salve", 1));
    store().mergeEdits("full", () => store().setResourceSize("def-goblin", "usage:salve", 12));
    expect([token("enemy-goblin-1").resources!["usage:salve"], token("enemy-goblin-2").resources!["usage:salve"]]).toEqual([2, 12]);
    expect(store().undoStack).toHaveLength(1);
  });

  it("adds a spell slot level full on every token, and takes one away", () => {
    store().setResourceSize("def-goblin", "slot-2", 2);
    expect(definition("def-goblin").resources!["slot-2"]).toBe(2);
    expect([token("enemy-goblin-1").resources!["slot-2"], token("enemy-goblin-2").resources!["slot-2"]]).toEqual([2, 2]);
    store().removeResource("def-goblin", "slot-2");
    expect(definition("def-goblin").resources!["slot-2"]).toBeUndefined();
    expect(token("enemy-goblin-1").resources!["slot-2"]).toBeUndefined();
  });

  it("refills a token in one undo step, and does nothing when it's full", () => {
    store().refillResources("enemy-goblin-1");
    expect(token("enemy-goblin-1").resources!["usage:salve"]).toBe(3);
    expect(store().undoStack).toHaveLength(1);
    store().refillResources("enemy-goblin-1");
    expect(store().undoStack).toHaveLength(1);
    expect(refilledResources(definition("def-goblin"), token("enemy-goblin-2"))).toEqual({ "usage:salve": 3 });
  });
});
