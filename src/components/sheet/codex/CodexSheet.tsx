"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import {
  abilityModifier,
  armorClassOf,
  initiativeOf,
  type Ability,
  type CombatantState,
  type ConditionImmunity,
  type CreatureDefinition,
  type CreatureType,
  type DamageAdjustment,
  type DamageType,
  type ItemDefinition,
  type SizeCategory
} from "@/engine";
import { abilityList, type ListGroup, type ListRow } from "@/lib/ability-editor/list";
import { withWorn } from "@/lib/ability-editor/items";
import type { AbilityRef } from "@/lib/ability-editor/refs";
import {
  characterLevel,
  CONDITION_IMMUNITIES,
  cycledSkill,
  proficiencyOf,
  saveKind,
  skillKind,
  SKILLS,
  skillName,
  toggledSave,
  withAdjustment,
  withConditionImmunity,
  withLevel,
  withoutAdjustment,
  withSave,
  withSkill
} from "@/lib/actor-sheet/edits";
import { CODEX_PALETTES, hitDiceOf, identityOf, type CodexPaletteId } from "@/lib/actor-sheet/codex";
import { readBuild } from "@/lib/character-builder/summary";
import { CREATURE_TYPES } from "@/lib/creature-types";
import { readJson, writeJson } from "@/lib/persist";
import { formatBonus } from "@/lib/ui-helpers";
import { useBuilderUiStore } from "@/store/builder-ui-store";
import { useBuildSources } from "@/store/catalog-store";
import { useEncounterStore } from "@/store/encounter-store";
import { DAMAGE_TYPES } from "../ability-editor/DamageLines";
import { ConditionsRow } from "../SheetHeader";
import { SheetNumber, SheetText } from "../SheetInputs";
import { Astrolabe, Portrait } from "./ornaments";
import { codexBody, codexDisplay } from "./fonts";
import styles from "./codex.module.css";

const ABILITIES: Array<[Ability, string]> = [
  ["str", "Strength"], ["dex", "Dexterity"], ["con", "Constitution"], ["int", "Intelligence"], ["wis", "Wisdom"], ["cha", "Charisma"]
];
const SHORT: Record<Ability, string> = { str: "Str", dex: "Dex", con: "Con", int: "Int", wis: "Wis", cha: "Cha" };
const KIND_WORDS = { none: "not proficient", proficient: "proficient", expertise: "expertise", custom: "its own number" } as const;
const SIZES: SizeCategory[] = ["tiny", "small", "medium", "large", "huge", "gargantuan"];
const capitalize = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

type CodexTab = "details" | "items" | "abilities" | "spells";
const TAB_LABELS: Record<CodexTab, string> = { details: "Details", items: "Items", abilities: "Abilities", spells: "Spells" };
const TAB_KEY = "codex-tab";

export interface CodexSheetProps {
  combatant: CombatantState;
  definition: CreatureDefinition;
  /** Every token of the creature: with more than one, the banner has the switcher (plan D2). */
  tokens: CombatantState[];
  onShowToken: (combatantId: string) => void;
  palette: CodexPaletteId;
  /** Edit an ability on Standard's Abilities tab, in this window (plan D8). */
  onEditAbility: (ref: AbilityRef) => void;
}

/**
 * The Codex (CHARACTER_SHEET_WINDOWS_PLAN.md Part 3), in the design of Character Codex.html, over the same data and
 * store actions as the Standard sheet. A banner with its name and level, a sidebar with its portrait and vitals, its
 * ability dials, and tabs: Details, Items, Abilities, Spells. It edits what fits on a paper sheet in place; anything
 * bigger opens in Standard's editor. Creature values reach every token of the creature, and token values the token the
 * switcher shows.
 */
export function CodexSheet({ combatant, definition, tokens, onShowToken, palette, onEditAbility }: CodexSheetProps) {
  const theme = CODEX_PALETTES[palette];
  // The Abilities list's own groups and rows, so the Codex says what Standard says about each.
  const groups = abilityList(definition, combatant);
  const spellcasting = groups.find((group) => group.id === "spellcasting");
  const hasItems = Boolean(definition.weapons?.length || definition.items?.length);
  const available: CodexTab[] = ["details", ...(hasItems ? ["items" as const] : []), "abilities", ...(spellcasting ? ["spells" as const] : [])];
  const [stored, setStored] = useState<CodexTab>(() => readJson<CodexTab>(TAB_KEY, "details"));
  const tab = available.includes(stored) ? stored : "details";
  const choose = (next: CodexTab) => {
    setStored(next);
    writeJson(TAB_KEY, next);
  };

  return (
    <div
      className={`${styles.codex} ${codexDisplay.variable} ${codexBody.variable}`}
      data-palette={palette}
      data-dark={theme.dark}
      style={theme.tokens as CSSProperties}
    >
      <Banner combatant={combatant} definition={definition} tokens={tokens} onShowToken={onShowToken} />
      <div className={styles.sheet}>
        <div className={styles.grid}>
          <Side combatant={combatant} definition={definition} />
          <div className={styles.stack}>
            <AbilityDials definition={definition} />
            <div>
              <div className={styles.tabs} role="tablist" aria-label="Codex sections">
                {available.map((id) => (
                  <button key={id} type="button" role="tab" className={styles.tab} aria-selected={id === tab} onClick={() => choose(id)}>
                    {TAB_LABELS[id]}
                  </button>
                ))}
              </div>
              {tab === "details" ? <Details combatant={combatant} definition={definition} /> : null}
              {tab === "items" ? <Items definition={definition} groups={groups} onEdit={onEditAbility} /> : null}
              {tab === "abilities" ? <Abilities groups={groups} onEdit={onEditAbility} /> : null}
              {tab === "spells" && spellcasting ? <Spells group={spellcasting} combatant={combatant} definition={definition} onEdit={onEditAbility} /> : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const ICONS = {
  bag: "M9 3h6a1 1 0 0 1 1 1v3h3.5A1.5 1.5 0 0 1 21 8.5V12h-7v-1h-4v1H3V8.5A1.5 1.5 0 0 1 4.5 7H8V4a1 1 0 0 1 1-1zm1 2v2h4V5h-4zM3 13.5h7V15h4v-1.5h7v6A1.5 1.5 0 0 1 19.5 21h-15A1.5 1.5 0 0 1 3 19.5v-6z",
  shield: "M12 2l8 3v6.2c0 5-3.4 9.1-8 10.8-4.6-1.7-8-5.8-8-10.8V5l8-3z",
  compass: "M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 2a8 8 0 1 0 0 16 8 8 0 0 0 0-16zm3.5 4.5L13.4 13.4 8.5 15.5l2.1-4.9z",
  chest: "M9 3h6a1 1 0 0 1 1 1v3h3.5A1.5 1.5 0 0 1 21 8.5v11a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19.5v-11A1.5 1.5 0 0 1 4.5 7H8V4a1 1 0 0 1 1-1zm1 2v2h4V5h-4z",
  star: "M12 2l2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2z",
  sword: "M19.5 2H22v2.5L11.4 15.1l1.6 1.6-1.4 1.4-1.6-1.6L7 19.5l1 1-1.4 1.4-4.5-4.5L3.5 16l1 1 2.9-3-1.6-1.6 1.4-1.4 1.6 1.6z"
} as const;

/** A panel's heading, with Character Codex's small copper glyph. */
function Heading({ id, icon, children }: { id: string; icon: keyof typeof ICONS; children: ReactNode }) {
  return (
    <h2 className={styles.ph} id={id}>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS[icon]} /></svg>
      {children}
    </h2>
  );
}

/* ─── the banner ─────────────────────────────────────────────────────────── */

function Banner({ combatant, definition, tokens, onShowToken }: Omit<CodexSheetProps, "palette" | "onEditAbility">) {
  const update = useEncounterStore((s) => s.updateCreatureDefinition);
  const openBuilder = useBuilderUiStore((s) => s.open);
  const sources = useBuildSources();
  const build = readBuild(definition);
  const identity = identityOf(definition, build, sources);
  const character = identity.level !== undefined;

  return (
    <div className={styles.band}>
      <Astrolabe />
      <section className={styles.bandInner} aria-label="Name and level">
        <div className={styles.title}>
          <SheetText className={styles.name} label="Name" value={definition.name} onCommit={(name) => update(definition.id, { name })} />
          <div className={styles.subtitle}>
            <span className={styles.pill} title="What it is">{identity.what}</span>
            {identity.species ? <span className={styles.pill} title="Species">{identity.species}</span> : null}
            {identity.background ? <span className={styles.pill} title="Background">{identity.background}</span> : null}
            <SheetText
              className={styles.pillInput} label="Alignment" placeholder="Alignment"
              value={definition.alignment ?? ""} onCommit={(value) => update(definition.id, { alignment: value || undefined })}
            />
            {tokens.length > 1 ? (
              <select className={styles.pillSelect} aria-label="Token shown" value={combatant.id} onChange={(event) => onShowToken(event.target.value)}>
                {tokens.map((token) => (
                  <option key={token.id} value={token.id}>{token.displayName} · {token.currentHp}/{definition.maxHp} HP</option>
                ))}
              </select>
            ) : combatant.displayName !== definition.name ? <span className={styles.pill}>Token: {combatant.displayName}</span> : null}
          </div>
        </div>
        <div className={styles.lvl}>
          {build ? (
            <div className={styles.lvlButtons}>
              <button type="button" disabled={build.levels.length >= 20} onClick={() => openBuilder({ kind: "level-up", definitionId: definition.id })}>
                Level up…
              </button>
              <button type="button" onClick={() => openBuilder({ kind: "edit", definitionId: definition.id })}>Open in the builder…</button>
            </div>
          ) : null}
          <div className={styles.lv} title={character ? "Level" : "Challenge rating"}>
            {character && !build ? (
              // A hand-made character's level, typed (as on Stats); a built one's comes from its build (D9).
              <SheetNumber
                className={`${styles.bare} ${styles.lvValue}`} label="Level" value={characterLevel(definition)} min={1} max={20}
                onCommit={(level) => update(definition.id, { character: withLevel(definition.character, level) })}
              />
            ) : (
              <output className={styles.lvValue} aria-label={character ? "Level" : "Challenge rating"}>
                {character ? identity.level : identity.challenge ?? "—"}
              </output>
            )}
            <span className={styles.lvLabel} aria-hidden="true">{character ? "Level" : "CR"}</span>
          </div>
        </div>
      </section>
    </div>
  );
}

/* ─── the sidebar: portrait and vitals ───────────────────────────────────── */

function Side({ combatant, definition }: { combatant: CombatantState; definition: CreatureDefinition }) {
  const update = useEncounterStore((s) => s.updateCreatureDefinition);
  const updateHp = useEncounterStore((s) => s.updateHp);
  const updateCombatant = useEncounterStore((s) => s.updateCombatant);
  const sources = useBuildSources();
  const armored = armorClassOf(definition, combatant);
  // Worn armor (or a formula, Unarmored Defense) works the AC out: it's shown, not typed (as on Stats).
  const workedOut = Boolean(armored.armor || armored.shield || armored.formula);
  const initiative = initiativeOf(definition, combatant);
  const max = definition.maxHp;
  const hp = combatant.currentHp;
  const temp = combatant.tempHp ?? 0;
  const ratio = max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
  const tempRatio = max > 0 ? Math.max(0, Math.min(1 - ratio, temp / max)) : 0;
  const pc = Boolean(definition.character) || combatant.faction === "party";
  const hitDice = hitDiceOf(readBuild(definition), sources);
  const deathSaves = combatant.deathSaves ?? { successes: 0, failures: 0, stable: false };

  return (
    <aside className={styles.side} aria-label="Portrait and vitals">
      <Portrait definition={definition} combatant={combatant} />
      <div>
        <div className={styles.tiles}>
          <div className={`${styles.tile} ${styles.tileAc}`}>
            {workedOut ? (
              <output className={styles.tileValue} aria-label="Armor class" title={armored.parts.map((part) => `${part.label} ${part.value}`).join(" + ")}>
                {armored.total}
              </output>
            ) : (
              <SheetNumber className={`${styles.bare} ${styles.tileValue}`} label="Armor class" value={definition.armorClass} min={0} max={40} onCommit={(armorClass) => update(definition.id, { armorClass })} />
            )}
            <span className={styles.cap}>Armor class</span>
          </div>
          <div className={styles.tile} title={initiative.features.length ? `With ${initiative.features.join(", ")}` : "Its Dexterity modifier"}>
            <output className={styles.tileValue} aria-label="Initiative">{formatBonus(initiative.bonus)}</output>
            <span className={styles.cap}>Initiative{initiative.advantage ? " · adv." : ""}</span>
          </div>
          <div className={styles.tile}>
            <SheetNumber className={`${styles.bare} ${styles.tileValue}`} label="Speed" value={definition.speed} min={0} max={999} step={5} onCommit={(speed) => update(definition.id, { speed })} />
            <span className={styles.cap}>Speed, ft</span>
          </div>
          <div className={styles.tile}>
            <output className={styles.tileValue} aria-label="Proficiency bonus">{formatBonus(proficiencyOf(definition))}</output>
            <span className={styles.cap}>Proficiency</span>
          </div>
        </div>
        <div className={styles.hp} role="group" aria-label="Hit points">
          <div className={styles.hpTop}>
            <span className={styles.cap}>Hit points</span>
            <label className={styles.tmpWrap}>
              <span className={styles.cap}>Temp</span>
              <SheetNumber className={styles.tmp} label="Temporary hit points" value={temp} min={0} max={999} onCommit={(tempHp) => updateCombatant(combatant.id, { tempHp })} />
            </label>
          </div>
          <div className={styles.hpNums}>
            <SheetNumber className={`${styles.bare} ${styles.hpCur}`} label="Current hit points" value={hp} min={0} max={max} onCommit={(next) => updateHp(combatant.id, next)} />
            <span className={styles.slash} aria-hidden="true">/</span>
            <span className={styles.hpMax} aria-label="Maximum hit points" title="Its maximum is set on Standard's Stats">{max}</span>
          </div>
          <div className={styles.hpBar} aria-hidden="true">
            <div className={styles.hpFill} data-low={ratio <= 0.3} style={{ width: `${ratio * 100}%` }} />
            <div className={styles.hpTemp} style={{ left: `${ratio * 100}%`, width: `${tempRatio * 100}%` }} />
          </div>
        </div>
        {hitDice ? (
          <div className={styles.lineField}>
            <span className={styles.cap}>Hit dice</span>
            <span className={styles.lineValue}>{hitDice}</span>
          </div>
        ) : null}
        {pc ? (
          <div className={styles.lineField} role="group" aria-label="Death saves">
            <span className={styles.cap}>Death saves{deathSaves.stable ? " · stable" : ""}</span>
            <span className={styles.ds}>
              <Pips count={deathSaves.successes} label="Death save successes" className={styles.good} />
              <span className={styles.dsSep} aria-hidden="true" />
              <Pips count={deathSaves.failures} label="Death save failures" className={styles.bad} />
            </span>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

/** Three boxes, `count` of them filled: read-only (the engine keeps death saves: plan D10). */
function Pips({ count, label, className }: { count: number; label: string; className: string }) {
  return (
    <span className={`${styles.dpips} ${className}`} role="img" aria-label={`${label}: ${count} of 3`}>
      {[0, 1, 2].map((index) => <span key={index} className={styles.pip} data-v={index < count ? 1 : 0} />)}
    </span>
  );
}

/* ─── ability dials ──────────────────────────────────────────────────────── */

function AbilityDials({ definition }: { definition: CreatureDefinition }) {
  const updateAbility = useEncounterStore((s) => s.updateCreatureAbility);
  return (
    <section className={styles.abilities} aria-label="Ability scores">
      {ABILITIES.map(([ability, name]) => (
        <div key={ability} className={styles.ab}>
          <span className={styles.abName}>{name}</span>
          <div className={styles.dial}>
            <SheetNumber
              className={`${styles.bare} ${styles.abScore}`} label={`${name} score`} value={definition.abilities[ability]} min={1} max={30}
              onCommit={(score) => updateAbility(definition.id, ability, score)}
            />
          </div>
          <output className={styles.abMod} aria-label={`${name} modifier`}>{formatBonus(abilityModifier(definition.abilities[ability]))}</output>
        </div>
      ))}
    </section>
  );
}

/* ─── Details: skills, saves, origin, defenses ───────────────────────────── */

function Details({ combatant, definition }: { combatant: CombatantState; definition: CreatureDefinition }) {
  return (
    <div className={styles.details}>
      <Skills definition={definition} />
      <div className={styles.stack}>
        <Saves definition={definition} />
        <Origin definition={definition} />
        <Defenses combatant={combatant} definition={definition} />
      </div>
    </div>
  );
}

function Skills({ definition }: { definition: CreatureDefinition }) {
  const update = useEncounterStore((s) => s.updateCreatureDefinition);
  // The 18 skills, then any of its own (a statblock's "sixth sense").
  const own = Object.keys(definition.skills ?? {}).filter((id) => !SKILLS.some((skill) => skill.id === id));
  const rows = [
    ...SKILLS.map((skill) => ({ id: skill.id, name: skill.name, ability: skill.ability as Ability | undefined })),
    ...own.map((id) => ({ id, name: skillName(id), ability: undefined }))
  ];
  return (
    <section className={styles.panel} aria-labelledby="codex-skills">
      <Heading id="codex-skills" icon="bag">Skills</Heading>
      <div className={styles.skHead} aria-hidden="true">
        <span />
        <span className={styles.cap}>Skill</span>
        <span />
        <span className={styles.cap}>Bonus</span>
        <span className={styles.cap}>Passive</span>
      </div>
      <ul className={styles.sk}>
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
              <span className={styles.rowName}>{row.name}</span>
              <span className={styles.abbr}>{row.ability ? SHORT[row.ability] : ""}</span>
              <span className={styles.val}>{formatBonus(value)}</span>
              <span className={styles.passive} title={`Passive ${row.name}`}>{10 + value}</span>
            </li>
          );
        })}
      </ul>
      <p className={styles.hint}>Click a box to mark proficiency, again for expertise, and once more to clear it.</p>
    </section>
  );
}

function Saves({ definition }: { definition: CreatureDefinition }) {
  const update = useEncounterStore((s) => s.updateCreatureDefinition);
  return (
    <section className={styles.panel} aria-labelledby="codex-saves">
      <Heading id="codex-saves" icon="shield">Saving throws</Heading>
      <ul className={styles.sv}>
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
              <span className={styles.rowName}>{name}</span>
              <span className={styles.val}>{formatBonus(value)}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** What it is and where it comes from: its type and size (set here), species and background (from its build), languages. */
function Origin({ definition }: { definition: CreatureDefinition }) {
  const update = useEncounterStore((s) => s.updateCreatureDefinition);
  const sources = useBuildSources();
  const identity = identityOf(definition, readBuild(definition), sources);
  return (
    <section className={styles.panel} aria-labelledby="codex-origin">
      <Heading id="codex-origin" icon="compass">Origin</Heading>
      <div className={styles.origin}>
        <label className={styles.og}>
          <span className={styles.cap}>Creature type</span>
          <select className={styles.field} value={definition.type ?? ""} onChange={(event) => update(definition.id, { type: event.target.value ? (event.target.value as CreatureType) : undefined })}>
            <option value="">Unspecified</option>
            {CREATURE_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className={styles.og}>
          <span className={styles.cap}>Size</span>
          <select className={styles.field} value={definition.size} onChange={(event) => update(definition.id, { size: event.target.value as SizeCategory })}>
            {SIZES.map((size) => <option key={size} value={size}>{capitalize(size)}</option>)}
          </select>
        </label>
        {identity.species ? (
          <div className={styles.og}><span className={styles.cap}>Species</span><span className={styles.ogValue}>{identity.species}</span></div>
        ) : null}
        {identity.background ? (
          <div className={styles.og}><span className={styles.cap}>Background</span><span className={styles.ogValue}>{identity.background}</span></div>
        ) : null}
        <label className={styles.og}>
          <span className={styles.cap}>Languages</span>
          <SheetText className={styles.field} label="Languages" placeholder="None" value={definition.languages ?? ""} onCommit={(languages) => update(definition.id, { languages: languages || undefined })} />
        </label>
      </div>
    </section>
  );
}

const DEFENSE_GROUPS: Array<{ type: DamageAdjustment["type"]; title: string; tag: string; add: string }> = [
  { type: "immunity", title: "Immunities", tag: styles.tagImmune, add: "Add immunity" },
  { type: "resistance", title: "Resistances", tag: styles.tagResist, add: "Add resistance" },
  { type: "vulnerability", title: "Vulnerabilities", tag: styles.tagVulnerable, add: "Add vulnerability" }
];

/** Damage it's immune to, resists or is vulnerable to, the conditions it's immune to, and the token's conditions now. */
function Defenses({ combatant, definition }: { combatant: CombatantState; definition: CreatureDefinition }) {
  const update = useEncounterStore((s) => s.updateCreatureDefinition);
  const adjustments = definition.damageAdjustments ?? [];
  const conditionImmunities = definition.conditionImmunities ?? [];
  const absorbs = adjustments.filter((adjustment) => adjustment.type === "absorb");
  const label = (adjustment: DamageAdjustment) => `${adjustment.damageType}${adjustment.nonMagicalOnly ? " (nonmagical)" : ""}`;

  function add(type: DamageAdjustment["type"], value: string) {
    if (!value) return;
    if (value.startsWith("condition:")) update(definition.id, withConditionImmunity(definition, value.slice("condition:".length) as ConditionImmunity, true));
    else update(definition.id, withAdjustment(definition, type, value as DamageType));
  }

  return (
    <section className={styles.panel} aria-labelledby="codex-defenses">
      <Heading id="codex-defenses" icon="shield">Defenses &amp; conditions</Heading>
      {DEFENSE_GROUPS.map((group) => {
        const own = adjustments.filter((adjustment) => adjustment.type === group.type);
        const plain = new Set(own.filter((adjustment) => !adjustment.nonMagicalOnly).map((adjustment) => adjustment.damageType));
        const conditions = group.type === "immunity" ? conditionImmunities : [];
        return (
          <div key={group.type} className={styles.def} role="group" aria-label={group.title}>
            <h3 className={styles.defHead}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS.shield} /></svg>{group.title}</h3>
            <div className={styles.tags}>
              {own.map((adjustment) => (
                <button
                  key={label(adjustment)} type="button" className={`${styles.tag} ${group.tag}`} aria-label={`Remove ${group.type} to ${label(adjustment)}`}
                  onClick={() => update(definition.id, withoutAdjustment(definition, adjustment))}
                >
                  {label(adjustment)}<span aria-hidden="true">×</span>
                </button>
              ))}
              {conditions.map((condition) => (
                <button
                  key={condition} type="button" className={`${styles.tag} ${group.tag}`} aria-label={`Remove immunity to ${condition}`}
                  onClick={() => update(definition.id, withConditionImmunity(definition, condition, false))}
                >
                  {condition}<span aria-hidden="true">×</span>
                </button>
              ))}
              <select className={styles.tagAdd} aria-label={group.add} value="" onChange={(event) => add(group.type, event.target.value)}>
                <option value="">{group.add}…</option>
                <optgroup label="Damage">
                  {DAMAGE_TYPES.filter((type) => !plain.has(type)).map((type) => <option key={type} value={type}>{type}</option>)}
                </optgroup>
                {group.type === "immunity" ? (
                  <optgroup label="Conditions">
                    {CONDITION_IMMUNITIES.filter((condition) => !conditionImmunities.includes(condition)).map((condition) => (
                      <option key={condition} value={`condition:${condition}`}>{condition}</option>
                    ))}
                  </optgroup>
                ) : null}
              </select>
            </div>
          </div>
        );
      })}
      {absorbs.length ? (
        <div className={styles.def}>
          <h3 className={styles.defHead}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS.shield} /></svg>Absorbs (heals instead)</h3>
          <div className={styles.tags}>
            {absorbs.map((adjustment) => <span key={label(adjustment)} className={`${styles.tag} ${styles.tagImmune}`}>{label(adjustment)}</span>)}
          </div>
        </div>
      ) : null}
      <div className={styles.def} role="group" aria-label="Conditions">
        <h3 className={styles.defHead}><svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS.shield} /></svg>Conditions · {combatant.displayName}</h3>
        <ConditionsRow combatant={combatant} definition={definition} className={styles.conditions} />
      </div>
    </section>
  );
}

/* ─── lists: items, abilities, spells ────────────────────────────────────── */

const CHEVRON = <svg viewBox="0 0 10 10" aria-hidden="true"><path d="M3 1l5 4-5 4z" /></svg>;

/**
 * One row of the Abilities list: a chevron that opens its statblock line and chips, its name, what using it costs, how
 * it's used, and Edit (in Standard's editor). `lead` goes between the chevron and the name (the Items tab's worn box).
 */
function Row({ row, activation, lead, onEdit }: { row: ListRow; activation?: string; lead?: ReactNode; onEdit: (ref: AbilityRef) => void }) {
  const [open, setOpen] = useState(false);
  const chips = [...(row.enabled === false ? ["off"] : []), ...row.chips];
  return (
    <div className={styles.li}>
      <div className={`${styles.liRow} ${lead ? "" : styles.liRowNoPip}`}>
        <button type="button" className={styles.chev} aria-expanded={open} aria-label={`${row.name} details`} onClick={() => setOpen(!open)}>{CHEVRON}</button>
        {lead}
        <span className={styles.rowName}>{row.name}</span>
        {row.cost ? <span className={styles.usePill}>{row.cost}</span> : <span />}
        {activation ? <span className={styles.actPill}>{activation}</span> : <span />}
        <button type="button" className={styles.edit} aria-label={`Edit ${row.name}`} onClick={() => onEdit(row.ref)}>Edit</button>
      </div>
      {open ? (
        <div className={styles.ex}>
          {row.line ? <span>{row.line}</span> : null}
          {chips.length ? <span className={styles.exChips}>{chips.map((chip) => <span key={chip}>{chip}</span>)}</span> : null}
          {!row.line && !chips.length ? <span>Edit opens it in Standard&apos;s editor.</span> : null}
        </div>
      ) : null}
    </div>
  );
}

const ITEM_GROUPS: Array<{ id: string; title: string; types?: ItemDefinition["type"][] }> = [
  { id: "weapons", title: "Weapons" },
  { id: "armor", title: "Armor & shields", types: ["armor", "shield"] },
  { id: "consumables", title: "Consumables", types: ["potion", "scroll", "wand", "thrown"] },
  { id: "gear", title: "Gear", types: ["worn", "gear"] }
];

/** Weapons, armor, consumables and gear: the list's own rows, with a box to wear armor or a shield. */
function Items({ definition, groups, onEdit }: { definition: CreatureDefinition; groups: ListGroup[]; onEdit: (ref: AbilityRef) => void }) {
  const replaceAbilityRecord = useEncounterStore((s) => s.replaceAbilityRecord);
  const rows = groups.flatMap((group) => group.rows);
  const itemsGroup = groups.find((group) => group.id === "items");
  const itemOf = (row: ListRow) => (row.ref.list === "items" ? definition.items?.find((item) => "id" in row.ref && item.id === row.ref.id) : undefined);

  return (
    <section className={styles.panel} aria-labelledby="codex-items">
      <Heading id="codex-items" icon="chest">Items</Heading>
      {itemsGroup?.note ? <p className={styles.grpNote}>{itemsGroup.note.replace(/^attuned/, "Attuned")}</p> : null}
      {ITEM_GROUPS.map((group) => {
        const mine = group.types
          ? rows.filter((row) => { const item = itemOf(row); return item !== undefined && group.types!.includes(item.type); })
          : rows.filter((row) => row.ref.list === "weapons");
        if (!mine.length) return null;
        return (
          <div key={group.id} className={styles.grp} role="group" aria-label={group.title}>
            <div className={styles.grpHead}><span className={styles.grpTitle}>{group.title}</span></div>
            {mine.map((row) => {
              const item = itemOf(row);
              const lead = row.worn !== undefined && item ? (
                <button
                  type="button" className={styles.pip} data-v={row.worn ? 1 : 0} aria-pressed={row.worn}
                  aria-label={`${row.name}, ${row.worn ? "worn" : "carried"}`}
                  title="Only worn armor or a worn shield counts toward AC"
                  onClick={() => replaceAbilityRecord(definition.id, row.ref, withWorn(item, !row.worn))}
                />
              ) : <span className={styles.pip} aria-hidden="true" style={{ visibility: "hidden" }} />;
              return <Row key={row.key} row={row} lead={lead} onEdit={onEdit} />;
            })}
          </div>
        );
      })}
      <p className={styles.hint}>A filled box is worn armor or a worn shield. Open a row with the arrow for what it does.</p>
    </section>
  );
}

const ACTIVATION: Partial<Record<ListGroup["id"], string>> = {
  actions: "Action", bonus: "Bonus action", reactions: "Reaction", traits: "Passive", legendary: "Legendary", lair: "Lair", death: "On death"
};

/**
 * Its attacks (its weapons, each with its statblock line in view), then its actions, bonus actions, reactions and
 * features. Items are on Items, spells on Spells.
 */
function Abilities({ groups, onEdit }: { groups: ListGroup[]; onEdit: (ref: AbilityRef) => void }) {
  const attacks = groups.flatMap((group) => group.rows).filter((row) => row.ref.list === "weapons");
  const shown = groups
    .filter((group) => group.id !== "items" && group.id !== "spellcasting")
    .map((group) => ({ ...group, rows: group.rows.filter((row) => row.ref.list !== "weapons") }))
    .filter((group) => group.rows.length);
  return (
    <div className={styles.stack}>
      {attacks.length ? (
        <section className={styles.panel} aria-labelledby="codex-attacks">
          <Heading id="codex-attacks" icon="sword">Attacks</Heading>
          {attacks.map((row) => (
            <div key={row.key} className={styles.atkRow}>
              <span className={styles.rowName}>{row.name}</span>
              <span className={styles.atkLine}>{row.line}</span>
              <button type="button" className={styles.edit} aria-label={`Edit ${row.name}`} onClick={() => onEdit(row.ref)}>Edit</button>
            </div>
          ))}
        </section>
      ) : null}
      <section className={styles.panel} aria-labelledby="codex-abilities">
        <Heading id="codex-abilities" icon="star">Abilities</Heading>
        {shown.length ? shown.map((group) => (
          <div key={group.id} className={styles.grp} role="group" aria-label={group.id === "traits" ? "Features & traits" : group.title}>
            <div className={styles.grpHead}>
              <span className={styles.grpTitle}>{group.id === "traits" ? "Features & traits" : group.title}</span>
              {group.note ? <span className={styles.grpNote}>{group.note}</span> : null}
            </div>
            {group.rows.map((row) => <Row key={row.key} row={row} activation={ACTIVATION[group.id]} onEdit={onEdit} />)}
          </div>
        )) : <p className={styles.empty}>No other abilities yet: add them on Standard&apos;s Abilities tab.</p>}
        <p className={styles.hint}>Open a row with the arrow for what it does. Edit opens it in Standard&apos;s editor.</p>
      </section>
    </div>
  );
}

const LEVEL_NAMES = ["Cantrip", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

/**
 * How it casts (ability, DC, attack bonus), its slots as boxes on the token shown (filled: still there; a filled box
 * spends one, an empty one gives one back), and its spells by level.
 */
function Spells({ group, combatant, definition, onEdit }: { group: ListGroup; combatant: CombatantState; definition: CreatureDefinition; onEdit: (ref: AbilityRef) => void }) {
  const updateResource = useEncounterStore((s) => s.updateResource);
  const facts = group.spellcasting;
  const slotted = (group.levels ?? []).filter((level) => level.level > 0 && definition.resources?.[`slot-${level.level}`] !== undefined);
  return (
    <section className={styles.panel} aria-labelledby="codex-spells">
      <Heading id="codex-spells" icon="star">Spellcasting</Heading>
      {facts ? (
        <div className={styles.stats}>
          <div className={styles.stat}>
            <output className={styles.statValue} aria-label="Spellcasting ability">{facts.ability.toUpperCase()}</output>
            <span className={styles.cap}>Ability</span>
          </div>
          <div className={styles.stat}>
            <output className={styles.statValue} aria-label="Spell save DC">{facts.dc}</output>
            <span className={styles.cap}>Save DC</span>
          </div>
          <div className={styles.stat}>
            <output className={styles.statValue} aria-label="Spell attack bonus">{formatBonus(facts.toHit)}</output>
            <span className={styles.cap}>Attack bonus</span>
          </div>
        </div>
      ) : null}
      {slotted.length ? (
        <>
          <h3 className={styles.sub}>Spell slots · {combatant.displayName}</h3>
          <div className={styles.slots}>
            {slotted.map(({ level }) => {
              const resource = `slot-${level}`;
              const full = definition.resources![resource]!;
              const now = Math.min(full, combatant.resources?.[resource] ?? 0);
              return (
                <div key={level} className={styles.slot} role="group" aria-label={`Level ${level} spell slots: ${now} of ${full}`}>
                  <span className={styles.cap}>{LEVEL_NAMES[level] ?? level}</span>
                  <span className={styles.slotCount}>{now} of {full}</span>
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
          <p className={styles.hint}>Filled boxes are slots it still has. Click one to spend it.</p>
        </>
      ) : null}
      <h3 className={styles.sub}>Spells</h3>
      {(group.levels ?? []).map((level) => (
        <div key={level.level} className={styles.grp}>
          <div className={styles.grpHead}>
            <span className={styles.grpTitle}>{level.title}</span>
            {level.slots ? <span className={styles.grpNote}>{level.slots}</span> : null}
          </div>
          {level.rows.map((row) => <Row key={row.key} row={row} onEdit={onEdit} />)}
        </div>
      ))}
    </section>
  );
}
