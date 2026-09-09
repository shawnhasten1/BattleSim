// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import {
  SRD_DRAG_MIME,
  SRD_LIBRARY_VERSION,
  SRD_SPELLS,
  SRD_WEAPONS,
  findSrdSpell,
  findSrdWeapon,
  parseSrdDragPayload,
  searchSrd,
  serializeSrdDragPayload
} from "@/data/srd";
import {
  actionRiderSchema,
  areaTargetingSchema,
  areaTemplateSchema,
  damageComponentSchema,
  getExecutableActions,
  weaponChargesSchema
} from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";

const DEF_ID = "def-fighter";
const COMBATANT_ID = "pc-fighter";

/** Spells whose declared automationSupport is intentionally not "full". */
const SPELL_SUPPORT_OVERRIDES: Record<string, string> = {
  "srd:spell:counterspell": "manual-only"
};

const pristine = useEncounterStore.getState();
beforeEach(() => useEncounterStore.setState(pristine, true));

function fighterDefinition() {
  return useEncounterStore.getState().encounter.definitions.find((definition) => definition.id === DEF_ID)!;
}

describe("SRD library — integrity", () => {
  it("exposes a version string", () => {
    expect(typeof SRD_LIBRARY_VERSION).toBe("string");
    expect(SRD_LIBRARY_VERSION.length).toBeGreaterThan(0);
  });

  it("gives every entry a unique, correctly-namespaced id", () => {
    const ids = new Set<string>();
    for (const weapon of SRD_WEAPONS) {
      expect(weapon.id.startsWith("srd:weapon:")).toBe(true);
      expect(ids.has(weapon.id)).toBe(false);
      ids.add(weapon.id);
    }
    for (const spell of SRD_SPELLS) {
      expect(spell.id.startsWith("srd:spell:")).toBe(true);
      expect(ids.has(spell.id)).toBe(false);
      ids.add(spell.id);
    }
    expect(ids.size).toBe(SRD_WEAPONS.length + SRD_SPELLS.length);
  });

  it("deep-freezes the library so entries cannot be mutated in place", () => {
    expect(Object.isFrozen(SRD_WEAPONS)).toBe(true);
    expect(Object.isFrozen(SRD_WEAPONS[0])).toBe(true);
    expect(() => {
      (SRD_WEAPONS[0] as { name: string }).name = "tampered";
    }).toThrow();
  });
});

describe("SRD library — schema validity", () => {
  it("validates every weapon's damage, riders and charge pool", () => {
    for (const weapon of SRD_WEAPONS) {
      for (const component of weapon.damage) {
        expect(damageComponentSchema.safeParse(component).success, `${weapon.id} damage`).toBe(true);
      }
      for (const component of weapon.versatileDamage ?? []) {
        expect(damageComponentSchema.safeParse(component).success, `${weapon.id} versatile`).toBe(true);
      }
      for (const rider of weapon.onHit ?? []) {
        expect(actionRiderSchema.safeParse(rider).success, `${weapon.id} onHit`).toBe(true);
      }
      if (weapon.charges) {
        expect(weaponChargesSchema.safeParse(weapon.charges).success, `${weapon.id} charges`).toBe(true);
      }
    }
  });

  it("validates every spell's action sub-structures", () => {
    for (const spell of SRD_SPELLS) {
      const action = spell.action;
      if (!action) continue;
      if ("damage" in action) {
        for (const component of action.damage) {
          expect(damageComponentSchema.safeParse(component).success, `${spell.id} damage`).toBe(true);
        }
      }
      if ("riders" in action) {
        for (const rider of action.riders ?? []) {
          expect(actionRiderSchema.safeParse(rider).success, `${spell.id} rider`).toBe(true);
        }
      }
      if (action.kind === "area-save") {
        expect(areaTemplateSchema.safeParse(action.area).success, `${spell.id} area`).toBe(true);
        if (action.targeting) {
          expect(areaTargetingSchema.safeParse(action.targeting).success, `${spell.id} targeting`).toBe(true);
        }
      }
    }
  });

  it("declares the expected automation support on every spell", () => {
    for (const spell of SRD_SPELLS) {
      expect(spell.automationSupport).toBe(SPELL_SUPPORT_OVERRIDES[spell.id] ?? "full");
    }
  });
});

describe("SRD library — lookup & search", () => {
  it("round-trips ids and returns undefined for unknowns", () => {
    expect(findSrdWeapon("srd:weapon:longsword")?.name).toBe("Longsword");
    expect(findSrdSpell("srd:spell:fireball")?.name).toBe("Fireball");
    expect(findSrdWeapon("srd:weapon:nope")).toBeUndefined();
    expect(findSrdSpell("srd:spell:nope")).toBeUndefined();
  });

  it("searches names case-insensitively with an optional kind filter", () => {
    const bolts = searchSrd("BOLT").map((result) => result.id);
    expect(bolts).toContain("srd:spell:fire-bolt");
    expect(bolts).toContain("srd:spell:lightning-bolt");

    const spellsOnly = searchSrd("dagger", "spell");
    expect(spellsOnly).toHaveLength(0);

    const weaponsOnly = searchSrd("dagger", "weapon").map((result) => result.id);
    expect(weaponsOnly).toContain("srd:weapon:dagger");
    expect(weaponsOnly).toContain("srd:weapon:dagger-of-venom");

    expect(searchSrd("").length).toBe(SRD_WEAPONS.length + SRD_SPELLS.length);
  });
});

describe("SRD library — drag payload", () => {
  it("round-trips and rejects malformed input", () => {
    const raw = serializeSrdDragPayload("spell", "srd:spell:fireball");
    expect(parseSrdDragPayload(raw)).toEqual({ kind: "spell", id: "srd:spell:fireball" });
    expect(parseSrdDragPayload("not json")).toBeNull();
    expect(parseSrdDragPayload(JSON.stringify({ kind: "monster", id: "x" }))).toBeNull();
    expect(parseSrdDragPayload(JSON.stringify({ kind: "weapon" }))).toBeNull();
    expect(SRD_DRAG_MIME).toBe("application/x-battle-sim-srd");
  });
});

describe("SRD library — every entry attaches & compiles", () => {
  it("attaches each weapon as an executable attack (melee also gets an opportunity-attack reaction copy)", () => {
    for (const weapon of SRD_WEAPONS) {
      useEncounterStore.setState(pristine, true);
      const before = getExecutableActions(fighterDefinition()).length;
      const newId = useEncounterStore.getState().attachSrdWeapon(DEF_ID, weapon.id);
      expect(newId, weapon.id).toBeTruthy();
      const actions = getExecutableActions(fighterDefinition());
      const attached = actions.find((action) => action.id === `weapon-action-${newId}`);
      expect(attached?.kind, weapon.id).toBe("attack");
      const isMelee = weapon.attackType === "melee";
      expect(actions.length - before, weapon.id).toBe(isMelee ? 2 : 1);
      const reactionCopy = actions.find((action) => action.id === `weapon-action-${newId}:reaction`);
      if (isMelee) {
        expect(reactionCopy?.actionType, weapon.id).toBe("reaction");
        expect(reactionCopy?.kind === "attack" && reactionCopy.reaction?.trigger.kind, weapon.id).toBe("enemy-leaves-reach");
      } else {
        expect(reactionCopy, weapon.id).toBeUndefined();
      }
    }
  });

  it("attaches each spell, adding one action unless it is reference-only", () => {
    for (const spell of SRD_SPELLS) {
      useEncounterStore.setState(pristine, true);
      const before = getExecutableActions(fighterDefinition()).length;
      const newId = useEncounterStore.getState().attachSrdSpell(DEF_ID, spell.id);
      expect(newId, spell.id).toBeTruthy();
      const after = getExecutableActions(fighterDefinition()).length;
      expect(after - before, spell.id).toBe(spell.action ? 1 : 0);
    }
  });
});

describe("attachSrdWeapon", () => {
  it("clones with fresh ids and leaves the library entry untouched", () => {
    const newId = useEncounterStore.getState().attachSrdWeapon(DEF_ID, "srd:weapon:longsword");
    const weapon = fighterDefinition().weapons?.find((candidate) => candidate.id === newId);
    expect(weapon).toBeDefined();
    expect(weapon!.id.startsWith("weapon-")).toBe(true);
    expect(weapon!.actionId).toBe(`weapon-action-${newId}`);
    expect(weapon!.source?.slug).toBe("srd:weapon:longsword");
    // library entry unchanged
    expect(findSrdWeapon("srd:weapon:longsword")!.id).toBe("srd:weapon:longsword");
  });

  it("is one undo step", () => {
    const store = useEncounterStore.getState();
    const before = fighterDefinition().weapons?.length ?? 0;
    store.attachSrdWeapon(DEF_ID, "srd:weapon:mace");
    expect(fighterDefinition().weapons?.length).toBe(before + 1);
    useEncounterStore.getState().undo();
    expect(fighterDefinition().weapons?.length ?? 0).toBe(before);
  });

  it("returns undefined for an unknown srd id or definition, with no change", () => {
    const store = useEncounterStore.getState();
    const before = fighterDefinition().weapons?.length ?? 0;
    expect(store.attachSrdWeapon(DEF_ID, "srd:weapon:missing")).toBeUndefined();
    expect(store.attachSrdWeapon("def-missing", "srd:weapon:longsword")).toBeUndefined();
    expect(fighterDefinition().weapons?.length ?? 0).toBe(before);
  });

  it("namespaces, rewrites and seeds the Fear Sword charge pool", () => {
    const newId = useEncounterStore.getState().attachSrdWeapon(DEF_ID, "srd:weapon:fear-sword")!;
    const chargeId = `${newId}:fear-strike`;
    const weapon = fighterDefinition().weapons?.find((candidate) => candidate.id === newId)!;

    expect(weapon.charges).toEqual({ id: chargeId, max: 1, recharge: "dawn" });
    const rider = weapon.onHit?.[0];
    if (rider?.kind !== "condition") throw new Error("expected condition rider");
    expect(rider.resourceCost).toEqual({ resourceId: chargeId, amount: 1 });
    expect(rider.id?.startsWith("rider-")).toBe(true);

    // seeded on the definition and topped up on the existing combatant
    expect(fighterDefinition().resources?.[chargeId]).toBe(1);
    const combatant = useEncounterStore.getState().encounter.combatants.find((c) => c.id === COMBATANT_ID)!;
    expect(combatant.resources?.[chargeId]).toBe(1);
  });

  it("re-mints rider ids for a chargeless on-hit weapon without seeding resources", () => {
    const newId = useEncounterStore.getState().attachSrdWeapon(DEF_ID, "srd:weapon:dagger-of-venom")!;
    const weapon = fighterDefinition().weapons?.find((candidate) => candidate.id === newId)!;
    const rider = weapon.onHit?.[0];
    if (rider?.kind !== "condition") throw new Error("expected condition rider");
    expect(rider.id?.startsWith("rider-")).toBe(true);
    expect(rider.condition).toBe("poisoned");
    expect(weapon.charges).toBeUndefined();
    expect(Object.keys(fighterDefinition().resources ?? {})).not.toContain("fear-strike");
  });
});

describe("attachSrdSpell", () => {
  it("clones with fresh ids in one undo step", () => {
    const store = useEncounterStore.getState();
    const before = fighterDefinition().spells?.length ?? 0;
    const newId = store.attachSrdSpell(DEF_ID, "srd:spell:fireball")!;
    const spell = fighterDefinition().spells?.find((candidate) => candidate.id === newId)!;
    expect(spell.id.startsWith("spell-")).toBe(true);
    expect(spell.action?.id).toBe(`spell-action-${newId}`);
    expect(spell.source?.slug).toBe("srd:spell:fireball");

    useEncounterStore.getState().undo();
    expect(fighterDefinition().spells?.length ?? 0).toBe(before);
  });

  it("re-mints rider ids and preserves the save-ends condition on Hold Person", () => {
    const newId = useEncounterStore.getState().attachSrdSpell(DEF_ID, "srd:spell:hold-person")!;
    const spell = fighterDefinition().spells?.find((candidate) => candidate.id === newId)!;
    expect(spell.concentration).toBe(true);
    const action = spell.action;
    if (action?.kind !== "save") throw new Error("expected save action");
    const rider = action.riders?.[0];
    if (rider?.kind !== "condition") throw new Error("expected condition rider");
    expect(rider.id?.startsWith("rider-")).toBe(true);
    expect(rider.condition).toBe("paralyzed");
    expect(rider.duration).toEqual({ kind: "save-ends", saveAt: "turn-end" });
  });

  it("returns undefined for an unknown srd id", () => {
    expect(useEncounterStore.getState().attachSrdSpell(DEF_ID, "srd:spell:missing")).toBeUndefined();
  });
});
