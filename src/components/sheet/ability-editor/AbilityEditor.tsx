"use client";

import { AlertTriangle, BookmarkPlus, ChevronLeft } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import {
  spellcastingAbility,
  withTableRule,
  type ActionDefinition,
  type ActionRider,
  type CreatureDefinition,
  type DeathEffectDefinition,
  type FeatureDefinition,
  type ItemDefinition,
  type LegendaryActionRef,
  type SpellDefinition,
  type WeaponDefinition
} from "@/engine";
import { convertAction, type ConvertibleKind, type ParkedRecords } from "@/lib/ability-editor/conversions";
import { withGrantedAt, type Activation } from "@/lib/ability-editor/features";
import { checkRecordJson } from "@/lib/ability-editor/json";
import { withLegendaryPool, type ParkedLegendary } from "@/lib/ability-editor/legendary";
import { linkedEntry, newSavedId, savedFrom, savedKindOf, type SavedRecord } from "@/lib/ability-editor/my-library";
import { featurePoolsToSeed } from "@/lib/ability-editor/records";
import {
  DEFAULT_LEGENDARY_POOL,
  findAbility,
  withAbility,
  withNewAbilityAt,
  type AbilityInsertTarget,
  type AbilityRecord,
  type AbilityRef,
  type GrantingList
} from "@/lib/ability-editor/refs";
import { sectionsFor, type SectionId } from "@/lib/ability-editor/sections";
import { creaturesToFetch, loadCreatures, newSummonLoop } from "@/lib/ability-editor/spawns";
import { withSpellAction } from "@/lib/ability-editor/spells";
import { abilityWarnings } from "@/lib/ability-editor/validate";
import { deepEqual } from "@/lib/deep-equal";
import { statblockFor, type StatblockEntry } from "@/lib/statblock";
import { useEncounterStore } from "@/store/encounter-store";
import { useMyLibraryStore } from "@/store/my-library-store";
import { useEditorGuard } from "../SheetGuard";
import { UnsavedPrompt } from "../UnsavedPrompt";
import { ActionNotes, useParkedReaction, weaponSection } from "./AbilitySections";
import { actionSection } from "./ActionSections";
import { More } from "./controls";
import { EditorSection } from "./EditorSection";
import { featureSection } from "./FeatureSections";
import { itemSection } from "./ItemSections";
import { JsonView } from "./JsonView";
import { SaveToLibrary } from "./SaveToLibrary";
import { DeathNotes, LegendaryDoes, LegendaryNotes, LegendaryUse } from "./LegendarySections";
import type { NewPools } from "./LimitPicker";
import { spellSection } from "./SpellSections";
import styles from "./ability-editor.module.css";

/**
 * What the editor opens on: an ability already on the creature, a new one headed for a list, or (nested) an ability a
 * feature or item grants, edited inside its parent's editor and handed back to it on Done.
 */
export type AbilityEditorTarget =
  | { mode: "edit"; ref: AbilityRef }
  | {
    mode: "new";
    /** Where it's going: a list, the legendary actions, or what a weapon or feature grants. */
    list: AbilityInsertTarget;
    record: AbilityRecord;
    /** A recipe's sections to fill in: they open, highlighted, and the rest stay closed. */
    focus?: SectionId[];
    /** Pools it spends that the creature may lack (a copied monster ability's), offered as new pools. */
    pools?: Record<string, number>;
    /** Creatures it summons or changes into that the scene may lack (a My library entry's), embedded when it's saved. */
    creatures?: CreatureDefinition[];
    /** Handed back instead of put on the creature: the Homebrew window's class features. */
    commit?: AbilityCommit;
  }
  | {
    mode: "nested";
    /** Where it sits in its parent's granted abilities, on the creature as the parent's editor has it. */
    ref: Extract<AbilityRef, { list: "granted" }>;
    record: ActionDefinition;
    /** Not on the parent yet: Done adds it. */
    isNew: boolean;
    parentName: string;
    onDone: (record: ActionDefinition) => void;
    /** Each change, so the parent counts it as unsaved and a save from outside (switching tab) keeps it. */
    onWorking: (record: ActionDefinition) => void;
  };

/**
 * The Homebrew window's editor (plan Phase 8b): the record goes back to it, with the new pools it spends, instead of onto
 * the creature, which is only a stand-in to preview it on (the class built to the level that grants it).
 */
export interface AbilityCommit {
  /** The save button's label ("Done"). */
  label: string;
  /** What Back returns to ("Rogue, level 3"). */
  backTo: string;
  /** An ability being edited again rather than a new one: its sections open as an edit's do. */
  existing?: boolean;
  onCommit: (record: AbilityRecord, pools: Record<string, number>) => void;
}

/** What the sheet opens the editor on (a nested editor is only ever opened by another editor). */
export type SheetEditorTarget = Exclude<AbilityEditorTarget, { mode: "nested" }>;

export interface AbilityEditorResult {
  /** Where the ability is now, when it was saved. */
  savedRef?: AbilityRef;
}

type RecordType = "weapon" | "item" | "spell" | "action" | "feature" | "legendary" | "death";

/** The sections the editor has fields for, per kind of record (each shows only when it applies). */
const SECTIONS: Record<RecordType, SectionId[]> = {
  weapon: ["basics", "use", "target", "roll", "damage", "effects", "while-active", "grants", "notes"],
  // How many and what using it takes, what it does, what it gives while carried.
  item: ["basics", "armor", "use", "grants", "while-active", "notes"],
  spell: ["basics", "use", "target", "roll", "outcome", "damage", "effects", "while-active", "lingering", "notes"],
  action: ["sequence", "use", "target", "roll", "outcome", "damage", "effects", "while-active", "lingering", "notes"],
  feature: ["basics", "use", "while-active", "aura", "grants", "notes"],
  // Its cost and what it does; an ability of its own has an action's sections.
  legendary: ["use", "does", "sequence", "target", "roll", "outcome", "damage", "effects", "lingering", "notes"],
  // It fires on its own when the creature dies: no cost, and no lingering area.
  death: ["target", "roll", "outcome", "damage", "effects", "notes"]
};

/** The list a ref or an insert target names ("granted" for what a weapon or feature grants). */
function listNameOf(where: AbilityRef | AbilityInsertTarget): string {
  if (typeof where === "string") return where;
  return "list" in where ? where.list : "granted";
}

/** The action that does a record's work, for the sections that edit one: itself, a spell's, a death effect's, a legendary action's own. */
function workingAction(record: AbilityRecord, type: RecordType): ActionDefinition | undefined {
  if (type === "action") return record as ActionDefinition;
  if (type === "spell") return (record as SpellDefinition).action;
  if (type === "death") return (record as DeathEffectDefinition).action;
  if (type === "legendary") return (record as LegendaryActionRef).action;
  return undefined;
}

/** What the ability is after switching to a kind. */
const NOW: Record<ConvertibleKind, string> = {
  attack: "It's an attack roll now.", save: "It's a saving throw now.", "area-save": "It's an area saving throw now.",
  healing: "It heals now.", buff: "It grants a benefit now.", reposition: "It teleports now.", summon: "It summons creatures now.",
  transform: "It changes shape now.", utility: "It takes a standard action now.", unsupported: "It's reference only now."
};

/** What a switch did, said once under "How it works". A save becoming an area (or back) needs no note. */
function conversionNote(from: ActionDefinition["kind"], to: ConvertibleKind, fresh: boolean): string {
  if (fresh || from === "unsupported") return `${NOW[to]} The simulator uses it: check each section below.`;
  if ((from === "save" && to === "area-save") || (from === "area-save" && to === "save")) return "";
  const gates = from === "attack" && (to === "save" || to === "area-save") ? " Its on-hit effects happen on a failed save now."
    : (from === "save" || from === "area-save") && to === "attack" ? " Its failed-save effects happen on a hit now." : "";
  return `${NOW[to]}${gates} Anything that didn't fit is kept: switch back to get it as it was.`;
}

/** The effects (riders) a record carries: a weapon's on-hit effects, or its action's. */
function ridersOf(record: AbilityRecord, type: RecordType): ActionRider[] {
  if (type === "weapon") return (record as WeaponDefinition).onHit ?? [];
  const action = workingAction(record, type);
  return (action && "riders" in action ? action.riders : undefined) ?? [];
}

/** A summon with nothing to summon, or a shapechange with no form, anywhere in the record. */
function emptySpawn(value: unknown): "summon" | "transform" | undefined {
  if (Array.isArray(value)) return value.map(emptySpawn).find(Boolean);
  if (!value || typeof value !== "object") return undefined;
  const record = value as { kind?: unknown; options?: unknown[]; forms?: unknown[] };
  if (record.kind === "summon" && Array.isArray(record.options) && !record.options.length) return "summon";
  if (record.kind === "transform" && Array.isArray(record.forms) && !record.forms.length) return "transform";
  return Object.values(value).map(emptySpawn).find(Boolean);
}

/** Every pool id a record mentions, anywhere inside it: costs, its effects' pools, what it grants. */
function poolIdsIn(value: unknown, into = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) poolIdsIn(item, into);
  } else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (key === "resourceId" && typeof item === "string") into.add(item);
      else poolIdsIn(item, into);
    }
  }
  return into;
}

/** Which new pools a record actually spends (a pool created and then not picked isn't added). */
function poolsUsedBy(record: AbilityRecord, pools: Record<string, number>): Record<string, number> {
  const spent = poolIdsIn(record);
  return Object.fromEntries(Object.entries(pools).filter(([id]) => spent.has(id)));
}

/** An effect anywhere in the record that spends or fills a pool, with none chosen yet. */
function poollessEffect(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(poollessEffect);
  if (!value || typeof value !== "object") return false;
  const record = value as { kind?: unknown; resourceId?: unknown };
  if ((record.kind === "resource-regain" || record.kind === "auto-succeed-save" || record.kind === "survive-lethal") && record.resourceId === "") return true;
  return Object.values(value).some(poollessEffect);
}

/** Something that stops a save: the DM has to fix it first. */
function blockingProblem(record: AbilityRecord, type: RecordType): { message: string; section?: SectionId } | null {
  if (!(record as { name?: string }).name?.trim()) return { message: "Give it a name first." };
  if (ridersOf(record, type).some((rider) => rider.kind !== "note" && rider.resourceCost && !rider.resourceCost.resourceId)) {
    return { message: "Choose which pool an effect's charges come from.", section: "effects" };
  }
  if (poollessEffect((record as { effects?: unknown }).effects) || poollessEffect((record as { grantedActions?: unknown }).grantedActions)
    || poollessEffect((record as { action?: unknown }).action) || ("kind" in record && poollessEffect(record))) {
    return { message: "Choose which pool an effect uses.", section: "while-active" };
  }
  const spawn = emptySpawn(record);
  if (spawn) return { message: spawn === "summon" ? "Pick a creature for it to summon first." : "Pick a form for it to change into first.", section: "outcome" };
  return null;
}

function SupportBadge({ entry }: { entry: StatblockEntry }) {
  const partial = entry.support === "simulated" && entry.notSimulated.length > 0;
  const tone = entry.support === "reference" || entry.support === "no-effect" ? styles.reference : partial ? styles.partial : styles.simulated;
  const label = entry.support === "reference" ? "Reference only" : entry.support === "no-effect" ? "No combat effect" : partial ? "Partly simulated" : "Simulated";
  return (
    <span className={`${styles.support} ${tone}`}>
      <span className={styles.supportDot} aria-hidden />
      {label}
    </span>
  );
}

type Granting = { grantedActions?: ActionDefinition[] };

export function AbilityEditor({ definition, target, onClose, pools: sharedPools, backLabel = "Abilities" }: {
  definition: CreatureDefinition;
  target: AbilityEditorTarget;
  onClose: (result: AbilityEditorResult) => void;
  /** What its back link goes back to: the Abilities tab, or (in the Codex) the tab it was opened from. */
  backLabel?: string;
  /** A nested editor's pools are its parent's: a pool made for a granted ability is saved with the parent. */
  pools?: NewPools;
}) {
  const replaceAbilityRecord = useEncounterStore((s) => s.replaceAbilityRecord);
  const insertAbilityRecord = useEncounterStore((s) => s.insertAbilityRecord);
  const nestedTarget = target.mode === "nested" ? target : undefined;
  const commit = target.mode === "new" ? target.commit : undefined;
  const isNew = (target.mode === "new" && !commit?.existing) || Boolean(nestedTarget?.isNew);
  // A potion that follows the table's rule takes what the rule says as it's edited, as the store will save it.
  const tableRules = useEncounterStore((s) => s.encounter.rules);
  const isItem = listNameOf(target.mode === "new" ? target.list : target.ref) === "items";
  const settle = (record: AbilityRecord): AbilityRecord => (isItem ? withTableRule(record as ItemDefinition, tableRules) : record);
  const [opened] = useState<AbilityRecord>(() => structuredClone(
    target.mode === "edit" ? findAbility(definition, target.ref)! : target.record
  ));
  const [working, setWorking] = useState<AbilityRecord>(() => settle(structuredClone(opened)));
  const [ownPools, setOwnPools] = useState<Record<string, number>>(() => (target.mode === "new" ? { ...(target.pools ?? {}) } : {}));
  const [error, setError] = useState<string | null>(null);
  // "Save your changes?": what Discard does, and what follows a successful save (saving itself closes the editor).
  const [leaving, setLeaving] = useState<{ message: string; discard: () => void; saveLabel?: string; discardLabel?: string } | null>(null);
  // Earlier versions of the action, one per kind it has been this session, and what the last switch did.
  const [parked, setParked] = useState<ParkedRecords>({});
  const [note, setNote] = useState<string | undefined>(undefined);
  // A granted ability open in this editor, nested (index null: a new one), and its edits so far.
  const [nested, setNested] = useState<{ index: number | null; record: ActionDefinition } | null>(null);
  const [nestedWorking, setNestedWorking] = useState<ActionDefinition | null>(null);
  const where: AbilityRef | AbilityInsertTarget = target.mode === "new" ? target.list : target.ref;
  const listName = listNameOf(where);
  const type: RecordType = listName === "weapons" ? "weapon" : listName === "items" ? "item" : listName === "spells" ? "spell" : listName === "features" || listName === "traits" ? "feature"
    : listName === "legendary" ? "legendary" : listName === "deathEffects" ? "death" : "action";
  const available = SECTIONS[type];
  // How many legendary actions it takes a round: a legendary action's editor sets it, saved with it.
  const currentPool = definition.legendary?.pool ?? DEFAULT_LEGENDARY_POOL;
  const [legendaryPool, setLegendaryPool] = useState(currentPool);
  const parkedLegendary = useRef<ParkedLegendary>({});
  // The creatures its summons and shapechanges name that the scene doesn't have yet, fetched from the library.
  const scene = useEncounterStore((s) => s.encounter.definitions);
  const [fetched, setFetched] = useState<CreatureDefinition[]>(() => (target.mode === "new" ? target.creatures ?? [] : [])
    .filter((creature) => !scene.some((candidate) => candidate.id === creature.id)));
  const [unfetchable, setUnfetchable] = useState<string[]>([]);
  // A new record opens every section (a recipe only the ones to fill in); a multiattack opens on its routine.
  const focus = target.mode === "new" ? target.focus ?? [] : [];
  const [open, setOpen] = useState<Set<SectionId>>(() => new Set(focus.length ? focus
    : isNew ? available : type === "action" && (opened as ActionDefinition).kind === "multiattack" ? ["sequence"] : []));
  const parkedReaction = useParkedReaction();
  const parkedActivation = useRef<Activation | undefined>(undefined);
  const rootRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const nameId = useId();

  const ownNewPools: NewPools = useMemo(() => ({ pools: ownPools, add: (id, size) => setOwnPools((current) => ({ ...current, [id]: size })) }), [ownPools]);
  // Pools a save adds on its own (Rage's 3, Legendary Resistance's 3) are offered as the creature's while editing.
  const seeds = useMemo(() => {
    const all = type === "feature" ? featurePoolsToSeed(working as FeatureDefinition) ?? {} : {};
    return Object.fromEntries(Object.entries(all).filter(([id]) => definition.resources?.[id] === undefined));
  }, [type, working, definition]);
  const given = sharedPools ?? ownNewPools;
  const newPools: NewPools = useMemo(() => ({ pools: { ...seeds, ...given.pools }, add: given.add }), [seeds, given]);
  const pools = newPools.pools;
  const name = (working as { name?: string }).name ?? "";
  // What a save writes: the record, with a granted ability still open in it as it stands.
  const merged = nested && nestedWorking ? (withGrantedAt(working as Granting, nested.index, nestedWorking) as AbilityRecord) : working;
  const nestedChanged = Boolean(nested) && (nested!.index === null || !deepEqual(nestedWorking, nested!.record));
  const poolChanged = type === "legendary" && legendaryPool !== currentPool;
  const dirty = !deepEqual(working, opened) || nestedChanged || poolChanged;

  // My library: any ability can be kept there to add to any creature (the sheet isn't changed).
  const savedKind = !nestedTarget && !commit ? savedKindOf(type) : undefined;
  const libraryEntries = useMyLibraryStore((s) => s.entries);
  const saveLibraryEntry = useMyLibraryStore((s) => s.save);
  const [libraryPrompt, setLibraryPrompt] = useState(false);
  const [libraryNote, setLibraryNote] = useState<string | null>(null);
  const linked = savedKind ? linkedEntry(merged as { source?: SavedRecord["source"] }, libraryEntries) : undefined;

  // New pools count as the creature's while editing, so the preview and warnings see them.
  const withPools = useMemo(
    () => (Object.keys(pools).length ? { ...definition, resources: { ...(definition.resources ?? {}), ...pools } } : definition),
    [definition, pools]
  );
  // A legendary action is placed with the round's pool as it is in the editor, so its summary follows the field.
  const placeRecord = (record: AbilityRecord) => {
    const placedRecord = target.mode === "new" ? withNewAbilityAt(withPools, target.list, record) : withAbility(withPools, target.ref, record);
    return type === "legendary" ? { ...placedRecord, definition: withLegendaryPool(placedRecord.definition, legendaryPool) } : placedRecord;
  };
  const placed = useMemo(() => placeRecord(working), [target, withPools, working, legendaryPool]); // eslint-disable-line react-hooks/exhaustive-deps
  const entry = statblockFor(placed.definition, placed.ref);
  const warnings = useMemo(() => abilityWarnings(withPools, where, working), [withPools, where, working]);
  const sectionList = (record: AbilityRecord) => sectionsFor({ ref: placed.ref, record, definition: placed.definition }).filter((section) => available.includes(section.id));
  const sections = sectionList(working);
  const flagged = new Set(warnings.map((warning) => warning.section).filter(Boolean));

  function update(next: AbilityRecord) {
    setWorking(settle(next));
    setError(null);
  }

  // The library creatures it names, fetched as they're picked so a save can embed them (a nested editor's parent does).
  const toFetch = useMemo(
    () => (nestedTarget || commit ? [] : creaturesToFetch(placeRecord(merged).definition, scene, fetched, unfetchable)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [merged, scene, fetched, unfetchable, withPools, nestedTarget, commit]
  );
  const fetchKey = toFetch.join("|");
  useEffect(() => {
    if (!fetchKey) return;
    let live = true;
    const ids = fetchKey.split("|");
    void loadCreatures(ids, [...scene, ...fetched]).then((found) => {
      if (!live) return;
      setFetched((current) => [...current, ...found.filter((creature) => !current.some((have) => have.id === creature.id))]);
      const got = new Set(found.map((creature) => creature.id));
      setUnfetchable((current) => [...current, ...ids.filter((id) => !got.has(id))]);
    });
    return () => { live = false; };
    // Only when what it names changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey]);

  // A nested editor tells its parent about each change.
  useEffect(() => {
    nestedTarget?.onWorking(working as ActionDefinition);
    // Only when the record changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [working]);

  /**
   * Switch what kind of ability it is. A spell with nothing to cast yet gets an action of that kind, spending what the
   * spell does. Sections the new kind brings (Healing, Lingering area) open so it's clear what to fill in.
   */
  function convert(to: ConvertibleKind, then?: (converted: ActionDefinition) => ActionDefinition) {
    const spell = type === "spell" ? (working as SpellDefinition) : undefined;
    const current: ActionDefinition = spell
      ? spell.action ?? { kind: "unsupported", id: "", name: spell.name, actionType: spell.castingTime, automationSupport: "unsupported" }
      : workingAction(working, type)!;
    // "Saving throw" brings back an earlier area when an area is what it was.
    const kind = to === "save" && parked["area-save"] && !parked.save && current.kind !== "area-save" ? "area-save" : to;
    const options = spell ? { spell: true, spellcasting: spellcastingAbility(withPools) } : {};
    const result = convertAction(current, kind, parked, options);
    let action = then ? then(result.action) : result.action;
    // A death effect's or a legendary action's own ability is converted inside it.
    let next: AbilityRecord = type === "death" ? { ...(working as DeathEffectDefinition), action }
      : type === "legendary" ? { ...(working as LegendaryActionRef), action } : action;
    if (spell) {
      if (!spell.action && spell.resourceCost && "resourceCost" in action && !action.resourceCost) action = { ...action, resourceCost: spell.resourceCost } as ActionDefinition;
      const cast = withSpellAction(spell, action);
      next = !spell.action || current.kind === "unsupported" ? { ...cast, automationSupport: "full" } : cast;
    }
    setParked(result.parked);
    setNote(conversionNote(current.kind, kind, Boolean(spell && !spell.action)));
    const before = new Set(sections.map((section) => section.id));
    const added = sectionList(next).map((section) => section.id).filter((id) => !before.has(id));
    if (added.length) setOpen((currentOpen) => new Set([...currentOpen, ...added]));
    update(next);
  }

  function close(result: AbilityEditorResult = {}) {
    setLeaving(null);
    onClose(result);
  }

  function save(): boolean {
    if (nested && nestedWorking) {
      const nestedProblem = blockingProblem(nestedWorking, "action");
      if (nestedProblem) {
        setError(`${nestedWorking.name || "The ability it grants"}: ${nestedProblem.message}`);
        return false;
      }
    }
    const record = merged;
    const problem = blockingProblem(record, type);
    if (problem) {
      setError(problem.message);
      if (problem.section) setOpen((current) => new Set([...current, problem.section!]));
      else nameRef.current?.focus();
      return false;
    }
    if (nestedTarget) {
      if (dirty || isNew) nestedTarget.onDone(record as ActionDefinition);
      close();
      return true;
    }
    // The Homebrew window's: back to it, with the pools it spends (they become the grant's pool there).
    if (commit) {
      if (dirty || isNew) commit.onCommit(record, poolsUsedBy(record, pools));
      close();
      return true;
    }
    if (!isNew && !dirty) {
      close();
      return true;
    }
    // What it summons or changes into has to be in the scene: wait for the library, and never make a summon loop.
    if (toFetch.length) {
      setError("Still fetching the creatures it summons or changes into from the library: try again in a moment.");
      return false;
    }
    const known = [...scene, ...fetched];
    const loop = newSummonLoop(known, placeRecord(record).definition);
    if (loop) {
      const names = loop.map((id) => known.find((candidate) => candidate.id === id)?.name ?? (id === definition.id ? definition.name : id));
      setError(`That summon would loop back on itself: ${names.join(" → ")}.`);
      setOpen((current) => new Set([...current, "outcome"]));
      return false;
    }
    const used = poolsUsedBy(record, pools);
    const embed = fetched.filter((creature) => !scene.some((candidate) => candidate.id === creature.id));
    const extras = {
      ...(Object.keys(used).length ? { pools: used } : {}),
      ...(type === "legendary" && (isNew || poolChanged) ? { legendaryPool } : {}),
      ...(embed.length ? { embed } : {})
    };
    const savedRef = target.mode === "new"
      ? insertAbilityRecord(definition.id, target.list, record, extras)
      : target.mode === "edit" ? replaceAbilityRecord(definition.id, target.ref, record, extras) : undefined;
    if (!savedRef) {
      setError("It couldn't be saved: this ability isn't on the creature any more (was it undone or deleted?).");
      return false;
    }
    close({ savedRef });
    return true;
  }

  /** "Save to my library": only a record the sheet could save, so the library never holds a broken one. */
  function openLibraryPrompt() {
    const problem = blockingProblem(merged, type);
    if (problem) {
      setError(problem.message);
      if (problem.section) setOpen((current) => new Set([...current, problem.section!]));
      return;
    }
    setLibraryNote(null);
    setLibraryPrompt(true);
  }

  async function saveToLibrary(entryName: string, mode: "new" | "update"): Promise<string | undefined> {
    if (!savedKind) return "This kind of ability can't be kept in My library.";
    const id = mode === "update" && linked ? linked.id : newSavedId();
    const entry = savedFrom(savedKind, merged as SavedRecord, definition, { id, name: entryName, list: listName, newPools: pools, scene: [...scene, ...fetched] });
    const result = await saveLibraryEntry(entry);
    if (!result.entry) return `It wasn't saved: ${result.problem}`;
    setLibraryPrompt(false);
    const brings = result.entry.creatures?.map((creature) => creature.name) ?? [];
    setLibraryNote([
      `Saved “${result.entry.name}” to My library: Add ability lists it for any creature.`,
      ...(brings.length ? [`${joinNames(brings)} ${brings.length === 1 ? "comes" : "come"} with it.`] : []),
      ...(result.entry.steps ? ["On another creature, its steps use that creature's abilities of the same names."] : [])
    ].join(" "));
    return undefined;
  }

  /** "A, B and C". */
  function joinNames(names: string[]): string {
    return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }

  function requestClose() {
    if (!dirty) return close();
    setLeaving(nestedTarget || commit
      ? { message: `Keep your changes to ${name || "this ability"}?`, discard: () => close(), saveLabel: "Keep them", discardLabel: "Discard" }
      : { message: `Save your changes to ${name || "this ability"}?`, discard: () => close() });
  }

  useEditorGuard({ dirty, label: name || "this ability", save, discard: () => close() }, !nestedTarget && !commit);

  // Unsaved changes survive nothing outside the app: ask before the page goes away. (The main page: a popped-out sheet
  // closed with unsaved changes docks back into it instead.)
  useEffect(() => {
    if (!dirty || nestedTarget) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", onBeforeUnload); // main-window only
    return () => window.removeEventListener("beforeunload", onBeforeUnload); // main-window only
  }, [dirty, nestedTarget]);

  useEffect(() => {
    if (isNew) {
      nameRef.current?.focus();
      nameRef.current?.select();
    } else {
      rootRef.current?.focus({ preventScroll: true });
    }
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Back from a granted ability: the editor takes focus again.
  const wasNested = useRef(false);
  useEffect(() => {
    if (wasNested.current && !nested) rootRef.current?.focus({ preventScroll: true });
    wasNested.current = Boolean(nested);
  }, [nested]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      // The editor answers Escape itself; the window around it mustn't close.
      event.stopPropagation();
      if (leaving) setLeaving(null);
      else requestClose();
      return;
    }
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      event.stopPropagation();
      save();
      return;
    }
    // The map pans on Space; inside the editor, Space presses a button.
    if (event.key === " ") event.stopPropagation();
  }

  function showSection(id: SectionId) {
    setOpen((current) => new Set([...current, id]));
    // The editor's own window: the main one's frames stop while it's hidden behind a popped-out sheet.
    (rootRef.current?.ownerDocument.defaultView ?? window).requestAnimationFrame(() => {
      const head = rootRef.current?.querySelector<HTMLButtonElement>(`[data-section="${id}"] button`);
      head?.scrollIntoView({ block: "nearest" });
      head?.focus({ preventScroll: true });
    });
  }

  const toggle = (id: SectionId) => setOpen((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  const allOpen = sections.every((section) => open.has(section.id));

  function openGranted(index: number | null, action: ActionDefinition) {
    setNested({ index, record: structuredClone(action) });
    setNestedWorking(action);
    setError(null);
  }

  // A granted ability open: its editor stands in for this one, which keeps its state underneath.
  if (nested) {
    const parentRecord = withGrantedAt(working as Granting, nested.index, nested.record) as AbilityRecord;
    const parentPlaced = placeRecord(parentRecord);
    const parentRef = parentPlaced.ref as { list: GrantingList; id: string };
    const finish = () => { setNested(null); setNestedWorking(null); };
    return (
      <AbilityEditor
        key={`nested:${nested.index ?? "new"}:${nested.record.id}`}
        definition={parentPlaced.definition}
        pools={newPools}
        target={{
          mode: "nested",
          ref: { list: "granted", parent: { list: parentRef.list, id: parentRef.id }, id: nested.record.id },
          record: nested.record,
          isNew: nested.index === null,
          parentName: name || "this ability",
          onDone: (record) => update(withGrantedAt(working as Granting, nested.index, record) as AbilityRecord),
          onWorking: setNestedWorking
        }}
        onClose={finish}
      />
    );
  }

  const common = { definition: withPools, newPools, parkedReaction, onConvert: convert, conversionNote: note };
  function renderSection(id: SectionId) {
    if (type === "weapon") return weaponSection(id, { weapon: working as WeaponDefinition, onChange: update, definition: withPools, newPools, onOpenGranted: openGranted });
    if (type === "item") return itemSection(id, { item: working as ItemDefinition, onChange: update, definition: withPools, newPools, onOpenGranted: openGranted });
    if (type === "spell") return spellSection(id, { ...common, spell: working as SpellDefinition, onChange: update });
    if (type === "feature") {
      return featureSection(id, {
        feature: working as FeatureDefinition, onChange: update, definition: withPools, newPools, parkedReaction, parkedActivation, onOpenGranted: openGranted
      });
    }
    if (type === "legendary") {
      const entry = working as LegendaryActionRef;
      if (id === "use") return <LegendaryUse entry={entry} onChange={update} pool={legendaryPool} onPool={setLegendaryPool} />;
      if (id === "does") return <LegendaryDoes entry={entry} onChange={update} definition={withPools} parked={parkedLegendary} />;
      if (id === "notes") {
        return (
          <>
            <LegendaryNotes entry={entry} onChange={update} />
            {entry.action ? <ActionNotes action={entry.action} onChange={(action) => update({ ...entry, action })} hideText /> : null}
          </>
        );
      }
      return entry.action ? actionSection(id, { ...common, action: entry.action, onChange: (action) => update({ ...entry, action }), place: "legendary" }) : null;
    }
    if (type === "death") {
      const effect = working as DeathEffectDefinition;
      if (id === "notes") return <DeathNotes effect={effect} onChange={update} />;
      return actionSection(id, { ...common, action: effect.action, onChange: (action) => update({ ...effect, action }), place: "death" });
    }
    return actionSection(id, { ...common, action: working as ActionDefinition, onChange: update, place: listName === "lairActions" ? "lair" : undefined });
  }
  const actionKind = type === "action" ? (working as ActionDefinition).kind : undefined;
  const ACTION_WORDS: Partial<Record<ActionDefinition["kind"], string>> = {
    attack: "attack", multiattack: "multiattack", summon: "summon", transform: "shapechange", utility: "standard action"
  };
  const kindLabel = type === "weapon" ? "weapon" : type === "item" ? "item" : type === "spell" ? "spell"
    : type === "feature" ? (working as FeatureDefinition).category : type === "legendary" ? "legendary action" : type === "death" ? "death effect"
      : listName === "lairActions" ? "lair action" : (actionKind && ACTION_WORDS[actionKind]) ?? "action";

  return (
    <div ref={rootRef} className={styles.editor} tabIndex={-1} onKeyDown={onKeyDown} aria-label={`Edit ${name || `new ${kindLabel}`}`} role="region">
      <div className={styles.stickyHead}>
        <div className={styles.bar}>
          <button
            type="button" className={styles.back} onClick={requestClose}
            aria-label={nestedTarget ? `Back to ${nestedTarget.parentName}` : commit ? `Back to ${commit.backTo}` : `Back to ${backLabel.toLowerCase()}`}
          >
            <ChevronLeft size={15} /> {nestedTarget ? nestedTarget.parentName : commit ? commit.backTo : backLabel}
          </button>
          <span className={styles.crumb}>
            <span>{nestedTarget ? "›" : "/"}</span>{name || (isNew ? `New ${kindLabel}` : "Unnamed")}
          </span>
          {dirty ? <span className={styles.unsaved}>{nestedTarget ? "Changed" : "Unsaved"}</span> : null}
          {savedKind ? (
            <button
              type="button" className={styles.btn} aria-expanded={libraryPrompt} onClick={openLibraryPrompt}
              title="Keep a copy to add to any creature from Add ability › My library"
            >
              <BookmarkPlus size={13} aria-hidden /> Save to my library
            </button>
          ) : null}
          <button type="button" className={styles.btn} onClick={() => close()}>Cancel</button>
          {nestedTarget ? (
            <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={save} title={`Back to ${nestedTarget.parentName}, keeping this (saved with it). Ctrl+Enter`}>
              Done
            </button>
          ) : (
            <button
              type="button" className={`${styles.btn} ${styles.primary}`} onClick={save}
              disabled={!isNew && !dirty} title={!isNew && !dirty ? "Nothing has changed" : "Ctrl+Enter"}
            >
              {commit ? commit.label : isNew ? "Add to sheet" : "Save"}
            </button>
          )}
        </div>
        {entry ? (
          <div className={styles.preview} role="group" aria-label="Preview">
            <p className={styles.previewText}>
              <span className={styles.previewTitle}>{entry.title}.</span> {entry.text}
            </p>
            <SupportBadge entry={entry} />
          </div>
        ) : null}
        {entry?.notSimulated.length ? <p className={styles.notSimulated}>Not simulated: {entry.notSimulated.join(" ")}</p> : null}
      </div>

      {libraryPrompt ? (
        <SaveToLibrary defaultName={linked?.name ?? name} linked={linked} onSave={saveToLibrary} onCancel={() => setLibraryPrompt(false)} />
      ) : null}
      {libraryNote ? <p className={styles.libraryNote} role="status">{libraryNote}</p> : null}
      {leaving ? (
        <UnsavedPrompt
          message={leaving.message}
          saveLabel={leaving.saveLabel}
          discardLabel={leaving.discardLabel}
          onSave={() => { save(); }}
          onDiscard={() => leaving.discard()}
          onKeep={() => setLeaving(null)}
        />
      ) : null}
      {error ? <p className={styles.error} role="alert">{error}</p> : null}
      {warnings.length ? (
        <ul className={styles.warnings} aria-label="Warnings">
          {warnings.map((warning) => (
            <li key={`${warning.id}:${warning.message}`} className={styles.warning}>
              <AlertTriangle size={13} aria-hidden />
              <span>{warning.message}</span>
              {warning.section && sections.some((section) => section.id === warning.section) ? (
                <button type="button" className={styles.linkBtn} onClick={() => showSection(warning.section!)}>Show</button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      <div className={styles.nameRow}>
        <label htmlFor={nameId} className={styles.label}>Name</label>
        <input
          id={nameId} ref={nameRef} value={name} aria-invalid={error !== null && !name.trim()}
          onChange={(event) => {
            // A spell's action carries its name too (the log and the AI show it); so does a feature's activation.
            const renamed = { ...working, name: event.target.value } as AbilityRecord;
            const spell = type === "spell" ? (renamed as SpellDefinition) : undefined;
            if (spell?.action && spell.action.name === (working as SpellDefinition).name) {
              update({ ...spell, action: { ...spell.action, name: event.target.value } });
              return;
            }
            // So does a death effect's action, and a legendary action's own ability, while they share its name.
            const wrapped = type === "death" || type === "legendary" ? (renamed as { action?: ActionDefinition }) : undefined;
            if (wrapped?.action && wrapped.action.name === name) {
              update({ ...renamed, action: { ...wrapped.action, name: event.target.value } } as AbilityRecord);
              return;
            }
            // An item's uses named after it (a potion's drink) follow its name.
            const item = type === "item" ? (renamed as ItemDefinition) : undefined;
            if (item?.grantedActions?.some((action) => action.name === name)) {
              update({ ...item, grantedActions: item.grantedActions.map((action) => (action.name === name ? { ...action, name: event.target.value } : action)) });
              return;
            }
            const feature = type === "feature" ? (renamed as FeatureDefinition) : undefined;
            if (feature?.grantedActions?.some((action) => action.kind === "activate-feature" && action.name === (working as FeatureDefinition).name)) {
              update({
                ...feature,
                grantedActions: feature.grantedActions.map((action) => (action.kind === "activate-feature" && action.name === (working as FeatureDefinition).name
                  ? { ...action, name: event.target.value } : action))
              });
              return;
            }
            update(renamed);
          }}
        />
      </div>

      <div className={styles.sectionsTools}>
        <button type="button" className={styles.linkBtn} onClick={() => setOpen(allOpen ? new Set() : new Set(sections.map((section) => section.id)))}>
          {allOpen ? "Collapse all" : "Expand all"}
        </button>
      </div>
      {sections.map((section) => (
        <EditorSection
          key={section.id}
          id={section.id}
          title={section.title}
          summary={section.summary}
          open={open.has(section.id)}
          onToggle={() => toggle(section.id)}
          flagged={flagged.has(section.id)}
          suggested={focus.includes(section.id)}
        >
          {renderSection(section.id)}
          {section.id === "notes" ? (
            <More set={0} label="Edit as JSON">
              <JsonView record={working} check={(text) => checkRecordJson(text, working, where, withPools)} onApply={update} />
            </More>
          ) : null}
          {section.id === "notes" && entry ? (
            <p className={styles.hint}>
              <SupportBadge entry={entry} />{" "}
              {entry.support === "reference" ? "The AI never uses it; it's on the sheet for you to resolve."
                : entry.support === "no-effect" ? "Nothing in it changes a fight."
                  : entry.notSimulated.length ? `Not simulated: ${entry.notSimulated.join(" ")}` : "Everything it does is simulated."}
            </p>
          ) : null}
        </EditorSection>
      ))}

    </div>
  );
}
