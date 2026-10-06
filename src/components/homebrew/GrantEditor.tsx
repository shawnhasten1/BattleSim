"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";
import type { FeatureDefinition } from "@/engine";
import { blankFeature, scalablePaths, type FeatureGrant, type FreeCast, type GrantAdjust } from "@/lib/character-builder";
import { AbilityChecks, NumberField, SpellPicker, TemplateField, useHomebrew } from "./controls";
import styles from "./homebrew.module.css";

const SUPPORT_LABELS: Record<FeatureDefinition["automationSupport"], string> = {
  full: "Simulated",
  partial: "Partly simulated",
  "manual-only": "Reference only",
  unsupported: "Not simulated"
};

/** A template or number as typed: a number when it's only digits. */
const asTemplate = (text: string): string | number => (/^-?\d+$/.test(text.trim()) ? Number(text) : text);

/** Drops keys whose value is undefined or an empty list or object, so the saved grant stays as small as the SRD's. */
function pruned<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined
    && !(Array.isArray(v) && v.length === 0)
    && !(v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0))) as T;
}

/**
 * One grant of a level (or a pick's option): its feature, opened in the ability editor, and what it does besides: numbers
 * that follow the table, a pool, a feature it replaces, adjustments, spells and free casts.
 */
export function GrantEditor({ grant, level, earlierKeys, inOption, onChange, onRemove }: {
  grant: FeatureGrant;
  /** The level it's granted at: the ability editor previews the class built to it. */
  level: number;
  /** Keys of the entry's other grants: what it can replace. */
  earlierKeys: string[];
  /** Inside a pick's option: it can wait for a later class level (`atLevel`). */
  inOption?: boolean;
  onChange: (next: FeatureGrant) => void;
  onRemove: () => void;
}) {
  const { library, editFeature } = useHomebrew();
  const [open, setOpen] = useState(false);
  const libraryFeature = typeof grant.feature === "string" ? library.feature(grant.feature) : undefined;
  const feature = typeof grant.feature === "string" ? libraryFeature : grant.feature;
  const title = feature?.name ?? (typeof grant.feature === "string" ? grant.feature : "Adjustments only");
  const paths = feature ? scalablePaths(feature) : [];
  const set = (patch: Partial<FeatureGrant>) => onChange(pruned({ ...grant, ...patch }));
  const setAdjust = (patch: Partial<GrantAdjust>) => {
    const adjust = pruned({ ...(grant.adjust ?? {}), ...patch });
    set({ adjust: Object.keys(adjust).length ? adjust : undefined });
  };

  function edit() {
    // A library feature is copied into the grant to be edited: it's this class's own from then on.
    const record = feature ? structuredClone(feature) : blankFeature("New feature", grant.key);
    editFeature(record, level, !feature, (next, pools) => {
      const [poolId, size] = Object.entries(pools)[0] ?? [];
      set({ feature: next, ...(poolId && !grant.pool ? { pool: { id: poolId, size: size! } } : {}) });
    });
  }

  return (
    <div className={styles.card} role="group" aria-label={`Feature ${title}`}>
      <div className={styles.cardHead}>
        <button type="button" className={styles.link} onClick={() => setOpen(!open)} aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} ${title}'s details`}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <span className={styles.cardTitle}>{title}</span>
        {feature ? <span className={styles.badge}>{SUPPORT_LABELS[feature.automationSupport]}{libraryFeature ? " · library" : ""}</span> : null}
        <button type="button" className={styles.btn} onClick={edit}><Pencil size={12} /> {feature ? "Edit" : "Add a feature"}</button>
        <button type="button" className={`${styles.btn} ${styles.danger}`} onClick={onRemove} aria-label={`Remove ${title}`}><Trash2 size={12} /></button>
      </div>
      {open ? (
        <>
          <div className={styles.row}>
            <label className={styles.field}>
              Key
              <input value={grant.key} onChange={(event) => set({ key: event.target.value.replace(/[^a-z0-9-]/gi, "-").toLowerCase() })} aria-label="Key" />
            </label>
            <label className={styles.field}>
              Replaces
              <select value={grant.replaces ?? ""} onChange={(event) => set({ replaces: event.target.value || undefined })} aria-label="Replaces">
                <option value="">Nothing</option>
                {earlierKeys.filter((key) => key !== grant.key).map((key) => <option key={key} value={key}>{key}</option>)}
              </select>
            </label>
            {inOption ? <NumberField label="From class level" value={grant.atLevel} min={1} max={20} onChange={(atLevel) => set({ atLevel })} /> : null}
          </div>

          <ScaleList grant={grant} paths={paths} onChange={(scale) => set({ scale })} />

          <div className={styles.row}>
            <label className={styles.check}>
              <input type="checkbox" checked={Boolean(grant.pool)} onChange={(event) => set({ pool: event.target.checked ? { id: grant.key, size: 1 } : undefined })} />
              A pool of uses
            </label>
            {grant.pool ? (
              <>
                <label className={styles.field}>
                  Pool id
                  <input value={grant.pool.id} onChange={(event) => set({ pool: { ...grant.pool!, id: event.target.value } })} aria-label="Pool id" />
                </label>
                <TemplateField label="Pool size" value={String(grant.pool.size)} onChange={(size) => set({ pool: { ...grant.pool!, size: asTemplate(size) } })} />
              </>
            ) : null}
          </div>

          <div className={styles.row}>
            <TemplateField label="Speed +" value={grant.adjust?.speed === undefined ? "" : String(grant.adjust.speed)} onChange={(text) => setAdjust({ speed: text.trim() ? asTemplate(text) : undefined })} />
            <TemplateField label="Max HP +" value={grant.adjust?.hpBonus === undefined ? "" : String(grant.adjust.hpBonus)} onChange={(text) => setAdjust({ hpBonus: text.trim() ? asTemplate(text) : undefined })} />
            <NumberField
              label="Darkvision" value={grant.adjust?.senses?.darkvision}
              onChange={(darkvision) => setAdjust({ senses: darkvision ? { ...(grant.adjust?.senses ?? {}), darkvision } : pruned({ ...(grant.adjust?.senses ?? {}), darkvision: undefined }) })}
            />
          </div>
          <AbilityChecks
            label="Saving throw proficiencies it adds"
            value={Array.isArray(grant.adjust?.saves) ? grant.adjust.saves : []}
            onChange={(saves) => setAdjust({ saves: saves.length ? saves : undefined })}
          />
          <SpellPicker label="Spells always prepared" value={grant.spells ?? []} onChange={(spells) => set({ spells })} />
          <FreeCastList value={grant.freeCasts ?? []} onChange={(freeCasts) => set({ freeCasts })} />
        </>
      ) : null}
    </div>
  );
}

/** "This number follows a column": a path in the feature and the template that sets it. */
function ScaleList({ grant, paths, onChange }: { grant: FeatureGrant; paths: Array<{ path: string; value: string | number }>; onChange: (scale: FeatureGrant["scale"]) => void }) {
  const { columns } = useHomebrew();
  const scale = grant.scale ?? [];
  const firstColumn = columns[0] ? `{col:${columns[0].id}}` : "{level}";
  return (
    <div className={styles.field} role="group" aria-label="Numbers that follow the table">
      <span>Numbers that follow the table</span>
      {scale.map((binding, index) => (
        <div key={index} className={styles.row}>
          <label className={styles.field}>
            Number
            <select
              aria-label="Number to scale" value={binding.path}
              onChange={(event) => onChange(scale.map((b, i) => (i === index ? { ...b, path: event.target.value } : b)))}
            >
              {paths.some((path) => path.path === binding.path) ? null : <option value={binding.path}>{binding.path}</option>}
              {paths.map((path) => <option key={path.path} value={path.path}>{`${path.path} (now ${path.value})`}</option>)}
            </select>
          </label>
          <TemplateField label="Becomes" value={binding.value} onChange={(value) => onChange(scale.map((b, i) => (i === index ? { ...b, value } : b)))} />
          <button type="button" className={`${styles.btn} ${styles.danger}`} aria-label="Remove this scaling" onClick={() => onChange(scale.filter((_, i) => i !== index))}>
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      {paths.length ? (
        <button type="button" className={styles.link} onClick={() => onChange([...scale, { path: paths[0]!.path, value: firstColumn }])}>+ Follow a column</button>
      ) : <span className={styles.dim}>Its feature has no numbers or dice to scale yet.</span>}
    </div>
  );
}

/** Spells it can cast without a slot: each a spell and its uses (a number, a template, or at will). */
function FreeCastList({ value, onChange }: { value: FreeCast[]; onChange: (next: FreeCast[]) => void }) {
  const { library } = useHomebrew();
  return (
    <div className={styles.field} role="group" aria-label="Free casts">
      <span>Cast without a slot</span>
      {value.map((cast, index) => (
        <div key={`${cast.spell}-${index}`} className={styles.row}>
          <span>{library.spell?.(cast.spell)?.name ?? cast.spell}</span>
          <label className={styles.field}>
            Uses
            <input
              aria-label={`Uses of ${library.spell?.(cast.spell)?.name ?? cast.spell}`} value={String(cast.uses)}
              onChange={(event) => onChange(value.map((c, i) => (i === index ? { ...c, uses: event.target.value === "at-will" ? "at-will" : asTemplate(event.target.value) } : c)))}
            />
          </label>
          <button type="button" className={`${styles.btn} ${styles.danger}`} aria-label="Remove this free cast" onClick={() => onChange(value.filter((_, i) => i !== index))}>
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <SpellPicker label="Add a free cast" value={[]} onChange={(spells) => onChange([...value, ...spells.map((spell) => ({ spell, uses: 1 }))])} />
    </div>
  );
}
