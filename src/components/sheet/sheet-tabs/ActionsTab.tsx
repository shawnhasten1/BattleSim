"use client";

import { Plus, Swords } from "lucide-react";
import { useState } from "react";
import { getExecutableActions, type Ability, type CombatantState, type CreatureDefinition, type DamageType } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import { buildSheetItems } from "@/lib/sheet";
import { EditableItemList, SelectAbility, SelectDamageType } from "../SheetControls";
import styles from "../sheet.module.css";

export function ActionsTab({ definition }: { combatant: CombatantState; definition: CreatureDefinition }) {
  const addStructuredAction = useEncounterStore((s) => s.addStructuredAction);
  const addMultiattack = useEncounterStore((s) => s.addMultiattack);
  const removeDefinitionItem = useEncounterStore((s) => s.removeDefinitionItem);

  const [actionForm, setActionForm] = useState({
    kind: "attack" as "attack" | "save" | "area-save" | "healing",
    name: "Power Strike",
    actionType: "action" as "action" | "bonus",
    attackType: "melee" as "melee" | "ranged" | "spell",
    ability: "str" as Ability,
    saveAbility: "dex" as Ability,
    dc: 13,
    range: 5,
    areaSize: 20,
    damageDice: "1d8",
    damageType: "slashing" as DamageType
  });
  const [multiattackForm, setMultiattackForm] = useState({ name: "Multiattack", actionIds: [] as string[], count: 2 });

  const items = buildSheetItems(definition);
  const attackActions = getExecutableActions(definition).filter((action) => action.kind === "attack");

  function toggleAttack(id: string) {
    setMultiattackForm((current) => ({
      ...current,
      actionIds: current.actionIds.includes(id)
        ? current.actionIds.filter((existing) => existing !== id)
        : [...current.actionIds, id]
    }));
  }

  return (
    <div className={styles.tab}>
      <section className={styles.section}>
        <h3>New action</h3>
        <div className={styles.stack}>
          <input value={actionForm.name} onChange={(e) => setActionForm({ ...actionForm, name: e.target.value })} aria-label="Action name" />
          <div className={styles.grid}>
            <select value={actionForm.kind} onChange={(e) => setActionForm({ ...actionForm, kind: e.target.value as typeof actionForm.kind })} aria-label="Kind">
              <option value="attack">Attack</option>
              <option value="save">Save</option>
              <option value="area-save">Area save</option>
              <option value="healing">Healing</option>
            </select>
            <select value={actionForm.actionType} onChange={(e) => setActionForm({ ...actionForm, actionType: e.target.value as "action" | "bonus" })} aria-label="Timing">
              <option value="action">Action</option>
              <option value="bonus">Bonus</option>
            </select>
            <select value={actionForm.attackType} onChange={(e) => setActionForm({ ...actionForm, attackType: e.target.value as typeof actionForm.attackType })} aria-label="Attack type">
              <option value="melee">Melee</option>
              <option value="ranged">Ranged</option>
              <option value="spell">Spell</option>
            </select>
            <SelectAbility value={actionForm.ability} onChange={(ability) => setActionForm({ ...actionForm, ability })} />
            <SelectAbility value={actionForm.saveAbility} onChange={(saveAbility) => setActionForm({ ...actionForm, saveAbility })} />
            <input type="number" value={actionForm.dc} onChange={(e) => setActionForm({ ...actionForm, dc: Number(e.target.value) })} aria-label="DC" />
            <input type="number" value={actionForm.range} onChange={(e) => setActionForm({ ...actionForm, range: Number(e.target.value) })} aria-label="Range" />
            <input type="number" value={actionForm.areaSize} onChange={(e) => setActionForm({ ...actionForm, areaSize: Number(e.target.value) })} aria-label="Area" />
            <input value={actionForm.damageDice} onChange={(e) => setActionForm({ ...actionForm, damageDice: e.target.value })} aria-label="Damage dice" />
            <SelectDamageType value={actionForm.damageType} onChange={(damageType) => setActionForm({ ...actionForm, damageType })} />
          </div>
        </div>
        <button
          type="button"
          className={styles.addBtn}
          onClick={() => {
            addStructuredAction(definition.id, actionForm);
            setActionForm({ ...actionForm, name: "New Action" });
          }}
        >
          <Swords size={14} /> Add action
        </button>
      </section>

      <section className={styles.section}>
        <h3>Multiattack</h3>
        <div className={styles.grid}>
          <input value={multiattackForm.name} onChange={(e) => setMultiattackForm({ ...multiattackForm, name: e.target.value })} aria-label="Multiattack name" />
          <input type="number" min={1} value={multiattackForm.count} onChange={(e) => setMultiattackForm({ ...multiattackForm, count: Number(e.target.value) })} aria-label="Count" />
        </div>
        <div className={styles.chips} style={{ marginTop: 6 }}>
          {attackActions.map((action) => (
            <button
              key={action.id}
              type="button"
              onClick={() => toggleAttack(action.id)}
              style={multiattackForm.actionIds.includes(action.id) ? { borderColor: "var(--ui-accent)", color: "var(--ui-accent)" } : undefined}
            >
              {action.name}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={styles.addBtn}
          onClick={() => {
            addMultiattack(definition.id, multiattackForm);
            setMultiattackForm({ ...multiattackForm, actionIds: [] });
          }}
        >
          <Plus size={14} /> Add multiattack
        </button>
      </section>

      <section className={styles.section}>
        <h3>Current actions</h3>
        <EditableItemList items={items.actions} definitionId={definition.id} onRemove={removeDefinitionItem} />
      </section>
    </div>
  );
}
