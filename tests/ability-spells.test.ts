import { beforeAll, describe, expect, it } from "vitest";
import {
  normalizeActionDefinition,
  normalizeSpellDefinition,
  resolveSaveDc,
  type ActionDefinition,
  type CreatureDefinition,
  type SpellDefinition
} from "@/engine";
import { findSrdSpell } from "@/data/srd";
import { loadSrdMonster } from "@/data/srd/monsters";
import { actionTarget } from "@/lib/ability-editor/bindings";
import { areaShapeOf, areaStartOf, areaStarts, withAreaShape, withAreaSize, withAreaStart, type AreaTarget } from "@/lib/ability-editor/areas";
import { convertAction } from "@/lib/ability-editor/conversions";
import { sectionsFor, type SectionId } from "@/lib/ability-editor/sections";
import {
  concentrates,
  printedRange,
  spellIsReference,
  spellOpensInEditor,
  upcastOf,
  withCastingTime,
  withConcentration,
  withSpellAction,
  withSpellLevel,
  withSpellReference,
  withSpellZone,
  withUpcast,
  zoneOf
} from "@/lib/ability-editor/spells";
import { blankSpecialAction, blankSpell, SPELL_TEMPLATES } from "@/lib/ability-editor/templates";
import { abilityWarnings } from "@/lib/ability-editor/validate";

/** Phase 3's model: spells kept in step with the action they cast, areas, spell conversions, summaries and warnings. */

const spell = (id: string): SpellDefinition => structuredClone(findSrdSpell(`srd:spell:${id}`)!);

let dragon: CreatureDefinition;
beforeAll(async () => {
  dragon = (await loadSrdMonster("srd:monster:adult-red-dragon"))!;
});

const cleric: CreatureDefinition = {
  id: "cleric", name: "Cleric", size: "medium", armorClass: 16, maxHp: 38, speed: 30, proficiencyBonus: 3,
  abilities: { str: 12, dex: 10, con: 14, int: 10, wis: 16, cha: 12 }, actions: [], spellcasting: { ability: "wis" },
  resources: { "slot-1": 4, "slot-2": 3, "slot-3": 2 }
};

const summaries = (definition: CreatureDefinition, record: SpellDefinition) =>
  Object.fromEntries(sectionsFor({ ref: { list: "spells", id: record.id }, record, definition: { ...definition, spells: [record] } })
    .map((section) => [section.id, `${section.title}: ${section.summary}`])) as Partial<Record<SectionId, string>>;

describe("a spell and its action, kept in step", () => {
  it("casts in the same slot its action takes, parking a reaction's trigger", () => {
    const rebuke = SPELL_TEMPLATES.find((template) => template.label === "Reaction")!.record("cha");
    const asAction = withCastingTime(rebuke, "action", undefined);
    expect(asAction.spell).toMatchObject({ castingTime: "action", action: { actionType: "action" } });
    expect(asAction.spell.action).not.toHaveProperty("reaction");
    const back = withCastingTime(asAction.spell, "reaction", asAction.parked);
    expect(back.spell.action).toMatchObject({ actionType: "reaction", reaction: { trigger: { kind: "hit-by-attack" } } });
  });

  it("needs concentration on the spell and its action together; a heal has none of its own", () => {
    const fireball = spell("fireball");
    expect(concentrates(fireball)).toBe(false);
    const held = withConcentration(fireball, true);
    expect(held.concentration).toBe(true);
    expect(held.action).toMatchObject({ concentration: true });
    const released = withConcentration(held, false);
    expect(released).not.toHaveProperty("concentration");
    expect(released.action).not.toHaveProperty("concentration");
    expect(withConcentration(spell("cure-wounds"), true).action).not.toHaveProperty("concentration");
  });

  it("writes upcasting where it lives, and removes it", () => {
    const fireball = spell("fireball");
    expect(upcastOf(fireball)).toEqual({ perSlotAboveBase: { damageDice: "1d6" } });
    const more = withUpcast(fireball, { perSlotAboveBase: { damageDice: "2d6" } });
    expect(more.upcast).toEqual({ perSlotAboveBase: { damageDice: "2d6" } });
    expect(more.action).not.toHaveProperty("upcast");
    expect(withUpcast(fireball, undefined)).not.toHaveProperty("upcast");
    expect(withUpcast(fireball, upcastOf(fireball))).toBe(fireball);
  });

  it("keeps a lingering area on the action, or on the spell when only the spell has one", () => {
    const web = spell("web");
    expect(zoneOf(web.action, web)?.terrain).toEqual({ type: "difficult" });
    const drifting = withSpellZone(web, { ...zoneOf(web.action, web)!, movement: { driftFeetPerCasterTurn: 10 } });
    expect(drifting.action).toMatchObject({ zone: { movement: { driftFeetPerCasterTurn: 10 } } });
    const onSpell: SpellDefinition = { ...web, zone: zoneOf(web.action, web), action: { ...web.action!, zone: undefined } as ActionDefinition };
    const moved = withSpellZone(onSpell, undefined);
    expect(moved).not.toHaveProperty("zone");
  });

  it("prints the range its action reaches", () => {
    expect(printedRange(spell("fireball").action!)).toBe(150);
    expect(printedRange(spell("burning-hands").action!)).toBe("self");
    expect(printedRange(spell("cure-wounds").action!)).toBe("touch");
    expect(printedRange(spell("misty-step").action!)).toBe("self");
  });

  it("changes the printed range only when the target changes", () => {
    const fireball = spell("fireball");
    const renamed = withSpellAction(fireball, { ...fireball.action!, name: "Big Boom" });
    expect(renamed.range).toBe(150);
    const closer = withSpellAction(fireball, actionTarget.set(fireball.action!, { kind: "area", area: { type: "circle", size: 20 }, origin: "point", range: 90 })!);
    expect(closer.range).toBe(90);
  });

  it("moves the slot with the level; a cantrip is at will and doesn't upcast; a leveled spell doesn't grow like a cantrip", () => {
    const fireball = spell("fireball");
    const fourth = withSpellLevel(fireball, 4);
    expect(fourth.resourceCost).toEqual({ resourceId: "slot-4", amount: 1 });
    expect(fourth.action).toMatchObject({ resourceCost: { resourceId: "slot-4", amount: 1 } });

    const cantrip = withSpellLevel(fireball, 0);
    expect(cantrip).not.toHaveProperty("resourceCost");
    expect(cantrip.action).not.toHaveProperty("resourceCost");
    expect(cantrip).not.toHaveProperty("upcast");

    const bolt = spell("fire-bolt");
    const leveled = withSpellLevel(bolt, 1);
    expect(leveled.resourceCost).toEqual({ resourceId: "slot-1", amount: 1 });
    expect(leveled.action!.kind === "attack" && leveled.action!.damage[0]).not.toHaveProperty("scaling");
    const blast = withSpellLevel(spell("eldritch-blast"), 2);
    expect(blast.action).not.toHaveProperty("beamCountByLevel");
  });

  it("is reference only on the spell and its action together", () => {
    const fireball = spell("fireball");
    expect(spellIsReference(fireball)).toBe(false);
    const reference = withSpellReference(fireball, true);
    expect(reference.automationSupport).toBe("manual-only");
    expect(reference.action!.automationSupport).toBe("manual-only");
    expect(spellIsReference(reference)).toBe(true);
    expect(spellIsReference(withSpellReference(reference, false))).toBe(false);
  });

  it("opens spells that cast what the editor knows, activations (Shield, Counterspell) included", () => {
    expect(spellOpensInEditor(spell("fireball"))).toBe(true);
    expect(spellOpensInEditor(spell("misty-step"))).toBe(true);
    expect(spellOpensInEditor({ ...spell("fireball"), action: undefined })).toBe(true);
    expect(spellOpensInEditor(spell("shield"))).toBe(true);
    expect(spellOpensInEditor(spell("counterspell"))).toBe(true);
  });
});

describe("areas", () => {
  const areaOf = (action: ActionDefinition) => actionTarget.get(action) as AreaTarget;

  it("reads the SRD's shapes and where they start", () => {
    expect([areaShapeOf(areaOf(spell("fireball").action!).area), areaStartOf(areaOf(spell("fireball").action!))]).toEqual(["sphere", "point"]);
    expect([areaShapeOf(areaOf(spell("burning-hands").action!).area), areaStartOf(areaOf(spell("burning-hands").action!))]).toEqual(["cone", "front"]);
    expect([areaShapeOf(areaOf(spell("lightning-bolt").action!).area), areaStartOf(areaOf(spell("lightning-bolt").action!))]).toEqual(["line", "front"]);
    expect([areaShapeOf(areaOf(spell("thunderwave").action!).area), areaStartOf(areaOf(spell("thunderwave").action!))]).toEqual(["cube", "front"]);
    const frightful = dragon.actions.find((action) => action.name === "Frightful Presence")!;
    expect([areaShapeOf(areaOf(frightful).area), areaStartOf(areaOf(frightful))]).toEqual(["sphere", "self"]);
  });

  it("switches shape keeping the size, starting where that shape usually does", () => {
    const sphere = areaOf(spell("fireball").action!);
    expect(withAreaShape(sphere, "cone")).toEqual({ kind: "area", area: { type: "cone", size: 20 }, origin: "self", range: 20, aimedFromSelf: true });
    expect(withAreaShape(sphere, "line").area).toEqual({ type: "line", size: 20, width: 5 });
    expect(withAreaShape(sphere, "cube")).toMatchObject({ area: { type: "square", size: 20 }, origin: "point", range: 150 });
  });

  it("moves a cube between a point, around itself and out from itself", () => {
    const cube = withAreaShape(areaOf(spell("fireball").action!), "cube");
    expect(areaStarts("cube")).toEqual(["point", "self", "front"]);
    expect(withAreaStart(cube, "front")).toEqual({ kind: "area", area: { type: "rectangle", size: 20, width: 20 }, origin: "self", range: 20, aimedFromSelf: true });
    expect(withAreaStart(cube, "self")).toEqual({ kind: "area", area: { type: "square", size: 20 }, origin: "self", range: 20 });
  });

  it("keeps a cube out from itself square when it's resized", () => {
    const thunder = areaOf(spell("thunderwave").action!);
    expect(withAreaSize(thunder, 30).area).toEqual({ type: "rectangle", size: 30, width: 30 });
    const bolt = areaOf(spell("lightning-bolt").action!);
    expect(withAreaSize(bolt, 60).area).toEqual({ type: "rectangle", size: 60, width: 5 });
  });

  it("keeps an unusual start on offer", () => {
    expect(areaStarts("cone", "point")).toEqual(["front", "point"]);
  });

  it("aims a healing area from itself", () => {
    const heal = convertAction(spell("burning-hands").action!, "healing").action;
    const cone: AreaTarget = { kind: "area", area: { type: "cone", size: 15 }, origin: "self", range: 15, aimedFromSelf: true };
    const aimed = actionTarget.set(heal, cone)!;
    expect(aimed).toMatchObject({ targeting: { target: "area" }, areaTargeting: { origin: "self", aimedFromSelf: true } });
    expect(actionTarget.get(aimed)).toEqual(cone);
  });
});

describe("converting a spell's action", () => {
  it("gives a spell's new save a DC that follows the spellcasting ability", () => {
    const bolt = spell("fire-bolt").action!;
    const { action } = convertAction(bolt, "save", {}, { spell: true });
    expect(action).toMatchObject({ kind: "save", dcFormula: { base: 8, ability: "spellcasting", proficiency: true } });
    expect(resolveSaveDc(action as Extract<ActionDefinition, { kind: "save" }>, cleric)).toBe(8 + 3 + 3);
  });

  it("gives a monster's new save a DC from the ability its attack used", () => {
    const claw: ActionDefinition = { kind: "attack", id: "claw", name: "Claw", actionType: "action", attackType: "melee", ability: "str", range: 5, reach: 5, damage: [], automationSupport: "full" };
    expect(convertAction(claw, "save").action).toMatchObject({ dcFormula: { base: 8, ability: "str", proficiency: true } });
  });

  it("makes a spell's new attack a spell attack that follows the spellcasting ability, and a heal that adds it", () => {
    const hold = spell("hold-person").action!;
    expect(convertAction(hold, "attack", {}, { spell: true, spellcasting: "wis" }).action).toMatchObject({
      kind: "attack", attackType: "spell", ability: "wis", attackBonusFormula: { ability: "spellcasting", proficiency: true }, range: 60
    });
    expect(convertAction(hold, "healing", {}, { spell: true, spellcasting: "wis" }).action).toMatchObject({ healing: [{ dice: "1d8", abilityModifier: "wis" }] });
  });

  it("starts a new buff with something to grant", () => {
    const { action } = convertAction(spell("fireball").action!, "buff");
    expect(action).toMatchObject({ appliedCondition: { durationRounds: 10, modifiers: { armorClass: 2 } } });
  });
});

describe("summaries", () => {
  it("say how a spell is cast, what it reaches and what it does", () => {
    const fireball = spell("fireball");
    expect(summaries(cleric, fireball)).toMatchObject({
      basics: "Basics: Fireball · level 3 evocation",
      use: "Use & cost: Action · a 3rd-level slot · upcasts",
      target: "Target: 20-ft sphere within 150 ft · everyone in it",
      // The library Fireball names INT itself: 8 + 0 + 3 for this cleric.
      roll: "Roll: Dexterity save · DC 11 (calculated) · half on a success"
    });
  });

  it("give a heal and a buff their outcome, and a teleport its distance", () => {
    expect(summaries(cleric, spell("cure-wounds"))).toMatchObject({ roll: "Roll: no roll · heals", outcome: "Healing: heals 7 (1d8 + 3)", target: "Target: a creature it touches" });
    expect(summaries(cleric, spell("bless"))).toMatchObject({ outcome: "Benefit: +2 to hit, +2 saves · 1 minute", target: "Target: up to 3 creatures within 30 ft" });
    expect(summaries(cleric, spell("misty-step"))).toMatchObject({ target: "Target: itself, up to 30 ft", roll: "Roll: no roll · teleports" });
  });

  it("gives a spell with nothing to cast a Roll section to pick one", () => {
    const blank: SpellDefinition = { ...spell("fireball"), action: undefined, automationSupport: "manual-only" };
    expect(summaries(cleric, blank)).toMatchObject({ roll: "Roll: not simulated", use: "Use & cost: Action · a 3rd-level slot" });
  });
});

describe("warnings", () => {
  const place = (record: SpellDefinition) => abilityWarnings({ ...cleric, spells: [record] }, { list: "spells", id: record.id }, record);

  it("warns about a buff that grants nothing", () => {
    const bless = spell("bless");
    const empty = { ...bless, action: { ...bless.action!, appliedCondition: { name: "custom", durationRounds: 10 } } as ActionDefinition };
    expect(place(empty).map((warning) => warning.id)).toContain("empty-buff");
    expect(place(bless).map((warning) => warning.id)).not.toContain("empty-buff");
  });

  it("warns that a success that negates everything skips its success effects", () => {
    const hold = spell("hold-person");
    const action = hold.action as Extract<ActionDefinition, { kind: "save" }>;
    const withSuccess = { ...hold, action: { ...action, riders: [...(action.riders ?? []), { kind: "push" as const, when: "on-save-success" as const, distance: 5 }] } };
    expect(place(withSuccess).find((warning) => warning.id === "dead-success-effects")?.section).toBe("roll");
    expect(place({ ...withSuccess, action: { ...withSuccess.action, onSuccess: "none" } }).map((warning) => warning.id)).not.toContain("dead-success-effects");
  });

  it("checks a spell attack's damage against the ability it follows", () => {
    const blast = blankSpell("wis");
    const agonizing = { ...blast, action: { ...blast.action!, damage: [{ dice: "1d10", damageType: "force" as const, abilityModifier: "cha" as const }] } as ActionDefinition };
    const warlock = { ...cleric, spellcasting: { ability: "cha" as const } };
    expect(abilityWarnings({ ...warlock, spells: [agonizing] }, { list: "spells", id: agonizing.id }, agonizing).map((warning) => warning.id)).not.toContain("damage-ability-mismatch");
  });
});

describe("templates", () => {
  it("are spells the normalizer accepts as they are", () => {
    for (const template of SPELL_TEMPLATES) {
      const record = { ...template.record("wis"), id: "t" };
      const normalized = normalizeSpellDefinition(structuredClone(record));
      expect(normalized.action?.kind, template.label).toBe(record.action?.kind);
      expect(normalized.action?.actionType, template.label).toBe(record.castingTime);
    }
    expect(normalizeSpellDefinition({ ...blankSpell("int"), id: "b" }).action?.kind).toBe("attack");
    expect(normalizeActionDefinition(blankSpecialAction(), "action").kind).toBe("save");
  });
});

describe("over the SRD", () => {
  it("writes back what each spell setting reads without changing any SRD spell", async () => {
    const { SRD_SPELLS } = await import("@/data/srd");
    const { SRD_MONSTER_INDEX } = await import("@/data/srd/monsters");
    const { deepEqual } = await import("@/lib/deep-equal");
    const changed: string[] = [];
    const same = (label: string, before: unknown, after: unknown) => { if (!deepEqual(before, after)) changed.push(label); };
    const check = (label: string, record: SpellDefinition) => {
      same(`${label} casting time`, record, withCastingTime(record, record.castingTime, undefined).spell);
      same(`${label} concentration`, record, withConcentration(record, concentrates(record)));
      same(`${label} upcast`, record, withUpcast(record, upcastOf(record)));
      same(`${label} zone`, record, withSpellZone(record, zoneOf(record.action, record)));
      same(`${label} level`, record, withSpellLevel(record, record.level));
      same(`${label} reference`, record, withSpellReference(record, spellIsReference(record)));
    };
    for (const { id } of SRD_MONSTER_INDEX) {
      const definition = (await loadSrdMonster(id))!;
      for (const record of definition.spells ?? []) check(`${definition.name}: ${record.name}`, record);
    }
    for (const record of SRD_SPELLS) check(record.name, record);
    expect(changed).toEqual([]);
  }, 60_000);
});

describe("teleports and reference text", () => {
  it("reads a teleport without targeting as itself, the way the engine moves it, and writes both ways out", () => {
    const blink: ActionDefinition = { kind: "reposition", id: "blink", name: "Blink", actionType: "bonus", range: 30, automationSupport: "full" };
    expect(actionTarget.get(blink)).toEqual({ kind: "self" });
    const other = actionTarget.set(blink, { kind: "creature", range: 60 });
    expect(other).toMatchObject({ range: 60, targeting: { target: "single" } });
    expect(actionTarget.set(other, { kind: "self" })).toMatchObject({ targeting: { target: "self" } });
  });

  it("starts a new teleport as itself, whatever the old kind reached", () => {
    const { action } = convertAction(spell("fire-bolt").action!, "reposition");
    expect(action).toMatchObject({ kind: "reposition", range: 30, targeting: { target: "self" } });
  });

  it("keeps an ability's reference text through a switch", () => {
    const described: ActionDefinition = { kind: "unsupported", id: "gaze", name: "Petrifying Gaze", actionType: "action", description: "Each creature within 30 feet…", automationSupport: "unsupported" };
    expect(convertAction(described, "area-save").action.description).toBe("Each creature within 30 feet…");
  });
});
