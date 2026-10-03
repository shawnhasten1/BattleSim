import { describe, expect, it } from "vitest";
import { migrateDefinition, normalizeCreatureDefinition, type ActionDefinition, type CreatureDefinition } from "@/engine";

/**
 * Saved Shield- and Parry-style reactions fired before the attack roll (`targeted-by-attack`). They come up to date
 * when a creature is loaded or imported: an AC-only activation waits for a hit it can turn into a miss.
 */
const creature = (reactions: ActionDefinition[], extra: Partial<CreatureDefinition> = {}): CreatureDefinition => ({
  id: "def-old", name: "Old", size: "medium", armorClass: 15, maxHp: 30, speed: 30,
  abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }, actions: [], reactions, ...extra
});

const oldShield: ActionDefinition = {
  kind: "activate-feature", id: "shield", name: "Shield", actionType: "reaction", featureId: "srd:spell:shield",
  reaction: { trigger: { kind: "targeted-by-attack" }, target: "self", priority: "always" },
  resourceCost: { resourceId: "slot-1", amount: 1 },
  condition: { id: "shield-active", name: "custom", durationRounds: 1, modifiers: { armorClass: 5 } }, automationSupport: "full"
};
const oldParry: ActionDefinition = {
  kind: "activate-feature", id: "parry", name: "Parry", actionType: "reaction", featureId: "parry",
  reaction: { trigger: { kind: "targeted-by-attack", meleeOnly: true }, target: "self", priority: "always" },
  condition: { id: "parry-active", name: "custom", durationRounds: 1, modifiers: { armorClass: 2 } }, automationSupport: "full"
};

describe("migrateDefinition", () => {
  it("Shield waits for the roll and lasts until its caster's next turn; Parry waits for a melee hit and lasts for that attack", () => {
    const migrated = migrateDefinition(creature([oldShield, oldParry]));
    expect(migrated.reactions![0]).toMatchObject({ reaction: { trigger: { kind: "would-be-hit" }, lastsFor: "until-start-of-next-turn" } });
    expect(migrated.reactions![1]).toMatchObject({ reaction: { trigger: { kind: "would-be-hit", meleeOnly: true }, lastsFor: "triggering-attack" } });
  });

  it("any other AC-only reaction waits for the roll and keeps its own duration", () => {
    const homebrew: ActionDefinition = { ...oldShield, id: "ward", name: "Ward", featureId: "ward" };
    const migrated = migrateDefinition(creature([homebrew]));
    expect((migrated.reactions![0] as { reaction: unknown }).reaction).toEqual({ trigger: { kind: "would-be-hit" }, target: "self", priority: "always" });
  });

  it("leaves reactions that do more than raise AC, and creatures that are up to date, as they were (the same objects)", () => {
    const blur: ActionDefinition = { ...oldShield, id: "blur", condition: { id: "blur", name: "custom", durationRounds: 1, modifiers: { armorClass: 2, incomingAttackRoll: -2 } } };
    const current = creature([blur]);
    expect(migrateDefinition(current)).toBe(current);
    const migrated = migrateDefinition(creature([oldShield]));
    expect(migrateDefinition(migrated)).toBe(migrated);
  });

  it("reaches reactions wherever a creature keeps them: spells, granted actions, legendary actions", () => {
    const definition = creature([], {
      spells: [{ id: "my-shield", name: "Shield", level: 1, school: "abjuration", castingTime: "reaction", range: "self", automationSupport: "full", action: oldShield }],
      features: [{ id: "f", name: "Defensive", category: "feature", automationSupport: "full", grantedActions: [oldParry] }]
    });
    const migrated = migrateDefinition(definition);
    expect(migrated.spells![0]!.action).toMatchObject({ reaction: { trigger: { kind: "would-be-hit" } } });
    expect(migrated.features![0]!.grantedActions![0]).toMatchObject({ reaction: { trigger: { kind: "would-be-hit", meleeOnly: true } } });
  });

  it("runs on import", () => {
    const imported = normalizeCreatureDefinition(creature([oldShield]) as unknown as Record<string, unknown>);
    expect(imported.reactions![0]).toMatchObject({ reaction: { trigger: { kind: "would-be-hit" }, lastsFor: "until-start-of-next-turn" } });
  });
});
