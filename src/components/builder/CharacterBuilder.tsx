"use client";

import { useMemo, useState } from "react";
import { abilityModifier, armorClassOf, type Ability, type CreatureDefinition, type SizeCategory } from "@/engine";
import {
  ABILITIES,
  blankCharacter,
  buildCharacter,
  buildLabel,
  changeSentence,
  orderedChanges,
  pointBuyCost,
  POINT_BUY_BUDGET,
  readBuild,
  rebuildActor,
  STANDARD_ARRAY,
  standardArrayFor,
  startBuild,
  withChoice,
  withLevelDown,
  withLevelUp,
  withSuggestions,
  type BuildChange,
  type CharacterBuild,
  type ChoiceSlot
} from "@/lib/character-builder";
import type { BuildSources } from "@/lib/character-builder/build";
import { entryLabel } from "@/lib/character-builder/homebrew";
import { formatBonus } from "@/lib/ui-helpers";
import { FloatingWindow } from "@/components/ui/FloatingWindow";
import { useEncounterStore } from "@/store/encounter-store";
import type { BuilderSeed } from "@/store/builder-ui-store";
import { ChoiceControl } from "./ChoiceControl";
import { MissingCatalogNotice, useBuilderSources } from "./CatalogGate";
import styles from "./builder.module.css";
/** The builder's windows open beside the actor sheet (680 px wide at x 72), not on top of it. */
export const BESIDE_SHEET = { x: 770, y: 60 };
const ABILITY_LABELS: Record<Ability, string> = { str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA" };

/** What's wrong with a set of base scores under its method, if anything. */
export function scoresProblem(abilities: CharacterBuild["abilities"]): string | undefined {
  const values = ABILITIES.map((ability) => abilities.base[ability]);
  if (abilities.method === "standard-array") {
    const sorted = [...values].sort((a, b) => a - b).join(",");
    return sorted === [...STANDARD_ARRAY].sort((a, b) => a - b).join(",") ? undefined : "The standard array is one each of 15, 14, 13, 12, 10 and 8.";
  }
  if (abilities.method === "point-buy") {
    const cost = pointBuyCost(abilities.base);
    if (cost === undefined) return "Point buy scores are 8 to 15.";
    return cost > POINT_BUY_BUDGET ? `That's ${cost} points: point buy has ${POINT_BUY_BUDGET}.` : undefined;
  }
  return values.some((value) => value < 1 || value > 30) ? "Scores are 1 to 30." : undefined;
}

/** A build's level count changed to `level`, keeping what was chosen at the levels it still has. */
function withLevel(build: CharacterBuild, level: number): CharacterBuild {
  let next = build;
  while (next.levels.length < level) next = withLevelUp(next);
  while (next.levels.length > level) next = withLevelDown(next);
  return next;
}

/** The choices, grouped by what asks for them (the background, each level), in order. */
function groups(slots: ChoiceSlot[]): Array<{ label: string; slots: ChoiceSlot[] }> {
  const out: Array<{ label: string; slots: ChoiceSlot[] }> = [];
  for (const slot of slots) {
    const label = slot.scope.kind === "level" ? `Level ${slot.scope.index + 1}` : slot.scope.kind === "background" ? "Background" : "Species";
    const last = out[out.length - 1];
    if (last?.label === label) last.slots.push(slot);
    else out.push({ label, slots: [slot] });
  }
  return out;
}

/**
 * The character builder (PC_BUILDER_PLAN.md): a character's whole recipe in one window. For a new character it starts
 * from the class and level picked in Create Token, every choice already suggested; for a built one it edits its build,
 * and shows what applying it would change before it does.
 */
type BuilderProps = {
  seed?: BuilderSeed;
  definitionId?: string;
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

function CharacterBuilderBody({ seed, definitionId, onClose, onCreated, sources }: BuilderProps & { sources: BuildSources }) {
  const definition = useEncounterStore((s) => (definitionId ? s.encounter.definitions.find((entry) => entry.id === definitionId) : undefined));
  const createCharacter = useEncounterStore((s) => s.createCharacter);
  const rebuildCharacter = useEncounterStore((s) => s.rebuildCharacter);
  const saved = readBuild(definition);
  const creating = !definitionId;

  const [name, setName] = useState(seed?.name ?? "New Character");
  const [draft, setDraft] = useState<CharacterBuild | undefined>(() => {
    if (saved) return saved;
    if (!seed) return undefined;
    return withSuggestions(startBuild(sources, { classId: seed.classId, level: seed.level, backgroundId: seed.backgroundId, speciesId: seed.speciesId }), sources);
  });
  const [update, setUpdate] = useState<string[]>([]);

  const built = useMemo(() => (draft ? buildCharacter(draft, sources) : undefined), [draft, sources]);
  // Worked out without the "use the build's instead" ticks, so the changes they apply to stay listed.
  const preview = useMemo(() => {
    if (!draft) return undefined;
    return rebuildActor(definition ?? blankCharacter("preview", name), draft, sources);
  }, [draft, definition, name, sources]);

  if (!draft || !built || !preview) {
    return (
      <FloatingWindow title="Character Builder" onClose={onClose} width={420} storageKey="character-builder" initialPosition={BESIDE_SHEET}>
        <p className={styles.dim}>This actor wasn&apos;t made with the character builder.</p>
      </FloatingWindow>
    );
  }

  const classId = draft.levels[0]!.classId;
  const firstClass = sources.catalog.classes.find((entry) => entry.id === classId);
  const species = draft.species ? sources.catalog.species.find((entry) => entry.id === draft.species!.id) : undefined;
  const pending = built.choices.filter((slot) => slot.pending);
  const scores = scoresProblem(draft.abilities);
  const changes: BuildChange[] = creating ? [] : orderedChanges(preview.changes).filter((change) => !(change.kind === "field" && change.key === "field:classes"));
  const kept = changes.filter((change) => change.kind === "kept");
  const set = (next: CharacterBuild) => setDraft(next);

  function changeClass(nextClass: string) {
    set(withSuggestions(startBuild(sources, { classId: nextClass, level: draft!.levels.length, backgroundId: draft!.background.id, speciesId: draft!.species?.id }), sources));
  }

  function changeSpecies(id: string) {
    const { species: _species, ...rest } = draft!;
    set(withSuggestions(id ? { ...rest, species: { id } } : rest, sources));
  }

  function changeBackground(id: string) {
    set(withSuggestions({ ...draft!, background: { ...(id ? { id } : {}), increases: {} } }, sources));
  }

  function setScore(ability: Ability, value: number) {
    set({ ...draft!, abilities: { ...draft!.abilities, base: { ...draft!.abilities.base, [ability]: value } } });
  }

  function apply() {
    if (creating) {
      const id = createCharacter({ name: name.trim() || "New Character", build: draft! });
      onCreated?.(id);
    } else {
      rebuildCharacter(definitionId!, draft!, update);
    }
    onClose();
  }

  const finalScores = built.fields.abilities;
  return (
    <FloatingWindow
      title={creating ? "New character" : `Character Builder · ${definition?.name ?? ""}`}
      ariaLabel="Character builder"
      onClose={onClose}
      width={600}
      storageKey="character-builder" initialPosition={BESIDE_SHEET}
    >
      <div className={styles.builder}>
        <p className={styles.lede}>{buildLabel(draft, sources)}</p>

        <section className={styles.section} aria-label="Basics">
          <h4>Basics</h4>
          <div className={styles.row}>
            {creating ? (
              <label className={styles.field}>
                Name
                <input value={name} onChange={(event) => setName(event.target.value)} />
              </label>
            ) : null}
            <label className={styles.field}>
              Class
              <select value={classId} disabled={!creating} onChange={(event) => changeClass(event.target.value)} aria-label="Class">
                {sources.catalog.classes.map((entry) => <option key={entry.id} value={entry.id}>{entryLabel(entry)}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              Level
              <select
                value={draft.levels.length} aria-label="Level"
                onChange={(event) => set(withSuggestions(withLevel(draft, Number(event.target.value)), sources))}
              >
                {Array.from({ length: 20 }, (_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              Background
              <select value={draft.background.id ?? ""} onChange={(event) => changeBackground(event.target.value)} aria-label="Background">
                {sources.catalog.backgrounds.map((entry) => <option key={entry.id} value={entry.id}>{entryLabel(entry)}</option>)}
              </select>
            </label>
          </div>
          <div className={styles.row}>
            <label className={styles.field}>
              Species
              <select value={draft.species?.id ?? ""} onChange={(event) => changeSpecies(event.target.value)} aria-label="Species">
                <option value="">None (size, speed and senses by hand)</option>
                {sources.catalog.species.map((entry) => <option key={entry.id} value={entry.id}>{entryLabel(entry)}</option>)}
              </select>
            </label>
            {species && species.sizes.length > 1 ? (
              <label className={styles.field}>
                Size
                <select
                  aria-label="Size" value={draft.species?.size ?? species.sizes[0]}
                  onChange={(event) => set({ ...draft, species: { ...draft.species!, size: event.target.value as SizeCategory } })}
                >
                  {species.sizes.map((size) => <option key={size} value={size}>{size.charAt(0).toUpperCase()}{size.slice(1)}</option>)}
                </select>
              </label>
            ) : null}
          </div>
          {creating && firstClass?.startingEquipment?.length ? (
            <label className={styles.field}>
              Starting equipment
              <select
                aria-label="Starting equipment" value={draft.equipment?.classOption ?? ""}
                onChange={(event) => set({ ...draft, equipment: { ...draft.equipment, applied: false, classOption: event.target.value || undefined } })}
              >
                <option value="">None</option>
                {firstClass.startingEquipment.map((entry) => <option key={entry.id} value={entry.id}>{entry.id}: {entry.label}</option>)}
              </select>
            </label>
          ) : null}
        </section>

        <section className={styles.section} aria-label="Ability scores">
          <h4>Ability scores</h4>
          <div className={styles.row}>
            <label className={styles.field}>
              Method
              <select
                aria-label="Ability score method" value={draft.abilities.method}
                onChange={(event) => set({ ...draft, abilities: { ...draft.abilities, method: event.target.value as CharacterBuild["abilities"]["method"] } })}
              >
                <option value="standard-array">Standard array</option>
                <option value="point-buy">Point buy (27)</option>
                <option value="manual">Typed by hand</option>
              </select>
            </label>
            {firstClass ? (
              <button
                type="button" className={styles.linkButton}
                onClick={() => set(withSuggestions({ ...draft, abilities: { method: "standard-array", base: standardArrayFor(firstClass.suggested.abilities) } }, sources))}
              >
                Suggested for a {firstClass.name.toLowerCase()}
              </button>
            ) : null}
          </div>
          <div className={styles.scores}>
            {ABILITIES.map((ability) => (
              <label key={ability} className={styles.score}>
                <span>{ABILITY_LABELS[ability]}</span>
                <input
                  type="number" min={1} max={30} aria-label={`Base ${ABILITY_LABELS[ability]}`}
                  value={draft.abilities.base[ability]}
                  onChange={(event) => setScore(ability, Math.round(Number(event.target.value) || 0))}
                />
                <small>{finalScores[ability]} ({formatBonus(abilityModifier(finalScores[ability]))})</small>
              </label>
            ))}
          </div>
          {scores ? <p className={styles.problem}>{scores}</p> : (
            <p className={styles.dim}>Base scores; the background&apos;s increases and feats are added on top (shown under each).</p>
          )}
        </section>

        <section className={styles.section} aria-label="Choices">
          <div className={styles.sectionHead}>
            <h4>Choices</h4>
            <span className={styles.dim}>{pending.length ? `${pending.length} still to choose` : "All made"}</span>
            {pending.length ? <button type="button" className={styles.linkButton} onClick={() => set(withSuggestions(draft, sources))}>Suggest the rest</button> : null}
          </div>
          {groups(built.choices).map((group) => (
            <div key={group.label} className={styles.group}>
              <h5>{group.label}</h5>
              {group.slots.map((slot) => (
                <ChoiceControl
                  key={`${JSON.stringify(slot.scope)}|${slot.path.join("/")}`}
                  slot={slot}
                  onChange={(value) => set(withChoice(draft, slot.scope, slot.path, value, slot.spec))}
                />
              ))}
            </div>
          ))}
        </section>

        <section className={styles.section} aria-label="Hit points">
          <h4>Hit points</h4>
          <div className={styles.row}>
            <label className={styles.field}>
              Per level
              <select
                aria-label="Hit points per level" value={draft.hp.method}
                onChange={(event) => set({ ...draft, hp: { ...draft.hp, method: event.target.value as "average" | "rolled" } })}
              >
                <option value="average">Average</option>
                <option value="rolled">Rolled (typed by hand)</option>
              </select>
            </label>
            <span className={styles.stat}>Max HP <strong>{built.fields.maxHp}</strong></span>
          </div>
          {draft.hp.method === "rolled" && draft.levels.length > 1 ? (
            <div className={styles.rolls}>
              {draft.levels.slice(1).map((entry, index) => {
                const die = sources.catalog.classes.find((candidate) => candidate.id === entry.classId)?.hitDie ?? 8;
                return (
                  <label key={index} className={styles.roll}>
                    <span>L{index + 2}</span>
                    <input
                      type="number" min={1} max={die} aria-label={`Level ${index + 2} hit die roll`}
                      value={draft.hp.rolls?.[index] ?? ""}
                      placeholder={String(die / 2 + 1)}
                      onChange={(event) => {
                        const rolls = [...(draft.hp.rolls ?? [])];
                        rolls[index] = Math.min(die, Math.max(1, Math.round(Number(event.target.value) || die / 2 + 1)));
                        set({ ...draft, hp: { ...draft.hp, rolls } });
                      }}
                    />
                  </label>
                );
              })}
            </div>
          ) : null}
        </section>

        <section className={styles.section} aria-label={creating ? "Summary" : "What changes"}>
          <h4>{creating ? "Summary" : "What applying changes"}</h4>
          <Summary definition={preview.definition} />
          {creating ? null : <ChangeList changes={changes} update={update} onUpdate={setUpdate} />}
          {kept.length === 0 && !creating && changes.length === 0 ? <p className={styles.dim}>Nothing: the actor already matches this build.</p> : null}
        </section>

        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={onClose}>Cancel</button>
          <button type="button" className={styles.primary} disabled={Boolean(scores)} onClick={apply}>
            {creating ? "Create character" : "Apply"}
          </button>
        </div>
        {pending.length ? <p className={styles.dim}>Choices still open are left out until they&apos;re made.</p> : null}
      </div>
    </FloatingWindow>
  );
}

/** HP, AC, speed and the features, as the actor would have them. */
export function Summary({ definition }: { definition: CreatureDefinition }) {
  const features = [...(definition.features ?? []), ...(definition.traits ?? [])];
  return (
    <div className={styles.summary}>
      <span className={styles.stat}>HP <strong>{definition.maxHp}</strong></span>
      <span className={styles.stat}>AC <strong>{armorClassOf(definition).total}</strong></span>
      <span className={styles.stat}>Speed <strong>{definition.speed} ft</strong></span>
      <span className={styles.stat}>Proficiency <strong>{formatBonus(definition.proficiencyBonus ?? 2)}</strong></span>
      <p className={styles.featureList}>
        {features.map((feature) => (
          <span key={feature.id} className={feature.automationSupport === "manual-only" && !feature.informational ? styles.manual : undefined} title={feature.automationSupport === "manual-only" && !feature.informational ? "Not simulated: for the DM to run" : undefined}>
            {feature.name}
          </span>
        ))}
      </p>
    </div>
  );
}

/** The changes applying would make, with "use the build's" for each the DM changed. */
export function ChangeList({ changes, update, onUpdate }: { changes: BuildChange[]; update: string[]; onUpdate: (keys: string[]) => void }) {
  if (!changes.length) return null;
  return (
    <ul className={styles.changes} aria-label="Changes">
      {changes.map((change) => (
        <li key={change.key} className={styles[`change_${change.kind}`]}>
          {changeSentence(change)}
          {change.kind === "kept" ? (
            <label className={styles.update}>
              <input
                type="checkbox" checked={update.includes(change.key)}
                onChange={(event) => onUpdate(event.target.checked ? [...update, change.key] : update.filter((key) => key !== change.key))}
              />
              Use the build&apos;s instead
            </label>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
