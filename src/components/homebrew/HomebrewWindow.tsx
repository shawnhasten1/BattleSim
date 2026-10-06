"use client";

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { Copy, Download, Globe, Save, Trash2, Upload } from "lucide-react";
import type { FeatureDefinition } from "@/engine";
import {
  blankEntry,
  CATALOG_KIND_LABELS,
  CATALOG_KINDS,
  catalogFile,
  copyAsHomebrew,
  entryLabel,
  entryProblems,
  mergeCatalog,
  missingFor,
  previewCharacter,
  readCatalogFile,
  type Catalog,
  type CatalogEntry,
  type CatalogKind,
  type ClassTableColumn
} from "@/lib/character-builder";
import { SRD_BUILD_SOURCES } from "@/lib/character-builder/srd";
import { deepEqual } from "@/lib/deep-equal";
import { downloadJson, safeFileName } from "@/lib/ui-helpers";
import { FloatingWindow } from "@/components/ui/FloatingWindow";
import { AbilityEditor } from "@/components/sheet/ability-editor/AbilityEditor";
import { useCatalogStore } from "@/store/catalog-store";
import { ClassEditor } from "./ClassEditor";
import { HomebrewContext, type HomebrewContextValue } from "./controls";
import { Open5eImport } from "./Open5eImport";
import { BackgroundEditor, FeatEditor, SpeciesEditor, SubclassEditor } from "./OtherEditors";
import styles from "./homebrew.module.css";

/** A feature open in the ability editor, and where it goes back to. */
interface FeatureEdit {
  feature: FeatureDefinition;
  level: number;
  isNew: boolean;
  apply: (feature: FeatureDefinition, pools: Record<string, number>) => void;
}

type Message = { error?: boolean; text: string; details?: string[] };

const key = (item: CatalogEntry) => `${item.kind}|${item.entry.id}`;


/**
 * The Homebrew window (PC builder plan, Phases 8b and 8c): the account's own classes, subclasses, feats, backgrounds and
 * species beside the SRD's. Make one, copy an SRD one, import or export a file; each is edited as a draft and saved to
 * the account, and every character built from it levels with the saved version.
 */
export function HomebrewWindow({ onClose }: { onClose: () => void }) {
  const entries = useCatalogStore((s) => s.entries);
  const status = useCatalogStore((s) => s.status);
  const loadProblems = useCatalogStore((s) => s.problems);
  const load = useCatalogStore((s) => s.load);
  const saveEntries = useCatalogStore((s) => s.save);
  const removeEntry = useCatalogStore((s) => s.remove);
  const [draft, setDraft] = useState<CatalogEntry | null>(null);
  // The draft as last saved: null while it's new.
  const [stored, setStored] = useState<CatalogEntry | null>(null);
  const [editing, setEditing] = useState<FeatureEdit | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [problems, setProblems] = useState<string[] | null>(null);
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const [deleting, setDeleting] = useState(false);
  // The Open5e import panel, in place of an entry's editor.
  const [searching, setSearching] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dirty = draft !== null && !deepEqual(draft, stored);

  // The SRD and the account's entries, with the draft as it stands in place of its saved self.
  const sources = useMemo(
    () => mergeCatalog(SRD_BUILD_SOURCES, [...(draft ? [draft] : []), ...entries.filter((item) => !draft || key(item) !== key(draft))]),
    [draft, entries]
  );
  const taken = useMemo(() => Object.values(sources.catalog).flatMap((list: Array<{ id: string }>) => list.map((entry) => entry.id)), [sources]);

  /** Does `then`, asking first when the open draft has unsaved changes. */
  function leave(then: () => void) {
    if (dirty) setLeaving(() => then);
    else then();
  }

  function openEntry(item: CatalogEntry | null, saved: CatalogEntry | null) {
    setDraft(item ? structuredClone(item) : null);
    setStored(saved);
    setSearching(false);
    setProblems(null);
    setDeleting(false);
    setLeaving(null);
  }

  async function save() {
    if (!draft) return;
    const { saved, problems: refused } = await saveEntries([draft]);
    if (!saved.length) {
      setMessage({ error: true, text: `${draft.entry.name} wasn't saved.`, details: refused });
      return;
    }
    setDraft(saved[0]!);
    setStored(saved[0]!);
    const found = entryProblems(saved[0]!, SRD_BUILD_SOURCES, entries);
    setProblems(found);
    setMessage({ text: found.length ? `Saved ${saved[0]!.entry.name}, but building with it says:` : `Saved ${saved[0]!.entry.name}.` });
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    let read: ReturnType<typeof readCatalogFile>;
    try {
      read = readCatalogFile(JSON.parse(await file.text()));
    } catch {
      setMessage({ error: true, text: `${file.name} isn't JSON.` });
      return;
    }
    if (!read.entries.length) {
      setMessage({ error: true, text: `Nothing in ${file.name} could be imported.`, details: read.problems });
      return;
    }
    const { saved, problems: refused } = await saveEntries(read.entries);
    const merged = mergeCatalog(SRD_BUILD_SOURCES, useCatalogStore.getState().entries);
    const notes = saved.flatMap((item) => missingFor(item, merged.catalog).map((note) => `${item.entry.name}: ${note}`));
    setMessage({
      error: saved.length === 0,
      text: saved.length ? `Imported ${saved.map((item) => item.entry.name).join(", ")}.` : `Nothing in ${file.name} was imported.`,
      details: [...read.problems, ...refused, ...notes]
    });
  }

  async function importFromOpen5e(item: CatalogEntry) {
    const { saved, problems: refused } = await saveEntries([item]);
    if (!saved.length) {
      setMessage({ error: true, text: `${item.entry.name} wasn't imported.`, details: refused });
      return;
    }
    const merged = mergeCatalog(SRD_BUILD_SOURCES, useCatalogStore.getState().entries);
    openEntry(saved[0]!, saved[0]!);
    setMessage({
      text: `Imported ${entryLabel(saved[0]!.entry)}. Its features are reference text: open one to make it runnable.`,
      details: missingFor(saved[0]!, merged.catalog).map((note) => `${saved[0]!.entry.name}: ${note}`)
    });
  }

  async function confirmDelete() {
    if (!draft) return;
    if (stored && !(await removeEntry(draft.kind, draft.entry.id))) {
      setMessage({ error: true, text: `${draft.entry.name} couldn't be deleted.` });
      return;
    }
    setMessage({ text: `Deleted ${draft.entry.name}.` });
    openEntry(null, null);
  }

  const context: HomebrewContextValue = {
    library: sources.library,
    columns: draft ? columnsOf(draft, sources.catalog.classes) : [],
    editFeature: (feature, level, isNew, apply) => setEditing({ feature, level, isNew, apply })
  };

  const srdOfKind = (kind: CatalogKind): CatalogEntry[] => {
    const list = { class: SRD_BUILD_SOURCES.catalog.classes, subclass: SRD_BUILD_SOURCES.catalog.subclasses, feat: SRD_BUILD_SOURCES.catalog.feats, background: SRD_BUILD_SOURCES.catalog.backgrounds, species: SRD_BUILD_SOURCES.catalog.species }[kind];
    return list.map((entry) => ({ kind, entry }) as CatalogEntry);
  };

  // A feature open: the ability editor stands in for the entry's (which stays mounted underneath, keeping its open level
  // and scroll), previewed on the class built to the feature's level.
  const featureEditor = editing && draft ? (
    <AbilityEditor
      definition={previewCharacter(sources, draft.kind === "class" ? draft.entry.id : draft.kind === "subclass" ? draft.entry.classId : undefined, editing.level)}
      target={{
        mode: "new",
        list: "features",
        record: editing.feature,
        commit: {
          label: "Done",
          backTo: `${draft.entry.name}, level ${editing.level}`,
          existing: !editing.isNew,
          onCommit: (record, pools) => editing.apply(record as FeatureDefinition, pools)
        }
      }}
      onClose={() => setEditing(null)}
    />
  ) : null;

  return (
    <FloatingWindow title={featureEditor ? `Homebrew · ${draft!.entry.name}` : "Homebrew"} ariaLabel="Homebrew" onClose={onClose} width={860} storageKey="homebrew">
      <HomebrewContext.Provider value={context}>
        {featureEditor}
        <div className={styles.window} hidden={Boolean(featureEditor)}>
          <nav className={styles.side} aria-label="Homebrew entries">
            <label className={styles.field}>
              New
              <select
                value="" aria-label="New entry"
                onChange={(event) => {
                  const kind = event.target.value as CatalogKind;
                  if (!kind) return;
                  // A new subclass starts on the class open now, or the first class.
                  const classId = draft?.kind === "class" ? draft.entry.id : draft?.kind === "subclass" ? draft.entry.classId : undefined;
                  leave(() => openEntry(blankEntry(kind, `New ${CATALOG_KIND_LABELS[kind].toLowerCase()}`, taken, classId ?? sources.catalog.classes[0]?.id), null));
                }}
              >
                <option value="">Make a new…</option>
                {CATALOG_KINDS.map((kind) => <option key={kind} value={kind}>{CATALOG_KIND_LABELS[kind]}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              Copy an SRD entry
              <select
                value="" aria-label="Copy an SRD entry"
                onChange={(event) => {
                  const [kind, id] = event.target.value.split("|") as [CatalogKind, string];
                  const source = srdOfKind(kind).find((item) => item.entry.id === id);
                  if (source) leave(() => openEntry(copyAsHomebrew(source, taken), null));
                }}
              >
                <option value="">Choose…</option>
                {CATALOG_KINDS.map((kind) => (
                  <optgroup key={kind} label={CATALOG_KIND_LABELS[kind]}>
                    {srdOfKind(kind).map((item) => <option key={item.entry.id} value={`${kind}|${item.entry.id}`}>{item.entry.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </label>
            <div className={styles.row}>
              <button type="button" className={styles.btn} onClick={() => fileRef.current?.click()}><Upload size={12} /> Import…</button>
              <button
                type="button" className={styles.btn} disabled={!entries.length}
                onClick={() => downloadJson("homebrew.catalog.json", catalogFile(entries))}
              >
                <Download size={12} /> Export all
              </button>
              <input ref={fileRef} type="file" accept="application/json,.json" className={styles.hidden} onChange={importFile} aria-label="Import a catalog file" />
            </div>
            <button type="button" className={styles.btn} onClick={() => leave(() => { openEntry(null, null); setSearching(true); })}>
              <Globe size={12} /> Import from Open5e…
            </button>

            {status === "loading" ? <p className={styles.dim}>Loading…</p> : null}
            {status === "failed" ? (
              <p className={styles.dim}>Your homebrew couldn&apos;t be loaded. <button type="button" className={styles.link} onClick={() => void load()}>Try again</button></p>
            ) : null}
            {loadProblems.length ? <p className={styles.dim}>Some entries no longer check out: {loadProblems.join("; ")}</p> : null}
            {CATALOG_KINDS.map((kind) => {
              const ofKind = entries.filter((item) => item.kind === kind);
              if (!ofKind.length) return null;
              return (
                <div key={kind}>
                  <h5 className={styles.kindHead}>{CATALOG_KIND_LABELS[kind]}</h5>
                  <ul className={styles.entryList}>
                    {ofKind.map((item) => (
                      <li key={item.entry.id}>
                        <button
                          type="button" className={styles.entryButton} aria-current={draft !== null && key(draft) === key(item)}
                          onClick={() => leave(() => openEntry(item, item))}
                        >
                          {entryLabel(item.entry)}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {!entries.length && status !== "loading" ? <p className={styles.dim}>No homebrew yet.</p> : null}
          </nav>

          <div className={styles.main}>
            {draft ? (
              <>
                <div className={styles.bar}>
                  <span className={styles.barTitle}>{CATALOG_KIND_LABELS[draft.kind]}: {draft.entry.name}</span>
                  {dirty ? <span className={styles.unsaved}>{stored ? "Unsaved" : "Not saved yet"}</span> : null}
                  <button type="button" className={styles.btn} onClick={() => setProblems(entryProblems(draft, SRD_BUILD_SOURCES, entries))}>Check</button>
                  <button
                    type="button" className={styles.btn} title="Download as a file to import elsewhere"
                    onClick={() => downloadJson(`${safeFileName(draft.entry.name)}.catalog.json`, catalogFile([draft]))}
                  >
                    <Download size={12} /> Export
                  </button>
                  <button type="button" className={`${styles.btn} ${styles.danger}`} onClick={() => setDeleting(true)}><Trash2 size={12} /> Delete</button>
                  <button type="button" className={styles.btn} disabled={!dirty} onClick={() => openEntry(stored, stored)}>Discard</button>
                  <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={!dirty} onClick={() => void save()}><Save size={12} /> Save</button>
                </div>
                <div className={styles.body}>
                  {deleting ? (
                    <p className={styles.message} role="alert">
                      Delete {draft.entry.name}? Characters built from it keep their actors but can&apos;t be leveled until it&apos;s back.{" "}
                      <button type="button" className={styles.link} onClick={() => void confirmDelete()}>Delete it</button>{" · "}
                      <button type="button" className={styles.link} onClick={() => setDeleting(false)}>Keep it</button>
                    </p>
                  ) : null}
                  <Notices message={message} problems={problems} onDismiss={() => setMessage(null)} />
                  {leaving ? (
                    <p className={styles.message} role="alert">
                      {draft.entry.name} has unsaved changes.{" "}
                      <button type="button" className={styles.link} onClick={() => { const then = leaving; setLeaving(null); then(); }}>Discard them</button>{" · "}
                      <button type="button" className={styles.link} onClick={() => setLeaving(null)}>Keep editing</button>
                    </p>
                  ) : null}
                  <EntryEditor item={draft} catalog={sources.catalog} onChange={setDraft} />
                </div>
              </>
            ) : searching ? (
              <div className={styles.body}>
                <Notices message={message} problems={null} onDismiss={() => setMessage(null)} />
                <Open5eImport
                  owned={new Set(entries.map((item) => item.entry.id))}
                  onImported={importFromOpen5e}
                  onOpen={(id) => {
                    const item = entries.find((candidate) => candidate.entry.id === id);
                    if (item) openEntry(item, item);
                  }}
                />
              </div>
            ) : (
              <div className={styles.body}>
                <Notices message={message} problems={null} onDismiss={() => setMessage(null)} />
                <p className={styles.dim}>
                  Your own classes, subclasses, feats, backgrounds and species, beside the SRD&apos;s: make one, copy an SRD one
                  to change, or import a file. What you save here is offered in Create Token&apos;s Character tab and in the
                  builder, and characters built from it level up with it. A subclass can go on an SRD class (an Arcane
                  Trickster on the Rogue).
                </p>
                <p className={styles.dim}>
                  <Copy size={12} /> Copying an SRD class is the quickest start for a variant: it keeps every feature, and you
                  change what&apos;s different.
                </p>
              </div>
            )}
          </div>
        </div>
      </HomebrewContext.Provider>
    </FloatingWindow>
  );
}

/** The table columns an entry's numbers can follow: its own, and a subclass's class's. */
function columnsOf(item: CatalogEntry, classes: Array<{ id: string; table: ClassTableColumn[] }>): ClassTableColumn[] {
  if (item.kind === "class") return item.entry.table;
  if (item.kind === "subclass") return [...(item.entry.table ?? []), ...(classes.find((entry) => entry.id === item.entry.classId)?.table ?? [])];
  return [];
}

function Notices({ message, problems, onDismiss }: { message: Message | null; problems: string[] | null; onDismiss: () => void }) {
  return (
    <>
      {message ? (
        <div className={`${styles.message} ${message.error ? styles.messageError : ""}`} role="status">
          {message.text} <button type="button" className={styles.link} onClick={onDismiss}>Dismiss</button>
          {message.details?.length ? <ul className={styles.problems}>{message.details.map((line) => <li key={line}>{line}</li>)}</ul> : null}
        </div>
      ) : null}
      {problems ? (
        problems.length
          ? <ul className={styles.problems} aria-label="Problems">{problems.slice(0, 12).map((line) => <li key={line}>{line}</li>)}{problems.length > 12 ? <li>…and {problems.length - 12} more</li> : null}</ul>
          : <p className={styles.message} role="status">It builds at every level without a problem.</p>
      ) : null}
    </>
  );
}

function EntryEditor({ item, catalog, onChange }: { item: CatalogEntry; catalog: Catalog; onChange: (next: CatalogEntry) => void }) {
  switch (item.kind) {
    case "class":
      return <ClassEditor entry={item.entry} onChange={(entry) => onChange({ kind: "class", entry })} />;
    case "subclass":
      return <SubclassEditor entry={item.entry} classes={catalog.classes} onChange={(entry) => onChange({ kind: "subclass", entry })} />;
    case "feat":
      return <FeatEditor entry={item.entry} onChange={(entry) => onChange({ kind: "feat", entry })} />;
    case "background":
      return <BackgroundEditor entry={item.entry} feats={catalog.feats} onChange={(entry) => onChange({ kind: "background", entry })} />;
    case "species":
      return <SpeciesEditor entry={item.entry} onChange={(entry) => onChange({ kind: "species", entry })} />;
  }
}
