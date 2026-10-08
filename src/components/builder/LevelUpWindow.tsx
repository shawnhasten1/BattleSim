"use client";

import { useMemo, useState } from "react";
import {
  buildCharacter,
  buildLabel,
  describeClass,
  describeFeature,
  multiclassProblems,
  NO_FILTERS,
  nextOpenSpellSlot,
  orderedChanges,
  otherEditionTwin,
  readBuild,
  rebuildActor,
  spellSlotKey,
  storedChoice,
  timeline,
  withChoice,
  withHitDieRoll,
  withLevelUp,
  withSuggestions,
  type CharacterBuild,
  type ChoiceSlot
} from "@/lib/character-builder";
import type { BuildSources } from "@/lib/character-builder/build";
import { formatBonus } from "@/lib/ui-helpers";
import { builderIconUrl } from "@/data/srd/tokens";
import { CodexBanner, CodexRoot, LEVEL_VALUE_CLASS, LevelDial } from "@/components/codex-ui";
import { RulesCardProvider } from "@/components/rules-card";
import { EditionFilter } from "@/components/ui/Edition";
import { FloatingWindow } from "@/components/ui/FloatingWindow";
import { useEditionFilter } from "@/hooks/useEditionFilter";
import { useEncounterStore } from "@/store/encounter-store";
import { rememberStyle, storedStyle, useSheetWindowsStore, type SheetStyle } from "@/store/sheet-windows-store";
import { BuilderContext, useBuilder, type BuilderModel } from "./builder-context";
import { catalogGroups } from "./CatalogSelect";
import { choiceTitle } from "./ChoiceControl";
import { BESIDE_SHEET } from "./CharacterBuilder";
import { MissingCatalogNotice, useBuilderSources } from "./CatalogGate";
import { LookSwitch } from "./LookSwitch";
import { Shortcuts } from "./Shortcuts";
import { FeatureRow, Panel, StepHeading } from "./parts";
import { CardGrid, type CardOption } from "./pickers/CardGrid";
import { InlineChoice } from "./pickers/InlineChoice";
import { SpellGrid } from "./pickers/SpellGrid";
import { ChangeList } from "./steps/ReviewStep";
import styles from "./builder.module.css";

const ABBR = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" } as const;
const WIDTH = 780;

/** A die rolled for someone without dice: the browser's randomness (it's the UI, not the simulation). */
function rollDie(die: number): number {
  const buffer = new Uint32Array(1);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(buffer);
  else buffer[0] = Math.floor(Math.random() * 2 ** 32);
  return 1 + (buffer[0]! % die);
}

/**
 * Level up (CHARACTER_BUILDER_UX_PLAN.md §4, D12): a moment, in either look. The level turns from N to N+1; the class to
 * level is a row of cards (multiclass options with their prerequisites); "You gain" lists the new features and what got
 * bigger; the hit points it adds; then this level's choices, already filled in with the builder's suggestions (spells in
 * the §3.4 grids); and what applying changes, folded. Applying is one undo step.
 */
export function LevelUpWindow({ definitionId, onClose }: { definitionId: string; onClose: () => void }) {
  const definition = useEncounterStore((s) => s.encounter.definitions.find((entry) => entry.id === definitionId));
  const { sources, missing, loading } = useBuilderSources(readBuild(definition));
  if (missing.length) return <MissingCatalogNotice title="Level up" missing={missing} loading={loading} onClose={onClose} initialPosition={BESIDE_SHEET} />;
  return <LevelUpBody definitionId={definitionId} onClose={onClose} sources={sources} />;
}

/** Beside the sheet, as far as the screen allows. */
function firstPlace() {
  if (typeof window === "undefined") return { x: BESIDE_SHEET.x, y: BESIDE_SHEET.y, height: 760 };
  return {
    x: Math.max(16, Math.min(BESIDE_SHEET.x, window.innerWidth - WIDTH - 16)),
    y: BESIDE_SHEET.y,
    height: Math.min(780, window.innerHeight - BESIDE_SHEET.y - 24)
  };
}

function LevelUpBody({ definitionId, onClose, sources }: { definitionId: string; onClose: () => void; sources: BuildSources }) {
  const definition = useEncounterStore((s) => s.encounter.definitions.find((entry) => entry.id === definitionId));
  const rebuildCharacter = useEncounterStore((s) => s.rebuildCharacter);
  const saved = readBuild(definition);
  const [draft, setDraft] = useState<CharacterBuild | undefined>(() => (saved && saved.levels.length < 20 ? withSuggestions(withLevelUp(saved), sources) : undefined));
  const [update, setUpdate] = useState<string[]>([]);
  const [filter, setFilter] = useEditionFilter("level-up", saved?.edition);
  const [look, setLook] = useState<SheetStyle>(() => storedStyle("pc"));
  const palette = useSheetWindowsStore((s) => s.palette);
  const setPalette = useSheetWindowsStore((s) => s.setPalette);
  const [place] = useState(firstPlace);
  const built = useMemo(() => (draft ? buildCharacter(draft, sources) : undefined), [draft, sources]);
  const preview = useMemo(() => (draft && definition ? rebuildActor(definition, draft, sources) : undefined), [draft, definition, sources]);

  if (!definition || !saved || !draft || !built || !preview) {
    return (
      <FloatingWindow title="Level up" onClose={onClose} width={420} storageKey="level-up" initialPosition={BESIDE_SHEET}>
        <p className={styles.dim}>{saved && saved.levels.length >= 20 ? "This character is already 20th level." : "This actor wasn't made with the character builder."}</p>
      </FloatingWindow>
    );
  }

  const chooseLook = (next: SheetStyle) => {
    setLook(next);
    rememberStyle("pc", next);
  };
  const model: BuilderModel = {
    build: draft, set: setDraft, built, preview, sources, filter, edition: saved.edition, creating: false, adopting: false, definition, look,
    go: () => undefined, openSpells: () => undefined, spellFocus: null
  };
  const level = draft.levels.length;
  const classId = draft.levels[level - 1]!.classId;
  const classLevel = draft.levels.filter((entry) => entry.classId === classId).length;
  const className = sources.catalog.classes.find((entry) => entry.id === classId)?.name ?? "";
  const target = `${className} ${classLevel}`;
  const open = built.choices.filter((slot) => slot.pending).length;

  const header = look === "codex" ? (
    <CodexBanner label="Level up" className={styles.banner}>
      <div className={styles.headerTitle}>
        <span className={styles.headerName}>{definition.name}</span>
        <span className={styles.levelUpFrom}>{buildLabel(saved, sources)} <strong>→ {target}</strong></span>
        <EditionFilter value={filter} onChange={setFilter} label="Rules shown" />
      </div>
      <div className={styles.levelUpDials} role="img" aria-label={`Level ${level - 1} to level ${level}`}>
        <span className={styles.levelUpOld} aria-hidden="true">{level - 1}</span>
        <span className={styles.levelUpArrow} aria-hidden="true">→</span>
        <LevelDial label="Level" className={styles.levelUpNew}>
          <output className={LEVEL_VALUE_CLASS}>{level}</output>
        </LevelDial>
      </div>
    </CodexBanner>
  ) : (
    <header className={styles.standardHeader} aria-label="Level up">
      <div className={styles.headerTitle}>
        <span className={styles.headerName}>{definition.name}</span>
        <span className={styles.levelUpFrom}>{buildLabel(saved, sources)} <strong>→ {target}</strong></span>
      </div>
      <div className={styles.headerSide}>
        <EditionFilter value={filter} onChange={setFilter} label="Rules shown" />
      </div>
      <strong className={styles.levelUpStandard} role="img" aria-label={`Level ${level - 1} to level ${level}`}>
        Level {level - 1} <span>→ {level}</span>
      </strong>
    </header>
  );

  return (
    <FloatingWindow
      title={`Level up · ${definition.name}`} ariaLabel="Level up" onClose={onClose}
      width={WIDTH} initialHeight={place.height} resizable={{ minWidth: 520, minHeight: 420, maxWidth: 1200 }} scrollBody={false}
      storageKey="level-up-window" initialPosition={{ x: place.x, y: place.y }}
      headerExtra={<LookSwitch look={look} onLook={chooseLook} palette={palette} onPalette={setPalette}><Shortcuts /></LookSwitch>}
    >
      <BuilderContext.Provider value={model}>
        <RulesCardProvider palette={look === "codex" ? palette : null}>
          <CodexRoot palette={palette} plain={look !== "codex"} className={styles.frame}>
            <div className={styles.shell} data-look={look}>
              {header}
              <main className={styles.levelUpBody} aria-label="Level up to the next level">
                <ClassToLevel saved={saved} classId={classId} onChoose={(next) => { setDraft(withSuggestions(withLevelUp(saved, next), sources)); setUpdate([]); }} />
                <YouGain />
                <HitPoints />
                <Choices saved={saved} />
                <WhatChanges update={update} onUpdate={setUpdate} />
              </main>
              <footer className={styles.footer}>
                <span className={styles.footerNote}>{open ? `${open} still to choose` : "All made"}</span>
                <button type="button" className={styles.secondary} onClick={onClose}>Cancel</button>
                <button
                  type="button" className={styles.primary}
                  onClick={() => {
                    rebuildCharacter(definitionId, draft, update);
                    onClose();
                  }}
                >
                  Level up to {level}
                </button>
              </footer>
            </div>
          </CodexRoot>
        </RulesCardProvider>
      </BuilderContext.Provider>
    </FloatingWindow>
  );
}

/** Which class gains the level: the classes it has, then (opened) a new one, with what multiclassing needs. */
function ClassToLevel({ saved, classId, onChoose }: { saved: CharacterBuild; classId: string; onChoose: (classId: string) => void }) {
  const { sources, filter } = useBuilder();
  const owned = [...new Set(saved.levels.map((entry) => entry.classId))];
  const [more, setMore] = useState(!owned.includes(classId));
  const prerequisites = multiclassProblems(saved, classId, sources);
  const ownedCards: CardOption[] = owned.map((id) => {
    const entry = sources.catalog.classes.find((candidate) => candidate.id === id);
    const levels = saved.levels.filter((level) => level.classId === id).length;
    return {
      id, title: entry?.name ?? id, badge: entry ? (entry.source.provider === "srd" ? entry.edition : "Homebrew") : undefined, icon: builderIconUrl("class", id),
      lines: [`Level ${levels} → ${levels + 1}`], ...(entry ? { card: () => describeClass(entry) } : {})
    };
  });
  // The edition filter reads the whole list, so a class it has hides its other edition's twin too; then its own go.
  const others = more ? catalogGroups(sources.catalog.classes, filter, classId).map((group) => ({
    label: `${group.label}: a new class (multiclass)`,
    options: group.entries.filter(({ entry }) => !owned.includes(entry.id)).map(({ entry, label }): CardOption => {
      const twin = otherEditionTwin(saved, entry.id, sources);
      // A twin says why it can't be taken (once); another class, what multiclassing into it needs.
      const problems = twin ? [] : multiclassProblems(saved, entry.id, sources);
      return {
        id: entry.id, title: label.replace(/ \((2014|2024|Homebrew|Open5e|Imported)\)$/, ""),
        badge: entry.source.provider === "srd" ? entry.edition : "Homebrew", icon: builderIconUrl("class", entry.id),
        lines: twin ? [] : [problems.length ? problems.join("; ") : `d${entry.hitDie} · ${entry.primaryAbilities.map((ability) => ABBR[ability]).join(entry.primaryAbilityAny ? " or " : ", ")}`],
        ...(twin ? { blocked: twin } : {}),
        card: () => describeClass(entry)
      };
    })
  })).filter((group) => group.options.length) : [];
  return (
    <Panel label="The class">
      <StepHeading
        icon="star"
        aside={<button type="button" className={styles.linkButton} aria-expanded={more} onClick={() => setMore(!more)}>{more ? "Only its classes" : "Multiclass…"}</button>}
      >
        Class to level
      </StepHeading>
      <CardGrid label="Class to level" columns={3} value={classId} groups={[{ label: "Its classes", options: ownedCards }, ...others]} onChange={onChoose} />
      {prerequisites.length ? (
        <p role="note" className={styles.note}>
          Multiclassing needs 13 in each class&apos;s primary ability: {prerequisites.join("; ")}. You can still take it.
        </p>
      ) : null}
    </Panel>
  );
}

/** What the new level gives: its features, with their text, and what got bigger. */
function YouGain() {
  const { build, built, sources, edition } = useBuilder();
  const level = useMemo(() => timeline(build, built, sources).levels.at(-1), [build, built, sources]);
  if (!level) return null;
  const features = [...level.features.filter((entry) => !entry.subclass), ...level.features.filter((entry) => entry.subclass)];
  return (
    <Panel label="You gain">
      <StepHeading icon="star">You gain</StepHeading>
      {features.map((entry) => (
        <FeatureRow
          key={entry.key} name={entry.feature.name} support={entry.support} text={entry.feature.description}
          from={entry.subclass ? entry.owner : undefined}
          card={() => describeFeature(entry.feature, { owner: entry.owner, level: level.level, edition })}
        />
      ))}
      {level.grows.map((grow) => (
        <p key={grow} className={styles.gainRow}><span className={styles.gainMark} aria-hidden="true">▲</span>{grow}</p>
      ))}
      {!features.length && !level.grows.length ? <p className={styles.dim}>No new features at this level: its choices are below.</p> : null}
    </Panel>
  );
}

/** The hit points the level adds: the average, or a roll typed or rolled here. */
function HitPoints() {
  const { build, built, sources, set } = useBuilder();
  const index = build.levels.length - 1;
  const hp = built.breakdown.hitPoints.levels[index];
  const die = hp?.die ?? 8;
  const setRoll = (value: number | undefined) => set(withHitDieRoll(build, index, value, sources));
  return (
    <Panel label="Hit points">
      <StepHeading
        icon="shield"
        aside={<strong className={styles.levelUpHp}>{hp ? `+${hp.gained}` : ""}</strong>}
      >
        Hit points
      </StepHeading>
      <div className={styles.rollRow}>
        <span role="group" aria-label="Hit points this level" className={styles.segmented}>
          {(["average", "rolled"] as const).map((method) => (
            <button key={method} type="button" aria-pressed={build.hp.method === method} onClick={() => set({ ...build, hp: { ...build.hp, method } })}>
              {method === "average" ? "Average" : "Rolled"}
            </button>
          ))}
        </span>
        {build.hp.method === "rolled" ? (
          <>
            <label className={styles.rollField}>
              d{die}
              <input
                type="number" min={1} max={die} aria-label="Hit die roll" placeholder={String(die / 2 + 1)}
                value={build.hp.rolls?.[index - 1] || ""}
                onChange={(event) => setRoll(event.target.value === "" ? undefined : Number(event.target.value) || die / 2 + 1)}
              />
            </label>
            <button type="button" className={styles.secondary} onClick={() => setRoll(rollDie(die))}>Roll d{die}</button>
          </>
        ) : null}
        {hp ? <span className={styles.dim}>{hp.rolled ? `rolled ${hp.roll}` : `${hp.roll} average`}, CON {formatBonus(hp.conMod)}</span> : null}
      </div>
    </Panel>
  );
}

/**
 * This level's choices, and any still open or made again: spells in the §3.4 grids (one open at a time, the next opening
 * when one is done), the rest inline.
 */
function Choices({ saved }: { saved: CharacterBuild }) {
  const { build, built, sources, filter, set } = useBuilder();
  const newIndex = build.levels.length - 1;
  // An earlier choice the level up made again: a spell a new feature now makes always prepared is swapped for another.
  const remade = (slot: ChoiceSlot) =>
    JSON.stringify(storedChoice(saved, slot.scope, slot.path, slot.spec) ?? null) !== JSON.stringify(storedChoice(build, slot.scope, slot.path, slot.spec) ?? null);
  const slots = built.choices.filter((slot) => (slot.scope.kind === "level" && slot.scope.index === newIndex) || slot.pending || remade(slot));
  const spells = slots.filter((slot) => slot.spec.kind === "spells");
  const [open, setOpen] = useState<Set<string>>(() => {
    const first = nextOpenSpellSlot(spells);
    return new Set(first ? [spellSlotKey(first)] : []);
  });
  const [tucked, setTucked] = useState<Set<string>>(new Set());
  const definition = sources.catalog.classes.find((entry) => entry.id === build.levels[newIndex]?.classId);
  const toggle = (set_: Set<string>, key: string, on: boolean) => {
    const copy = new Set(set_);
    if (on) copy.add(key);
    else copy.delete(key);
    return copy;
  };

  function changeSpell(slot: ChoiceSlot, value: unknown) {
    const key = spellSlotKey(slot);
    set(withChoice(build, slot.scope, slot.path, value as never, slot.spec));
    if (slot.pending && Array.isArray(value) && value.length >= slot.count) {
      const next = nextOpenSpellSlot(spells, key);
      setOpen((current) => {
        const copy = toggle(current, key, false);
        return next ? toggle(copy, spellSlotKey(next), true) : copy;
      });
    }
  }

  return (
    <Panel label="Choices">
      <StepHeading icon="star" aside={<span className={styles.dim}>filled with the builder&apos;s suggestions where it can</span>}>
        {slots.length ? "Choose" : "No choices at this level"}
      </StepHeading>
      {slots.some((slot) => !(slot.scope.kind === "level" && slot.scope.index === newIndex) && !slot.pending)
        ? <p className={styles.dim}>An earlier choice is made again: what it had is now given another way.</p>
        : null}
      {slots.map((slot) => {
        const key = spellSlotKey(slot);
        if (slot.spec.kind === "spells") {
          return (
            <SpellGrid
              key={key} slot={slot} open={open.has(key)} onOpen={(on) => setOpen((current) => toggle(current, key, on))}
              filters={NO_FILTERS} onClearFilters={() => undefined} onChange={(value) => changeSpell(slot, value)}
              sources={sources} edition={filter} showTucked={tucked.has(key)} onShowTucked={(shown) => setTucked((current) => toggle(current, key, shown))}
              fromBook={slot.spec.what === "prepared" && slot.scope.kind === "level" && Boolean(definition?.spellcasting?.spellbook)}
            />
          );
        }
        return (
          <InlineChoice
            key={key} slot={slot} title={slot.spec.kind === "subclass" ? definition?.subclassLabel || "Subclass" : choiceTitle(slot)}
            onChange={(value) => set(withChoice(build, slot.scope, slot.path, value, slot.spec))}
          />
        );
      })}
    </Panel>
  );
}

/** What applying changes, folded: the sheet's records the level adds, changes or keeps (the DM's edits). */
function WhatChanges({ update, onUpdate }: { update: string[]; onUpdate: (keys: string[]) => void }) {
  const { preview } = useBuilder();
  const [open, setOpen] = useState(false);
  const changes = orderedChanges(preview.changes).filter((change) => !(change.kind === "field" && (change.key === "field:classes" || change.key === "field:level")));
  return (
    <Panel label="What changes">
      <button type="button" className={styles.foldHead} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className={styles.foldTitle}>What changes</span>
        <span className={styles.dim}>{changes.length}</span>
      </button>
      {open ? (changes.length ? <ChangeList changes={changes} update={update} onUpdate={onUpdate} /> : <p className={styles.dim}>Nothing else.</p>) : null}
    </Panel>
  );
}
