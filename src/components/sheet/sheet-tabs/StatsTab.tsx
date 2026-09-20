"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { abilityModifier, type Ability, type CombatantState, type ConditionImmunity, type CreatureDefinition, type CreatureType } from "@/engine";
import { AdjustmentGroupEditor, flattenGroups, groupAdjustments } from "../builders/DamageAdjustmentGroup";
import builderStyles from "../builders/builders.module.css";
import { useEncounterStore } from "@/store/encounter-store";
import { formatBonus } from "@/lib/ui-helpers";
import { resourceIdsForEditor } from "@/lib/sheet";
import { CREATURE_TYPES } from "@/lib/creature-types";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import styles from "../sheet.module.css";

const RESOURCES_HELP = (
  <p>
    <strong>Current</strong> is what's left this encounter — it's what actions spend. <strong>Default</strong> is
    what it resets to at the start of a fresh encounter. Give a resource the exact id an action's "resource cost"
    refers to (e.g. <code>slot-3</code> for a 3rd-level spell slot) or that action can't spend it.
  </p>
);

const CREATURE_TYPE_HELP = (
  <p>
    Standard 5e creature type. Some spell effects can be restricted to only affect certain types (e.g. a
    condition that only works on undead) — leaving this unspecified means this actor won't match any
    type-restricted effect.
  </p>
);

const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

const CONDITION_IMMUNITIES: ConditionImmunity[] = [
  "blinded", "charmed", "deafened", "exhaustion", "frightened", "grappled", "incapacitated", "paralyzed",
  "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"
];

const DEFENSES_HELP = (
  <p>
    Resistances, immunities, vulnerabilities and damage the creature absorbs (heals from) apply to every attack
    and effect that damages it. A condition immunity stops the condition being applied at all — no save is
    rolled. Effects granted by features (a Rage, a magic item) are edited on the feature itself.
  </p>
);

export function StatsTab({ combatant, definition }: { combatant: CombatantState; definition: CreatureDefinition }) {
  const updateCreatureDefinition = useEncounterStore((s) => s.updateCreatureDefinition);
  const updateCreatureAbility = useEncounterStore((s) => s.updateCreatureAbility);
  const updateResource = useEncounterStore((s) => s.updateResource);
  const updateDefinitionResource = useEncounterStore((s) => s.updateDefinitionResource);

  const [resourceForm, setResourceForm] = useState({ resourceId: "slot-1", current: 1, maximum: 1 });
  const resourceIds = resourceIdsForEditor(definition, combatant);
  const primaryClass = definition.character?.classes?.[0];
  const level = definition.character?.level ?? primaryClass?.level ?? 1;

  function addResource() {
    const id = resourceForm.resourceId.trim();
    if (!id) return;
    updateResource(combatant.id, id, resourceForm.current);
    updateDefinitionResource(definition.id, id, resourceForm.maximum);
    setResourceForm({ resourceId: "", current: 1, maximum: 1 });
  }

  return (
    <div className={styles.tab}>
      <section className={styles.section}>
        <h3>Profile</h3>
        <label className={styles.field}>
          Name
          <input value={definition.name} onChange={(e) => updateCreatureDefinition(definition.id, { name: e.target.value })} />
        </label>
        <div className={styles.grid} style={{ marginTop: 6 }}>
          <label className={styles.field}>
            AC
            <input type="number" value={definition.armorClass} onChange={(e) => updateCreatureDefinition(definition.id, { armorClass: Number(e.target.value) })} />
          </label>
          <label className={styles.field}>
            Max HP
            <input type="number" value={definition.maxHp} onChange={(e) => updateCreatureDefinition(definition.id, { maxHp: Number(e.target.value) })} />
          </label>
          <label className={styles.field}>
            Speed
            <input type="number" value={definition.speed} onChange={(e) => updateCreatureDefinition(definition.id, { speed: Number(e.target.value) })} />
          </label>
          {(["fly", "swim", "climb", "burrow"] as const).map((mode) => (
            <label key={mode} className={styles.field}>
              {mode}
              <input
                type="number" min={0} step={5} aria-label={`${mode} speed`} value={definition.movement?.[mode] ?? 0}
                onChange={(e) => {
                  const feet = Math.max(0, Number(e.target.value) || 0);
                  const { [mode]: _dropped, ...rest } = definition.movement ?? { walk: definition.speed };
                  updateCreatureDefinition(definition.id, { movement: { ...rest, walk: definition.speed, ...(feet > 0 ? { [mode]: feet } : {}) } });
                }}
              />
            </label>
          ))}
          <label className={styles.field}>
            Prof
            <input type="number" value={definition.proficiencyBonus ?? 2} onChange={(e) => updateCreatureDefinition(definition.id, { proficiencyBonus: Number(e.target.value) })} />
          </label>
          <label className={styles.field}>
            Size
            <input value={definition.size} readOnly />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Type
              <InfoTooltip label="About creature type" content={CREATURE_TYPE_HELP} />
            </span>
            <select
              value={definition.type ?? ""}
              onChange={(e) =>
                updateCreatureDefinition(definition.id, {
                  type: e.target.value ? (e.target.value as CreatureType) : undefined
                })
              }
            >
              <option value="">Unspecified</option>
              {CREATURE_TYPES.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            Level
            <input
              type="number"
              value={level}
              onChange={(e) =>
                updateCreatureDefinition(definition.id, {
                  character: {
                    ...(definition.character ?? {}),
                    level: Number(e.target.value),
                    classes: [{ name: primaryClass?.name ?? "", level: Number(e.target.value) }]
                  }
                })
              }
            />
          </label>
          <label className={styles.field} style={{ gridColumn: "1 / -1" }}>
            Class
            <input
              value={primaryClass?.name ?? ""}
              placeholder="Fighter"
              onChange={(e) =>
                updateCreatureDefinition(definition.id, {
                  character: { ...(definition.character ?? {}), classes: [{ name: e.target.value, level }] }
                })
              }
            />
          </label>
        </div>
      </section>

      <section className={styles.section}>
        <h3>Abilities</h3>
        <div className={styles.abilities}>
          {ABILITIES.map((ability) => (
            <label key={ability}>
              <span>{ability}</span>
              <input
                type="number"
                value={definition.abilities[ability]}
                onChange={(e) => updateCreatureAbility(definition.id, ability, Number(e.target.value))}
              />
              <strong>{formatBonus(abilityModifier(definition.abilities[ability]))}</strong>
            </label>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.fieldLabel}>
          Defenses
          <InfoTooltip label="About defenses" content={DEFENSES_HELP} />
        </h3>
        <div className={builderStyles.riderList}>
          {groupAdjustments(definition.damageAdjustments ?? []).map((group, index, groups) => (
            <div key={index} className={builderStyles.riderCard}>
              <div className={builderStyles.riderHead}>
                <span>Damage</span>
                <button
                  type="button" className={builderStyles.riderRemove} aria-label="Remove damage defense"
                  onClick={() => updateCreatureDefinition(definition.id, { damageAdjustments: flattenGroups(groups.filter((_, i) => i !== index)) })}
                >
                  ×
                </button>
              </div>
              <AdjustmentGroupEditor
                group={group}
                onChange={(next) => updateCreatureDefinition(definition.id, { damageAdjustments: flattenGroups(groups.map((g, i) => (i === index ? next : g))) })}
              />
            </div>
          ))}
          <button
            type="button" className={builderStyles.riderAdd}
            onClick={() => updateCreatureDefinition(definition.id, {
              damageAdjustments: [...(definition.damageAdjustments ?? []), { type: "resistance", damageType: "fire" }]
            })}
          >
            + Add damage defense
          </button>
        </div>
        <div className={styles.field}>Immune to being</div>
        <div className={builderStyles.chips}>
          {CONDITION_IMMUNITIES.map((condition) => {
            const on = definition.conditionImmunities?.includes(condition) ?? false;
            return (
              <button
                key={condition} type="button" aria-pressed={on}
                className={on ? builderStyles.chipOn : undefined}
                onClick={() => {
                  const current = definition.conditionImmunities ?? [];
                  const next = on ? current.filter((entry) => entry !== condition) : [...current, condition];
                  updateCreatureDefinition(definition.id, { conditionImmunities: next.length ? next : undefined });
                }}
              >
                {condition}
              </button>
            );
          })}
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.fieldLabel}>
          Resources
          <InfoTooltip label="About resources" content={RESOURCES_HELP} />
        </h3>
        <div className={styles.stack}>
          {resourceIds.map((id) => (
            <div key={id} className={styles.grid}>
              <label className={styles.field}>
                {id} — current
                <input type="number" min={0} value={combatant.resources?.[id] ?? 0} onChange={(e) => updateResource(combatant.id, id, Number(e.target.value))} />
              </label>
              <label className={styles.field}>
                default
                <input type="number" min={0} value={definition.resources?.[id] ?? 0} onChange={(e) => updateDefinitionResource(definition.id, id, Number(e.target.value))} />
              </label>
            </div>
          ))}
        </div>
        <div className={styles.grid} style={{ marginTop: 6 }}>
          <label className={styles.field}>
            New id
            <input value={resourceForm.resourceId} placeholder="slot-3" onChange={(e) => setResourceForm({ ...resourceForm, resourceId: e.target.value })} />
          </label>
          <label className={styles.field}>
            current
            <input type="number" min={0} value={resourceForm.current} onChange={(e) => setResourceForm({ ...resourceForm, current: Number(e.target.value) })} />
          </label>
          <label className={styles.field}>
            default
            <input type="number" min={0} value={resourceForm.maximum} onChange={(e) => setResourceForm({ ...resourceForm, maximum: Number(e.target.value) })} />
          </label>
        </div>
        <button type="button" className={styles.addBtn} onClick={addResource}>
          <Plus size={14} /> Add resource
        </button>
      </section>
    </div>
  );
}
