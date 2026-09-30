import { describe, expect, it } from "vitest";
import { featureDraftFromDefinition, featureFieldSchema, featureFromDraft, PRESETS } from "@/components/sheet/builders/schemas";
import type { ActionDefinition, FeatureDefinition } from "@/engine";

/** The feature builder's Phase 9 fields: auras, melee retaliation, evasion and follow-up attacks survive a round trip. */
const bite: Extract<ActionDefinition, { kind: "attack" }> = {
  kind: "attack", id: "bite", name: "Bite", actionType: "action", attackType: "melee", ability: "str", attackBonus: 5, range: 5, reach: 5,
  damage: [{ dice: "1d8", damageType: "piercing" }], automationSupport: "full"
};
const claw: Extract<ActionDefinition, { kind: "attack" }> = { ...bite, id: "claw", name: "Claw", damage: [{ dice: "1d6", damageType: "slashing" }] };
const context = { attacks: [bite, claw] };
const roundTrip = (feature: FeatureDefinition) => featureFromDraft(featureDraftFromDefinition(feature, context), context);

describe("feature builder: Phase 9 fields", () => {
  it("keeps a Stench aura through an edit", () => {
    const stench: FeatureDefinition = {
      id: "stench", name: "Stench", category: "trait", automationSupport: "full",
      emanation: { range: 10, timing: "target-turn-start", affects: "all", save: { ability: "con", dc: 14 }, condition: "poisoned", immuneOnSave: true }
    };
    expect(roundTrip(stench).emanation).toEqual(stench.emanation);
  });

  it("keeps Fire Aura's damage aura and its melee retaliation", () => {
    const fireAura: FeatureDefinition = {
      id: "fire", name: "Fire Aura", category: "trait", automationSupport: "full",
      emanation: { range: 5, timing: "bearer-turn-start", affects: "all", damage: [{ dice: "3d6", damageType: "fire" }] },
      effects: [{ kind: "melee-retaliation", damage: [{ dice: "3d6", damageType: "fire" }] }]
    };
    const saved = roundTrip(fireAura);
    expect(saved.emanation).toEqual(fireAura.emanation);
    expect(saved.effects).toEqual([{ kind: "melee-retaliation", damage: [{ dice: "3d6", damageType: "fire" }] }]);
    expect(saved.automationSupport).toBe("full");
  });

  it("keeps a Pounce follow-up bite, pointed at the same attack", () => {
    const pounce: FeatureDefinition = {
      id: "pounce", name: "Pounce", category: "trait", automationSupport: "full",
      effects: [{ kind: "apply-condition-on-hit", condition: "charged", actionIds: ["claw"], appliedCondition: { name: "prone" }, save: { ability: "str", dc: 13 } }],
      grantedActions: [{ ...bite, id: "bite-pounce", name: "Bite (Pounce)", actionType: "bonus", onlyAfter: "charge-hit", requiresTargetCondition: "prone" }]
    };
    const draft = featureDraftFromDefinition(pounce, context);
    expect(draft.followUpAttackId).toBe("bite");
    const saved = featureFromDraft(draft, context);
    expect(saved.grantedActions?.[0]).toMatchObject({ kind: "attack", actionType: "bonus", onlyAfter: "charge-hit", requiresTargetCondition: "prone", damage: bite.damage });
    expect(saved.effects).toEqual(pounce.effects);
  });

  it("keeps a follow-up whose attack it can't find, rather than dropping it", () => {
    const orphan: FeatureDefinition = {
      id: "rampage", name: "Rampage", category: "trait", automationSupport: "full",
      grantedActions: [{ ...bite, id: "gore-rampage", name: "Gore (Rampage)", actionType: "bonus", onlyAfter: "dropped-creature", grantsMovementFeet: 20 }]
    };
    expect(roundTrip(orphan).grantedActions?.[0]).toMatchObject({ name: "Gore (Rampage)", onlyAfter: "dropped-creature" });
  });

  it("switching an aura off removes it (a save replaces, it doesn't merge)", () => {
    const stench: FeatureDefinition = {
      id: "stench", name: "Stench", category: "trait", automationSupport: "full",
      emanation: { range: 10, timing: "target-turn-start", affects: "all", save: { ability: "con", dc: 14 }, condition: "poisoned" }
    };
    const draft = { ...featureDraftFromDefinition(stench, context), emanationEnabled: false };
    const saved = featureFromDraft(draft, context);
    expect("emanation" in saved).toBe(true);
    expect(saved.emanation).toBeUndefined();
    expect(saved.automationSupport).toBe("manual-only");
  });

  it("Evasion is a toggle", () => {
    const saved = featureFromDraft({ name: "Evasion", category: "feature", featureShape: "passive", evasion: true }, context);
    expect(saved.effects).toEqual([{ kind: "evasion" }]);
  });

  it("the aura fields only appear once the aura is switched on, and the follow-up picker lists the creature's attacks", () => {
    const off = featureFieldSchema({ featureShape: "passive" }, context).filter((spec) => spec.visibleWhen?.({ featureShape: "passive" }) !== false);
    expect(off.some((spec) => spec.key === "emanationEnabled")).toBe(true);
    expect(off.some((spec) => spec.key === "emanationRange")).toBe(false);
    const draft = { featureShape: "passive", emanationEnabled: true, emanationSave: "con", followUpAfter: "charge-hit" };
    const on = featureFieldSchema(draft, context).filter((spec) => spec.visibleWhen?.(draft) !== false);
    expect(on.some((spec) => spec.key === "emanationRange")).toBe(true);
    expect(on.some((spec) => spec.key === "emanationDc")).toBe(true);
    const picker = on.find((spec) => spec.key === "followUpAttackId")!;
    expect(picker.options?.map((option) => option.label)).toEqual(["(pick one of its attacks)", "Bite", "Claw"]);
  });

  it("every new preset builds an automated feature", () => {
    for (const label of ["Charge", "Pounce", "Rampage", "Blood Frenzy", "Stench (aura)", "Fear Aura", "Fire Aura", "Heated Body", "Evasion"]) {
      const preset = PRESETS.find((candidate) => candidate.label === label)!;
      expect(preset, label).toBeDefined();
      const built = featureFromDraft(preset.draft, context);
      expect(built.automationSupport, label).toBe("full");
    }
    // Pounce with no attack chosen defaults to the creature's first melee attack.
    const pounce = featureFromDraft(PRESETS.find((candidate) => candidate.label === "Pounce")!.draft, context);
    expect(pounce.grantedActions?.[0]).toMatchObject({ onlyAfter: "charge-hit", name: "Bite (Pounce)" });
  });
});
