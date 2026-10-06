"use client";

import { useState, type FormEvent } from "react";
import { Search } from "lucide-react";
import type { Open5eClassSummary } from "@/adapters";
import type { CatalogEntry } from "@/lib/character-builder";
import styles from "./homebrew.module.css";

/**
 * Open5e's classes and subclasses (PC builder plan, Phase 8d), searched through the server's adapter. An import is a
 * skeleton saved to the account: its features are reference text until the DM makes them runnable. One already imported
 * opens as the account has it (an import never overwrites the DM's edits). The SRD 5.2 classes are bundled already.
 */
export function Open5eImport({ owned, onImported, onOpen }: {
  /** Entry ids the account has. */
  owned: Set<string>;
  onImported: (entry: CatalogEntry) => Promise<void>;
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Open5eClassSummary[] | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function search(event?: FormEvent) {
    event?.preventDefault();
    setStatus("Searching Open5e…");
    try {
      const response = await fetch(`/api/open5e/classes?query=${encodeURIComponent(query.trim())}`);
      const data = await response.json() as { results?: Open5eClassSummary[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? String(response.status));
      setResults((data.results ?? []).filter((result) => result.documentKey !== "srd-2024"));
      setStatus(null);
    } catch (error) {
      setStatus(`Open5e couldn't be searched: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function importOne(result: Open5eClassSummary) {
    setBusy(result.key);
    try {
      const response = await fetch(`/api/open5e/classes/${encodeURIComponent(result.key)}`);
      const data = await response.json() as { entry?: CatalogEntry; error?: string };
      if (!response.ok || !data.entry) throw new Error(data.error ?? String(response.status));
      await onImported(data.entry);
    } catch (error) {
      setStatus(`${result.name} couldn't be imported: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(null);
    }
  }

  const idOf = (result: Open5eClassSummary) => `open5e:${result.subclassOf ? "subclass" : "class"}:${result.key}`;
  return (
    <section className={styles.section} aria-label="Import from Open5e">
      <h4>Import from Open5e</h4>
      <p className={styles.dim}>
        A class or subclass comes in with its hit die, proficiencies, table and features by level, as reference text.
        Open a feature to make it runnable. The SRD 5.2 classes are in the builder already.
      </p>
      <form className={styles.row} onSubmit={(event) => void search(event)}>
        <label className={`${styles.field} ${styles.wide}`}>
          Name
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Leave empty to list them all" aria-label="Open5e class name" />
        </label>
        <button type="submit" className={styles.btn}><Search size={12} /> Search</button>
      </form>
      {status ? <p className={styles.message} role="status">{status}</p> : null}
      {results ? (
        results.length ? (
          <ul className={styles.entryList} aria-label="Open5e classes">
            {results.map((result) => {
              const id = idOf(result);
              return (
                <li key={result.key} className={styles.row}>
                  <span className={styles.wide}>
                    <strong>{result.name}</strong>{" "}
                    <span className={styles.badge}>
                      {result.subclassOf ? `${result.subclassOf.name} subclass · ` : ""}{result.documentTitle ?? result.documentKey ?? "unknown document"}
                    </span>
                  </span>
                  {owned.has(id) ? (
                    <button type="button" className={styles.btn} onClick={() => onOpen(id)} aria-label={`Open your ${result.name}`}>Open yours</button>
                  ) : (
                    <button type="button" className={styles.btn} disabled={busy !== null} onClick={() => void importOne(result)} aria-label={`Import ${result.name}`}>
                      {busy === result.key ? "Importing…" : "Import"}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        ) : <p className={styles.dim}>Nothing by that name (besides the SRD 5.2 classes).</p>
      ) : null}
    </section>
  );
}
