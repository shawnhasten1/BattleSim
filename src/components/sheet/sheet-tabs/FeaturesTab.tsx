"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import type { CombatantState, CreatureDefinition } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import { buildSheetItems } from "@/lib/sheet";
import { EditableItemList } from "../SheetControls";
import styles from "../sheet.module.css";

export function FeaturesTab({ definition }: { combatant: CombatantState; definition: CreatureDefinition }) {
  const addFeatureOrTrait = useEncounterStore((s) => s.addFeatureOrTrait);
  const removeDefinitionItem = useEncounterStore((s) => s.removeDefinitionItem);

  const [featureForm, setFeatureForm] = useState({
    category: "feature" as "feature" | "trait",
    name: "Pack Tactics",
    description: "",
    effectPreset: "pack-tactics" as "none" | "pack-tactics" | "swarm" | "defense" | "resource-regain"
  });

  const items = buildSheetItems(definition);
  const { counts } = items;

  return (
    <div className={styles.tab}>
      <section className={styles.section}>
        <h3>New feature / trait</h3>
        <div className={styles.stack}>
          <div className={styles.grid}>
            <select value={featureForm.category} onChange={(e) => setFeatureForm({ ...featureForm, category: e.target.value as "feature" | "trait" })} aria-label="Category">
              <option value="feature">Feature</option>
              <option value="trait">Trait</option>
            </select>
            <select value={featureForm.effectPreset} onChange={(e) => setFeatureForm({ ...featureForm, effectPreset: e.target.value as typeof featureForm.effectPreset })} aria-label="Effect preset">
              <option value="none">Reference note</option>
              <option value="pack-tactics">Pack Tactics</option>
              <option value="swarm">Swarm Damage</option>
              <option value="defense">Defense Bonus</option>
              <option value="resource-regain">Regain Use</option>
            </select>
          </div>
          <input value={featureForm.name} onChange={(e) => setFeatureForm({ ...featureForm, name: e.target.value })} aria-label="Feature name" />
          <textarea value={featureForm.description} onChange={(e) => setFeatureForm({ ...featureForm, description: e.target.value })} aria-label="Description" placeholder="Reference text" />
        </div>
        <button
          type="button"
          className={styles.addBtn}
          onClick={() => {
            if (!featureForm.name.trim()) return;
            addFeatureOrTrait(definition.id, featureForm);
            setFeatureForm({ ...featureForm, name: "", description: "", effectPreset: "none" });
          }}
        >
          <Plus size={14} /> Add feature / trait
        </button>
        <EditableItemList items={items.features} definitionId={definition.id} onRemove={removeDefinitionItem} />
      </section>

      <section className={styles.section}>
        <h3>Automation readiness</h3>
        <div className={styles.grid}>
          <div className={styles.field}>Full<strong style={{ fontSize: 14, color: "var(--ui-text)" }}>{counts.full ?? 0}</strong></div>
          <div className={styles.field}>Partial<strong style={{ fontSize: 14, color: "var(--ui-text)" }}>{counts.partial ?? 0}</strong></div>
          <div className={styles.field}>Reference<strong style={{ fontSize: 14, color: "var(--ui-text)" }}>{counts["manual-only"] ?? 0}</strong></div>
          <div className={styles.field}>Unsupported<strong style={{ fontSize: 14, color: "var(--ui-text)" }}>{counts.unsupported ?? 0}</strong></div>
        </div>
        <p className={styles.note} style={{ marginTop: 8 }}>
          <span>Only fully-automated content is used by simulation.</span>
          <span>Reference-only and unsupported items stay on the sheet for manual play.</span>
        </p>
      </section>
    </div>
  );
}
