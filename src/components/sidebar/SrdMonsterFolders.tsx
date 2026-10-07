"use client";

import { ChevronDown, ChevronRight, Folder, Image as ImageIcon, Lock, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { ActorThumbnail } from "@/components/ActorThumbnail";
import { Chip, ChipRow } from "@/components/ui/ChipRow";
import { EditionBadge } from "@/components/ui/Edition";
import { SRD_CREDITS_PATH } from "@/data/srd/attribution";
import { GAP_CODES, SRD_MONSTER_INDEX, type MonsterTier, type SrdMonsterIndexEntry } from "@/data/srd/monsters";
import type { SizeCategory } from "@/engine";
import {
  EMPTY_SRD_FILTERS, SIZE_ORDER, SRD_CR_VALUES, SRD_ENVIRONMENTS,
  activeSrdFilterCount, filterSrdMonsters, withCrRange, type SrdMonsterFilters
} from "@/lib/srd-monster-filter";
import { SRD_ROOT_FOLDER_ID, buildSrdMonsterTree, formatChallengeRating } from "@/lib/srd-monster-tree";
import { TokenArtModal } from "./TokenArtModal";
import { ActorRow } from "./ActorRow";
import styles from "./ActorsPanel.module.css";

interface SrdMonsterFoldersProps {
  /** The Actors tab's search, which narrows this folder with its own filters. */
  query: string;
  /** How many tokens each + or drag adds (the Actors tab's "Add ×"). */
  quantity: number;
  expandedFolderIds: Set<string>;
  onToggleExpanded: (folderId: string) => void;
  /** The row picked in the directory (one at a time, across every folder). */
  selectedId: string | null;
  onSelect: (monsterId: string) => void;
  /** Its sheet, read-only (ACTORS_TAB_PLAN.md D4). */
  onOpen: (monster: SrdMonsterIndexEntry) => void;
  onAdd: (monster: SrdMonsterIndexEntry, faction: "party" | "enemy", quantity: number) => void;
  /** Its menu, at `at`. */
  onMenu: (monster: SrdMonsterIndexEntry, at: { x: number; y: number }) => void;
  onDragStartMonster: (event: DragEvent<HTMLElement>, monster: SrdMonsterIndexEntry, quantity: number) => void;
}

const TIER_LABELS: Array<{ tier: MonsterTier; label: string; hint: string }> = [
  { tier: "full", label: "Full", hint: "Everything is automated" },
  { tier: "partial", label: "Partial", hint: "Core attacks run; some traits are reference-only" },
  { tier: "manual", label: "Manual", hint: "Actions aren't automated" }
];

/** "Add to the map" / "Add 3 to the map". */
function addLabel(quantity: number): string {
  return quantity > 1 ? `Add ${quantity} to the map` : "Add to the map";
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/**
 * The permanent "SRD Monsters → Monster Type → monster" directory. It looks and behaves like the
 * user's own folders (same rows, same expand/collapse, same drag-to-map) but is read-only: no
 * rename, move, delete, or "create actor here", and its sheets open read-only. The Actors tab's
 * search and this folder's filters narrow it; while either is on, the folders that still have
 * matches open by themselves (this one too, while a search finds any).
 */
export function SrdMonsterFolders({ query, quantity, expandedFolderIds, onToggleExpanded, selectedId, onSelect, onOpen, onAdd, onMenu, onDragStartMonster }: SrdMonsterFoldersProps) {
  const [filters, setFilters] = useState<SrdMonsterFilters>(EMPTY_SRD_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  // While filtering, folders default to open; this remembers the ones the user closed anyway.
  const [collapsedWhileFiltering, setCollapsedWhileFiltering] = useState<Set<string>>(new Set());
  const [tokenArtOpen, setTokenArtOpen] = useState(false);

  // A new search opens every folder with a match again.
  useEffect(() => setCollapsedWhileFiltering(new Set()), [query]);

  const searched = useMemo(() => ({ ...filters, query }), [filters, query]);
  // The badge counts this folder's own filters; the search is the Actors tab's.
  const activeCount = activeSrdFilterCount(filters);
  const searching = query.trim() !== "";
  const filtering = activeSrdFilterCount(searched) > 0;
  const total = SRD_MONSTER_INDEX.length;
  const tree = useMemo(() => buildSrdMonsterTree(filterSrdMonsters(SRD_MONSTER_INDEX, searched)), [searched]);
  const rootExpanded = searching
    ? tree.count > 0 && !collapsedWhileFiltering.has(SRD_ROOT_FOLDER_ID)
    : expandedFolderIds.has(SRD_ROOT_FOLDER_ID);

  function update(next: SrdMonsterFilters) {
    setFilters({ ...next, query: "" });
    setCollapsedWhileFiltering(new Set());
  }

  function toggleRoot() {
    if (!searching) {
      onToggleExpanded(SRD_ROOT_FOLDER_ID);
      return;
    }
    setCollapsedWhileFiltering((prev) => {
      const next = new Set(prev);
      if (next.has(SRD_ROOT_FOLDER_ID)) next.delete(SRD_ROOT_FOLDER_ID);
      else next.add(SRD_ROOT_FOLDER_ID);
      return next;
    });
  }

  function isTypeOpen(folderId: string): boolean {
    return filtering ? !collapsedWhileFiltering.has(folderId) : expandedFolderIds.has(folderId);
  }

  function toggleType(folderId: string) {
    if (!filtering) {
      onToggleExpanded(folderId);
      return;
    }
    setCollapsedWhileFiltering((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  return (
    <li className={styles.folderItem} data-testid="srd-monsters-root">
      <div className={`${styles.folderRow} ${styles.folderRowStatic}`} style={{ paddingLeft: 10 }} onClick={toggleRoot}>
        <button type="button" className={styles.folderToggle} aria-label={rootExpanded ? "Collapse SRD Monsters" : "Expand SRD Monsters"} aria-expanded={rootExpanded}>
          {rootExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <Folder size={14} />
        <span className={styles.folderName}>SRD Monsters</span>
        {/* Every one is SRD 5.1: the 2014 rules. */}
        <EditionBadge edition="2014" />
        <span className={styles.folderCount}>{filtering ? `${tree.count} of ${total}` : total}</span>
        <span className={styles.folderLock} title="Permanent, read-only library folder" aria-label="Permanent folder">
          <Lock size={11} />
        </span>
      </div>

      {rootExpanded ? (
        <>
          <div className={styles.srdFilterBar}>
            <div className={styles.srdSearchRow}>
              <button
                type="button"
                className={`${styles.srdFilterToggle} ${showFilters ? styles.srdIconButtonActive : ""}`}
                title="Filter by challenge rating, size, environment, automation and traits"
                aria-label="Filters"
                aria-expanded={showFilters}
                onClick={() => setShowFilters((open) => !open)}
              >
                <SlidersHorizontal size={14} /> Filters
                {activeCount > 0 ? <span className={styles.srdBadge}>{activeCount}</span> : null}
              </button>
              {activeCount > 0 ? (
                <button type="button" className={styles.srdIconButton} title="Clear all filters" aria-label="Clear all filters" onClick={() => update(EMPTY_SRD_FILTERS)}>
                  <X size={14} />
                </button>
              ) : null}
            </div>

            {showFilters ? (
              <div className={styles.srdFilterPanel}>
                <div className={styles.srdSelectRow}>
                  <label className={styles.srdFilterLabel}>
                    CR min
                    <select
                      className={styles.srdSelect}
                      aria-label="Minimum challenge rating"
                      value={filters.crMin === null ? "" : String(filters.crMin)}
                      onChange={(event) => update(withCrRange(filters, { crMin: event.target.value === "" ? null : Number(event.target.value) }))}
                    >
                      <option value="">Any</option>
                      {SRD_CR_VALUES.map((cr) => <option key={cr} value={String(cr)}>{formatChallengeRating(cr)}</option>)}
                    </select>
                  </label>
                  <label className={styles.srdFilterLabel}>
                    CR max
                    <select
                      className={styles.srdSelect}
                      aria-label="Maximum challenge rating"
                      value={filters.crMax === null ? "" : String(filters.crMax)}
                      onChange={(event) => update(withCrRange(filters, { crMax: event.target.value === "" ? null : Number(event.target.value) }))}
                    >
                      <option value="">Any</option>
                      {SRD_CR_VALUES.map((cr) => <option key={cr} value={String(cr)}>{formatChallengeRating(cr)}</option>)}
                    </select>
                  </label>
                  <label className={styles.srdFilterLabel}>
                    Environment
                    <select
                      className={styles.srdSelect}
                      aria-label="Environment"
                      value={filters.environment}
                      onChange={(event) => update({ ...filters, environment: event.target.value })}
                    >
                      <option value="">Any</option>
                      {SRD_ENVIRONMENTS.map((environment) => <option key={environment} value={environment}>{environment}</option>)}
                    </select>
                  </label>
                </div>

                <div className={styles.srdFilterGroup}>
                  <span className={styles.srdFilterCaption}>Size</span>
                  <ChipRow>
                    {SIZE_ORDER.map((size: SizeCategory) => (
                      <Chip key={size} label={size[0]!.toUpperCase() + size.slice(1)} active={filters.sizes.includes(size)} onClick={() => update({ ...filters, sizes: toggle(filters.sizes, size) })} />
                    ))}
                  </ChipRow>
                </div>

                <div className={styles.srdFilterGroup}>
                  <span className={styles.srdFilterCaption}>Automation</span>
                  <ChipRow>
                    {TIER_LABELS.map(({ tier, label }) => (
                      <Chip key={tier} label={label} active={filters.tiers.includes(tier)} onClick={() => update({ ...filters, tiers: toggle(filters.tiers, tier) })} />
                    ))}
                  </ChipRow>
                </div>

                <div className={styles.srdFilterGroup}>
                  <span className={styles.srdFilterCaption}>Traits</span>
                  <ChipRow>
                    <Chip label="Legendary" active={filters.legendary} onClick={() => update({ ...filters, legendary: !filters.legendary })} />
                    <Chip label="Flies" active={filters.flies} onClick={() => update({ ...filters, flies: !filters.flies })} />
                    <Chip label="Spellcaster" active={filters.spellcaster} onClick={() => update({ ...filters, spellcaster: !filters.spellcaster })} />
                  </ChipRow>
                </div>
              </div>
            ) : null}

            {filtering ? (
              <p className={styles.srdResultCount} role="status">
                {tree.count} of {total} monsters
              </p>
            ) : null}
            <div className={styles.srdFooterLinks}>
              {/* Opens in a new tab so the encounter being edited isn't left. */}
              <a className={styles.srdCreditLink} href={SRD_CREDITS_PATH} target="_blank" rel="noopener noreferrer">
                SRD 5.1 credits · CC-BY-4.0
              </a>
              <button type="button" className={styles.srdCreditLink} onClick={() => setTokenArtOpen(true)}>
                <ImageIcon size={11} /> Token art
              </button>
            </div>
          </div>

          <ul className={styles.list}>
            {filtering && tree.count === 0 ? (
              <li className={styles.empty}>
                No monsters match these filters.{" "}
                <button type="button" className={styles.srdLinkButton} onClick={() => update(EMPTY_SRD_FILTERS)}>Clear filters</button>
              </li>
            ) : null}
            {tree.types.map((type) => {
              const expanded = isTypeOpen(type.id);
              return (
                <li className={styles.folderItem} key={type.id}>
                  <div className={`${styles.folderRow} ${styles.folderRowStatic}`} style={{ paddingLeft: 26 }} onClick={() => toggleType(type.id)}>
                    <button type="button" className={styles.folderToggle} aria-label={expanded ? `Collapse ${type.label}` : `Expand ${type.label}`} aria-expanded={expanded}>
                      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </button>
                    <Folder size={14} />
                    <span className={styles.folderName}>{type.label}</span>
                    <span className={styles.folderCount}>{type.monsters.length}</span>
                  </div>
                  {expanded ? (
                    <ul className={styles.list}>
                      {type.monsters.map((monster) => (
                        <ActorRow
                          key={monster.id}
                          name={monster.name}
                          subtitle={`CR ${formatChallengeRating(monster.cr)} · HP ${monster.hp} · AC ${monster.ac}${monster.tier === "full" ? "" : ` · ${monster.tier === "partial" ? "Partial" : "Manual"}`}`}
                          thumbnail={<ActorThumbnail definition={{ name: monster.name, source: { provider: "srd", slug: monster.slug } }} />}
                          title={gapSummary(monster)}
                          selected={selectedId === monster.id}
                          addTitle={`${addLabel(quantity)} as an enemy`}
                          onSelect={() => onSelect(monster.id)}
                          onOpen={() => onOpen(monster)}
                          onAdd={() => onAdd(monster, "enemy", quantity)}
                          onMenu={(at) => onMenu(monster, at)}
                          onDragStart={(event) => onDragStartMonster(event, monster, quantity)}
                        />
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      {/* Portaled: the sidebar must not become the dialog's containing block. */}
      {tokenArtOpen ? createPortal(<TokenArtModal onClose={() => setTokenArtOpen(false)} />, document.body) : null}
    </li>
  );
}

/** Tooltip: what, if anything, the engine doesn't automate for this creature yet. */
function gapSummary(monster: SrdMonsterIndexEntry): string {
  if (monster.gaps.length === 0) return `${monster.name} — fully automated`;
  return `${monster.name} — ${monster.tier === "manual" ? "not automated" : "partly automated"}:\n${monster.gaps.map((code) => `• ${GAP_CODES[code]}`).join("\n")}`;
}
