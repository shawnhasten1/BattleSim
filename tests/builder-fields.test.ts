import { describe, expect, it } from "vitest";
import { FIELD_COPY } from "@/components/sheet/builders/field-copy";
import { visibleSpecs, type BuilderDraft } from "@/components/sheet/builders/field-spec";
import {
  actionFieldSchema,
  actionFromEffectDraft,
  effectDraftFromAction,
  spellDraftFromDefinition,
  spellFieldSchema,
  spellFromDraft,
  weaponDraftFromDefinition,
  weaponFieldSchema,
  weaponFromDraft
} from "@/components/sheet/builders/schemas";
import { findSrdSpell, findSrdWeapon } from "@/data/srd";
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

describe("every rendered field resolves a label", () => {
  const drafts: BuilderDraft[] = [
    weaponDraftFromDefinition(MELEE),
    { ...weaponDraftFromDefinition(MELEE), weaponKind: "ranged", chargesEnabled: true },
    { shape: "attack", attackDelivery: "beams" },
    { shape: "save" },
    { shape: "area", areaType: "rectangle" },
    { shape: "healing" }
  ];

  it("no FieldSpec.copy key is missing from FIELD_COPY", () => {
    const schemas = [weaponFieldSchema, spellFieldSchema, actionFieldSchema];
    for (const draft of drafts) {
      for (const schema of schemas) {
        for (const spec of schema(draft)) {
          const copy = FIELD_COPY[spec.copy];
          expect(copy, `missing FIELD_COPY["${spec.copy}"]`).toBeDefined();
          expect(copy.label.length).toBeGreaterThan(0);
        }
      }
    }
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
