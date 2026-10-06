"use client";

import { ChevronRight, CornerDownLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import type { FeatureEffect } from "@/engine";
import {
  COMMON,
  EFFECT_KINDS,
  EFFECT_SPECS,
  GROUPS,
  bestOf,
  searchEffects,
  type EffectExample,
  type EffectGroup,
  type EffectKindSpec,
  type EffectOwner
} from "@/lib/ability-editor/effects";
import styles from "./ability-editor.module.css";

export interface EffectPickerProps {
  /** Whether a kind can be added here (a mark only on a condition, an extra action only on an activation). */
  offered: (spec: EffectKindSpec) => boolean;
  /** What the effects belong to: the Common row's effects. */
  owner: EffectOwner;
  /** Adds what was picked: a kind's blank, or an example's effects, already filled in. */
  onPick: (effects: FeatureEffect[]) => void;
  onClose: () => void;
  /** The button that opens it: a click there toggles it, so it isn't a click outside. */
  anchorRef?: RefObject<HTMLElement | null>;
}

const COMMON_TITLES: Record<EffectOwner, string> = {
  item: "Common on an item",
  buff: "Common while it lasts",
  feature: "Common on a trait or feature"
};

/**
 * The Add effect picker (EFFECTS_PLAN.md, Phase 0): a search over every kind's name, hint, keywords and filled-in
 * examples; without one, the usual effects for what's being edited and the kinds in folds by what they change.
 */
export function EffectPicker({ offered, owner, onPick, onClose, anchorRef }: EffectPickerProps) {
  const [query, setQuery] = useState("");
  const [openGroup, setOpenGroup] = useState<EffectGroup | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const searching = query.trim().length > 0;
  const results = useMemo(() => (searching ? searchEffects(query, offered) : []), [query, searching, offered]);
  const top = results[0] ? bestOf(results[0]) : undefined;

  // The latest onClose, so opening runs once (a new handler each render would take focus back to the search).
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  useEffect(() => {
    searchRef.current?.focus();
    // A click anywhere else closes it.
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !anchorRef?.current?.contains(target)) closeRef.current();
    }
    // The picker's own document: a popped-out sheet's, or the main one.
    const doc = rootRef.current?.ownerDocument ?? document;
    doc.addEventListener("pointerdown", onPointerDown, true);
    return () => doc.removeEventListener("pointerdown", onPointerDown, true);
  }, [anchorRef]);

  const pickKind = (spec: EffectKindSpec) => onPick([spec.blank()]);
  const pickExample = (example: EffectExample) => onPick(example.effects());

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      // The first Escape clears a search; the next closes.
      if (searching) {
        setQuery("");
        searchRef.current?.focus();
      } else {
        onClose();
      }
      return;
    }
    if (event.key === "Enter" && event.target === searchRef.current) {
      event.preventDefault();
      if (results[0] && top) {
        if (top.example) pickExample(top.example);
        else pickKind(results[0].spec);
      }
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const items = [...(rootRef.current?.querySelectorAll<HTMLElement>("input, button") ?? [])];
    const at = items.indexOf(event.currentTarget.ownerDocument.activeElement as HTMLElement);
    items[(at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  }

  const common = COMMON[owner].map((kind) => EFFECT_SPECS[kind]).filter((spec) => spec && offered(spec));
  return (
    <div ref={rootRef} className={styles.picker} role="dialog" aria-label="Add effect" onKeyDown={onKeyDown}>
      <input
        ref={searchRef} type="search" className={styles.pickerSearch} aria-label="Search effects" value={query}
        placeholder="Search: speed, resistance, advantage, regenerates…" onChange={(event) => setQuery(event.target.value)}
      />
      {searching ? (
        results.length ? (
          <div className={styles.pickerList} role="group" aria-label="Results">
            {results.map((result, index) => (
              <KindEntry
                key={result.spec.kind} spec={result.spec} examples={result.examples.map((entry) => entry.example)}
                top={index === 0 ? (top?.example ?? "kind") : undefined} onKind={pickKind} onExample={pickExample}
              />
            ))}
          </div>
        ) : (
          <div className={styles.pickerEmpty} role="status">
            <p>Nothing here matches “{query.trim()}”.</p>
            <p>
              The simulator may not run that yet. Describe it in <strong>Notes &amp; AI</strong>; if the ability can&apos;t work
              without it, set <strong>The simulator</strong> to <strong>Reference only</strong> there, so the DM resolves it by hand.
            </p>
          </div>
        )
      ) : (
        <>
          {common.length ? (
            <div className={styles.pickerCommon} role="group" aria-label={COMMON_TITLES[owner]}>
              <span className={styles.menuGroupTitle} aria-hidden>{COMMON_TITLES[owner]}</span>
              <div className={styles.pickerChips}>
                {common.map((spec) => (
                  <button key={spec.kind} type="button" title={`${spec.label}: ${spec.hint}`} onClick={() => pickKind(spec)}>{spec.short ?? spec.label}</button>
                ))}
              </div>
            </div>
          ) : null}
          {GROUPS.map(({ group, label }) => {
            const kinds = EFFECT_KINDS.filter((spec) => spec.group === group && offered(spec));
            if (!kinds.length) return null;
            const open = openGroup === group;
            return (
              <div key={group} className={styles.pickerFold}>
                <button type="button" className={styles.pickerFoldHead} aria-expanded={open} onClick={() => setOpenGroup(open ? null : group)}>
                  <ChevronRight size={12} className={styles.pickerChevron} aria-hidden />
                  {label}
                  <span className={styles.pickerCount} aria-label={`${kinds.length} effects`}>{kinds.length}</span>
                </button>
                {open ? (
                  <div className={styles.pickerList} role="group" aria-label={label}>
                    {kinds.map((spec) => <KindEntry key={spec.kind} spec={spec} examples={spec.examples ?? []} onKind={pickKind} onExample={pickExample} />)}
                  </div>
                ) : null}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

/** A kind's row and its examples under it ("Start from: Pack Tactics, Reckless Attack"). `top` marks what Enter adds. */
function KindEntry({ spec, examples, top, onKind, onExample }: {
  spec: EffectKindSpec;
  examples: EffectExample[];
  top?: "kind" | EffectExample;
  onKind: (spec: EffectKindSpec) => void;
  onExample: (example: EffectExample) => void;
}) {
  const enter = <CornerDownLeft size={11} className={styles.pickerEnter} aria-hidden />;
  return (
    <div className={styles.pickerEntry}>
      <button type="button" className={`${styles.pickerKind} ${top === "kind" ? styles.pickerTop : ""}`} onClick={() => onKind(spec)}>
        <span className={styles.pickerKindLabel}>{spec.label}{top === "kind" ? enter : null}</span>
        <span>{spec.hint}</span>
      </button>
      {examples.length ? (
        <div className={styles.pickerExamples}>
          <span className={styles.pickerExamplesTitle} aria-hidden>Start from:</span>
          {examples.map((example) => (
            <button
              key={example.label} type="button" title={example.hint}
              className={`${styles.pickerExample} ${top === example ? styles.pickerTop : ""}`} onClick={() => onExample(example)}
            >
              {example.label}{top === example ? enter : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
