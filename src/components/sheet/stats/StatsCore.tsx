"use client";

import { X } from "lucide-react";
import { abilityModifier, type Ability, type CreatureDefinition, type CreatureType, type MovementProfile, type SizeCategory } from "@/engine";
import { useEncounterStore } from "@/store/encounter-store";
import { proficiencyOf, saveKind } from "@/lib/actor-sheet/edits";
import { CREATURE_TYPES } from "@/lib/creature-types";
import { formatBonus, sourceLabel } from "@/lib/ui-helpers";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { SheetNumber, SheetText } from "../SheetInputs";
import styles from "../sheet.module.css";

const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];
const SIZES: SizeCategory[] = ["tiny", "small", "medium", "large", "huge", "gargantuan"];
const MODES = ["burrow", "climb", "fly", "swim"] as const;
type Mode = (typeof MODES)[number];

const capitalize = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

const CREATURE_TYPE_HELP = (
  <p>
    Standard 5e creature type. Some spell effects can be restricted to only affect certain types (e.g. a
    condition that only works on undead) — leaving this unspecified means this actor won&apos;t match any
    type-restricted effect.
  </p>
);

const SIZE_HELP = (
  <p>
    Its space on the map: Medium and smaller take one square, Large 2 × 2, Huge 3 × 3, Gargantuan 4 × 4. Its tokens
    grow from their top-left square, and any that would leave the map move back onto it.
  </p>
);

const SAVES_HELP = (
  <p>
    ◆ marks a save it&apos;s proficient in: its modifier plus its proficiency bonus, which follows when either changes.
    Click ◆ to switch proficiency, or type a save&apos;s whole bonus as a statblock prints it. A number that isn&apos;t
    modifier + proficiency is its own (an amber ◆) and stays as typed.
  </p>
);

/** The top of the Stats tab, always open: who it is, its defenses and speed, and its scores with their saves. */
export function StatsCore({ definition, focusName }: { definition: CreatureDefinition; focusName?: boolean }) {
  const update = useEncounterStore((s) => s.updateCreatureDefinition);
  const updateAbility = useEncounterStore((s) => s.updateCreatureAbility);
  const movement: MovementProfile = definition.movement ?? { walk: definition.speed };
  const modes = MODES.filter((mode) => (movement[mode] ?? 0) > 0);
  const missing = MODES.filter((mode) => !modes.includes(mode));
  const proficiency = proficiencyOf(definition);

  /** A movement mode set (or, with no feet, taken away; hover goes with fly). */
  function setMode(mode: Mode, feet: number | undefined) {
    const { [mode]: _dropped, ...rest } = movement;
    const next: MovementProfile = { ...rest, walk: definition.speed, ...(feet ? { [mode]: feet } : {}) };
    if (mode === "fly" && !feet) delete next.hover;
    update(definition.id, { movement: next });
  }

  function setHover(on: boolean) {
    const { hover: _dropped, ...rest } = movement;
    update(definition.id, { movement: { ...rest, walk: definition.speed, ...(on ? { hover: true } : {}) } });
  }

  function setSave(ability: Ability, bonus: number | undefined) {
    const { [ability]: _dropped, ...rest } = definition.saves ?? {};
    const saves = bonus === undefined ? rest : { ...rest, [ability]: bonus };
    update(definition.id, { saves: Object.keys(saves).length ? saves : undefined });
  }

  return (
    <div className={styles.core}>
      <p className={styles.source}>Source: {sourceLabel(definition.source)}</p>
      <label className={styles.field}>
        Name
        <SheetText value={definition.name} autoSelect={focusName} onCommit={(name) => update(definition.id, { name })} />
      </label>
      <div className={styles.coreRow}>
        <label className={styles.field} style={{ width: 120 }}>
          <span className={styles.fieldLabel}>
            Size
            <InfoTooltip label="About size" content={SIZE_HELP} />
          </span>
          {/* Named here: the label also holds the "?" button, which a browser would take as the thing it labels. */}
          <select aria-label="Size" value={definition.size} onChange={(e) => update(definition.id, { size: e.target.value as SizeCategory })}>
            {SIZES.map((size) => <option key={size} value={size}>{capitalize(size)}</option>)}
          </select>
        </label>
        <label className={styles.field} style={{ width: 150 }}>
          <span className={styles.fieldLabel}>
            Type
            <InfoTooltip label="About creature type" content={CREATURE_TYPE_HELP} />
          </span>
          <select
            aria-label="Creature type"
            value={definition.type ?? ""}
            onChange={(e) => update(definition.id, { type: e.target.value ? (e.target.value as CreatureType) : undefined })}
          >
            <option value="">Unspecified</option>
            {CREATURE_TYPES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <label className={styles.field} style={{ flex: 1 }}>
          Alignment
          <SheetText value={definition.alignment ?? ""} placeholder="unaligned" onCommit={(alignment) => update(definition.id, { alignment: alignment || undefined })} />
        </label>
      </div>
      <div className={styles.coreRow}>
        <label className={styles.field}>
          Armor Class
          <SheetNumber className={styles.coreBox} value={definition.armorClass} min={0} max={99} onCommit={(armorClass) => update(definition.id, { armorClass })} />
        </label>
        <label className={styles.field}>
          Max HP
          <SheetNumber className={styles.coreBox} value={definition.maxHp} min={1} max={9999} onCommit={(maxHp) => update(definition.id, { maxHp })} />
        </label>
        <div className={styles.field}>
          <span>Speed</span>
          <div className={styles.speedRow}>
            <SheetNumber label="Speed" className={styles.coreBox} value={definition.speed} min={0} max={999} step={5} onCommit={(speed) => update(definition.id, { speed })} />
            <span className={styles.unit}>ft</span>
            {modes.map((mode) => (
              <span key={mode} className={styles.speedChip}>
                {mode}
                <SheetNumber label={`${mode} speed`} className={styles.coreBox} value={movement[mode]} min={5} max={999} step={5} onCommit={(feet) => setMode(mode, feet)} />
                ft
                {mode === "fly" ? (
                  <label className={styles.hoverCheck} title="A hovering flier doesn't fall when it's knocked prone or can't move.">
                    <input type="checkbox" aria-label="Hovers" checked={Boolean(movement.hover)} onChange={(e) => setHover(e.target.checked)} />
                    hover
                  </label>
                ) : null}
                <button type="button" className={styles.chipRemove} aria-label={`Remove ${mode} speed`} onClick={() => setMode(mode, undefined)}>
                  <X size={11} />
                </button>
              </span>
            ))}
            {missing.length ? (
              <select
                className={styles.addSmall} aria-label="Add a speed" value=""
                onChange={(e) => { if (e.target.value) setMode(e.target.value as Mode, definition.speed || 30); }}
              >
                <option value="">+ Speed</option>
                {missing.map((mode) => <option key={mode} value={mode}>{mode}</option>)}
              </select>
            ) : null}
          </div>
        </div>
      </div>

      <div className={styles.scores} role="group" aria-label="Ability scores and saves">
        {ABILITIES.map((ability) => {
          const name = ability.toUpperCase();
          const modifier = abilityModifier(definition.abilities[ability]);
          const kind = saveKind(definition, ability);
          const proficient = modifier + proficiency;
          return (
            <div key={ability} className={styles.score}>
              <span className={styles.scoreName}>{name}</span>
              <SheetNumber label={`${name} score`} className={styles.scoreBox} value={definition.abilities[ability]} min={1} max={30} onCommit={(score) => updateAbility(definition.id, ability, score)} />
              <span className={styles.scoreMod}>{formatBonus(modifier)}</span>
              <span className={styles.save}>
                <button
                  type="button" className={styles.saveMark} data-kind={kind} aria-pressed={kind !== "none"} aria-label={`${name} save proficiency`}
                  title={kind === "none" ? `Make it proficient: ${formatBonus(proficient)}` : kind === "custom" ? `Its own number (proficient would be ${formatBonus(proficient)}): click to clear` : "Proficient: click to clear"}
                  onClick={() => setSave(ability, kind === "none" ? proficient : undefined)}
                >
                  ◆
                </button>
                <SheetNumber
                  optional signed label={`${name} save`} className={styles.saveBox} value={definition.saves?.[ability]}
                  placeholder={formatBonus(modifier)} min={-10} max={30} onCommit={(bonus) => setSave(ability, bonus)}
                />
              </span>
            </div>
          );
        })}
      </div>
      <span className={styles.scoresLegend}>
        Score, modifier, and saving throw (◆ proficient)
        <InfoTooltip label="About saving throws" content={SAVES_HELP} />
      </span>
    </div>
  );
}
