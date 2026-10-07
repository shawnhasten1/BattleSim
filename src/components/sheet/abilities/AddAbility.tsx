"use client";

import { Check, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  levelOf,
  type ActionDefinition,
  type CreatureDefinition,
  type DeathEffectDefinition,
  type FeatureDefinition,
  type ItemDefinition,
  type LegendaryActionRef,
  type SourceMetadata,
  type SpellDefinition,
  type WeaponDefinition
} from "@/engine";
import { SRD_DRAG_MIME, SRD_FEATURES, SRD_ITEMS, SRD_SPELLS, SRD_WEAPONS, serializeSrdDragPayload, type SrdEntryKind } from "@/data/srd";
import { SRD_2014_SPELLS } from "@/data/srd/2014/spells";
import { SRD_2024_SPELLS } from "@/data/srd/2024/spells";
import { SRD_CREDITS_PATH } from "@/data/srd/attribution";
import { loadSrdMonsterAbilities, type SrdMonsterAbilityEntry } from "@/data/srd/monsters";
import { EditionBadge, EditionFilter } from "@/components/ui/Edition";
import type { Compendium } from "@/hooks/useCompendium";
import { useEditionFilter } from "@/hooks/useEditionFilter";
import {
  ADD_FILTERS,
  librarySlug,
  prepareLibrary,
  prepareMonsterAbility,
  searchAdd,
  type AddFilter,
  type LibraryEntry,
  type Prepared,
  type Recipe
} from "@/lib/ability-editor/add";
import { prepareSaved, savedKindWord, searchSaved, srdCreaturesNeeded, unboundSteps, type SavedAbility } from "@/lib/ability-editor/my-library";
import { withNewAbilityAt } from "@/lib/ability-editor/refs";
import { readBuild } from "@/lib/character-builder/summary";
import { editionNameKey, editionOf } from "@/lib/editions";
import { loadCreatures, newSummonLoop } from "@/lib/ability-editor/spawns";
import { actionStatblock, deathEffectStatblock, featureStatblock, itemStatblock, legendaryStatblock, spellStatblock, weaponStatblock } from "@/lib/statblock";
import { useEncounterStore } from "@/store/encounter-store";
import { useMyLibraryStore } from "@/store/my-library-store";
import styles from "./abilities.module.css";

/** What "Start from scratch" can start. */
export type BlankKind =
  | "weapon" | "attack" | "special" | "multiattack" | "spell" | "feature" | "item" | "reaction" | "legendary" | "lair" | "death" | "summon" | "transform";

const BLANKS: Array<{ kind: BlankKind; label: string; title: string }> = [
  { kind: "weapon", label: "Weapon", title: "A longsword-style weapon to change" },
  { kind: "attack", label: "Attack", title: "A claw, a bite or a slam: a natural attack" },
  { kind: "special", label: "Special action", title: "A breath, a gaze or a poison spray: starts as a saving throw; Roll and Target make it an area, a heal or a teleport" },
  { kind: "multiattack", label: "Multiattack", title: "Several attacks for one action: “a bite and two claws”" },
  { kind: "spell", label: "Spell", title: "A spell attack; Roll and Target make it anything else" },
  { kind: "feature", label: "Trait or feature", title: "Always on (Pack Tactics) or switched on (Rage)" },
  { kind: "item", label: "Item", title: "A potion, a wand, a ring: something it carries. Starts as a healing potion; Basics makes it anything else" },
  { kind: "reaction", label: "Reaction", title: "Something it does when it's targeted or hit (a Parry)" },
  { kind: "legendary", label: "Legendary action", title: "Taken between other creatures' turns, for legendary actions it has a round (a dragon's tail attack)" },
  { kind: "lair", label: "Lair action", title: "Taken on initiative 20 while it's in its lair" },
  { kind: "death", label: "On death", title: "Fires once, when it drops to 0 HP" },
  { kind: "summon", label: "Summon", title: "Calls other creatures into the fight" },
  { kind: "transform", label: "Shapechange", title: "Turns into another form" }
];


/**
 * The most library rows the panel shows at once: with both editions' spells and the 2024 features there are hundreds
 * before a search, and the rest are a word away ("N more: add a word to narrow it down").
 */
const LIBRARY_ROWS = 80;

/** What a recipe makes, beside its name. */
const RECIPE_GROUP_WORDS: Record<Recipe["group"], string> = { weapon: "weapon", action: "monster action", spell: "spell", feature: "feature", item: "item", death: "on death" };

/** A library row's statblock line, without its name ("Extra Attack: 2 × any weapon attack"), which the row shows. */
function line(entry: LibraryEntry, definition: CreatureDefinition): string {
  const short = entry.kind === "weapon"
    ? weaponStatblock(entry.entry as WeaponDefinition, definition).short
    : entry.kind === "spell" ? spellStatblock(entry.entry as SpellDefinition, definition).short
      : entry.kind === "item" ? itemStatblock(entry.entry as ItemDefinition, definition).short
        : featureStatblock(entry.entry as FeatureDefinition, definition).short;
  return short.startsWith(`${entry.name}: `) ? short.slice(entry.name.length + 2) : short;
}

/**
 * A My library row's line, as it would be on this creature. A multiattack naming abilities the creature has none of
 * says which: adding it opens the editor to change those steps.
 */
function savedLine(entry: SavedAbility, definition: CreatureDefinition): string {
  if (entry.kind === "item" || entry.kind === "weapon" || entry.kind === "spell" || entry.kind === "feature") {
    return line({ kind: entry.kind, id: entry.id, name: entry.name, entry: entry.record as LibraryEntry["entry"] }, definition);
  }
  const record = prepareSaved(entry, definition).record;
  const missing = unboundSteps(record, definition).map((id) => entry.steps?.[id] ?? id);
  if (missing.length) return `Uses ${missing.join(" and ")}, which this creature doesn't have: you'll choose what it uses instead.`;
  const short = entry.kind === "legendary" ? legendaryStatblock(record as LegendaryActionRef, definition).short
    : entry.kind === "death" ? deathEffectStatblock(record as DeathEffectDefinition, definition).short
      : actionStatblock(record as ActionDefinition, definition).short;
  return short.startsWith(`${entry.name}: `) ? short.slice(entry.name.length + 2) : short;
}

/** The library entries this creature has already (a copy keeps the id of the entry it came from as its source's slug). */
function onSheet(definition: CreatureDefinition): Set<string> {
  const records: Array<{ source?: { slug?: string } }> = [
    ...(definition.weapons ?? []), ...(definition.items ?? []), ...(definition.spells ?? []), ...(definition.features ?? []), ...(definition.traits ?? []),
    ...definition.actions, ...(definition.bonusActions ?? []), ...(definition.reactions ?? []), ...(definition.lairActions ?? []),
    ...(definition.deathEffects ?? []), ...(definition.legendary?.actions ?? [])
  ];
  return new Set(records.flatMap((record) => (record.source?.slug ? [record.source.slug] : [])));
}

/**
 * Add ability (plan §3.2): one search over recipes, the library, the SRD monsters' abilities and Open5e, and blank kinds
 * to start from scratch. A row opens the editor on a ready copy, and nothing is added until Save; a library row's "+"
 * adds it at once and leaves the panel open for the next one, and it can be dragged onto the sheet.
 */
export function AddAbility({ definition, compendium, onPrepared, onAttach, onBlank, onClose, initialFilter = "all", bare = false }: {
  definition: CreatureDefinition;
  compendium?: Compendium;
  onPrepared: (prepared: Prepared) => void;
  /** A library row's "+": `level` is the class level a 2024 class feature is added at (the creature's own when absent). */
  onAttach: (kind: SrdEntryKind, id: string, level?: number) => void;
  onBlank: (kind: BlankKind) => void;
  onClose: () => void;
  /** What it shows first: All, or (the Codex's Spells and Items tabs) Spells or Items. */
  initialFilter?: AddFilter;
  /** Without its own frame, inside a panel that has one (the Codex's). */
  bare?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AddFilter>(initialFilter);
  // Which version shows where the library has a 2014 and a 2024 one; a built character's opens on its own edition.
  const [edition, setEdition] = useEditionFilter("add-ability", readBuild(definition)?.edition);
  // The class level a 2024 class feature is added at: the creature's own if it has one, otherwise each at the level it's gained.
  const [featureLevel, setFeatureLevel] = useState<number | undefined>(() => (definition.character ? levelOf(definition) : undefined));
  const [abilities, setAbilities] = useState<readonly SrdMonsterAbilityEntry[] | undefined>(undefined);
  const [busy, setBusy] = useState<string | null>(null);
  const [open5e, setOpen5e] = useState(false);
  // What the last "+" added: the panel stays open for the next one, and says so.
  const [added, setAdded] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const already = useMemo(() => onSheet(definition), [definition]);

  useEffect(() => { searchRef.current?.focus(); }, []);
  // The monsters' abilities load once, the first time they could show.
  useEffect(() => {
    if (abilities || (!query.trim() && filter !== "monster")) return;
    let live = true;
    void loadSrdMonsterAbilities().then((loaded) => { if (live) setAbilities(loaded); });
    return () => { live = false; };
  }, [abilities, query, filter]);

  const results = useMemo(() => searchAdd(query, filter, abilities, definition, edition), [query, filter, abilities, definition, edition]);
  // Rows listed with their other edition's version beside them: their "Add" buttons say which is which.
  const twinned = useMemo(() => {
    const seen = new Map<string, number>();
    for (const entry of results.library) {
      const key = `${entry.kind}:${editionNameKey(entry.name)}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return new Set([...seen].filter(([, count]) => count > 1).map(([key]) => key));
  }, [results.library]);
  // Each row's statblock line, worked out once per creature (and a 2024 class feature's, per level) rather than on every keystroke.
  const lines = useMemo(() => new Map<string, string>(), [definition]);
  const lineOf = (entry: LibraryEntry) => {
    const key = entry.from ? `${entry.id}@${featureLevel ?? ""}` : entry.id;
    let text = lines.get(key);
    if (text === undefined) {
      // A 2024 class feature at the level it would be added at: its numbers are that level's.
      const scaled = entry.from ? prepareLibrary(entry.kind, entry.id, definition, featureLevel)?.record as FeatureDefinition | undefined : undefined;
      lines.set(key, text = line(scaled ? { ...entry, entry: scaled } : entry, definition));
    }
    return text;
  };
  // Which is which, when a name is listed more than once: its edition beside its other version, and what gives a 2024 class
  // feature (five classes have Extra Attack).
  const addLabel = (entry: LibraryEntry) => {
    const which = [entry.edition && twinned.has(`${entry.kind}:${editionNameKey(entry.name)}`) ? entry.edition : undefined, entry.from].filter(Boolean);
    return `Add ${entry.name}${which.length ? ` (${which.join(", ")})` : ""}`;
  };
  const classFeatures = results.library.some((entry) => entry.from);
  // My library: what the DM saved from the editor, for any creature.
  const mine = useMyLibraryStore((s) => s.entries);
  const mineStatus = useMyLibraryStore((s) => s.status);
  const forgetSaved = useMyLibraryStore((s) => s.remove);
  const insertAbilityRecord = useEncounterStore((s) => s.insertAbilityRecord);
  const saved = useMemo(() => searchSaved(mine, query, filter), [mine, query, filter]);
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  function chooseRecipe(recipe: Recipe) {
    // A recipe that's a search (a spell scroll asks for its spell): search for it under Items.
    if (recipe.search) {
      setQuery(recipe.search);
      setFilter("items");
      setOpen5e(false);
      searchRef.current?.focus();
      return;
    }
    onPrepared(recipe.prepare(definition));
  }
  function attach(entry: LibraryEntry) {
    onAttach(entry.kind, entry.id, entry.from ? featureLevel : undefined);
    setAdded(entry.name);
    // Ready for the next one: the search keeps its words, selected, so typing replaces them.
    searchRef.current?.focus();
    searchRef.current?.select();
  }
  function chooseSaved(entry: SavedAbility) {
    onPrepared(prepareSaved(entry, definition));
  }
  /**
   * "+" on a My library row: added as it is, with the creatures it summons or changes into (the ones it keeps, and SRD
   * monsters fetched). One that needs a choice first opens the editor instead: a multiattack whose attacks this creature
   * lacks, or a summon that would loop back to this creature.
   */
  async function attachSaved(entry: SavedAbility) {
    const prepared = prepareSaved(entry, definition);
    if (unboundSteps(prepared.record, definition).length) return chooseSaved(entry);
    const scene = useEncounterStore.getState().encounter.definitions;
    const kept = (prepared.creatures ?? []).filter((creature) => !scene.some((candidate) => candidate.id === creature.id));
    const needed = srdCreaturesNeeded(entry);
    let fetched: CreatureDefinition[] = [];
    if (needed.length) {
      setBusy(entry.id);
      try {
        fetched = await loadCreatures(needed, [...scene, ...kept]);
      } finally {
        setBusy(null);
      }
    }
    const embed = [...kept, ...fetched];
    if (newSummonLoop([...scene, ...embed], withNewAbilityAt(definition, prepared.list, prepared.record).definition)) return chooseSaved(entry);
    const extras = { ...(prepared.pools ? { pools: prepared.pools } : {}), ...(embed.length ? { embed } : {}) };
    insertAbilityRecord(definition.id, prepared.list, prepared.record, Object.keys(extras).length ? extras : undefined);
    setAdded(entry.name);
    searchRef.current?.focus();
    searchRef.current?.select();
  }
  async function forget(entry: SavedAbility) {
    const view = searchRef.current?.ownerDocument.defaultView ?? window;
    if (!view.confirm(`Remove “${entry.name}” from My library? Copies already on creatures stay as they are.`)) return;
    await forgetSaved(entry.id);
  }
  function chooseLibrary(entry: LibraryEntry) {
    const prepared = prepareLibrary(entry.kind, entry.id, definition, featureLevel);
    if (prepared) onPrepared(prepared);
  }
  async function chooseMonster(entry: SrdMonsterAbilityEntry) {
    setBusy(`${entry.monsterId}:${entry.id}`);
    try {
      const prepared = await prepareMonsterAbility(entry);
      if (prepared) onPrepared(prepared);
    } finally {
      setBusy(null);
    }
  }

  function onSearchKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.stopPropagation();
      if (query) setQuery("");
      else onClose();
      return;
    }
    if (event.key !== "Enter") return;
    // Enter takes the first thing found.
    event.preventDefault();
    if (saved[0]) chooseSaved(saved[0]);
    else if (results.recipes[0]) chooseRecipe(results.recipes[0]);
    else if (results.library[0]) chooseLibrary(results.library[0]);
    else if (results.monster[0]) void chooseMonster(results.monster[0]);
  }

  const showRecipes = results.recipes.length > 0;
  // Under Items, Open5e is searched for items (carried for reference); otherwise for spells.
  const open5eItems = filter === "items";
  const nothing = !showRecipes && !results.library.length && !results.monster.length && !saved.length;
  return (
    <div className={`${styles.add} ${bare ? styles.addBare : ""}`} role="region" aria-label="Add ability">
      <input
        ref={searchRef} type="search" className={styles.search} aria-label="Search abilities" value={query}
        placeholder="Search weapons, spells, items, monster abilities and recipes" onChange={(event) => { setQuery(event.target.value); setOpen5e(false); }}
        onKeyDown={onSearchKey}
      />
      <div className={styles.filterBar}>
        <div className={styles.filters} role="group" aria-label="Show">
          {ADD_FILTERS.map((entry) => (
            <button key={entry.value} type="button" aria-pressed={filter === entry.value} onClick={() => setFilter(entry.value)}>{entry.label}</button>
          ))}
        </div>
        <EditionFilter value={edition} onChange={setEdition} />
      </div>
      {added ? (
        <div className={styles.added} role="status">
          <span><Check size={12} aria-hidden /> Added {added}.</span>
          <button type="button" onClick={onClose}>Done</button>
        </div>
      ) : null}

      <div className={styles.results}>
        {saved.length ? (
          <section className={styles.section} aria-label="My library">
            <h5>My library</h5>
            <div className={styles.items}>
              {saved.map((entry) => (
                <div key={entry.id} className={styles.item}>
                  <button type="button" className={styles.itemOpen} onClick={() => chooseSaved(entry)} title="Open it to check or change before adding">
                    <span className={styles.itemName}>
                      {entry.name} <span className={styles.itemMeta}>· {savedKindWord(entry)}{already.has(entry.id) ? " · on the sheet" : ""}</span>{" "}
                      <EditionBadge edition={editionOf(entry.record as { source?: SourceMetadata })} />
                    </span>
                    <span className={styles.itemLine}>{savedLine(entry, definition)}</span>
                  </button>
                  <button
                    type="button" className={styles.plus} aria-label={`Add ${entry.name}`} disabled={busy === entry.id}
                    title={already.has(entry.id) ? "It's on the sheet already: add another copy" : "Add it as it is"} onClick={() => void attachSaved(entry)}
                  >
                    <Plus size={13} />
                  </button>
                  <button
                    type="button" className={styles.plus} aria-label={`Remove ${entry.name} from my library`}
                    title="Remove it from My library (copies on creatures stay)" onClick={() => void forget(entry)}
                  >
                    <X size={13} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        ) : filter === "mine" ? (
          <p className={styles.more}>
            {mineStatus === "failed" ? "My library couldn't be loaded: try again later."
              : mine.length ? `Nothing in My library matches “${query.trim()}”.`
                : "Nothing in My library yet. Open an ability (a library item to start from, or one on a sheet), change it, and use Save to my library."}
          </p>
        ) : null}
        {showRecipes ? (
          <section className={styles.section} aria-label="Recipes">
            <h5>Recipes</h5>
            <div className={styles.items}>
              {results.recipes.map((recipe) => (
                <div key={recipe.id} className={styles.item}>
                  <button type="button" className={styles.itemOpen} onClick={() => chooseRecipe(recipe)}>
                    <span className={styles.itemName}>{recipe.label} <span className={styles.itemMeta}>· {RECIPE_GROUP_WORDS[recipe.group]}</span></span>
                    <span className={styles.itemLine}>{recipe.hint}</span>
                  </button>
                </div>
              ))}

            </div>
          </section>
        ) : null}

        {results.library.length ? (
          <section className={styles.section} aria-label="Library">
            <h5>Library</h5>
            {classFeatures ? (
              <label className={styles.featureLevel} title="A 2024 class feature's numbers (Rage's uses, Second Wind's healing) are that class level's. Empty: each at the level it's gained.">
                2024 class features at level
                <input
                  type="number" min={1} max={20} inputMode="numeric" aria-label="Class level for 2024 features" placeholder="as gained"
                  value={featureLevel ?? ""}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setFeatureLevel(event.target.value === "" || !Number.isFinite(value) ? undefined : Math.min(20, Math.max(1, Math.round(value))));
                  }}
                />
              </label>
            ) : null}
            <div className={styles.items}>
              {results.library.slice(0, LIBRARY_ROWS).map((entry) => (
                <div
                  key={entry.id} className={styles.item} draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "copy";
                    event.dataTransfer.setData(SRD_DRAG_MIME, serializeSrdDragPayload(entry.kind, entry.id));
                  }}
                >
                  <button type="button" className={styles.itemOpen} onClick={() => chooseLibrary(entry)} title="Open it to check or change before adding">
                    <span className={styles.itemName}>
                      {entry.name} <span className={styles.itemMeta}>· {entry.kind}{entry.from ? ` · ${entry.from}` : ""}{entry.reference ? " · ref" : ""}{already.has(librarySlug(entry)) ? " · on the sheet" : ""}</span>{" "}
                      <EditionBadge edition={entry.edition} />
                    </span>
                    <span className={styles.itemLine}>{lineOf(entry)}</span>
                  </button>
                  <button
                    type="button" className={styles.plus} aria-label={addLabel(entry)}
                    title={already.has(librarySlug(entry)) ? "It's on the sheet already: add another copy" : "Add it as it is"} onClick={() => attach(entry)}
                  >
                    <Plus size={13} />
                  </button>
                </div>
              ))}
            </div>
            {results.library.length > LIBRARY_ROWS ? (
              <p className={styles.more}>{results.library.length - LIBRARY_ROWS} more: add a word to narrow it down, or pick a filter.</p>
            ) : null}
          </section>
        ) : null}

        {filter === "all" || filter === "monster" || filter === "features" ? (
          <section className={styles.section} aria-label="From SRD monsters">
            <h5>From SRD monsters</h5>
            {!tokens.length ? (
              <p className={styles.more}>Type to search {abilities ? abilities.length : "the"} abilities of the SRD monsters: a dragon&apos;s breath, a knight&apos;s Parry, Pack Tactics.</p>
            ) : !abilities ? (
              <p className={styles.more}>Loading the monsters&apos; abilities…</p>
            ) : results.monster.length ? (
              <>
                <div className={styles.items}>
                  {results.monster.map((entry) => (
                    <div key={`${entry.monsterId}:${entry.id}`} className={styles.item}>
                      <button type="button" className={styles.itemOpen} disabled={busy !== null} onClick={() => void chooseMonster(entry)}>
                        <span className={styles.itemName}>
                          {entry.name} <span className={styles.itemMeta}>· {entry.monster}{entry.others ? ` and ${entry.others} more` : ""}</span>
                        </span>
                        <span className={styles.itemLine}>{busy === `${entry.monsterId}:${entry.id}` ? "Copying…" : entry.text}</span>
                      </button>
                    </div>
                  ))}
                </div>
                {results.monsterMore ? <p className={styles.more}>{results.monsterMore} more: add a word to narrow it down.</p> : null}
              </>
            ) : (
              <p className={styles.more}>No monster ability matches.</p>
            )}
          </section>
        ) : null}

        {nothing && tokens.length && filter !== "mine" ? <p className={styles.more}>Nothing matches “{query.trim()}”. Start from scratch below, or search Open5e.</p> : null}

        {tokens.length && compendium ? (
          <section className={styles.section} aria-label="Open5e">
            <button
              type="button" className={styles.linkBtn}
              onClick={() => { compendium.setQuery(query.trim()); setOpen5e(true); void compendium.search(open5eItems ? "items" : "spells", query.trim()); }}
            >
              Search Open5e {open5eItems ? "items" : "spells"} for “{query.trim()}” →
            </button>
            {open5e ? (
              <>
                <div className={styles.items}>
                  {open5eItems
                    ? compendium.results.filter((result) => result.resource === "item" || result.resource === "weapon").map((result) => (
                      <div key={result.key} className={styles.item}>
                        <button type="button" className={styles.itemOpen} onClick={() => void compendium.attach(result, definition.id)}>
                          <span className={styles.itemName}>{result.name} <span className={styles.itemMeta}>· {result.documentTitle ?? "Open5e"}</span></span>
                          <span className={styles.itemLine}>Carries it for reference (a weapon attacks): its text, applied by hand.</span>
                        </button>
                      </div>
                    ))
                    : compendium.results.filter((result) => result.resource === "spell").map((result) => (
                      <div key={result.key} className={styles.item}>
                        <button type="button" className={styles.itemOpen} onClick={() => void compendium.importSpell(result.slug, definition.id)}>
                          <span className={styles.itemName}>{result.name} <span className={styles.itemMeta}>· level {result.level ?? 0} · {result.documentTitle ?? "Open5e"}</span></span>
                          <span className={styles.itemLine}>Adds it as reference text: open it and pick how it works to simulate it.</span>
                        </button>
                      </div>
                    ))}
                </div>
                {compendium.status ? <p className={styles.more}>{compendium.status}</p> : null}
              </>
            ) : null}
          </section>
        ) : null}
      </div>

      <section className={styles.section} aria-label="Start from scratch">
        <h5>Start from scratch</h5>
        <div className={styles.blanks}>
          {BLANKS.map((blank) => <button key={blank.kind} type="button" title={blank.title} onClick={() => onBlank(blank.kind)}>{blank.label}</button>)}
        </div>
      </section>
      <p className={styles.footnote}>
        Click a row to check it before it&apos;s added; a library row&apos;s + adds it as it is, or drag it onto the sheet.{" "}
        {SRD_WEAPONS.length} weapons, {SRD_2014_SPELLS.length} 2014 and {SRD_2024_SPELLS.length} 2024 spells,{" "}
        {SRD_FEATURES.length} features, {SRD_ITEMS.length} items and their scrolls{mine.length ? `, and ${mine.length} of your own in My library` : ""}.{" "}
        <a href={SRD_CREDITS_PATH} target="_blank" rel="noopener noreferrer">SRD 5.1 and 5.2 credits · CC-BY-4.0</a>
      </p>
    </div>
  );
}
