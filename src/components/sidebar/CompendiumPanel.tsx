"use client";

import { Plus, Search } from "lucide-react";
import { Chip, ChipRow } from "@/components/ui/ChipRow";
import type { Compendium } from "@/hooks/useCompendium";
import { COMPENDIUM_CATEGORIES, compendiumMeta, compendiumSnippet, stripMarkup } from "@/lib/compendium";
import styles from "./CompendiumPanel.module.css";

interface CompendiumPanelProps {
  compendium: Compendium;
}

/** SRD / Open5e browser: category chips, search, and draggable result cards. */
export function CompendiumPanel({ compendium }: CompendiumPanelProps) {
  const { tab, setTab, query, setQuery, documentKey, setDocumentKey, results, status, search, attach, onDragStart } =
    compendium;

  return (
    <div className={styles.panel}>
      <ChipRow>
        {COMPENDIUM_CATEGORIES.map((category) => (
          <Chip
            key={category.id}
            label={category.label}
            active={tab === category.id}
            onClick={() => {
              setTab(category.id);
              void search(category.id);
            }}
          />
        ))}
      </ChipRow>

      <div className={styles.searchRow}>
        <input
          value={query}
          placeholder="Search Open5e…"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void search();
          }}
        />
        <button type="button" onClick={() => void search()} title="Search">
          <Search size={15} />
        </button>
      </div>
      <input
        className={styles.sourceFilter}
        value={documentKey}
        placeholder="source document key (optional)"
        aria-label="Source document key"
        onChange={(event) => setDocumentKey(event.target.value)}
      />
      {status ? <p className={styles.status}>{status}</p> : null}

      <ul className={styles.results}>
        {results.map((result, index) => (
          <li
            key={result.key || `${result.documentKey ?? "doc"}-${result.objectKey}-${index}`}
            draggable
            onDragStart={(event) => onDragStart(event, result)}
          >
            <button type="button" className={styles.cardMain} onClick={() => void attach(result)}>
              <strong>{result.name}</strong>
              <span>{compendiumMeta(result)}</span>
              {result.text || result.highlighted ? (
                <small>{compendiumSnippet(result.text ?? stripMarkup(result.highlighted ?? ""))}</small>
              ) : null}
            </button>
            <button type="button" onClick={() => void attach(result)} title="Add to selected sheet">
              <Plus size={14} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
