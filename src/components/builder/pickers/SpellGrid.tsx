"use client";

import { forwardRef, type CSSProperties, type KeyboardEvent } from "react";
import {
  describeSpell,
  gridView,
  suggestedValue,
  type ChoiceSlot,
  type ChoiceValue,
  type GridTile,
  type SpellFacts,
  type SpellFilters,
  type YourSpell
} from "@/lib/character-builder";
import type { BuildSources } from "@/lib/character-builder/build";
import type { EditionChoice } from "@/lib/editions";
import { EditionBadge } from "@/components/ui/Edition";
import { SupportDot, toneColor, useRulesCard } from "@/components/rules-card";
import { choiceTitle, editionOptions } from "../ChoiceControl";
import styles from "../builder.module.css";

export const LEVEL_NAMES = ["Cantrips", "1st level", "2nd level", "3rd level", "4th level", "5th level", "6th level", "7th level", "8th level", "9th level"];
const ORDINALS = ["Cantrips", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];
const COST: Record<SpellFacts["cost"], { mark: string; words: string }> = {
  action: { mark: "●", words: "An action" },
  bonus: { mark: "▲", words: "A bonus action" },
  reaction: { mark: "◆", words: "A reaction" },
  longer: { mark: "◷", words: "A minute or longer" }
};
const asList = (value: ChoiceValue | undefined): string[] => (Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []);

/** A spell as a tile (§3.4): its name, school, cost mark, C and R, the support dot, and an edge in its element's colour. */
export function SpellTile({ tile, chosen, blocked, onToggle, sources, mark }: {
  tile: GridTile;
  chosen: boolean;
  /** Why it can't be picked now (tucked away, or the grid's full); shown in its card. */
  blocked?: string;
  onToggle?: () => void;
  sources: BuildSources;
  /** Show its edition (both editions are listed). */
  mark?: boolean;
}) {
  const cards = useRulesCard();
  const facts = tile.facts;
  const cost = facts ? COST[facts.cost] : undefined;
  const tone = toneColor(facts?.tone);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    const grid = event.currentTarget.closest("[data-spell-grid]");
    const tiles = grid ? [...grid.querySelectorAll<HTMLButtonElement>("[data-spell-tile]")] : [];
    const at = tiles.indexOf(event.currentTarget);
    const next = tiles[(at + step + tiles.length) % tiles.length];
    if (next) {
      event.preventDefault();
      next.focus();
    }
  }

  const bound = cards.bind(() => {
    const entry = describeSpell(tile.id, sources, tile.reference);
    return blocked ? { ...entry, blocked } : entry;
  });
  return (
    <button
      type="button" role="checkbox" aria-checked={chosen} aria-disabled={blocked ? true : undefined} aria-label={tile.name}
      data-spell-tile className={styles.spellTile} data-chosen={chosen || undefined} data-off={blocked ? true : undefined}
      style={tone ? ({ "--tone": tone } as CSSProperties) : undefined}
      {...bound}
      onKeyDown={(event) => { bound.onKeyDown(event); onKeyDown(event); }}
      onClick={() => { if (!blocked || chosen) onToggle?.(); }}
    >
      <span className={styles.tileTop}>
        <span className={styles.tileName}>{tile.name}</span>
        {facts?.concentration ? <span className={styles.tileTag} title="Concentration">C</span> : null}
        {facts?.ritual ? <span className={styles.tileTag} title="Ritual">R</span> : null}
        {mark ? <EditionBadge edition={tile.edition} /> : null}
      </span>
      <span className={styles.tileMeta}>
        <span>{tile.level ? (facts?.school ?? "") : "cantrip"}</span>
        {cost ? <span className={styles.tileCost} data-cost={facts!.cost} title={cost.words}>{cost.mark}</span> : null}
        <SupportDot support={tile.reference ? "manual" : facts?.support ?? "full"} />
      </span>
      {tile.reason && !chosen ? <span className={styles.tileReason}>{tile.reason}</span> : null}
    </button>
  );
}

/** What a grid can choose from: "cantrips", "up to 3rd level", "from your spellbook, up to 3rd level". */
function limitWords(slot: ChoiceSlot, top: number, fromBook: boolean): string {
  if (slot.spec.kind !== "spells") return "";
  if (slot.spec.what === "cantrips" || top === 0) return "cantrips";
  const level = slot.spec.level !== undefined ? `${ORDINALS[top]} level` : `up to ${ORDINALS[top]} level`;
  return fromBook || slot.spec.from === "spellbook" ? `from your spellbook, ${level}` : level;
}

/** What the tucked-away tiles have in common: "14 already in your spellbook", "3 you already have". */
function tuckedWords(tiles: GridTile[]): string {
  const reasons = new Set(tiles.map((tile) => tile.reason));
  const only = reasons.size === 1 ? [...reasons][0] : undefined;
  if (only === "already in the spellbook") return `${tiles.length} already in your spellbook`;
  return only ? `${tiles.length} ${only}` : `${tiles.length} you already have`;
}

/**
 * One spell choice's grid (D4, §3.4). Folded, it's one line of its picks; open, its picks first, then the rest by spell
 * level from the highest down, what the character already has tucked away, under the shared filters. A grid of one swaps
 * a pick; a fuller grid that's full dims the rest.
 */
export const SpellGrid = forwardRef<HTMLDivElement, {
  slot: ChoiceSlot;
  title?: string;
  open: boolean;
  onOpen: (open: boolean) => void;
  filters: SpellFilters;
  onClearFilters: () => void;
  onChange: (value: ChoiceValue | undefined) => void;
  sources: BuildSources;
  edition: EditionChoice;
  showTucked: boolean;
  onShowTucked: (shown: boolean) => void;
  /** It prepares from a spellbook (a wizard's): its header says so. */
  fromBook?: boolean;
}>(function SpellGrid({ slot, title = choiceTitle(slot), open, onOpen, filters, onClearFilters, onChange, sources, edition, showTucked, onShowTucked, fromBook = false }, ref) {
  const { options, mark } = editionOptions(slot, edition);
  const view = gridView(slot, filters, sources, options);
  const picked = asList(slot.value);
  const remaining = Math.max(0, slot.count - picked.length);
  const toggle = (id: string) => {
    if (picked.includes(id)) return onChange(picked.filter((entry) => entry !== id));
    if (slot.count === 1) return onChange([id]);
    if (view.full) return;
    onChange([...picked, id]);
  };
  const fullWords = `${title} is full: remove one to swap`;
  const status = <span className={styles.gridMark} data-open={remaining > 0 || undefined} aria-hidden="true">{remaining ? remaining : "✓"}</span>;

  if (!open) {
    return (
      <div ref={ref} className={styles.gridFolded}>
        <button type="button" className={styles.gridLine} aria-expanded={false} data-open={remaining > 0 || undefined} onClick={() => onOpen(true)}>
          {status}
          <span className={styles.gridTitle}>{title}</span>
          <span className={styles.gridCount}>{picked.length} of {slot.count}</span>
          <span className={styles.gridNames}>{view.chosen.map((tile) => tile.name).join(" · ") || "Nothing chosen yet"}</span>
          <span className={styles.gridAction}>{remaining ? "Choose" : "Change"}</span>
        </button>
      </div>
    );
  }
  return (
    <div ref={ref} role="group" aria-label={title} data-spell-grid={view.key} className={styles.grid} data-open={remaining > 0 || undefined}>
      <div className={styles.gridHeadRow}>
        <button type="button" className={styles.gridHead} aria-expanded onClick={() => onOpen(false)}>
          {status}
          <span className={styles.gridTitle}>{title}</span>
          <span className={styles.gridCount}>{picked.length} of {slot.count}</span>
          <span className={styles.dim}>{limitWords(slot, view.top, fromBook)}</span>
        </button>
        {slot.pending && slot.suggestion !== undefined
          ? <button type="button" className={styles.linkButton} onClick={() => onChange(suggestedValue(slot))}>✦ Choose for me</button>
          : null}
      </div>
      {view.chosen.length ? (
        <div role="group" aria-label={`${title}: chosen`} className={styles.tileRow}>
          <span className={styles.tileRowLabel}>Chosen</span>
          <div className={styles.tiles}>
            {view.chosen.map((tile) => <SpellTile key={tile.id} tile={tile} chosen onToggle={() => toggle(tile.id)} sources={sources} mark={mark} />)}
          </div>
        </div>
      ) : null}
      {view.levels.map((level) => (
        <div key={level.level} role="group" aria-label={`${title}: ${LEVEL_NAMES[level.level]}`} className={styles.tileRow}>
          <span className={styles.tileRowLabel}>{ORDINALS[level.level]}</span>
          <div className={styles.tiles}>
            {level.tiles.map((tile) => (
              <SpellTile
                key={tile.id} tile={tile} chosen={false} sources={sources} mark={mark}
                blocked={view.full && slot.count > 1 ? fullWords : undefined} onToggle={() => toggle(tile.id)}
              />
            ))}
          </div>
        </div>
      ))}
      {view.hidden ? (
        <p className={styles.gridHidden}>
          {view.levels.length ? `${view.hidden} more hidden by the filters.` : "No spells match the filters."}{" "}
          <button type="button" className={styles.linkButton} onClick={onClearFilters}>Clear filters</button>
        </p>
      ) : null}
      {view.tucked.length ? (
        <div className={styles.tucked}>
          <p className={styles.gridHidden}>
            Tucked away: {tuckedWords(view.tucked)}.{" "}
            <button type="button" className={styles.linkButton} aria-expanded={showTucked} onClick={() => onShowTucked(!showTucked)}>{showTucked ? "Hide" : "Show"}</button>
          </p>
          {showTucked ? (
            <div role="group" aria-label={`${title}: tucked away`} className={styles.tiles}>
              {view.tucked.map((tile) => <SpellTile key={tile.id} tile={tile} chosen={false} blocked={tile.reason} sources={sources} mark={mark} />)}
            </div>
          ) : null}
        </div>
      ) : null}
      {slot.problem ? <p className={styles.problem}>{slot.problem}</p> : null}
    </div>
  );
});

/** The filters every grid shares (§3.4): search, school, cost, and what runs, concentration and ritual. */
export function SpellFilterBar({ filters, onChange, schools }: { filters: SpellFilters; onChange: (next: SpellFilters) => void; schools: string[] }) {
  return (
    <div role="search" aria-label="Spell filters" className={styles.filterBar}>
      <input
        type="search" aria-label="Search spells" placeholder="Search spells…" value={filters.query}
        onChange={(event) => onChange({ ...filters, query: event.target.value })}
      />
      <label className={styles.filterField}>
        School
        <select aria-label="School" value={filters.school} onChange={(event) => onChange({ ...filters, school: event.target.value })}>
          <option value="all">All</option>
          {schools.map((school) => <option key={school} value={school}>{school.charAt(0).toUpperCase()}{school.slice(1)}</option>)}
        </select>
      </label>
      <label className={styles.filterField}>
        Cost
        <select aria-label="Cost" value={filters.cost} onChange={(event) => onChange({ ...filters, cost: event.target.value as SpellFilters["cost"] })}>
          <option value="all">All</option>
          <option value="action">● Action</option>
          <option value="bonus">▲ Bonus action</option>
          <option value="reaction">◆ Reaction</option>
          <option value="longer">◷ Longer</option>
        </select>
      </label>
      <label className={styles.filterCheck}><input type="checkbox" checked={filters.runs} onChange={(event) => onChange({ ...filters, runs: event.target.checked })} /> Only spells that run</label>
      <label className={styles.filterCheck}><input type="checkbox" checked={filters.concentration} onChange={(event) => onChange({ ...filters, concentration: event.target.checked })} /> Concentration</label>
      <label className={styles.filterCheck}><input type="checkbox" checked={filters.ritual} onChange={(event) => onChange({ ...filters, ritual: event.target.checked })} /> Ritual</label>
    </div>
  );
}

/**
 * "Your spells" (§3.4): every spell the character has, by level, read-only. P marks a prepared one, ✓ an always-prepared
 * one, and "free" one cast without a slot; clicking one opens the grid that chose it.
 */
export function YourSpellsList({ levels, sources, onOpen }: {
  levels: Array<{ level: number; spells: YourSpell[] }>;
  sources: BuildSources;
  onOpen: (slotKey: string) => void;
}) {
  const cards = useRulesCard();
  if (!levels.length) return <p className={styles.dim}>No spells yet.</p>;
  return (
    <div className={styles.yourSpells}>
      {levels.map((level) => (
        <div key={level.level} className={styles.yourRow}>
          <span className={styles.tileRowLabel}>{ORDINALS[level.level]}</span>
          <div className={styles.yourChips}>
            {level.spells.map((spell) => {
              const tone = toneColor(spell.facts?.tone);
              const tag = spell.always ? "✓" : spell.prepared && spell.level > 0 ? "P" : "";
              return (
                <button
                  key={spell.id} type="button" className={styles.yourChip}
                  title={spell.always ? `Always prepared: ${spell.always}` : spell.free ? `Cast without a slot: ${spell.free}` : undefined}
                  {...cards.bind(() => describeSpell(spell.id, sources))}
                  onClick={() => { if (spell.slots[0]) onOpen(spell.slots[0]); }}
                >
                  <span className={styles.yourTone} style={tone ? { background: tone } : undefined} aria-hidden="true" />
                  {spell.name}
                  {tag ? <span className={styles.yourTag} aria-label={spell.always ? `always prepared (${spell.always})` : "prepared"}>{tag}</span> : null}
                  {spell.free ? <span className={styles.yourTag}>free</span> : null}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
