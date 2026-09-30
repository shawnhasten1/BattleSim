import { describe, expect, it } from "vitest";
import { FIELD_COPY } from "@/components/sheet/builders/field-copy";
import { visibleSpecs, type BuilderDraft } from "@/components/sheet/builders/field-spec";
import {
  actionFieldSchema,
  actionFromEffectDraft,
  applyDraftChange,
  deathEffectDraftFromDefinition,
  deathEffectFieldSchema,
  deathEffectFromDraft,
  diceValueToString,
  effectDraftFromAction,
  featureDraftFromDefinition,
  featureFieldSchema,
  featureFromDraft,
  parseDiceValue,
  PRESETS,
  spellDraftFromDefinition,
  spellFieldSchema,
  spellFromDraft,
  weaponDraftFromDefinition,
  weaponFieldSchema,
  weaponFromDraft,
  type DiceValue
} from "@/components/sheet/builders/schemas";
import { mergeDraftEdit } from "@/components/sheet/builders/save-delta";
import { findSrdFeature, findSrdSpell, findSrdWeapon } from "@/data/srd";
import type { ActionDefinition, WeaponDefinition } from "@/engine";

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

describe("aura builder support", () => {
  it("Spirit Guardians round-trips its self-anchored zone", () => {
    const spiritGuardians = findSrdSpell("srd:spell:spirit-guardians")!;
    const draft = spellDraftFromDefinition(spiritGuardians);
    expect(draft.zoneAnchor).toBe("self");

    const back = spellFromDraft(draft);
    const action = back.action;
    if (action?.kind !== "area-save") throw new Error("expected area-save");
    expect(action.zone?.anchor).toBe("self");
    expect(action.targeting?.origin).toBe("self");
  });

  it("forces self-origin targeting when a fresh zone is set to follow the caster", () => {
    const source = {
      kind: "area-save" as const, id: "a", name: "Test Aura", actionType: "action" as const,
      saveAbility: "con" as const, dc: 12, range: 30,
      area: { type: "circle" as const, size: 15 },
      targeting: { origin: "point" as const, range: 30 },
      damage: [{ dice: "1d6", damageType: "fire" as const }],
      halfDamageOnSuccess: true, onSuccess: "half" as const, affects: "hostile" as const,
      automationSupport: "full" as const
      // no `zone` yet — authoring a brand-new one, still origin: "point"
    };
    const draft = effectDraftFromAction(source);
    expect(draft.areaOrigin).toBe("point");
    draft.zoneEnabled = true;
    draft.zoneAnchor = "self";

    const back = actionFromEffectDraft(draft);
    if (back.kind !== "area-save") throw new Error("expected area-save");
    expect(back.targeting?.origin).toBe("self");
    expect(back.zone?.anchor).toBe("self");
  });

  it("Aura of Protection round-trips its aura range/affects", () => {
    const auraOfProtection = findSrdFeature("srd:feature:aura-of-protection")!;
    const draft = featureDraftFromDefinition(auraOfProtection);
    expect(draft.auraEnabled).toBe(true);
    expect(draft.auraRange).toBe(10);
    expect(draft.auraAffects).toBe("allies");
    expect(draft.auraRequiresConscious).toBe(true);

    const back = featureFromDraft(draft);
    expect(back.aura).toEqual({ range: 10, affects: "allies", requiresConscious: undefined });
  });

  it("compiles a fresh passive feature into a hostile-affecting aura with no minimum-conscious gate", () => {
    const draft: BuilderDraft = {
      name: "Fear Aura", category: "trait", featureShape: "passive",
      effects: [{ kind: "save-advantage" as const, ability: "wis" as const, condition: "always" as const }],
      auraEnabled: true, auraRange: 15, auraAffects: "hostile", auraRequiresConscious: false
    };
    const feature = featureFromDraft(draft);
    expect(feature.aura).toEqual({ range: 15, affects: "hostile", requiresConscious: false });
  });

  it("does not offer the aura toggle on activated or grants-bonus feature shapes", () => {
    const activated = visibleKeys(featureFieldSchema({ featureShape: "activated" }), { featureShape: "activated" }, "advanced");
    const grantsBonus = visibleKeys(featureFieldSchema({ featureShape: "grants-bonus" }), { featureShape: "grants-bonus" }, "advanced");
    expect(activated).not.toContain("auraEnabled");
    expect(grantsBonus).not.toContain("auraEnabled");
  });
});

describe("linked fields", () => {
  it("a spell's slot follows its level when it was that level's slot", () => {
    expect(applyDraftChange({ level: 2, resourceId: "slot-2" }, "level", 3).resourceId).toBe("slot-3");
    expect(applyDraftChange({ level: 1, resourceId: "slot-1" }, "level", 0).resourceId).toBe("");
    expect(applyDraftChange({ level: 0, resourceId: "" }, "level", 1).resourceId).toBe("slot-1");
  });

  it("a spell that spends something else (or nothing, like a 3/day innate spell) keeps it when the level changes", () => {
    expect(applyDraftChange({ level: 3, resourceId: "" }, "level", 4).resourceId).toBe("");
    expect(applyDraftChange({ level: 3, resourceId: "ki" }, "level", 4).resourceId).toBe("ki");
  });

  it("the damage modifier follows the attack's ability only when it was following it", () => {
    const claw: ActionDefinition = {
      kind: "attack", id: "claw", name: "Claw", actionType: "action", attackType: "melee", ability: "str", range: 5,
      damage: [{ dice: "2d6", damageType: "slashing", abilityModifier: "str" }], automationSupport: "full"
    };
    const switched = applyDraftChange(effectDraftFromAction(claw), "attackAbility", "dex");
    expect((switched.dmg as DiceValue).ability).toBe("dex");
    const built = actionFromEffectDraft(switched);
    if (built.kind !== "attack") throw new Error("not an attack");
    expect(built.damage[0]?.abilityModifier).toBe("dex");

    const odd = { ...claw, damage: [{ dice: "2d6", damageType: "slashing" as const, abilityModifier: "con" as const }] };
    expect((applyDraftChange(effectDraftFromAction(odd), "attackAbility", "dex").dmg as DiceValue).ability).toBe("con");
  });
});

describe("dice the count / die / bonus boxes can't hold", () => {
  it("keep their expression instead of becoming 1d6", () => {
    expect(parseDiceValue("1").raw).toBe("1");
    expect(parseDiceValue("2d6+1d4").raw).toBe("2d6+1d4");
    expect(parseDiceValue("2d6 + 3")).toMatchObject({ count: 2, die: 6, mod: 3 });
    expect(parseDiceValue("2d6 + 3").raw).toBeUndefined();
    expect(diceValueToString(parseDiceValue("2d6+1d4"))).toBe("2d6+1d4");
  });

  it("a flat-damage weapon keeps its damage through the builder", () => {
    const blowgun = findSrdWeapon("srd:weapon:blowgun")!;
    expect(weaponFromDraft(weaponDraftFromDefinition(blowgun)).damage[0]?.dice).toBe(blowgun.damage[0]!.dice);
  });
});

describe("a spell made from a preset or blank costs a slot of its level", () => {
  it.each(PRESETS.filter((preset) => preset.kind === "spell").map((preset) => [preset.label, preset] as const))("%s", (_label, preset) => {
    const spell = spellFromDraft({ ...preset.draft });
    expect(spell.resourceCost).toEqual(spell.level > 0 ? { resourceId: `slot-${spell.level}`, amount: 1 } : undefined);
  });
});

describe("records the builder has no shape for", () => {
  const slam: ActionDefinition = { kind: "unsupported", id: "slam", name: "Slam", actionType: "action", description: "Reference text", automationSupport: "unsupported" };

  it("open as reference only, offering that as the first shape", () => {
    const draft = effectDraftFromAction(slam);
    expect(draft.shape).toBe("keep");
    const shape = visibleSpecs(actionFieldSchema(draft), draft, "advanced").find((spec) => spec.key === "shape");
    expect(shape?.options?.[0]).toEqual({ value: "keep", label: "Reference only (not simulated)" });
    // Range and concentration would do nothing for an effect that isn't rebuilt.
    expect(visibleKeys(actionFieldSchema(draft), draft, "advanced")).not.toContain("range");
  });

  it("build only what the form shows, for the save to merge onto the stored record", () => {
    expect(actionFromEffectDraft(effectDraftFromAction(slam))).toEqual({ name: "Slam", actionType: "action", reaction: undefined });
  });

  it("an activated spell like Shield keeps its current effect", () => {
    const shield = findSrdSpell("srd:spell:shield")!;
    expect(shield.action?.kind).toBe("activate-feature");
    const draft = spellDraftFromDefinition(shield);
    expect(draft.shape).toBe("keep");
    expect(draft.keepLabel).toBe("Keep its current effect (not editable here)");
    expect(spellFromDraft(draft).automationSupport).toBe(shield.automationSupport);
  });

  it("a spell with no action opens as reference only", () => {
    const draft = spellDraftFromDefinition({ id: "s", name: "Counter", level: 3, castingTime: "reaction", range: 60, automationSupport: "manual-only" });
    expect(draft).toMatchObject({ shape: "keep", keepLabel: "Reference only (not simulated)" });
    expect(spellFromDraft(draft)).toMatchObject({ action: undefined, automationSupport: "manual-only" });
  });
});

describe("an attack that deals no damage", () => {
  const tendril: ActionDefinition = {
    kind: "attack", id: "tendril", name: "Tendril", actionType: "action", attackType: "melee", ability: "str", range: 50, reach: 50,
    damage: [], riders: [{ kind: "hold", when: "on-hit", escapeDc: 15, restrained: true }], automationSupport: "full"
  };

  it("shows its Deals damage toggle off and no dice, and builds no damage", () => {
    const draft = effectDraftFromAction(tendril);
    expect(draft.dealsDamage).toBe(false);
    const keys = visibleKeys(actionFieldSchema(draft), draft, "advanced");
    expect(keys).toContain("dealsDamage");
    expect(keys).not.toContain("dmg");
    expect(actionFromEffectDraft(draft)).toMatchObject({ kind: "attack", attackType: "melee", reach: 50, damage: [] });
  });
});

describe("an item's granted spells", () => {
  it("editing one keeps what its card doesn't show on the others", () => {
    const fireBolt = findSrdSpell("srd:spell:fire-bolt")!.action!;
    const fireball = findSrdSpell("srd:spell:fireball")!.action!;
    const staff: WeaponDefinition = {
      id: "staff", name: "Staff of Fire", attackType: "focus", ability: "int", range: 0, damage: [],
      charges: { id: "staff:charge", max: 10 },
      grantedActions: [
        { ...fireBolt, id: "bolt" },
        { ...fireball, id: "ball", resourceCost: { resourceId: "staff:charge", amount: 3 } } as ActionDefinition
      ]
    };
    const draft = weaponDraftFromDefinition(staff);
    const cards = draft.grantedActions as BuilderDraft[];
    const edited = { ...draft, grantedActions: [cards[0], applyDraftChange(cards[1]!, "saveDc", 17)] };
    const { record } = mergeDraftEdit(staff, draft, edited, weaponFromDraft);
    const [bolt, ball] = record.grantedActions!;
    expect(bolt).toEqual({ ...fireBolt, id: "bolt" });
    expect(ball).toMatchObject({ id: "ball", kind: "area-save", dc: 17, resourceCost: { resourceId: "staff:charge", amount: 3 } });
    if (ball?.kind !== "area-save" || fireball.kind !== "area-save") throw new Error("not an area save");
    expect(ball.damage).toEqual(fireball.damage);
    expect(ball.upcast).toEqual(fireball.upcast);
  });
});
