"use client";

import type { BuilderDraft } from "./field-spec";
import { BuilderForm } from "./BuilderForm";
import { actionFieldSchema, blankGrantedDraft } from "./schemas";
import styles from "./builders.module.css";

/** List editor for a weapon/focus's `grantedActions` — independent spells/effects it lets the wielder cast, each with its own timing and (optional) charge cost. Each card reuses the same attack/save/area/healing shape editor spells use. */
export function GrantedActionEditor({
  value, onChange, chargesEnabled
}: { value: BuilderDraft[]; onChange: (next: BuilderDraft[]) => void; chargesEnabled: boolean }) {
  const drafts = value ?? [];
  const replace = (index: number, next: BuilderDraft) => onChange(drafts.map((draft, i) => (i === index ? next : draft)));
  const remove = (index: number) => onChange(drafts.filter((_, i) => i !== index));

  return (
    <div className={styles.riderList}>
      {drafts.map((draft, index) => (
        <div key={index} className={styles.riderCard}>
          <div className={styles.riderHead}>
            <span>Granted action {index + 1}</span>
            {chargesEnabled ? (
              <label className={styles.fieldInlineLabel}>
                Charges (0 = at-will)
                <input
                  type="number" min={0} step={1} style={{ width: 64 }}
                  value={Number(draft.chargeCost) || 0}
                  onChange={(e) => replace(index, { ...draft, chargeCost: Math.max(0, Number(e.target.value) || 0) })}
                />
              </label>
            ) : null}
            <button type="button" className={styles.riderRemove} onClick={() => remove(index)} aria-label="Remove granted action">×</button>
          </div>
          <BuilderForm
            specs={actionFieldSchema(draft)}
            draft={draft}
            mode="simple"
            onChange={(key, next) => replace(index, { ...draft, [key]: next })}
          />
        </div>
      ))}
      <button type="button" className={styles.riderAdd} onClick={() => onChange([...drafts, blankGrantedDraft()])}>
        + Add granted spell / action
      </button>
    </div>
  );
}
