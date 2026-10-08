"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Redo2, Undo2 } from "lucide-react";
import {
  adoptionBuild,
  BUILDER_STEPS,
  blankCharacter,
  buildCharacter,
  firstOpenStep,
  missingFromCatalog,
  nextOpenSpellSlot,
  openChoices,
  readBuild,
  rebuildActor,
  sameNamedAbilities,
  spellSlotKey,
  startBuild,
  withLevelDown,
  withLevelUp,
  withSuggestions,
  type BuilderStep,
  type CharacterBuild,
  type RulesEntry
} from "@/lib/character-builder";
import type { BuildSources } from "@/lib/character-builder/build";
import { CodexRoot } from "@/components/codex-ui";
import { RulesCard, RulesCardProvider } from "@/components/rules-card";
import { FloatingWindow } from "@/components/ui/FloatingWindow";
import { useEditionFilter } from "@/hooks/useEditionFilter";
import type { EditionChoice } from "@/lib/editions";
import { useEncounterStore } from "@/store/encounter-store";
import { useBuilderUiStore, type BuilderSeed } from "@/store/builder-ui-store";
import { rememberStyle, storedStyle, useSheetWindowsStore, type SheetStyle } from "@/store/sheet-windows-store";
import { BuilderContext, type BuilderModel } from "./builder-context";
import { BuilderHeader } from "./BuilderHeader";
import { BuildPreview } from "./BuildPreview";
import { LookSwitch } from "./LookSwitch";
import { Shortcuts } from "./Shortcuts";
import { MissingCatalogNotice, useBuilderSources } from "./CatalogGate";
import { OriginStep } from "./steps/OriginStep";
import { ReviewStep } from "./steps/ReviewStep";
import { ClassStep } from "./steps/ClassStep";
import { AbilitiesStep } from "./steps/AbilitiesStep";
import { SpellsStep } from "./steps/SpellsStep";
import { EquipmentStep } from "./steps/EquipmentStep";
import { scoresProblem } from "./scores";
import { useDraftHistory, type Draft } from "./useDraftHistory";
import styles from "./builder.module.css";

export { scoresProblem } from "./scores";
export { ChangeList, Summary } from "./steps/ReviewStep";

/** The Level up window opens beside the actor sheet (680 px wide at x 72), not on top of it. */
export const BESIDE_SHEET = { x: 770, y: 60 };

/** A build's level count changed to `level`, keeping what was chosen at the levels it still has. */
function withLevel(build: CharacterBuild, level: number): CharacterBuild {
  let next = build;
  while (next.levels.length < level) next = withLevelUp(next);
  while (next.levels.length > level) next = withLevelDown(next);
  return next;
}

/**
 * The character builder (PC_BUILDER_PLAN.md, CHARACTER_BUILDER_UX_PLAN.md): a character's whole recipe in one window, in
 * steps beside a live preview of the sheet it makes. For a new character it starts from the class and level picked in
 * Create Token, every choice already suggested; for a built one it edits its build, and shows what applying it would
 * change before it does.
 */
type BuilderProps = {
  seed?: BuilderSeed;
  definitionId?: string;
  /** A hand-built PC to rebuild with the builder (plan D10). */
  adopt?: boolean;
  onClose: () => void;
  onCreated?: (definitionId: string) => void;
};

export function CharacterBuilder(props: BuilderProps) {
  const definition = useEncounterStore((s) => (props.definitionId ? s.encounter.definitions.find((entry) => entry.id === props.definitionId) : undefined));
  const saved = readBuild(definition);
  // A new character's seed names its class, background and species as a build would.
  const seeded = useMemo(() => (props.seed ? startBuildShape(props.seed) : undefined), [props.seed]);
  const { sources, missing, loading } = useBuilderSources(saved ?? seeded);
  if (missing.length) return <MissingCatalogNotice title="Character Builder" missing={missing} loading={loading} onClose={props.onClose} initialPosition={BESIDE_SHEET} />;
  return <CharacterBuilderBody {...props} sources={sources} />;
}

/** Only what `missingFromCatalog` reads of a new character's seed. */
function startBuildShape(seed: BuilderSeed): CharacterBuild {
  return {
    version: 1, edition: "2024", abilities: { method: "manual", base: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } },
    background: { ...(seed.backgroundId ? { id: seed.backgroundId } : {}), increases: {} },
    ...(seed.speciesId ? { species: { id: seed.speciesId } } : {}),
    hp: { method: "average" }, levels: [{ classId: seed.classId, choices: {} }], made: {}
  };
}

/** The window's first size: as big as the builder wants, within the screen. */
function firstSize() {
  if (typeof window === "undefined") return { width: 1180, height: 820, x: 40, y: 50 };
  const width = Math.min(1180, window.innerWidth - 32);
  const height = Math.min(820, window.innerHeight - 80);
  return { width, height, x: Math.max(16, Math.round((window.innerWidth - width) / 2)), y: 50 };
}

function CharacterBuilderBody({ seed, definitionId, adopt, onClose, onCreated, sources }: BuilderProps & { sources: BuildSources }) {
  const definition = useEncounterStore((s) => (definitionId ? s.encounter.definitions.find((entry) => entry.id === definitionId) : undefined));
  const createCharacter = useEncounterStore((s) => s.createCharacter);
  const moveDefinitionToFolder = useEncounterStore((s) => s.moveDefinitionToFolder);
  const rebuildCharacter = useEncounterStore((s) => s.rebuildCharacter);
  const adoptCharacter = useEncounterStore((s) => s.adoptCharacter);
  const saved = readBuild(definition);
  const creating = !definitionId;
  // A hand-built PC, rebuilt: its classes matched by name (the first class when none is), its scores and HP kept.
  const adopting = Boolean(adopt && definition && !saved);
  // Which edition's version the lists show where there are two: a built character's opens on its own (D2). Rebuilding,
  // its classes are matched in that edition, and again when it changes.
  const [filter, setFilter] = useEditionFilter("builder", saved?.edition);
  // Create Token's edition filter carries over (D13).
  useEffect(() => {
    if (seed?.edition && seed.edition !== filter) setFilter(seed.edition);
    // Once, when the builder opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const adoptIn = (choice: EditionChoice) => {
    if (!adopting || !definition) return undefined;
    const preferred = choice === "both" ? undefined : choice;
    const first = sources.catalog.classes.find((entry) => !preferred || entry.edition === preferred) ?? sources.catalog.classes[0];
    return adoptionBuild(definition, sources, undefined, preferred) ?? adoptionBuild(definition, sources, first?.id, preferred);
  };
  const [adoption, setAdoption] = useState(() => adoptIn(filter));

  // The look (D1): the PC sheets' Standard or Codex, switched here or there.
  const [look, setLook] = useState<SheetStyle>(() => storedStyle("pc"));
  const palette = useSheetWindowsStore((s) => s.palette);
  const setPalette = useSheetWindowsStore((s) => s.setPalette);
  const chooseLook = (next: SheetStyle) => {
    setLook(next);
    rememberStyle("pc", next);
  };

  // The draft, with undo, kept in this browser until it's applied or cancelled (D11).
  const history = useDraftHistory(
    creating ? "create" : `${adopting ? "adopt" : "edit"}:${definitionId}`,
    (): Draft | undefined => {
      const name = seed?.name ?? definition?.name ?? "New Character";
      if (saved) return { build: saved, name };
      if (adoption) return { build: adoption.build, name };
      if (!seed) return undefined;
      return { build: withSuggestions(startBuild(sources, { classId: seed.classId, level: seed.level, backgroundId: seed.backgroundId, speciesId: seed.speciesId }), sources), name };
    },
    (kept) => missingFromCatalog(kept.build, sources.catalog).length === 0
  );
  const build = history.present?.build;
  const name = history.present?.name ?? "New Character";
  const set = (next: CharacterBuild) => history.set({ build: next, name });

  const [step, setStep] = useState<BuilderStep>(creating ? "class" : "review");
  const [pinned, setPinned] = useState<RulesEntry | null>(null);
  const [spellFocus, setSpellFocus] = useState<{ key: string; nonce: number } | null>(null);
  const [update, setUpdate] = useState<string[]>([]);
  const [removeTwins, setRemoveTwins] = useState(false);
  const [size] = useState(firstSize);
  const stepRef = useRef<HTMLElement>(null);

  const chooseFilter = (next: EditionChoice) => {
    setFilter(next);
    const again = adoptIn(next);
    if (again) {
      setAdoption(again);
      set(again.build);
    }
  };

  const built = useMemo(() => (build ? buildCharacter(build, sources) : undefined), [build, sources]);
  // Worked out without the "use the build's instead" ticks, so the changes they apply to stay listed.
  const preview = useMemo(() => (build ? rebuildActor(definition ?? blankCharacter("preview", name), build, sources) : undefined), [build, definition, name, sources]);

  if (!build || !built || !preview) {
    return (
      <FloatingWindow title="Character Builder" onClose={onClose} width={420} storageKey="character-builder" initialPosition={BESIDE_SHEET}>
        <p className={styles.dim}>This actor wasn&apos;t made with the character builder.</p>
      </FloatingWindow>
    );
  }

  const go = (next: BuilderStep) => {
    setStep(next);
    setPinned(null);
    if (stepRef.current) stepRef.current.scrollTop = 0;
  };
  const counts = openChoices(built.choices);
  const pending = built.choices.filter((slot) => slot.pending).length;
  const scores = scoresProblem(build.abilities);
  const hasSpells = built.choices.some((slot) => slot.spec.kind === "spells") || Boolean(built.fields.spellcasting);
  const steps = BUILDER_STEPS.filter((entry) => entry.id !== "spells" || hasSpells);
  const index = steps.findIndex((entry) => entry.id === step);
  const nextStep = steps[index + 1];
  const species = build.species ? sources.catalog.species.find((entry) => entry.id === build.species!.id) : undefined;
  const background = build.background.id ? sources.catalog.backgrounds.find((entry) => entry.id === build.background.id) : undefined;
  const twins = adopting ? sameNamedAbilities(preview.definition) : [];

  function apply() {
    history.clear();
    if (creating) {
      const id = createCharacter({ name: name.trim() || "New Character", build: build! });
      if (seed?.folderId) void moveDefinitionToFolder(id, seed.folderId);
      onCreated?.(id);
    } else if (adopting) {
      adoptCharacter(definitionId!, build!, removeTwins);
    } else {
      rebuildCharacter(definitionId!, build!, update);
    }
    onClose();
  }

  function cancel() {
    history.clear();
    onClose();
  }

  function onKeys(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    const typing = target.tagName === "TEXTAREA" || (target.tagName === "INPUT" && !["checkbox", "radio", "button"].includes((target as HTMLInputElement).type));
    if (typing || !(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();
    if (key === "z" && !event.shiftKey) history.undo();
    else if ((key === "z" && event.shiftKey) || key === "y") history.redo();
    else return;
    event.preventDefault();
  }

  const openSpells = (slotKey?: string) => {
    const key = slotKey ?? (() => {
      const next = nextOpenSpellSlot(built.choices);
      return next ? spellSlotKey(next) : undefined;
    })();
    if (key) setSpellFocus({ key, nonce: Date.now() });
    go("spells");
  };
  const model: BuilderModel = {
    build, set, built, preview, sources, filter, edition: build.edition, creating, adopting, definition, look, go, openSpells, spellFocus
  };
  const classes = built.fields.classes.map((entry) => `${entry.name} ${entry.level}${entry.subclass ? ` · ${entry.subclass.name}` : ""}`).join(" / ");

  const shell = (
    <div className={styles.shell} data-look={look} onKeyDown={onKeys}>
      {history.offer ? (
        <div role="status" className={styles.offer}>
          <span>You have a draft of this character from {new Date(history.offer.savedAt).toLocaleString()}.</span>
          <button type="button" className={styles.primary} onClick={history.restore}>Continue where you left off</button>
          <button type="button" className={styles.secondary} onClick={history.dismiss}>Start over</button>
        </div>
      ) : null}
      <BuilderHeader
        look={look} name={name}
        onName={creating ? (next) => history.replace({ build, name: next }) : undefined}
        pills={[
          { label: classes || "No class", title: "Class: go to the Class step", go: () => go("class") },
          { label: background?.name ?? "No background", title: "Background: go to the Origin step", go: () => go("origin") },
          { label: species?.name ?? (build.edition === "2014" ? "No race" : "No species"), title: "Species or race: go to the Origin step", go: () => go("origin") }
        ]}
        filter={filter} onFilter={chooseFilter}
        open={pending} onOpen={() => go(firstOpenStep(built.choices) ?? "review")}
        level={build.levels.length}
        onLevel={(level) => set(withSuggestions(withLevel(build, level), sources))}
      />
      <BuildPreview definition={preview.definition} built={built} build={build} name={name} look={look} compact />
      <div className={styles.body}>
        <nav className={styles.rail} aria-label="Builder steps">
          {steps.map((entry, at) => {
            const open = entry.id === "abilities" ? counts.abilities + (scores ? 1 : 0) : counts[entry.id];
            return (
              <button
                key={entry.id} type="button" className={styles.railStep} aria-current={entry.id === step ? "step" : undefined}
                onClick={() => go(entry.id)}
              >
                <span className={styles.railNumber}>{at + 1}</span>
                <span className={styles.railLabel}>{entry.label}</span>
                {entry.id === "review" ? null : (
                  <span className={styles.railCount} data-open={open > 0 || undefined} aria-label={open ? `${open} open` : "done"}>{open || "✓"}</span>
                )}
              </button>
            );
          })}
          <span className={styles.railGap} />
          {pending ? <button type="button" className={styles.secondary} onClick={() => set(withSuggestions(build, sources))}><span aria-hidden="true">✦ </span>Suggest the rest</button> : null}
          {creating ? (
            <button
              type="button" className={styles.linkButton} onClick={() => useBuilderUiStore.getState().openHomebrew()}
              title="Your own classes, subclasses, feats, backgrounds and species, beside the SRD's"
            >
              Homebrew content…
            </button>
          ) : null}
          <p className={styles.railHint}>Nothing is locked: go to any step. Hover anything to read its rules.</p>
        </nav>
        <main ref={stepRef} className={styles.stepArea} aria-label={`${steps[index]?.label ?? "This"} step`}>
          {step === "class" ? <ClassStep /> : null}
          {step === "origin" ? <OriginStep /> : null}
          {step === "abilities" ? <AbilitiesStep /> : null}
          {step === "spells" ? <SpellsStep /> : null}
          {step === "equipment" ? <EquipmentStep /> : null}
          {step === "review" ? (
            <ReviewStep
              update={update} onUpdate={setUpdate} adoptNotes={adoption?.notes}
              twins={twins} removeTwins={removeTwins} onRemoveTwins={setRemoveTwins}
            />
          ) : null}
        </main>
        <aside className={styles.previewColumn} aria-label={pinned ? "Pinned rules" : "Live preview"}>
          {pinned
            ? <RulesCard entry={pinned} variant="full" inline onClose={() => setPinned(null)} />
            : <BuildPreview definition={preview.definition} built={built} build={build} name={name} look={look} />}
        </aside>
      </div>
      <footer className={styles.footer}>
        <button type="button" className={styles.secondary} disabled={index <= 0} onClick={() => go(steps[index - 1]!.id)}>‹ Back</button>
        <span className={styles.footerNote}>{pending ? `${pending} still to choose` : "All made"}</span>
        {nextStep ? <button type="button" className={styles.secondary} onClick={() => go(nextStep.id)}>Next: {nextStep.label} ›</button> : null}
        <button type="button" className={styles.secondary} onClick={cancel}>Cancel</button>
        <button type="button" className={styles.primary} disabled={Boolean(scores)} onClick={apply}>
          {creating ? "Create character" : adopting ? "Rebuild" : "Apply"}
        </button>
      </footer>
    </div>
  );

  return (
    <FloatingWindow
      title={creating ? "New character" : adopting ? `Rebuild with the builder · ${definition?.name ?? ""}` : `Character Builder · ${definition?.name ?? ""}`}
      ariaLabel="Character builder"
      onClose={onClose}
      width={size.width}
      initialHeight={size.height}
      resizable={{ minWidth: 640, minHeight: 440, maxWidth: 1600 }}
      scrollBody={false}
      storageKey="builder"
      initialPosition={{ x: size.x, y: size.y }}
      headerExtra={(
        <LookSwitch look={look} onLook={chooseLook} palette={palette} onPalette={setPalette}>
          <button type="button" className={styles.titleButton} aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!history.canUndo} onClick={history.undo}><Undo2 size={14} /></button>
          <button type="button" className={styles.titleButton} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!history.canRedo} onClick={history.redo}><Redo2 size={14} /></button>
          <Shortcuts undo />
        </LookSwitch>
      )}
    >
      <BuilderContext.Provider value={model}>
        <RulesCardProvider palette={look === "codex" ? palette : null} onPin={setPinned}>
          {/* One element in both looks, so switching keeps the step's state (an open spell grid). */}
          <CodexRoot palette={palette} plain={look !== "codex"} className={styles.frame}>{shell}</CodexRoot>
        </RulesCardProvider>
      </BuilderContext.Provider>
    </FloatingWindow>
  );
}
