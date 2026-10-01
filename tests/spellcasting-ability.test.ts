import { describe, expect, it } from "vitest";
import {
  creatureDefinitionSchema,
  getExecutableActions,
  inferSpellcastingAbility,
  normalizeCreatureDefinition,
  resolveAttackBonus,
  resolveNumericFormula,
  resolveSaveDc,
  spellcastingAbility,
  type CreatureDefinition,
  type SpellDefinition
} from "@/engine";

/**
 * A creature's spellcasting ability (ABILITY_BUILDER_REDESIGN_PLAN.md §3.6, D5): a spell whose DC or attack bonus
 * formula names "spellcasting" follows it; one that names an ability of its own overrides it.
 */

function caster(abilities: Partial<CreatureDefinition["abilities"]>, spells: SpellDefinition[] = [], spellcasting?: CreatureDefinition["spellcasting"]): CreatureDefinition {
  return {
    id: "caster", name: "Caster", size: "medium", armorClass: 12, maxHp: 30, speed: 30, proficiencyBonus: 3,
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10, ...abilities }, actions: [], spells,
    ...(spellcasting ? { spellcasting } : {})
  };
}

function saveSpell(id: string, ability: "spellcasting" | "int" | "wis" | "cha"): SpellDefinition {
  return {
    id, name: id, level: 1, castingTime: "action", range: 60, automationSupport: "full",
    action: {
      kind: "save", id: `${id}-action`, name: id, actionType: "action", saveAbility: "wis", range: 60,
      dcFormula: { base: 8, ability, proficiency: true }, damage: [], halfDamageOnSuccess: false, onSuccess: "negates",
      automationSupport: "full"
    }
  };
}

function attackSpell(id: string, ability: "spellcasting" | "int"): SpellDefinition {
  return {
    id, name: id, level: 0, castingTime: "action", range: 120, automationSupport: "full",
    action: {
      kind: "attack", id: `${id}-action`, name: id, actionType: "action", attackType: "spell", ability: "int", range: 120,
      attackBonusFormula: { ability, proficiency: true }, damage: [{ dice: "1d10", damageType: "fire" }], automationSupport: "full"
    }
  };
}

const dcOf = (definition: CreatureDefinition, spellId: string) => {
  const action = getExecutableActions(definition).find((candidate) => candidate.id === `${spellId}-action`);
  if (action?.kind !== "save" && action?.kind !== "area-save") throw new Error("no save");
  return resolveSaveDc(action, definition);
};

describe("the spellcasting ability", () => {
  it("is the creature's own when it has one", () => {
    const cleric = caster({ wis: 16, cha: 18 }, [], { ability: "wis" });
    expect(spellcastingAbility(cleric)).toBe("wis");
    expect(resolveNumericFormula({ base: 8, ability: "spellcasting", proficiency: true }, cleric)).toBe(8 + 3 + 3);
  });

  it("without one, is the ability its spells name most", () => {
    const wizard = caster({ int: 12, cha: 16 }, [saveSpell("a", "int"), saveSpell("b", "int"), saveSpell("c", "cha")]);
    expect(inferSpellcastingAbility(wizard)).toBe("int");
  });

  it("breaks a tie between named abilities by the higher score", () => {
    const hybrid = caster({ int: 12, wis: 16 }, [saveSpell("a", "int"), saveSpell("b", "wis")]);
    expect(inferSpellcastingAbility(hybrid)).toBe("wis");
  });

  it("with no spells naming one, is the highest of INT, WIS and CHA (INT, then WIS, on a tie)", () => {
    expect(inferSpellcastingAbility(caster({ cha: 16, wis: 14 }))).toBe("cha");
    expect(inferSpellcastingAbility(caster({ int: 14, wis: 14 }))).toBe("int");
    expect(inferSpellcastingAbility(caster({ wis: 14, cha: 14 }))).toBe("wis");
    // Spells that follow the spellcasting ability don't vote for one.
    expect(inferSpellcastingAbility(caster({ cha: 16 }, [saveSpell("a", "spellcasting")]))).toBe("cha");
  });

  it("moves the DC of every spell that follows it, but not one that overrides it", () => {
    const spells = [saveSpell("bless-dc", "spellcasting"), saveSpell("hold", "spellcasting"), saveSpell("fireball", "int")];
    const asWis = caster({ int: 10, wis: 16, cha: 12 }, spells, { ability: "wis" });
    const asCha = { ...asWis, spellcasting: { ability: "cha" as const } };
    expect([dcOf(asWis, "bless-dc"), dcOf(asWis, "hold"), dcOf(asWis, "fireball")]).toEqual([14, 14, 11]);
    expect([dcOf(asCha, "bless-dc"), dcOf(asCha, "hold"), dcOf(asCha, "fireball")]).toEqual([12, 12, 11]);
  });

  it("gives a spell attack that follows it the ability to roll with", () => {
    const warlock = caster({ int: 8, cha: 18 }, [attackSpell("blast", "spellcasting"), attackSpell("bolt", "int")], { ability: "cha" });
    const actions = getExecutableActions(warlock);
    const blast = actions.find((action) => action.id === "blast-action");
    const bolt = actions.find((action) => action.id === "bolt-action");
    if (blast?.kind !== "attack" || bolt?.kind !== "attack") throw new Error("no attacks");
    expect(blast.ability).toBe("cha");
    expect(resolveAttackBonus(blast, warlock)).toBe(4 + 3);
    // An override keeps its own ability.
    expect(bolt.ability).toBe("int");
    expect(resolveAttackBonus(bolt, warlock)).toBe(-1 + 3);
  });

  it("is kept and checked by the creature schema", () => {
    const definition = normalizeCreatureDefinition({ ...caster({ wis: 16 }), spellcasting: { ability: "wis" } } as unknown as Record<string, unknown>);
    expect(definition.spellcasting).toEqual({ ability: "wis" });
    expect(() => creatureDefinitionSchema.parse({ ...caster({}), spellcasting: { ability: "luck" } })).toThrow();
  });
});

describe("attaching and saving spells", () => {
  // Imported here so the engine tests above don't need the store.
  const load = async () => (await import("@/store/encounter-store")).useEncounterStore;
  const withFighter = async (abilities: Partial<CreatureDefinition["abilities"]>) => {
    const store = await load();
    store.setState(pristine!, true);
    const encounter = store.getState().encounter;
    store.setState({
      encounter: {
        ...encounter,
        definitions: encounter.definitions.map((definition) => definition.id === "def-fighter"
          ? { ...definition, abilities: { ...definition.abilities, ...abilities } }
          : definition)
      }
    });
    return store;
  };
  let pristine: ReturnType<Awaited<ReturnType<typeof load>>["getState"]> | undefined;
  const fighterOf = (store: Awaited<ReturnType<typeof load>>) => store.getState().encounter.definitions.find((definition) => definition.id === "def-fighter")!;

  it("casts an attached library spell with the creature's spellcasting ability, and gives the creature one", async () => {
    const store = await load();
    pristine ??= store.getState();
    const cleric = await withFighter({ wis: 16 });
    cleric.getState().attachSrdSpell("def-fighter", "srd:spell:fireball");
    const fireball = fighterOf(cleric).spells!.at(-1)!;
    expect(fireball.action).toMatchObject({ dcFormula: { base: 8, ability: "spellcasting", proficiency: true } });
    expect(fighterOf(cleric).spellcasting).toEqual({ ability: "wis" });
    // 8 + WIS +3 + proficiency +2, where the library's Fireball named INT (+0).
    const compiled = getExecutableActions(fighterOf(cleric)).find((action) => action.id === fireball.action!.id);
    if (compiled?.kind !== "area-save") throw new Error("no Fireball");
    expect(resolveSaveDc(compiled, fighterOf(cleric))).toBe(13);
  });

  it("adds the caster's own modifier to an attached heal", async () => {
    const store = await load();
    pristine ??= store.getState();
    const bard = await withFighter({ cha: 16 });
    bard.getState().attachSrdSpell("def-fighter", "srd:spell:cure-wounds");
    expect(fighterOf(bard).spells!.at(-1)!.action).toMatchObject({ healing: [{ dice: "1d8", abilityModifier: "cha" }] });
  });

  it("moves every following spell's DC when the ability changes, but not one that overrides it", async () => {
    const store = await load();
    pristine ??= store.getState();
    const cleric = await withFighter({ wis: 16, cha: 12 });
    cleric.getState().attachSrdSpell("def-fighter", "srd:spell:hold-person");
    cleric.getState().attachSrdSpell("def-fighter", "srd:spell:sacred-flame");
    cleric.getState().insertAbilityRecord("def-fighter", "spells", saveSpell("own-dc", "int"));
    const [hold, flame, own] = fighterOf(cleric).spells!;
    const dcs = () => [hold, flame, own].map((record) => {
      const definition = fighterOf(cleric);
      const action = getExecutableActions(definition).find((candidate) => candidate.name === record!.name);
      if (action?.kind !== "save" && action?.kind !== "area-save") throw new Error(`no save for ${record!.name}`);
      return resolveSaveDc(action, definition);
    });
    expect(dcs()).toEqual([13, 13, 10]);
    cleric.getState().updateCreatureDefinition("def-fighter", { spellcasting: { ability: "cha" } });
    expect(dcs()).toEqual([11, 11, 10]);
  });
});
