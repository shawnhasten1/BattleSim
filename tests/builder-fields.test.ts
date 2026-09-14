import { describe, expect, it } from "vitest";
import { FIELD_COPY } from "@/components/sheet/builders/field-copy";
import { visibleSpecs, type BuilderDraft } from "@/components/sheet/builders/field-spec";
import {
  actionFieldSchema,
  actionFromEffectDraft,
  deathEffectDraftFromDefinition,
  deathEffectFieldSchema,
  deathEffectFromDraft,
  effectDraftFromAction,
  featureDraftFromDefinition,
  featureFieldSchema,
  featureFromDraft,
  spellDraftFromDefinition,
  spellFieldSchema,
  spellFromDraft,
  weaponDraftFromDefinition,
  weaponFieldSchema,
  weaponFromDraft
} from "@/components/sheet/builders/schemas";
import { findSrdFeature, findSrdSpell, findSrdWeapon } from "@/data/srd";
import type { WeaponDefinition } from "@/engine";

function visibleKeys(specs: ReturnType<typeof weaponFieldSchema>, draft: BuilderDraft, mode: "simple" | "advanced" = "simple") {
  return visibleSpecs(specs, draft, mode).map((s) => s.key);
}

const MELEE: WeaponDefinition = {
  id: "w", name: "Longsword", attackType: "melee", ability: "str", range: 5, reach: 5,
  damage: [{ dice: "1d8", damageType: "slashing", abilityModifier: "str" }]
};

describe("weapon builder — progressive disclosure", () => {
  it("Simple mode shows the essentials and hides untouched advanced fields", () => {
    const draft = weaponDraftFromDefinition(MELEE);
    const keys = visibleKeys(weaponFieldSchema(draft), draft, "simple");
    expect(keys).toEqual(expect.arrayContaining(["name", "weaponKind", "ability", "dmg", "magicBonus", "magical", "onHit", "chargesEnabled"]));
    expect(keys).not.toContain("toHitBonus");
    expect(keys).not.toContain("properties");
    // never any spell/area fields on a weapon
    expect(keys).not.toContain("saveAbility");
    expect(keys).not.toContain("areaType");
  });

  it("Advanced mode reveals the rest, gated by melee / ranged", () => {
    const melee = weaponDraftFromDefinition(MELEE);
    const meleeKeys = visibleKeys(weaponFieldSchema(melee), melee, "advanced");
    expect(meleeKeys).toContain("reach");
    expect(meleeKeys).not.toContain("range");
    expect(meleeKeys).not.toContain("longRange");

    const ranged = { ...melee, weaponKind: "ranged" };
    const rangedKeys = visibleKeys(weaponFieldSchema(ranged), ranged, "advanced");
    expect(rangedKeys).toContain("range");
    expect(rangedKeys).toContain("longRange");
    expect(rangedKeys).not.toContain("reach");
  });

  it("charge fields appear only once limited-uses is on", () => {
    const off = weaponDraftFromDefinition(MELEE);
    expect(visibleKeys(weaponFieldSchema(off), off)).not.toContain("chargesMax");
    const on = { ...off, chargesEnabled: true };
    expect(visibleKeys(weaponFieldSchema(on), on)).toEqual(expect.arrayContaining(["chargesMax", "chargesRecharge"]));
  });

  it("an advanced field with a value set still shows in Simple mode, marked", () => {
    const draft = { ...weaponDraftFromDefinition(MELEE), toHitBonus: 2 };
    const spec = visibleSpecs(weaponFieldSchema(draft), draft, "simple").find((s) => s.key === "toHitBonus");
    expect(spec).toBeDefined();
    expect(spec?.markedAdvanced).toBe(true);
  });
});

describe("spell builder — shape-first disclosure", () => {
  const base: BuilderDraft = { ...effectDraftFromAction({ kind: "attack", id: "", name: "x", actionType: "action", attackType: "spell", ability: "int", range: 60, damage: [{ dice: "1d10", damageType: "fire" }], automationSupport: "full" }), level: 1, timing: "action", range: "60" };

  it("Attack shape shows to-hit, not save / area", () => {
    const draft = { ...base, shape: "attack" };
    const keys = visibleKeys(spellFieldSchema(draft), draft, "advanced");
    expect(keys).toContain("attackAbility");
    expect(keys).not.toContain("saveAbility");
    expect(keys).not.toContain("areaType");
  });

  it("Save shape shows the save fields, not the attack or area fields", () => {
    const draft = { ...base, shape: "save" };
    const keys = visibleKeys(spellFieldSchema(draft), draft, "advanced");
    expect(keys).toEqual(expect.arrayContaining(["saveAbility", "onSuccess"]));
    expect(keys).not.toContain("attackAbility");
    expect(keys).not.toContain("areaType");
  });

  it("Area shape reveals width only for line / rectangle and aim only for directional shapes", () => {
    const circle = { ...base, shape: "area", areaType: "circle" };
    const circleKeys = visibleKeys(spellFieldSchema(circle), circle, "advanced");
    expect(circleKeys).toContain("areaSize");
    expect(circleKeys).not.toContain("areaWidth");
    expect(circleKeys).not.toContain("areaAimed");

    const line = { ...base, shape: "area", areaType: "line" };
    const lineKeys = visibleKeys(spellFieldSchema(line), line, "advanced");
    expect(lineKeys).toContain("areaWidth");
    expect(lineKeys).toContain("areaAimed");

    const cone = { ...base, shape: "area", areaType: "cone" };
    expect(visibleKeys(spellFieldSchema(cone), cone, "advanced")).toContain("areaAimed");
    expect(visibleKeys(spellFieldSchema(cone), cone, "advanced")).not.toContain("areaWidth");
  });

  it("Healing shape swaps the damage block for a heal block", () => {
    const draft = { ...base, shape: "healing" };
    const keys = visibleKeys(spellFieldSchema(draft), draft, "advanced");
    expect(keys).toEqual(expect.arrayContaining(["healDice", "healTarget"]));
    expect(keys).not.toContain("saveAbility");
    expect(keys).not.toContain("dmg");
  });
});

describe("weapon builder — reaction / grip / power-attack fields", () => {
  it("round-trips usableAs, grip, powerAttack and a reaction trigger", () => {
    const source: WeaponDefinition = {
      ...MELEE, id: "spear", name: "Reach Spear",
      usableAs: ["action", "bonus"], grip: "versatile", powerAttack: true
    };
    const back = weaponFromDraft(weaponDraftFromDefinition(source));
    expect(back.usableAs).toEqual(["action", "bonus"]);
    expect(back.grip).toBe("versatile");
    expect(back.powerAttack).toBe(true);
  });

  it("a plain melee weapon emits no explicit usableAs (default action + reaction)", () => {
    expect(weaponFromDraft(weaponDraftFromDefinition(MELEE)).usableAs).toBeUndefined();
  });

  it("turning the reaction toggle off on a melee weapon opts out of opportunity attacks", () => {
    const draft = { ...weaponDraftFromDefinition(MELEE), usableAsReaction: false };
    expect(weaponFromDraft(draft).usableAs).toEqual(["action"]);
  });

  it("the 'bonus action only' toggle makes an off-hand / flurry weapon (no action slot), and round-trips", () => {
    const draft = { ...weaponDraftFromDefinition(MELEE), bonusOnly: true };
    expect(weaponFromDraft(draft).usableAs).toEqual(["bonus"]);
    const back = weaponDraftFromDefinition({ ...MELEE, usableAs: ["bonus"] });
    expect(back.bonusOnly).toBe(true);
    expect(back.usableAsBonus).toBe(false);
    expect(weaponFromDraft(back).usableAs).toEqual(["bonus"]);
  });

  it("the 'also as a bonus action' toggle keeps the action slot", () => {
    const draft = { ...weaponDraftFromDefinition(MELEE), usableAsBonus: true };
    expect(weaponFromDraft(draft).usableAs).toEqual(["action", "bonus", "reaction"]);
  });

  it("the reaction-trigger control shows only for a reaction-capable melee weapon", () => {
    const draft = { ...weaponDraftFromDefinition(MELEE), usableAsReaction: true };
    expect(visibleKeys(weaponFieldSchema(draft), draft, "advanced")).toContain("reactionTrigger");
    const off = { ...draft, usableAsReaction: false };
    expect(visibleKeys(weaponFieldSchema(off), off, "advanced")).not.toContain("reactionTrigger");
  });
});

describe("spell builder — reaction block", () => {
  const base: BuilderDraft = { shape: "attack", level: 1, range: "60" };
  it("reveals the reaction trigger only when the casting time is a reaction", () => {
    const action = { ...base, timing: "action" };
    expect(visibleKeys(spellFieldSchema(action), action, "advanced")).not.toContain("reactionTrigger");
    const reaction = { ...base, timing: "reaction" };
    expect(visibleKeys(spellFieldSchema(reaction), reaction, "advanced")).toEqual(expect.arrayContaining(["reactionTrigger", "reactionTarget", "reactionPriority"]));
  });

  it("stamps a reaction meta onto the compiled action", () => {
    const draft: BuilderDraft = {
      ...base, name: "Rebuke", timing: "reaction", shape: "save", saveAbility: "dex", dealsDamage: true,
      dmg: { count: 2, die: 10, mod: 0, type: "fire" }, onSuccess: "half",
      reactionTrigger: { kind: "hit-by-attack" }, reactionTarget: "trigger-source", reactionPriority: "worthwhile"
    };
    const spell = spellFromDraft(draft);
    expect(spell.castingTime).toBe("reaction");
    if (spell.action?.kind !== "save") throw new Error("expected save");
    // "trigger-source" is the default, so it is stored as `undefined`
    expect(spell.action.reaction).toEqual({ trigger: { kind: "hit-by-attack" }, target: undefined, priority: "worthwhile" });
  });
});

describe("feature builder — shape-first disclosure & round-trips", () => {
  it("Passive shape shows the effects editor, not the activate / grant fields", () => {
    const draft = { name: "x", category: "feature", featureShape: "passive", effects: [] };
    const keys = visibleSpecs(featureFieldSchema(draft), draft, "advanced").map((s) => s.key);
    expect(keys).toContain("effects");
    expect(keys).not.toContain("activateAs");
    expect(keys).not.toContain("grantsDash");
  });

  it("Activated shape shows activate-as + resource + effects + (for reaction) the trigger", () => {
    const draft = { name: "x", category: "feature", featureShape: "activated", activateAs: "reaction", effects: [] };
    const keys = visibleSpecs(featureFieldSchema(draft), draft, "advanced").map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(["activateAs", "resourceId", "reactionTrigger", "effects"]));
  });

  it("Grants-bonus shape shows the Dash / Disengage / Hide toggles, not the effects editor", () => {
    const draft = { name: "x", category: "feature", featureShape: "grants-bonus" };
    const keys = visibleSpecs(featureFieldSchema(draft), draft, "advanced").map((s) => s.key);
    expect(keys).toEqual(expect.arrayContaining(["grantsDash", "grantsDisengage", "grantsHide"]));
    expect(keys).not.toContain("effects");
  });

  it("a multi-effect Rage (bonus + 3 resistances + save advantage) round-trips through the builder", () => {
    const rage = featureFromDraft({
      name: "Rage", category: "feature", featureShape: "activated", activateAs: "bonus", resourceId: "rage", durationRounds: 10,
      effects: [
        { kind: "damage-bonus", condition: "always", attackTypes: ["melee"], damage: [{ dice: "3", damageType: "same-as-attack" }] },
        { kind: "damage-adjustment", condition: "always", adjustment: { type: "resistance", damageType: "bludgeoning" } },
        { kind: "damage-adjustment", condition: "always", adjustment: { type: "resistance", damageType: "piercing" } },
        { kind: "damage-adjustment", condition: "always", adjustment: { type: "resistance", damageType: "slashing" } },
        { kind: "save-advantage", ability: "str" }
      ]
    });
    const activate = rage.grantedActions?.[0];
    if (activate?.kind !== "activate-feature") throw new Error("expected activate-feature");
    expect(activate.actionType).toBe("bonus");
    expect(activate.resourceCost).toEqual({ resourceId: "rage", amount: 1 });
    expect(activate.condition?.durationRounds).toBe(10);
    expect(activate.condition?.effects).toHaveLength(5);
    const kinds = activate.condition?.effects?.map((e) => e.kind);
    expect(kinds).toEqual(["damage-bonus", "damage-adjustment", "damage-adjustment", "damage-adjustment", "save-advantage"]);
    const dmg = activate.condition?.effects?.[0];
    expect(dmg?.kind === "damage-bonus" && dmg.damage[0]?.dice).toBe("3");

    // round-trip: draft gathers feature.effects + condition.effects; rebuild is stable
    const rebuilt = featureFromDraft(featureDraftFromDefinition(rage));
    expect((rebuilt.grantedActions?.[0] as { condition?: { effects?: unknown[] } }).condition?.effects).toHaveLength(5);
  });

  it("instant effects (extra-action) go on the feature; lingering ones go in the condition", () => {
    const surge = featureFromDraft({
      name: "Action Surge", category: "feature", featureShape: "activated", activateAs: "free", resourceId: "action-surge",
      effects: [
        { kind: "extra-action", condition: "always", slot: "action" },
        { kind: "resource-regain", timing: "on-activate", resourceId: "ki", amount: { base: 2 } }
      ]
    });
    expect(surge.effects?.map((e) => e.kind)).toEqual(["extra-action", "resource-regain"]);
    expect((surge.grantedActions?.[0] as { condition?: unknown }).condition).toBeUndefined();
  });

  it("a damage-adjustment multi-type card collapses on load and expands on save", () => {
    // three consecutive resistance adjustments should read back as one card, then re-emit three
    const passive = featureFromDraft({
      name: "Bear Totem", category: "feature", featureShape: "passive",
      effects: (["acid", "cold", "fire"] as const).map((damageType) => ({ kind: "damage-adjustment" as const, condition: "always" as const, adjustment: { type: "resistance" as const, damageType } }))
    });
    const back = featureFromDraft(featureDraftFromDefinition(passive));
    expect(back.effects?.filter((e) => e.kind === "damage-adjustment")).toHaveLength(3);
  });

  it("Cunning Action compiles to three granted bonus utilities", () => {
    const cunning = featureFromDraft({ name: "Cunning Action", category: "feature", featureShape: "grants-bonus", grantsDash: true, grantsDisengage: true, grantsHide: true });
    expect(cunning.grantedActions?.map((a) => (a.kind === "utility" ? a.mode : "")).sort()).toEqual(["dash", "disengage", "hide"]);
    expect(cunning.grantedActions?.every((a) => a.actionType === "bonus")).toBe(true);
  });

  it("an SRD feature edits without losing its shape", () => {
    const packTactics = findSrdFeature("srd:feature:pack-tactics")!;
    const back = featureFromDraft(featureDraftFromDefinition(packTactics));
    expect(back.effects?.[0]?.kind).toBe("attack-advantage");
  });
});

describe("every rendered field resolves a label", () => {
  const drafts: BuilderDraft[] = [
    weaponDraftFromDefinition(MELEE),
    { ...weaponDraftFromDefinition(MELEE), weaponKind: "ranged", chargesEnabled: true, usableAsBonus: true },
    { shape: "attack", attackDelivery: "beams", timing: "reaction" },
    { shape: "save", timing: "reaction" },
    { shape: "area", areaType: "rectangle" },
    { shape: "healing" }
  ];
  const featureDrafts: BuilderDraft[] = [
    { name: "x", category: "feature", featureShape: "passive" },
    { name: "x", category: "feature", featureShape: "activated", activateAs: "reaction" },
    { name: "x", category: "feature", featureShape: "grants-bonus" }
  ];

  it("no FieldSpec.copy key is missing from FIELD_COPY", () => {
    for (const draft of drafts) {
      for (const schema of [weaponFieldSchema, spellFieldSchema, actionFieldSchema]) {
        for (const spec of schema(draft)) {
          const copy = FIELD_COPY[spec.copy];
          expect(copy, `missing FIELD_COPY["${spec.copy}"]`).toBeDefined();
          expect(copy.label.length).toBeGreaterThan(0);
        }
      }
    }
    for (const draft of featureDrafts) {
      for (const spec of featureFieldSchema(draft)) {
        expect(FIELD_COPY[spec.copy], `missing FIELD_COPY["${spec.copy}"]`).toBeDefined();
      }
    }
    for (const spec of deathEffectFieldSchema({ name: "x", areaType: "circle", dealsDamage: true })) {
      expect(FIELD_COPY[spec.copy], `missing FIELD_COPY["${spec.copy}"]`).toBeDefined();
    }
  });
});

describe("death effect builder", () => {
  it("only offers origin-symmetric area shapes (no directional aim exists for an automatic trigger)", () => {
    const draft = { name: "x", areaType: "circle" };
    const options = deathEffectFieldSchema(draft).find((spec) => spec.key === "areaType")?.options ?? [];
    expect(options.map((option) => option.value)).toEqual(["circle", "square"]);
  });

  it("never shows a shape picker, timing, or aim fields — the trigger is always an automatic self-origin area save", () => {
    const draft = { name: "x", areaType: "circle" };
    const keys = deathEffectFieldSchema(draft).map((spec) => spec.key);
    expect(keys).not.toContain("shape");
    expect(keys).not.toContain("timing");
    expect(keys).not.toContain("areaAimed");
    expect(keys).not.toContain("areaOrigin");
    expect(keys).toContain("areaType");
    expect(keys).toContain("saveAbility");
    expect(keys).toContain("riders");
  });

  it("a gas-spore-style death effect (damage + condition) round-trips", () => {
    const source = {
      id: "d", name: "Death Burst", description: "It pops.",
      action: {
        kind: "area-save" as const, id: "a", name: "Death Burst", actionType: "action" as const,
        saveAbility: "con" as const, dc: 8, range: 0,
        area: { type: "circle" as const, size: 10 },
        targeting: { origin: "self" as const, range: 0 },
        damage: [{ dice: "3d6", damageType: "poison" as const }],
        halfDamageOnSuccess: false, onSuccess: "negates" as const, affects: "all" as const,
        riders: [{ kind: "condition" as const, when: "on-save-fail" as const, condition: "poisoned" as const, duration: { kind: "rounds" as const, rounds: 10 } }],
        automationSupport: "full" as const
      },
      automationSupport: "full" as const
    };
    const back = deathEffectFromDraft(deathEffectDraftFromDefinition(source));
    expect(back.name).toBe("Death Burst");
    expect(back.description).toBe("It pops.");
    if (back.action.kind !== "area-save") throw new Error("expected area-save");
    expect(back.action.area).toEqual({ type: "circle", size: 10 });
    expect(back.action.saveAbility).toBe("con");
    expect(back.action.affects).toBe("all");
    expect(back.action.damage[0]?.dice).toBe("3d6");
    expect(back.action.riders?.[0]?.kind).toBe("condition");
  });

  it("compiles with no range (there is no one to aim it) and a self origin", () => {
    const deathEffect = deathEffectFromDraft({ name: "Burst", areaType: "circle", areaSize: 15, saveAbility: "con", dealsDamage: true, dmg: { count: 2, die: 6, mod: 0, type: "poison" } });
    if (deathEffect.action.kind !== "area-save") throw new Error("expected area-save");
    expect(deathEffect.action.range).toBe(0);
    expect(deathEffect.action.targeting?.origin).toBe("self");
  });
});

describe("draft <-> definition round-trips", () => {
  it("weapon: The Fear Sword survives an edit round-trip", () => {
    const fearSword = findSrdWeapon("srd:weapon:fear-sword")!;
    const back = weaponFromDraft(weaponDraftFromDefinition(fearSword));
    expect(back.name).toBe("The Fear Sword");
    expect(back.attackType).toBe("melee");
    expect(back.magical).toBe(true);
    expect(back.magicBonus).toBe(1);
    expect(back.charges?.max).toBe(1);
    expect(back.onHit?.[0]?.kind).toBe("condition");
    const rider = back.onHit?.[0];
    if (rider?.kind !== "condition") throw new Error("expected condition rider");
    expect(rider.condition).toBe("frightened");
    expect(rider.save?.ability).toBe("wis");
  });

  it("spell: Fireball round-trips shape / area / half-on-save", () => {
    const fireball = findSrdSpell("srd:spell:fireball")!;
    const back = spellFromDraft(spellDraftFromDefinition(fireball));
    expect(back.level).toBe(3);
    const action = back.action;
    if (action?.kind !== "area-save") throw new Error("expected area-save");
    expect(action.area.type).toBe("circle");
    expect(action.area.size).toBe(20);
    expect(action.onSuccess).toBe("half");
    expect(action.damage[0]?.damageType).toBe("fire");
  });

  it("spell: Hold Person round-trips the save-ends condition rider", () => {
    const hold = findSrdSpell("srd:spell:hold-person")!;
    const back = spellFromDraft(spellDraftFromDefinition(hold));
    expect(back.concentration).toBe(true);
    const action = back.action;
    if (action?.kind !== "save") throw new Error("expected save");
    expect(action.onSuccess).toBe("negates");
    const rider = action.riders?.[0];
    if (rider?.kind !== "condition") throw new Error("expected condition rider");
    expect(rider.condition).toBe("paralyzed");
    expect(rider.duration.kind).toBe("save-ends");
  });

  it("innate action: an area-save with a rider round-trips", () => {
    const source = {
      kind: "area-save" as const, id: "a", name: "Frost Nova", actionType: "action" as const,
      saveAbility: "con" as const, dc: 14, range: 30,
      area: { type: "cone" as const, size: 30 },
      targeting: { origin: "self" as const, aimedFromSelf: true, range: 30 },
      damage: [{ dice: "4d6", damageType: "cold" as const }],
      halfDamageOnSuccess: true, onSuccess: "half" as const, affects: "hostile" as const,
      riders: [{ kind: "condition" as const, when: "on-save-fail" as const, condition: "restrained" as const, duration: { kind: "rounds" as const, rounds: 2 } }],
      automationSupport: "full" as const
    };
    const back = actionFromEffectDraft(effectDraftFromAction(source));
    if (back.kind !== "area-save") throw new Error("expected area-save");
    expect(back.area.type).toBe("cone");
    expect(back.targeting?.origin).toBe("self");
    expect(back.targeting?.aimedFromSelf).toBe(true);
    expect(back.riders?.[0]?.kind).toBe("condition");
  });
});

describe("spell casting ability drives the save DC, not the target's saving throw ability", () => {
  it("Cloudkill (CON save, INT-based DC) keeps INT as the DC ability through the builder round-trip", () => {
    const cloudkill = findSrdSpell("srd:spell:cloudkill")!;
    const draft = spellDraftFromDefinition(cloudkill);
    expect(draft.saveAbility).toBe("con");
    expect(draft.castingAbility).toBe("int");

    const back = spellFromDraft(draft);
    const action = back.action;
    if (action?.kind !== "area-save") throw new Error("expected area-save");
    expect(action.saveAbility).toBe("con");
    expect(action.dcFormula?.ability).toBe("int");
  });

  it("a brand-new save-shaped spell defaults its DC ability to the caster's stat, independent of the save ability chosen", () => {
    const draft: BuilderDraft = {
      name: "Test Spell", shape: "save", saveAbility: "con", castingAbility: "int", dealsDamage: true,
      dmg: { count: 2, die: 6, mod: 0, type: "poison" }, range: "60"
    };
    const action = actionFromEffectDraft(draft, { spell: true });
    if (action.kind !== "save") throw new Error("expected save");
    expect(action.saveAbility).toBe("con");
    expect(action.dcFormula?.ability).toBe("int");
  });
});

describe("zone trigger toggles", () => {
  it("Cloudkill round-trips its on-enter + start-of-turn triggers, with end-of-turn off", () => {
    const cloudkill = findSrdSpell("srd:spell:cloudkill")!;
    const draft = spellDraftFromDefinition(cloudkill);
    expect(draft.zoneTriggerEnter).toBe(true);
    expect(draft.zoneTriggerStart).toBe(true);
    expect(draft.zoneTriggerEnd).toBe(false);

    const back = spellFromDraft(draft);
    const action = back.action;
    if (action?.kind !== "area-save") throw new Error("expected area-save");
    expect(action.zone?.trigger).toEqual(expect.arrayContaining(["on-enter", "start-of-turn-in-zone"]));
    expect(action.zone?.trigger).not.toContain("end-of-turn-in-zone");
  });

  it("Spike Growth round-trips its empty trigger list (movement damage only, no save-gated trigger)", () => {
    const spikeGrowth = findSrdSpell("srd:spell:spike-growth")!;
    const draft = spellDraftFromDefinition(spikeGrowth);
    expect(draft.zoneTriggerEnter).toBe(false);
    expect(draft.zoneTriggerStart).toBe(false);
    expect(draft.zoneTriggerEnd).toBe(false);

    const back = spellFromDraft(draft);
    const action = back.action;
    if (action?.kind !== "area-save") throw new Error("expected area-save");
    expect(action.zone?.trigger).toEqual([]);
    expect(action.zone?.movementDamage).toBeDefined();
  });

  it("compiles only the toggled-on triggers, independently of one another", () => {
    const source = {
      kind: "area-save" as const, id: "a", name: "Test Zone", actionType: "action" as const,
      saveAbility: "con" as const, dc: 12, range: 30,
      area: { type: "circle" as const, size: 15 },
      targeting: { origin: "point" as const, range: 30 },
      damage: [{ dice: "1d6", damageType: "fire" as const }],
      halfDamageOnSuccess: true, onSuccess: "half" as const, affects: "hostile" as const,
      zone: { duration: { kind: "rounds" as const, rounds: 3 }, trigger: [], anchor: "fixed" as const },
      automationSupport: "full" as const
    };
    const draft = effectDraftFromAction(source);
    // Only enable "start of turn" — leave enter and end off.
    draft.zoneTriggerEnter = false;
    draft.zoneTriggerStart = true;
    draft.zoneTriggerEnd = false;

    const back = actionFromEffectDraft(draft);
    if (back.kind !== "area-save") throw new Error("expected area-save");
    expect(back.zone?.trigger).toEqual(["start-of-turn-in-zone"]);
  });

  it("defaults a brand-new zone (no existing action.zone) to on-enter + start-of-turn", () => {
    const source = {
      kind: "area-save" as const, id: "a", name: "New Zone Spell", actionType: "action" as const,
      saveAbility: "con" as const, dc: 12, range: 30,
      area: { type: "circle" as const, size: 15 },
      targeting: { origin: "point" as const, range: 30 },
      damage: [{ dice: "1d6", damageType: "fire" as const }],
      halfDamageOnSuccess: true, onSuccess: "half" as const, affects: "hostile" as const,
      automationSupport: "full" as const
      // no `zone` at all yet
    };
    const draft = effectDraftFromAction(source);
    expect(draft.zoneTriggerEnter).toBe(true);
    expect(draft.zoneTriggerStart).toBe(true);

    draft.zoneEnabled = true;
    const back = actionFromEffectDraft(draft);
    if (back.kind !== "area-save") throw new Error("expected area-save");
    expect(back.zone?.trigger).toEqual(expect.arrayContaining(["on-enter", "start-of-turn-in-zone"]));
  });
});
