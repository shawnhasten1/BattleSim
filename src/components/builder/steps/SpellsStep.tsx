"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  NO_FILTERS,
  nextOpenSpellSlot,
  spellFacts,
  spellGroups,
  spellSlotKey,
  withChoice,
  yourSpells,
  type ChoiceSlot,
  type SpellFilters
} from "@/lib/character-builder";
import { useBuilder } from "../builder-context";
import { Panel, StepHeading } from "../parts";
import { SpellFilterBar, SpellGrid, YourSpellsList } from "../pickers/SpellGrid";
import styles from "../builder.module.css";

/**
 * Spells (CHARACTER_BUILDER_UX_PLAN.md D4, §3.4): "Your spells" and the shared filters, then every spell choice's grid,
 * grouped by what asks for it. Finished grids fold to a line; one grid is open at a time unless more are opened, and
 * finishing one opens the next still open.
 */
export function SpellsStep() {
  const { build, built, sources, filter, set, spellFocus } = useBuilder();
  const slots = useMemo(() => built.choices.filter((slot) => slot.spec.kind === "spells"), [built]);
  const groups = useMemo(() => spellGroups(build, built, sources), [build, built, sources]);
  const listed = useMemo(() => yourSpells(build, built, sources), [build, built, sources]);
  const [filters, setFilters] = useState<SpellFilters>(NO_FILTERS);
  const [open, setOpen] = useState<Set<string>>(() => {
    const first = spellFocus?.key ?? (nextOpenSpellSlot(slots) ? spellSlotKey(nextOpenSpellSlot(slots)!) : undefined);
    return new Set(first ? [first] : []);
  });
  const [tucked, setTucked] = useState<Set<string>>(new Set());
  const [scrollTo, setScrollTo] = useState<string | undefined>(spellFocus?.key);
  const refs = useRef(new Map<string, HTMLDivElement>());

  // Opened from elsewhere (a level's line in Class, a name in "Your spells").
  useEffect(() => {
    if (!spellFocus) return;
    setOpen((current) => new Set([...current, spellFocus.key]));
    setScrollTo(spellFocus.key);
  }, [spellFocus]);
  useEffect(() => {
    if (!scrollTo) return;
    // Smoothly, unless motion is reduced.
    const still = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    refs.current.get(scrollTo)?.scrollIntoView?.({ block: "start", behavior: still ? "auto" : "smooth" });
    setScrollTo(undefined);
  }, [scrollTo]);

  const schools = useMemo(() => {
    const found = new Set<string>();
    for (const slot of slots) for (const option of slot.options) {
      const school = spellFacts(option.id, sources)?.school;
      if (school) found.add(school);
    }
    return [...found].sort();
  }, [slots, sources]);

  const toggleOpen = (key: string, next: boolean) => setOpen((current) => {
    const copy = new Set(current);
    if (next) copy.add(key);
    else copy.delete(key);
    return copy;
  });
  const openOne = (key: string) => {
    toggleOpen(key, true);
    setScrollTo(key);
  };

  function change(slot: ChoiceSlot, value: unknown) {
    const key = spellSlotKey(slot);
    const count = Array.isArray(value) ? value.length : 0;
    set(withChoice(build, slot.scope, slot.path, value as never, slot.spec));
    // Finished: it folds, and the next open grid opens and comes into view.
    if (slot.pending && count >= slot.count) {
      const next = nextOpenSpellSlot(slots, key);
      setOpen((current) => {
        const copy = new Set(current);
        copy.delete(key);
        if (next) copy.add(spellSlotKey(next));
        return copy;
      });
      if (next) setScrollTo(spellSlotKey(next));
    }
  }

  const pending = slots.filter((slot) => slot.pending).length;
  const nextOpen = nextOpenSpellSlot(slots);
  const fromBook = (slot: ChoiceSlot) => slot.spec.kind === "spells" && slot.spec.what === "prepared" && slot.scope.kind === "level"
    && Boolean(sources.catalog.classes.find((entry) => entry.id === build.levels[(slot.scope as { index: number }).index]?.classId)?.spellcasting?.spellbook);

  if (!slots.length) {
    return (
      <div className={styles.stepBody}>
        <Panel label="Spells"><StepHeading icon="star">Spells</StepHeading><p className={styles.dim}>No spells to choose.</p></Panel>
      </div>
    );
  }
  return (
    <div className={styles.stepBody}>
      <Panel label="Your spells">
        <StepHeading
          icon="star"
          aside={<span className={styles.dim}>P prepared · ✓ always prepared · click one to open its grid</span>}
        >
          Your spells
        </StepHeading>
        <YourSpellsList levels={listed} sources={sources} onOpen={openOne} />
        <SpellFilterBar filters={filters} onChange={setFilters} schools={schools} />
        {pending ? (
          <p className={styles.gridHidden}>
            {pending} {pending === 1 ? "choice" : "choices"} still open.{" "}
            {nextOpen ? <button type="button" className={styles.linkButton} onClick={() => openOne(spellSlotKey(nextOpen))}>Next open choice ›</button> : null}
          </p>
        ) : null}
      </Panel>
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label} className={styles.spellGroup}>
          <p className={styles.spellGroupLabel}>{group.label}</p>
          {group.slots.map((slot) => {
            const key = spellSlotKey(slot);
            return (
              <SpellGrid
                key={key}
                ref={(node) => { if (node) refs.current.set(key, node); else refs.current.delete(key); }}
                slot={slot} open={open.has(key)} onOpen={(next) => toggleOpen(key, next)}
                filters={filters} onClearFilters={() => setFilters(NO_FILTERS)}
                onChange={(value) => change(slot, value)}
                sources={sources} edition={filter} fromBook={fromBook(slot)}
                showTucked={tucked.has(key)}
                onShowTucked={(shown) => setTucked((current) => {
                  const copy = new Set(current);
                  if (shown) copy.add(key);
                  else copy.delete(key);
                  return copy;
                })}
              />
            );
          })}
        </section>
      ))}
    </div>
  );
}
