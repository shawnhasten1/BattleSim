"use client";

import { abilityModifier, type Ability, type CombatantState, type ConditionImmunity, type CreatureDefinition, type CreatureType } from "@/engine";
import { AdjustmentGroupEditor, flattenGroups, groupAdjustments } from "../stats/DamageAdjustmentGroup";
import defenseStyles from "../stats/defenses.module.css";
import { useEncounterStore } from "@/store/encounter-store";
import { formatBonus, sourceLabel } from "@/lib/ui-helpers";
import { characterLevel, withClassName, withLevel } from "@/lib/actor-sheet/edits";
import { CREATURE_TYPES } from "@/lib/creature-types";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { SheetNumber, SheetText } from "../SheetInputs";
import styles from "../sheet.module.css";

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

/** The creature's numbers. Its spellcasting ability and its resources are on the Abilities tab, by what spends them. */
export function StatsTab({ definition }: { combatant: CombatantState; definition: CreatureDefinition }) {
  const updateCreatureDefinition = useEncounterStore((s) => s.updateCreatureDefinition);
  const updateCreatureAbility = useEncounterStore((s) => s.updateCreatureAbility);
  const primaryClass = definition.character?.classes?.[0];
  const level = characterLevel(definition);

  return (
    <div className={styles.tab}>
      <section className={styles.section}>
        <h3>Profile</h3>
        <p className={styles.source}>Source: {sourceLabel(definition.source)}</p>
        <label className={styles.field}>
          Name
          <SheetText value={definition.name} onCommit={(name) => updateCreatureDefinition(definition.id, { name })} />
        </label>
        <div className={styles.grid} style={{ marginTop: 6 }}>
          <label className={styles.field}>
            AC
            <SheetNumber value={definition.armorClass} min={0} max={99} onCommit={(armorClass) => updateCreatureDefinition(definition.id, { armorClass })} />
          </label>
          <label className={styles.field}>
            Max HP
            <SheetNumber value={definition.maxHp} min={1} max={9999} onCommit={(maxHp) => updateCreatureDefinition(definition.id, { maxHp })} />
          </label>
          <label className={styles.field}>
            Speed
            <SheetNumber value={definition.speed} min={0} max={999} step={5} onCommit={(speed) => updateCreatureDefinition(definition.id, { speed })} />
          </label>
          {(["fly", "swim", "climb", "burrow"] as const).map((mode) => (
            <label key={mode} className={styles.field}>
              {mode}
              <SheetNumber
                label={`${mode} speed`} value={definition.movement?.[mode] ?? 0} min={0} max={999} step={5}
                onCommit={(feet) => {
                  const { [mode]: _dropped, ...rest } = definition.movement ?? { walk: definition.speed };
                  updateCreatureDefinition(definition.id, { movement: { ...rest, walk: definition.speed, ...(feet > 0 ? { [mode]: feet } : {}) } });
                }}
              />
            </label>
          ))}
          {definition.movement?.fly ? (
            <label className={styles.field} title="A hovering flier doesn't fall when it's knocked prone or can't move.">
              hover
              <input
                type="checkbox" aria-label="Hovers" checked={Boolean(definition.movement.hover)}
                onChange={(e) => {
                  const { hover: _dropped, ...rest } = definition.movement ?? { walk: definition.speed };
                  updateCreatureDefinition(definition.id, { movement: { ...rest, walk: definition.speed, ...(e.target.checked ? { hover: true } : {}) } });
                }}
              />
            </label>
          ) : null}
          <label className={styles.field}>
            Prof
            <SheetNumber value={definition.proficiencyBonus ?? 2} min={0} max={10} onCommit={(proficiencyBonus) => updateCreatureDefinition(definition.id, { proficiencyBonus })} />
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
              // Named here: the label also holds the "?" button, which a browser would take as the thing it labels.
              aria-label="Creature type"
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
            <SheetNumber
              value={level} min={1} max={20}
              onCommit={(next) => updateCreatureDefinition(definition.id, { character: withLevel(definition.character, next) })}
            />
          </label>
          <label className={styles.field} style={{ gridColumn: "1 / -1" }}>
            Class
            <SheetText
              value={primaryClass?.name ?? ""}
              placeholder="Fighter"
              onCommit={(name) => updateCreatureDefinition(definition.id, { character: withClassName(definition.character, name, level) })}
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
              <SheetNumber value={definition.abilities[ability]} min={1} max={30} onCommit={(score) => updateCreatureAbility(definition.id, ability, score)} />
              <strong>{formatBonus(abilityModifier(definition.abilities[ability]))}</strong>
            </label>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.fieldLabel}>
          Saving throws
          <InfoTooltip
            label="About saving throws"
            content={<p>A save&apos;s whole bonus, as a statblock prints it (DEX +6). Empty: the ability&apos;s modifier.</p>}
          />
        </h3>
        <div className={styles.abilities}>
          {ABILITIES.map((ability) => (
            <label key={ability}>
              <span>{ability}</span>
              <SheetNumber
                optional label={`${ability.toUpperCase()} save`} value={definition.saves?.[ability]} min={-10} max={30}
                placeholder={formatBonus(abilityModifier(definition.abilities[ability]))}
                onCommit={(bonus) => {
                  const { [ability]: _dropped, ...rest } = definition.saves ?? {};
                  const saves = bonus === undefined ? rest : { ...rest, [ability]: bonus };
                  updateCreatureDefinition(definition.id, { saves: Object.keys(saves).length ? saves : undefined });
                }}
              />
            </label>
          ))}
        </div>
      </section>

      <section className={styles.section}>
        <h3 className={styles.fieldLabel}>
          Defenses
          <InfoTooltip label="About defenses" content={DEFENSES_HELP} />
        </h3>
        <div className={defenseStyles.list}>
          {groupAdjustments(definition.damageAdjustments ?? []).map((group, index, groups) => (
            <div key={index} className={defenseStyles.card}>
              <div className={defenseStyles.head}>
                <span>Damage</span>
                <button
                  type="button" className={defenseStyles.remove} aria-label="Remove damage defense"
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
            type="button" className={defenseStyles.add}
            onClick={() => updateCreatureDefinition(definition.id, {
              damageAdjustments: [...(definition.damageAdjustments ?? []), { type: "resistance", damageType: "fire" }]
            })}
          >
            + Add damage defense
          </button>
        </div>
        <div className={styles.field}>Immune to being</div>
        <div className={defenseStyles.chips}>
          {CONDITION_IMMUNITIES.map((condition) => {
            const on = definition.conditionImmunities?.includes(condition) ?? false;
            return (
              <button
                key={condition} type="button" aria-pressed={on}
                className={on ? defenseStyles.chipOn : undefined}
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
    </div>
  );
}
