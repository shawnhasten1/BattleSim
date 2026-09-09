"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { abilityModifier, type Ability, type CombatantState, type CreatureDefinition } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import { formatBonus } from "@/lib/ui-helpers";
import { resourceIdsForEditor } from "@/lib/sheet";
import styles from "../sheet.module.css";

const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

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
          <label className={styles.field}>
            Prof
            <input type="number" value={definition.proficiencyBonus ?? 2} onChange={(e) => updateCreatureDefinition(definition.id, { proficiencyBonus: Number(e.target.value) })} />
          </label>
          <label className={styles.field}>
            Size
            <input value={definition.size} readOnly />
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
        <h3>Resources</h3>
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
