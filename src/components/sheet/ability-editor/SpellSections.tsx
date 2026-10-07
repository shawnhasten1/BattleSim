"use client";

import { useId, type ReactNode } from "react";
import type { ActionDefinition, CreatureDefinition, ReactionMeta, SpellDefinition, SpellUpcast } from "@/engine";
import { EditionBadge } from "@/components/ui/Edition";
import { spellLimit } from "@/lib/ability-editor/bindings";
import { higherLevelsText, srdUpcastOffer } from "@/lib/ability-editor/upcasting";
import type { SectionId } from "@/lib/ability-editor/sections";
import { editionOf } from "@/lib/editions";
import {
  canBeReaction,
  concentrates,
  spellIsReference,
  upcastOf,
  withCastingTime,
  withConcentration,
  withSpellAction,
  withSpellLevel,
  withSpellReference,
  withSpellZone,
  withUpcast,
  zoneOf
} from "@/lib/ability-editor/spells";
import { actionSection, PrepOnly, type Convert } from "./ActionSections";
import { Check, Field, More, NumberField, Segmented } from "./controls";
import { LimitPicker, type NewPools } from "./LimitPicker";
import { LingeringArea } from "./LingeringArea";
import { TriggerNote } from "./FeatureSections";
import { ACTIVATION_TRIGGERS, ATTACK_TRIGGERS, ReactionControls } from "./ReactionControls";
import { HowItWorks } from "./RollSection";
import styles from "./ability-editor.module.css";

export interface SpellSectionProps {
  spell: SpellDefinition;
  onChange: (next: SpellDefinition) => void;
  definition: CreatureDefinition;
  newPools: NewPools;
  parkedReaction: { current: ReactionMeta | undefined };
  onConvert: Convert;
  conversionNote?: string;
}

const SCHOOLS = ["abjuration", "conjuration", "divination", "enchantment", "evocation", "illusion", "necromancy", "transmutation"];

function ordinal(n: number): string {
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

/**
 * A spell's sections. Basics, Use & cost and Notes are the spell's own; the rest edit the action it casts, with the
 * spell kept in step (its printed range follows the target, a lingering area stays where it lives).
 */
export function spellSection(id: SectionId, props: SpellSectionProps): ReactNode {
  const { spell, onChange, definition, newPools, parkedReaction, onConvert, conversionNote } = props;
  switch (id) {
    case "basics":
      return <SpellBasics spell={spell} onChange={onChange} />;
    case "use":
      return <SpellUse spell={spell} onChange={onChange} definition={definition} newPools={newPools} parkedReaction={parkedReaction} />;
    case "notes":
      return <SpellNotes spell={spell} onChange={onChange} />;
    case "lingering":
      return spell.action?.kind === "area-save"
        ? <LingeringArea zone={zoneOf(spell.action, spell)} onZone={(zone) => onChange(withSpellZone(spell, zone))} concentrates={concentrates(spell)} definition={definition} />
        : null;
    case "roll":
      if (!spell.action) return <HowItWorks kind={undefined} onConvert={onConvert} note={conversionNote} />;
      break;
    default:
      break;
  }
  if (!spell.action) return null;
  return actionSection(id, {
    action: spell.action,
    onChange: (action: ActionDefinition) => onChange(withSpellAction(spell, action)),
    definition, newPools, parkedReaction, onConvert, conversionNote, spell
  });
}

/** Level, school, concentration and ritual; components and where it came from behind More. */
function SpellBasics({ spell, onChange }: { spell: SpellDefinition; onChange: (next: SpellDefinition) => void }) {
  const levelId = useId();
  const schoolId = useId();
  const materialId = useId();
  const components = spell.components ?? {};
  const schools = spell.school && !SCHOOLS.includes(spell.school) ? [...SCHOOLS, spell.school] : SCHOOLS;
  const source = spell.source;
  function setComponents(next: SpellDefinition["components"]) {
    const record = { ...spell };
    delete record.components;
    const kept = Object.fromEntries(Object.entries(next ?? {}).filter(([, value]) => value));
    onChange(Object.keys(kept).length ? { ...record, components: kept } : record);
  }
  return (
    <>
      <div className={styles.row}>
        <Field copy="spellLevel" id={levelId}>
          <select id={levelId} value={spell.level} onChange={(e) => onChange(withSpellLevel(spell, Number(e.target.value)))}>
            <option value={0}>Cantrip</option>
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((level) => <option key={level} value={level}>{ordinal(level)} level</option>)}
          </select>
        </Field>
        <Field copy="school" id={schoolId}>
          <select
            id={schoolId}
            value={spell.school ?? ""}
            onChange={(e) => { const next = { ...spell }; delete next.school; onChange(e.target.value ? { ...next, school: e.target.value } : next); }}
          >
            <option value="">—</option>
            {schools.map((school) => <option key={school} value={school}>{school}</option>)}
          </select>
        </Field>
      </div>
      <span className={styles.inline}>
        <Check copy="concentration" checked={concentrates(spell)} onChange={(on) => onChange(withConcentration(spell, on))} />
        <Check copy="ritual" checked={spell.ritual === true} onChange={(on) => { const next = { ...spell }; delete next.ritual; onChange(on ? { ...next, ritual: true } : next); }} />
      </span>
      <More set={Object.values(components).some(Boolean) ? 1 : 0}>
        <Field copy="components">
          <span className={styles.inline}>
            <Check label="Verbal" checked={components.v === true} onChange={(on) => setComponents({ ...components, v: on || undefined })} />
            <Check label="Somatic" checked={components.s === true} onChange={(on) => setComponents({ ...components, s: on || undefined })} />
          </span>
        </Field>
        <Field copy="componentMaterial" id={materialId}>
          <input id={materialId} value={components.m ?? ""} placeholder="a tiny ball of bat guano and sulfur" onChange={(e) => setComponents({ ...components, m: e.target.value || undefined })} />
        </Field>
        <Field copy="source">
          <span className={styles.hint}>
            {source ? `${source.documentName ?? source.provider}${source.slug ? ` · ${source.slug}` : ""}` : "Made on this sheet"}
            {" "}<EditionBadge edition={editionOf(source)} />
          </span>
        </Field>
      </More>
    </>
  );
}

/** Casting time (a reaction's trigger), what casting spends, and how it grows with a higher slot. */
function SpellUse({ spell, onChange, definition, newPools, parkedReaction }: {
  spell: SpellDefinition;
  onChange: (next: SpellDefinition) => void;
  definition: CreatureDefinition;
  newPools: NewPools;
  parkedReaction: { current: ReactionMeta | undefined };
}) {
  const action = spell.action;
  const reaction = action && "reaction" in action && action.actionType === "reaction" ? action.reaction : undefined;
  const reactionOk = canBeReaction(action) || spell.castingTime === "reaction";
  const limit = spellLimit.get(spell);
  return (
    <>
      <Field copy="castingTime">
        <Segmented
          label="Casting time"
          value={spell.castingTime}
          options={[
            { value: "action", label: "Action" },
            { value: "bonus", label: "Bonus action" },
            ...(reactionOk ? [{ value: "reaction" as const, label: "Reaction" }] : [])
          ]}
          onChange={(castingTime) => {
            const moved = withCastingTime(spell, castingTime, parkedReaction.current);
            parkedReaction.current = moved.parked;
            onChange(moved.spell);
          }}
        />
      </Field>
      {reaction && action ? (
        <>
          {/* An activation (Shield, Counterspell) always acts on its caster, and answers its own set of triggers. */}
          <ReactionControls
            reaction={reaction}
            onChange={(next) => onChange(withSpellAction(spell, { ...action, reaction: next } as ActionDefinition))}
            kinds={action.kind === "activate-feature" ? ACTIVATION_TRIGGERS : ATTACK_TRIGGERS}
            actsOn={action.kind !== "activate-feature"}
          />
          {action.kind === "activate-feature" ? <TriggerNote trigger={reaction.trigger} /> : null}
        </>
      ) : null}
      <LimitPicker spell={spell} onSpellChange={onChange} definition={definition} newPools={newPools} />
      {limit.kind === "slot" && spell.level > 0 ? <Upcasting spell={spell} onChange={onChange} /> : null}
      {action?.kind === "buff" ? (
        <More set={action.prepOnly ? 1 : 0}>
          <PrepOnly action={action} onChange={(next) => onChange(withSpellAction(spell, next))} />
        </More>
      ) : null}
    </>
  );
}

type PerSlot = NonNullable<SpellUpcast["perSlotAboveBase"]>;

/**
 * Casting with a higher slot. Any leveled spell can; what a higher slot adds, per level above the spell's (dice of damage
 * or healing, beams, targets), if anything; what it does that isn't simulated; the SRD's upcasting, offered for a spell
 * of the same name that has none; and the spell's own "At Higher Levels" text.
 */
function Upcasting({ spell, onChange }: { spell: SpellDefinition; onChange: (next: SpellDefinition) => void }) {
  const action = spell.action;
  const upcast = upcastOf(spell);
  const offer = srdUpcastOffer(spell);
  const reference = higherLevelsText(spell.description);
  if (action && "reaction" in action && action.reaction?.trigger.kind === "enemy-casts-spell") {
    return (
      <Field copy="higherSlot">
        <p className={styles.hint}>A higher slot stops a spell of its own level or lower outright; above that, the check (in When).</p>
      </Field>
    );
  }
  return (
    <Field copy="higherSlot">
      <UpcastBenefits spell={spell} onChange={onChange} />
      {offer ? (
        <p className={styles.hint}>
          {offer.text}{" "}
          <button type="button" className={styles.linkBtn} onClick={() => onChange(withUpcast(spell, { ...offer.upcast, ...(upcast?.notModelled ? { notModelled: upcast.notModelled } : {}) }))}>Use it</button>
        </p>
      ) : null}
      {reference ? <p className={`${styles.hint} ${styles.reference}`}>At higher levels: {reference}</p> : null}
      <More set={upcast?.notModelled ? 1 : 0} label="Not simulated">
        <Field copy="upcastNotModelled">
          <input
            aria-label="What else a higher slot does (not simulated)"
            placeholder="A longer duration, a bigger sphere…"
            value={upcast?.notModelled ?? ""}
            onChange={(e) => {
              const notModelled = e.target.value;
              const rest = upcast?.perSlotAboveBase ? { perSlotAboveBase: upcast.perSlotAboveBase } : {};
              onChange(withUpcast(spell, notModelled.trim() || upcast?.perSlotAboveBase ? { ...rest, ...(notModelled.trim() ? { notModelled } : {}) } : undefined));
            }}
          />
        </Field>
      </More>
    </Field>
  );
}

/** What a higher slot adds, per level above the spell's: dice of damage or healing, beams, targets. */
function UpcastBenefits({ spell, onChange }: { spell: SpellDefinition; onChange: (next: SpellDefinition) => void }) {
  const action = spell.action;
  const upcast = upcastOf(spell);
  const per: PerSlot = upcast?.perSlotAboveBase ?? {};
  const on = Object.values(per).some(Boolean);
  const dealsDamage = Boolean(action && (action.kind === "attack" || action.kind === "save" || action.kind === "area-save") && action.damage.length > 0);
  const heals = action?.kind === "healing";
  const beams = action?.kind === "attack" && action.attackDelivery === "beams";
  // A save on one creature catches more (Hold Person); a buff or a heal on "up to N" reaches more (Bless).
  const targets = (action?.kind === "save" && action.targeting?.target !== "self")
    || ((action?.kind === "buff" || action?.kind === "healing") && action.targeting?.target === "chosen");
  const dice = dealsDamage || heals || Boolean(per.damageDice);
  const showBeams = beams || Boolean(per.beams);
  const showTargets = targets || Boolean(per.targets);
  const same = <p className={styles.hint}>A higher slot casts it the same.</p>;
  if (!dice && !showBeams && !showTargets) return same;
  const above = `per level above ${ordinal(spell.level)}`;
  // What isn't simulated stays put whatever is ticked here.
  const kept = (perSlot: PerSlot | undefined): SpellUpcast | undefined => (perSlot || upcast?.notModelled
    ? { ...(perSlot ? { perSlotAboveBase: perSlot } : {}), ...(upcast?.notModelled ? { notModelled: upcast.notModelled } : {}) }
    : undefined);

  function setPer(next: PerSlot) {
    const set = Object.fromEntries(Object.entries(next).filter(([, value]) => value)) as PerSlot;
    onChange(withUpcast(spell, kept(Object.keys(set).length ? set : undefined)));
  }
  function firstDie(): string {
    const first = action && "damage" in action ? action.damage[0]?.dice : action?.kind === "healing" ? action.healing[0]?.dice : undefined;
    const match = first ? /d(\d+)/.exec(first) : null;
    return `1d${match ? match[1] : 6}`;
  }

  return (
    <>
      <Check
        copy="upcast"
        checked={on}
        onChange={(next) => {
          if (!next) return onChange(withUpcast(spell, kept(undefined)));
          setPer(beams ? { beams: 1 } : targets && !dealsDamage && !heals ? { targets: 1 } : { damageDice: firstDie() });
        }}
      />
      {on ? (
        <div className={styles.row}>
          {dice ? (
            <Field copy={heals ? "upcastHealing" : "upcastDamage"}>
              <span className={styles.inline}>
                <span>+</span>
                <input
                  className={styles.expression}
                  aria-label={heals ? "More healing per slot level" : "More damage per slot level"}
                  placeholder="none"
                  value={per.damageDice ?? ""}
                  onChange={(e) => setPer({ ...per, damageDice: e.target.value.replace(/\s+/g, "") || undefined })}
                />
                <span>{above}</span>
              </span>
            </Field>
          ) : null}
          {showBeams ? (
            <Field copy="upcastBeams">
              <span className={styles.inline}>
                <span>+</span>
                <NumberField label="More beams per slot level" value={per.beams} optional min={1} max={10} placeholder="0" onChange={(n) => setPer({ ...per, beams: n })} />
                <span>{above}</span>
              </span>
            </Field>
          ) : null}
          {showTargets ? (
            <Field copy="upcastTargets">
              <span className={styles.inline}>
                <span>+</span>
                <NumberField label="More targets per slot level" value={per.targets} optional min={1} max={10} placeholder="0" onChange={(n) => setPer({ ...per, targets: n })} />
                <span>{above}</span>
              </span>
            </Field>
          ) : null}
        </div>
      ) : same}
    </>
  );
}

/** Reference text, and whether the simulator casts it (on the spell and its action together). */
function SpellNotes({ spell, onChange }: { spell: SpellDefinition; onChange: (next: SpellDefinition) => void }) {
  const id = useId();
  const support = spell.action?.automationSupport;
  const editable = Boolean(spell.action) && spell.action?.kind !== "unsupported"
    && (support === "full" || support === "manual-only") && (spell.automationSupport === "full" || spell.automationSupport === "manual-only");
  return (
    <>
      <Field copy="description" id={id}>
        <textarea
          id={id} value={spell.description ?? ""} placeholder="The spell's text, or a reminder for yourself."
          onChange={(e) => { const next = { ...spell }; delete next.description; onChange(e.target.value ? { ...next, description: e.target.value } : next); }}
        />
      </Field>
      {editable ? (
        <Field copy="automation">
          <Segmented
            label="The simulator"
            value={spellIsReference(spell) ? "reference" : "simulated"}
            options={[{ value: "simulated", label: "Casts it" }, { value: "reference", label: "Reference only" }]}
            onChange={(next) => onChange(withSpellReference(spell, next === "reference"))}
          />
        </Field>
      ) : null}
    </>
  );
}
