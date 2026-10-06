"use client";

import { type CSSProperties } from "react";
import { abilityModifier, armorClassOf, initiativeOf, type Ability, type CombatantState, type CreatureDefinition } from "@/engine";
import { cycledSkill, proficiencyOf, saveKind, skillKind, SKILLS, skillName, toggledSave, withSave, withSkill } from "@/lib/actor-sheet/edits";
import { CODEX_PALETTES, hitDiceOf, identityOf, type CodexPaletteId } from "@/lib/actor-sheet/codex";
import { passivePerception } from "@/lib/actor-sheet/summaries";
import { readBuild } from "@/lib/character-builder/summary";
import { hpTone } from "@/lib/combatFeedback";
import { formatBonus } from "@/lib/ui-helpers";
import { useBuilderUiStore } from "@/store/builder-ui-store";
import { useBuildSources } from "@/store/catalog-store";
import { useEncounterStore } from "@/store/encounter-store";
import { abilityList, type ListGroup, type ListRow } from "@/lib/ability-editor/list";
import type { AbilityRef } from "@/lib/ability-editor/refs";
import { ConditionsRow } from "../SheetHeader";
import { SheetNumber, SheetText } from "../SheetInputs";
import { Crest, Filigree, PortraitRing } from "./ornaments";
import { codexDisplay } from "./fonts";
import styles from "./codex.module.css";

const ABILITIES: Array<[Ability, string]> = [
  ["str", "Strength"], ["dex", "Dexterity"], ["con", "Constitution"], ["int", "Intelligence"], ["wis", "Wisdom"], ["cha", "Charisma"]
];
const SHORT: Record<Ability, string> = { str: "Str", dex: "Dex", con: "Con", int: "Int", wis: "Wis", cha: "Cha" };
const KIND_WORDS = { none: "not proficient", proficient: "proficient", expertise: "expertise", custom: "its own number" } as const;

export interface CodexSheetProps {
  combatant: CombatantState;
  definition: CreatureDefinition;
  /** Every token of the creature: with more than one, the hero has the switcher (plan D2). */
  tokens: CombatantState[];
  onShowToken: (combatantId: string) => void;
  palette: CodexPaletteId;
  /** Edit an ability on Standard's Abilities tab, in this window (plan D8). */
  onEditAbility: (ref: AbilityRef) => void;
}

/**
 * The Codex (CHARACTER_SHEET_WINDOWS_PLAN.md Part 3): the Faerie Codex's sheet, in this app's colours, over the same data
 * and store actions as the Standard sheet. It edits what fits on a paper sheet in place; everything else stays on
 * Standard. Creature values reach every token of the creature, and token values the token the switcher shows.
 */
export function CodexSheet({ combatant, definition, tokens, onShowToken, palette, onEditAbility }: CodexSheetProps) {
  const theme = CODEX_PALETTES[palette];
  // The Abilities list's own groups and rows, so the Codex says what Standard says about each.
  const groups = abilityList(definition, combatant);
  const group = (id: ListGroup["id"]) => groups.find((entry) => entry.id === id);
  const actions = (["actions", "bonus", "reactions"] as const).map(group).filter((entry): entry is ListGroup => Boolean(entry));
  const spellcasting = group("spellcasting");
  const items = group("items");
  const traits = group("traits");
  const more = (["legendary", "lair", "death"] as const).map(group).filter((entry): entry is ListGroup => Boolean(entry));
  return (
    <div
      className={`${styles.codex} ${codexDisplay.variable}`}
      data-palette={palette}
      data-dark={theme.dark}
      style={theme.tokens as CSSProperties}
    >
      <Hero combatant={combatant} definition={definition} tokens={tokens} onShowToken={onShowToken} />
      <Abilities definition={definition} />
      <div className={styles.row3}>
        <Vitals combatant={combatant} definition={definition} />
        <Saves definition={definition} />
        <Skills definition={definition} />
      </div>
      {actions.length || items ? (
        <div className={styles.row2}>
          {actions.length ? (
            <RowsPanel id="codex-actions" title="Attacks & actions" groups={actions} onEdit={onEditAbility} />
          ) : null}
          {items ? <RowsPanel id="codex-equipment" title="Equipment" groups={[items]} onEdit={onEditAbility} single /> : null}
        </div>
      ) : null}
      {spellcasting ? <Spellcasting group={spellcasting} combatant={combatant} definition={definition} onEdit={onEditAbility} /> : null}
      {traits || more.length ? (
        <div className={styles.row2}>
          {traits ? <RowsPanel id="codex-features" title="Features & traits" groups={[traits]} onEdit={onEditAbility} single /> : null}
          {more.map((entry) => (
            <RowsPanel key={entry.id} id={`codex-${entry.id}`} title={entry.title} groups={[entry]} onEdit={onEditAbility} single />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ─── abilities: the Abilities list's rows, to read, with Edit ───────────── */

/** A panel of the list's groups: each group's title (unless the panel holds only one), then its rows. */
function RowsPanel({ id, title, groups, onEdit, single }: {
  id: string;
  title: string;
  groups: ListGroup[];
  onEdit: (ref: AbilityRef) => void;
  /** One group, titled by the panel itself. */
  single?: boolean;
}) {
  return (
    <section className={styles.panel} aria-labelledby={id}>
      <h2 className={styles.heading} id={id}>{title}</h2>
      {groups.map((entry) => (
        <div key={entry.id} className={styles.rowGroup}>
          {!single || entry.note ? (
            <h3 className={styles.groupTitle}>
              {single ? null : entry.title}
              {entry.note ? <span>{single ? entry.note : ` · ${entry.note}`}</span> : null}
            </h3>
          ) : null}
          {entry.rows.map((row) => <AbilityRow key={row.key} row={row} onEdit={onEdit} />)}
        </div>
      ))}
    </section>
  );
}

/** One ability: its name and what using it costs, the statblock's line, its chips, and Edit. */
function AbilityRow({ row, onEdit }: { row: ListRow; onEdit: (ref: AbilityRef) => void }) {
  const chips = [...(row.worn ? ["worn"] : []), ...(row.enabled === false ? ["off"] : []), ...row.chips];
  return (
    <div className={styles.abilityRow}>
      <div className={styles.rowText}>
        <span className={styles.rowName}>
          {row.name}
          {row.cost ? <span className={styles.rowCost}> · {row.cost}</span> : null}
        </span>
        {row.line ? <span className={styles.rowLine}>{row.line}</span> : null}
        {chips.length ? <span className={styles.rowChips}>{chips.map((chip) => <span key={chip}>{chip}</span>)}</span> : null}
      </div>
      <button type="button" className={styles.edit} aria-label={`Edit ${row.name}`} onClick={() => onEdit(row.ref)}>Edit</button>
    </div>
  );
}

/* ─── spellcasting ───────────────────────────────────────────────────────── */

const ROMAN = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX"];

/**
 * How it casts (ability, DC, attack bonus), its slots as orbs on the token shown (lit: still there; a lit orb spends
 * one, a dark one gives one back), and its spells by level.
 */
function Spellcasting({ group, combatant, definition, onEdit }: {
  group: ListGroup;
  combatant: CombatantState;
  definition: CreatureDefinition;
  onEdit: (ref: AbilityRef) => void;
}) {
  const updateResource = useEncounterStore((s) => s.updateResource);
  const facts = group.spellcasting;
  const slotted = (group.levels ?? []).filter((level) => level.level > 0 && definition.resources?.[`slot-${level.level}`] !== undefined);
  return (
    <section className={styles.panel} aria-labelledby="codex-spells">
      <h2 className={styles.heading} id="codex-spells">Spellcasting</h2>
      {facts ? (
        <div className={`${styles.plaques} ${styles.plaques3}`}>
          <div className={styles.plaque}>
            <output className={styles.plaqueValue} aria-label="Spellcasting ability">{facts.ability.toUpperCase()}</output>
            <span className={styles.plaqueLabel}>Spellcasting ability</span>
          </div>
          <div className={styles.plaque}>
            <output className={styles.plaqueValue} aria-label="Spell save DC">{facts.dc}</output>
            <span className={styles.plaqueLabel}>Spell save DC</span>
          </div>
          <div className={styles.plaque}>
            <output className={styles.plaqueValue} aria-label="Spell attack bonus">{formatBonus(facts.toHit)}</output>
            <span className={styles.plaqueLabel}>Spell attack bonus</span>
          </div>
        </div>
      ) : null}
      {slotted.length ? (
        <>
          <h3 className={styles.groupTitle}>Spell slots<span> · {combatant.displayName}: lit orbs are slots it still has</span></h3>
          <div className={styles.slots}>
            {slotted.map(({ level }) => {
              const resource = `slot-${level}`;
              const full = definition.resources![resource]!;
              const now = Math.min(full, combatant.resources?.[resource] ?? 0);
              return (
                <div key={level} className={styles.slot} role="group" aria-label={`Level ${level} spell slots: ${now} of ${full}`}>
                  <span className={styles.slotLevel} aria-hidden="true">{ROMAN[level] ?? level}</span>
                  <span className={styles.slotPips}>
                    {Array.from({ length: full }, (_, index) => (
                      <button
                        key={index} type="button" className={styles.pip} data-v={index < now ? 1 : 0}
                        aria-label={`Level ${level} slot ${index + 1}, ${index < now ? "there: spend it" : "spent: get it back"}`}
                        onClick={() => updateResource(combatant.id, resource, index < now ? now - 1 : Math.min(full, now + 1))}
                      />
                    ))}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      ) : null}
      {(group.levels ?? []).map((level) => (
        <div key={level.level} className={styles.rowGroup}>
          <h3 className={styles.groupTitle}>{level.title}{level.slots ? <span> · {level.slots}</span> : null}</h3>
          {level.rows.map((row) => <AbilityRow key={row.key} row={row} onEdit={onEdit} />)}
        </div>
      ))}
    </section>
  );
}


/* ─── the hero ───────────────────────────────────────────────────────────── */

function Hero({ combatant, definition, tokens, onShowToken }: Omit<CodexSheetProps, "palette" | "onEditAbility">) {
  const update = useEncounterStore((s) => s.updateCreatureDefinition);
  const openBuilder = useBuilderUiStore((s) => s.open);
  const sources = useBuildSources();
  const build = readBuild(definition);
  const identity = identityOf(definition, build, sources);
  const initial = Array.from(definition.name.trim() || "?")[0]!.toUpperCase();
  const alignment = (
    <SheetText
      className={styles.inline} label="Alignment" placeholder="unaligned"
      value={definition.alignment ?? ""} onCommit={(value) => update(definition.id, { alignment: value || undefined })}
    />
  );

  return (
    <section className={`${styles.panel} ${styles.hero}`} aria-label="Who it is">
      <Filigree corner="top-left" />
      <Filigree corner="bottom-right" />
      {/* Keyed by the name's first letter: the ring flares when it changes, as the original's initial did. */}
      <PortraitRing key={initial} definition={definition} combatant={combatant} />
      <SheetText className={styles.name} label="Name" value={definition.name} onCommit={(name) => update(definition.id, { name })} />
      <p className={styles.sentence}>
        {identity.level !== undefined ? (
          <>
            A level <strong>{identity.level}</strong> <strong>{identity.what}</strong>
            {identity.species ? <>, <strong>{identity.species}</strong> by birth</> : null}
            {identity.background ? <>, <strong>{identity.background}</strong> by trade</> : null}
            , and {alignment} at heart.
          </>
        ) : (
          <>
            A <strong>{identity.what}</strong>
            {identity.challenge ? <> of challenge <strong>{identity.challenge}</strong></> : null}, {alignment} at heart.
          </>
        )}
      </p>
      <div className={styles.meta}>
        {tokens.length > 1 ? (
          <label>
            Showing{" "}
            <select aria-label="Token shown" value={combatant.id} onChange={(event) => onShowToken(event.target.value)}>
              {tokens.map((token) => (
                <option key={token.id} value={token.id}>{token.displayName} · {token.currentHp}/{definition.maxHp} HP</option>
              ))}
            </select>{" "}
            of {tokens.length} tokens
          </label>
        ) : combatant.displayName !== definition.name ? <span>Token: {combatant.displayName}</span> : null}
        {build ? (
          <>
            <button type="button" disabled={build.levels.length >= 20} onClick={() => openBuilder({ kind: "level-up", definitionId: definition.id })}>
              Level up…
            </button>
            <button type="button" onClick={() => openBuilder({ kind: "edit", definitionId: definition.id })}>Open in the builder…</button>
          </>
        ) : null}
      </div>
    </section>
  );
}

/* ─── ability scores ─────────────────────────────────────────────────────── */

function Abilities({ definition }: { definition: CreatureDefinition }) {
  const updateAbility = useEncounterStore((s) => s.updateCreatureAbility);
  return (
    <section className={styles.abilities} aria-label="Ability scores">
      {ABILITIES.map(([ability, name]) => {
        const score = definition.abilities[ability];
        const step = (by: number) => updateAbility(definition.id, ability, Math.max(1, Math.min(30, score + by)));
        return (
          <div key={ability} className={styles.ability}>
            <span className={styles.abilityName}>{name}</span>
            <div className={styles.crest}>
              <Crest />
              <SheetNumber className={styles.score} label={`${name} score`} value={score} min={1} max={30} onCommit={(next) => updateAbility(definition.id, ability, next)} />
              <button type="button" className={styles.step} aria-label={`Lower ${name}`} disabled={score <= 1} onClick={() => step(-1)}>−</button>
              <button type="button" className={`${styles.step} ${styles.stepUp}`} aria-label={`Raise ${name}`} disabled={score >= 30} onClick={() => step(1)}>+</button>
            </div>
            <output className={styles.gem} aria-label={`${name} modifier`}>{formatBonus(abilityModifier(score))}</output>
          </div>
        );
      })}
    </section>
  );
}

/* ─── vitals ─────────────────────────────────────────────────────────────── */

function Vitals({ combatant, definition }: { combatant: CombatantState; definition: CreatureDefinition }) {
  const update = useEncounterStore((s) => s.updateCreatureDefinition);
  const updateHp = useEncounterStore((s) => s.updateHp);
  const updateCombatant = useEncounterStore((s) => s.updateCombatant);
  const sources = useBuildSources();
  const armored = armorClassOf(definition, combatant);
  // Worn armor (or a formula, Unarmored Defense) works the AC out: it's shown, not typed (as on Stats).
  const workedOut = Boolean(armored.armor || armored.shield || armored.formula);
  const initiative = initiativeOf(definition, combatant);
  const otherModes = (["fly", "swim", "climb", "burrow"] as const).filter((mode) => (definition.movement?.[mode] ?? 0) > 0);
  const max = definition.maxHp;
  const hp = combatant.currentHp;
  const temp = combatant.tempHp ?? 0;
  const ratio = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
  const tempRatio = max > 0 ? Math.max(0, Math.min(1 - ratio, temp / max)) : 0;
  const pc = Boolean(definition.character) || combatant.faction === "party";
  const hitDice = hitDiceOf(readBuild(definition), sources);
  const deathSaves = combatant.deathSaves ?? { successes: 0, failures: 0, stable: false };

  return (
    <section className={styles.panel} aria-labelledby="codex-vitals">
      <h2 className={styles.heading} id="codex-vitals">Vitals</h2>
      <div className={styles.plaques}>
        <div className={styles.plaque}>
          {workedOut ? (
            <output className={styles.plaqueValue} aria-label="Armor class" title={armored.parts.map((part) => `${part.label} ${part.value}`).join(" + ")}>
              {armored.total}
            </output>
          ) : (
            <SheetNumber className={styles.plaqueInput} label="Armor class" value={definition.armorClass} min={0} max={40} onCommit={(armorClass) => update(definition.id, { armorClass })} />
          )}
          <span className={styles.plaqueLabel}>Armor class</span>
        </div>
        <div className={styles.plaque}>
          <output
            className={styles.plaqueValue} aria-label="Initiative"
            title={initiative.features.length ? `With ${initiative.features.join(", ")}` : "Its Dexterity modifier"}
          >
            {formatBonus(initiative.bonus)}
          </output>
          <span className={styles.plaqueLabel}>Initiative{initiative.advantage ? ", with advantage" : ""}</span>
        </div>
        <div className={styles.plaque}>
          <SheetNumber className={styles.plaqueInput} label="Speed" value={definition.speed} min={0} max={999} step={5} onCommit={(speed) => update(definition.id, { speed })} />
          <span className={styles.plaqueLabel}>
            Speed, ft{otherModes.length ? ` · ${otherModes.map((mode) => `${mode} ${definition.movement![mode]}`).join(", ")}` : ""}
          </span>
        </div>
        <div className={styles.plaque}>
          <output className={styles.plaqueValue} aria-label="Proficiency bonus">{formatBonus(proficiencyOf(definition))}</output>
          <span className={styles.plaqueLabel}>Proficiency bonus</span>
        </div>
      </div>

      <div className={styles.hp} role="group" aria-label="Hit points">
        <span className={styles.label}>Hit points{` · ${combatant.displayName}`}</span>
        <div className={styles.hpMain}>
          <button type="button" className={styles.round} aria-label="Lose 1 hit point" disabled={hp <= 0} onClick={() => updateHp(combatant.id, Math.max(0, hp - 1))}>−</button>
          <SheetNumber className={styles.big} label="Current hit points" value={hp} min={0} max={max} onCommit={(next) => updateHp(combatant.id, next)} />
          <span className={styles.slash} aria-hidden="true">/</span>
          <span className={styles.hpMax} aria-label="Maximum hit points" title="Its maximum is set on Standard's Stats">{max}</span>
          <button type="button" className={styles.round} aria-label="Gain 1 hit point" disabled={hp >= max} onClick={() => updateHp(combatant.id, Math.min(max, hp + 1))}>+</button>
        </div>
        <div className={styles.vial} aria-hidden="true">
          <div className={styles.vialFill} data-tone={hpTone(ratio)} style={{ width: `${ratio * 100}%` }} />
          <div className={styles.vialTemp} style={{ left: `${ratio * 100}%`, width: `${tempRatio * 100}%` }} />
        </div>
        <label className={styles.inlineField}>
          Temporary
          <SheetNumber className={styles.inline} label="Temporary hit points" value={temp} min={0} max={999} onCommit={(tempHp) => updateCombatant(combatant.id, { tempHp })} />
        </label>
        <ConditionsRow combatant={combatant} definition={definition} className={styles.conditions} />
      </div>

      {pc ? (
        <div className={styles.death} role="group" aria-label="Death saves">
          <span className={styles.label}>Death saves{deathSaves.stable ? " · stable" : ""}</span>
          <div className={styles.deathRow}>
            <span>Successes</span>
            <Pips count={deathSaves.successes} label="Death save successes" className={styles.good} />
          </div>
          <div className={styles.deathRow}>
            <span>Failures</span>
            <Pips count={deathSaves.failures} label="Death save failures" className={styles.bad} />
          </div>
        </div>
      ) : null}
      {hitDice ? (
        <p className={styles.fact}>
          <span>Hit dice</span>
          <strong>{hitDice}</strong>
        </p>
      ) : null}
    </section>
  );
}

/** Three orbs, `count` of them lit: read-only (the engine keeps death saves: plan D10). */
function Pips({ count, label, className }: { count: number; label: string; className: string }) {
  return (
    <span className={`${styles.pips} ${className}`} role="img" aria-label={`${label}: ${count} of 3`}>
      {[0, 1, 2].map((index) => <span key={index} className={styles.pip} data-v={index < count ? 1 : 0} />)}
    </span>
  );
}

/* ─── saves, Perception and languages ────────────────────────────────────── */

function Saves({ definition }: { definition: CreatureDefinition }) {
  const update = useEncounterStore((s) => s.updateCreatureDefinition);
  return (
    <section className={styles.panel} aria-labelledby="codex-saves">
      <h2 className={styles.heading} id="codex-saves">Saving throws</h2>
      <ul className={styles.checklist}>
        {ABILITIES.map(([ability, name]) => {
          const kind = saveKind(definition, ability);
          const value = definition.saves?.[ability] ?? abilityModifier(definition.abilities[ability]);
          return (
            <li key={ability} className={kind !== "none" ? styles.proficient : undefined}>
              <button
                type="button" className={styles.pip} data-v={kind === "none" ? 0 : 1} data-custom={kind === "custom"}
                aria-pressed={kind !== "none"} aria-label={`${name} saving throw, ${KIND_WORDS[kind]}`}
                title={kind === "custom" ? "Its own number: click to clear it" : kind === "none" ? "Click to make it proficient" : "Proficient: click to clear"}
                onClick={() => update(definition.id, withSave(definition, ability, toggledSave(definition, ability)))}
              />
              <span className={styles.checkName}>{name}</span>
              <span />
              <span className={styles.checkValue}>{formatBonus(value)}</span>
            </li>
          );
        })}
      </ul>
      <div className={styles.passive}>
        <div className={styles.moon} aria-label="Passive Perception">{passivePerception(definition)}</div>
        <span className={styles.passiveLabel}>Passive Perception</span>
      </div>
      <h2 className={styles.heading} id="codex-languages" style={{ marginTop: 16 }}>Languages</h2>
      <SheetText
        className={`${styles.inline} ${styles.languages}`} label="Languages" placeholder="none"
        value={definition.languages ?? ""} onCommit={(languages) => update(definition.id, { languages: languages || undefined })}
      />
    </section>
  );
}

function Skills({ definition }: { definition: CreatureDefinition }) {
  const update = useEncounterStore((s) => s.updateCreatureDefinition);
  // The 18 skills, then any of its own (a statblock's "sixth sense").
  const own = Object.keys(definition.skills ?? {}).filter((id) => !SKILLS.some((skill) => skill.id === id));
  const rows = [...SKILLS.map((skill) => ({ id: skill.id, name: skill.name, ability: skill.ability as Ability | undefined })), ...own.map((id) => ({ id, name: skillName(id), ability: undefined }))];
  return (
    <section className={`${styles.panel} ${styles.skills}`} aria-labelledby="codex-skills">
      <h2 className={styles.heading} id="codex-skills">Skills</h2>
      <p className={styles.hint}>Tap an orb for proficiency, again for expertise, and once more to clear it.</p>
      <ul className={styles.checklist}>
        {rows.map((row) => {
          const kind = skillKind(definition, row.id);
          const value = definition.skills?.[row.id] ?? (row.ability ? abilityModifier(definition.abilities[row.ability]) : 0);
          return (
            <li key={row.id} className={kind !== "none" ? styles.proficient : undefined}>
              <button
                type="button" className={styles.pip} data-v={kind === "expertise" ? 2 : kind === "none" ? 0 : 1} data-custom={kind === "custom"}
                aria-label={`${row.name}, ${KIND_WORDS[kind]}`}
                onClick={() => update(definition.id, withSkill(definition, row.id, cycledSkill(definition, row.id)))}
              />
              <span className={styles.checkName}>{row.name}</span>
              <span className={styles.checkAbility}>{row.ability ? SHORT[row.ability] : ""}</span>
              <span className={styles.checkValue}>{formatBonus(value)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
