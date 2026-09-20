"use client";

import { ChevronDown, ChevronRight, Copy, Folder, Lock, Minus, Plus, Search, SlidersHorizontal, Swords, Users, X } from "lucide-react";
import { useMemo, useState, type DragEvent } from "react";
import { ActorThumbnail } from "@/components/ActorThumbnail";
import { Chip, ChipRow } from "@/components/ui/ChipRow";
import { SRD_CREDITS_PATH } from "@/data/srd/attribution";
import { GAP_CODES, SRD_MONSTER_INDEX, type MonsterTier, type SrdMonsterIndexEntry } from "@/data/srd/monsters";
import type { SizeCategory } from "@/engine";
import {
  EMPTY_SRD_FILTERS, SIZE_ORDER, SRD_CR_VALUES, SRD_ENVIRONMENTS,
  activeSrdFilterCount, filterSrdMonsters, withCrRange, type SrdMonsterFilters
} from "@/lib/srd-monster-filter";
import { SRD_ROOT_FOLDER_ID, buildSrdMonsterTree, formatChallengeRating } from "@/lib/srd-monster-tree";
import { MAX_TOKEN_BATCH } from "@/store/encounter-store";
import styles from "./ActorsPanel.module.css";

interface SrdMonsterFoldersProps {
  expandedFolderIds: Set<string>;
  onToggleExpanded: (folderId: string) => void;
  onAdd: (monster: SrdMonsterIndexEntry, faction: "party" | "enemy", quantity: number) => void;
  onCopyToLibrary: (monster: SrdMonsterIndexEntry) => void;
  onDragStartMonster: (event: DragEvent<HTMLElement>, monster: SrdMonsterIndexEntry, quantity: number) => void;
}

const TIER_LABELS: Array<{ tier: MonsterTier; label: string; hint: string }> = [
  { tier: "full", label: "Full", hint: "Everything is automated" },
  { tier: "partial", label: "Partial", hint: "Core attacks run; some traits are reference-only" },
  { tier: "manual", label: "Manual", hint: "Actions aren't automated" }
];

/** Whole number from 1 to MAX_TOKEN_BATCH; anything unreadable counts as 1. */
function clampQuantity(text: string | number): number {
  const value = Math.floor(Number(text));
  return Number.isFinite(value) ? Math.max(1, Math.min(MAX_TOKEN_BATCH, value)) : 1;
}

/** "Add as party" / "Add 3 as party". */
function addLabel(quantity: number, faction: "party" | "enemy"): string {
  return quantity > 1 ? `Add ${quantity} as ${faction}` : `Add as ${faction}`;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/**
 * The permanent "SRD Monsters → Monster Type → monster" directory. It looks and behaves like the
 * user's own folders (same rows, same expand/collapse, same drag-to-map) but is read-only: no
 * rename, move, delete, context menu, or "create actor here". A search box and filters narrow it;
 * while any filter is on, the folders that still have matches open by themselves.
 */
export function SrdMonsterFolders({ expandedFolderIds, onToggleExpanded, onAdd, onCopyToLibrary, onDragStartMonster }: SrdMonsterFoldersProps) {
  const [filters, setFilters] = useState<SrdMonsterFilters>(EMPTY_SRD_FILTERS);
  const [showFilters, setShowFilters] = useState(false);
  // While filtering, folders default to open; this remembers the ones the user closed anyway.
  const [collapsedWhileFiltering, setCollapsedWhileFiltering] = useState<Set<string>>(new Set());
  // How many tokens each add / drag creates. The text box keeps what's being typed; `quantity` is always valid.
  const [quantityDraft, setQuantityDraft] = useState("1");
  const quantity = clampQuantity(quantityDraft);

  const activeCount = activeSrdFilterCount(filters);
  const filtering = activeCount > 0;
  const total = SRD_MONSTER_INDEX.length;
  const tree = useMemo(() => buildSrdMonsterTree(filterSrdMonsters(SRD_MONSTER_INDEX, filters)), [filters]);
  const rootExpanded = expandedFolderIds.has(SRD_ROOT_FOLDER_ID);

  function update(next: SrdMonsterFilters) {
    setFilters(next);
    setCollapsedWhileFiltering(new Set());
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
      <div className={`${styles.folderRow} ${styles.folderRowStatic}`} style={{ paddingLeft: 10 }} onClick={() => onToggleExpanded(SRD_ROOT_FOLDER_ID)}>
        <button type="button" className={styles.folderToggle} aria-label={rootExpanded ? "Collapse SRD Monsters" : "Expand SRD Monsters"} aria-expanded={rootExpanded}>
          {rootExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <Folder size={14} />
        <span className={styles.folderName}>SRD Monsters</span>
        <span className={styles.folderCount}>{filtering ? `${tree.count} of ${total}` : total}</span>
        <span className={styles.folderLock} title="Permanent, read-only library folder" aria-label="Permanent folder">
          <Lock size={11} />
        </span>
      </div>

      {rootExpanded ? (
        <>
          <div className={styles.srdFilterBar}>
            <div className={styles.srdSearchRow}>
              <Search size={13} className={styles.srdSearchIcon} />
              <input
                type="search"
                className={styles.srdSearchInput}
                placeholder="Search name, family or type…"
                aria-label="Search SRD monsters"
                value={filters.query}
                onChange={(event) => update({ ...filters, query: event.target.value })}
              />
              <button
                type="button"
                className={`${styles.srdIconButton} ${showFilters ? styles.srdIconButtonActive : ""}`}
                title="Filters"
                aria-label="Filters"
                aria-expanded={showFilters}
                onClick={() => setShowFilters((open) => !open)}
              >
                <SlidersHorizontal size={14} />
                {activeCount > 0 ? <span className={styles.srdBadge}>{activeCount}</span> : null}
              </button>
              {filtering ? (
                <button type="button" className={styles.srdIconButton} title="Clear all filters" aria-label="Clear all filters" onClick={() => update(EMPTY_SRD_FILTERS)}>
                  <X size={14} />
                </button>
              ) : null}
            </div>

            <div className={styles.srdQuantityRow}>
              <span className={styles.srdFilterCaption}>Quantity per add</span>
              <div className={styles.srdStepper}>
                <button type="button" aria-label="Decrease quantity" disabled={quantity <= 1} onClick={() => setQuantityDraft(String(quantity - 1))}><Minus size={12} /></button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_TOKEN_BATCH}
                  aria-label="Quantity to add"
                  value={quantityDraft}
                  onChange={(event) => setQuantityDraft(event.target.value)}
                  onBlur={() => setQuantityDraft(String(quantity))}
                />
                <button type="button" aria-label="Increase quantity" disabled={quantity >= MAX_TOKEN_BATCH} onClick={() => setQuantityDraft(String(quantity + 1))}><Plus size={12} /></button>
              </div>
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
            {/* Opens in a new tab so the encounter being edited isn't left. */}
            <a className={styles.srdCreditLink} href={SRD_CREDITS_PATH} target="_blank" rel="noopener noreferrer">
              SRD 5.1 credits · CC-BY-4.0
            </a>
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
                        <li key={monster.id} draggable onDragStart={(event) => onDragStartMonster(event, monster, quantity)} title={gapSummary(monster)}>
                          <ActorThumbnail definition={{ name: monster.name }} />
                          <button type="button" className={styles.cardMain} onClick={() => onAdd(monster, "enemy", quantity)}>
                            <strong>{monster.name}</strong>
                            <span>
                              CR {formatChallengeRating(monster.cr)} · HP {monster.hp} · AC {monster.ac}
                              {monster.tier === "full" ? "" : ` · ${monster.tier === "partial" ? "Partial" : "Manual"}`}
                            </span>
                          </button>
                          <button type="button" onClick={() => onAdd(monster, "party", quantity)} title={addLabel(quantity, "party")}><Users size={14} /></button>
                          <button type="button" onClick={() => onAdd(monster, "enemy", quantity)} title={addLabel(quantity, "enemy")}><Swords size={14} /></button>
                          <button type="button" onClick={() => onCopyToLibrary(monster)} title="Copy to my library (editable)"><Copy size={14} /></button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </li>
  );
}

/** Tooltip: what, if anything, the engine doesn't automate for this creature yet. */
function gapSummary(monster: SrdMonsterIndexEntry): string {
  if (monster.gaps.length === 0) return `${monster.name} — fully automated`;
  return `${monster.name} — ${monster.tier === "manual" ? "not automated" : "partly automated"}:\n${monster.gaps.map((code) => `• ${GAP_CODES[code]}`).join("\n")}`;
}
