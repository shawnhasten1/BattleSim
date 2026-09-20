"use client";

import type { DamageAdjustment, DamageType } from "@/engine";
import styles from "./builders.module.css";

export const DAMAGE_TYPES: DamageType[] = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic",
  "piercing", "poison", "psychic", "radiant", "slashing", "thunder"
];

type Material = NonNullable<DamageAdjustment["exceptMaterials"]>[number];
const MATERIALS: Material[] = ["silvered", "adamantine"];

/**
 * Several damage types that share one adjustment: "resistance to bludgeoning, piercing and slashing from
 * nonmagical attacks that aren't silvered". Stored flat as one `DamageAdjustment` per type.
 */
export interface AdjustmentGroup {
  type: DamageAdjustment["type"];
  damageTypes: DamageType[];
  nonMagicalOnly?: boolean;
  exceptMaterials?: Material[];
}

const keyOf = (adjustment: DamageAdjustment) =>
  `${adjustment.type}|${adjustment.nonMagicalOnly ? 1 : 0}|${[...(adjustment.exceptMaterials ?? [])].sort().join(",")}`;

export function groupAdjustments(adjustments: DamageAdjustment[]): AdjustmentGroup[] {
  const groups = new Map<string, AdjustmentGroup>();
  for (const adjustment of adjustments) {
    const key = keyOf(adjustment);
    const group = groups.get(key);
    if (group) {
      group.damageTypes.push(adjustment.damageType);
    } else {
      groups.set(key, {
        type: adjustment.type,
        damageTypes: [adjustment.damageType],
        nonMagicalOnly: adjustment.nonMagicalOnly,
        exceptMaterials: adjustment.exceptMaterials
      });
    }
  }
  return [...groups.values()];
}

export function flattenGroups(groups: AdjustmentGroup[]): DamageAdjustment[] {
  return groups.flatMap((group) => group.damageTypes.map((damageType): DamageAdjustment => ({
    type: group.type,
    damageType,
    ...(group.nonMagicalOnly ? { nonMagicalOnly: true } : {}),
    ...(group.nonMagicalOnly && group.exceptMaterials?.length ? { exceptMaterials: group.exceptMaterials } : {})
  })));
}

const TYPE_LABELS: Array<[DamageAdjustment["type"], string]> = [
  ["resistance", "Resistance"], ["immunity", "Immunity"], ["vulnerability", "Vulnerability"], ["absorb", "Absorbs (heals instead)"]
];

/** One group of damage types sharing an adjustment. Used by the feature effect editor and the Stats tab. */
export function AdjustmentGroupEditor({ group, onChange }: { group: AdjustmentGroup; onChange: (next: AdjustmentGroup) => void }) {
  const selected = new Set(group.damageTypes);
  const materials = new Set(group.exceptMaterials ?? []);
  return (
    <>
      <div className={styles.riderRow}>
        <select aria-label="Adjustment" value={group.type} onChange={(e) => onChange({ ...group, type: e.target.value as DamageAdjustment["type"] })}>
          {TYPE_LABELS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <label className={styles.fieldInlineLabel}>
          <input
            type="checkbox"
            checked={Boolean(group.nonMagicalOnly)}
            onChange={(e) => onChange({ ...group, nonMagicalOnly: e.target.checked ? true : undefined, exceptMaterials: e.target.checked ? group.exceptMaterials : undefined })}
          />
          non-magical only
        </label>
        {group.nonMagicalOnly ? MATERIALS.map((material) => (
          <label key={material} className={styles.fieldInlineLabel}>
            <input
              type="checkbox"
              checked={materials.has(material)}
              onChange={(e) => {
                const next = new Set(materials);
                e.target.checked ? next.add(material) : next.delete(material);
                onChange({ ...group, exceptMaterials: next.size ? [...next] : undefined });
              }}
            />
            not {material}
          </label>
        )) : null}
        <button type="button" onClick={() => onChange({ ...group, damageTypes: [...DAMAGE_TYPES] })}>All</button>
        <button type="button" onClick={() => onChange({ ...group, damageTypes: DAMAGE_TYPES.filter((t) => t !== "psychic") })}>All but psychic</button>
      </div>
      <div className={styles.chips}>
        {DAMAGE_TYPES.map((t) => (
          <button
            key={t} type="button"
            className={selected.has(t) ? styles.chipOn : undefined}
            onClick={() => {
              const next = new Set(selected);
              next.has(t) ? next.delete(t) : next.add(t);
              onChange({ ...group, damageTypes: DAMAGE_TYPES.filter((candidate) => next.has(candidate)) });
            }}
          >
            {t}
          </button>
        ))}
      </div>
    </>
  );
}
