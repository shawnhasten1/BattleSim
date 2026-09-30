"use client";

import { Pencil, Plus, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type {
  Ability,
  ActionRider,
  ConditionName,
  CreatureDefinition,
  CreatureType,
  DamageComponent,
  RiderDuration,
  RiderGate,
  SizeCategory,
  WeaponDefinition
} from "@/engine";
import { CREATURE_TYPES } from "@/lib/creature-types";
import { componentAverage, effectCardText, riderFallbackDc } from "@/lib/statblock";
import { Check, Field, More, NumberField, Segmented } from "./controls";
import { DamageLines } from "./DamageLines";
import { PoolPicker, type NewPools } from "./LimitPicker";
import styles from "./ability-editor.module.css";

type Rider = ActionRider;
type Triggered = Exclude<ActionRider, { kind: "note" }>;
type ConditionRider = Extract<ActionRider, { kind: "condition" }>;

/** What a card is, as the DM thinks of it: "Can't take reactions" is a condition rider underneath. */
type CardKind = "condition" | "damage" | "push" | "hold" | "swallow" | "reactions" | "healing" | "note";

const CARD_KINDS: Array<{ kind: CardKind; label: string; hint: string }> = [
  { kind: "condition", label: "Condition", hint: "Prone, poisoned, frightened… with an optional save" },
  { kind: "damage", label: "Extra damage", hint: "More damage, often of another type" },
  { kind: "hold", label: "Grapple", hint: "Grabs the target (escape DC), maybe restraining it" },
  { kind: "push", label: "Push", hint: "Shoves the target away" },
  { kind: "swallow", label: "Swallow", hint: "Swallows a creature, usually one it's grappling" },
  { kind: "reactions", label: "Can't take reactions", hint: "Until the start of the target's next turn" },
  { kind: "healing", label: "Healing", hint: "The attacker or the target regains hit points" },
  { kind: "note", label: "Note for the DM", hint: "Shown with the ability; not simulated" }
];

const KIND_LABEL: Record<CardKind, string> = Object.fromEntries(CARD_KINDS.map((entry) => [entry.kind, entry.label])) as Record<CardKind, string>;

const GATES: Array<{ value: RiderGate; label: string; group: string }> = [
  { value: "on-hit", label: "On a hit", group: "On a hit" },
  { value: "on-crit", label: "On a critical hit", group: "On a critical hit" },
  { value: "on-miss", label: "On a miss", group: "On a miss" },
  { value: "always", label: "Hit or miss", group: "Hit or miss" }
];

const CONDITIONS: ConditionName[] = [
  "blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated", "paralyzed", "petrified", "poisoned", "prone",
  "restrained", "stunned", "unconscious"
];
const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

/** The save statblocks usually pair with a condition: a new card, and a changed condition, start from it. */
const USUAL_SAVE: Partial<Record<string, Ability>> = {
  prone: "str", grappled: "str", restrained: "str",
  poisoned: "con", blinded: "con", deafened: "con", paralyzed: "con", petrified: "con", stunned: "con", incapacitated: "con", unconscious: "con",
  frightened: "wis", charmed: "wis"
};
const SIZES: SizeCategory[] = ["tiny", "small", "medium", "large", "huge", "gargantuan"];

function cardKindOf(rider: Rider): CardKind {
  if (rider.kind === "condition" && typeof rider.condition !== "string" && rider.modifiers?.deniesReactions) return "reactions";
  return rider.kind;
}

function blankRider(kind: CardKind, when: RiderGate, holdDc: number): Rider {
  switch (kind) {
    case "condition":
      return { kind: "condition", when, condition: "prone", save: { ability: "str", onSuccess: "negates" }, duration: { kind: "until-start-of-next-turn" } };
    case "damage":
      return { kind: "damage", when, components: [{ dice: "1d6", damageType: "fire", diceCount: 1, diceSize: 6 }] };
    case "push":
      return { kind: "push", when, distance: 10 };
    case "hold":
      return { kind: "hold", when, escapeDc: holdDc };
    case "swallow":
      return { kind: "swallow", when, requiresHeld: true, damage: [{ dice: "3d6", damageType: "acid", diceCount: 3, diceSize: 6 }] };
    case "reactions":
      return { kind: "condition", when, condition: { custom: "reaction-locked" }, modifiers: { deniesReactions: true }, duration: { kind: "until-start-of-next-turn" } };
    case "healing":
      return { kind: "healing", when, target: "self", components: [{ dice: "1d6" }] };
    case "note":
      return { kind: "note", text: "" };
  }
}

export interface EffectCardsProps {
  riders: Rider[];
  onChange: (next: Rider[]) => void;
  definition: CreatureDefinition;
  /** The ability the attack rolls with: a rider save without its own DC uses it. */
  ability: Ability;
  /** On a weapon, its charges are the first pool offered. */
  weapon?: WeaponDefinition;
  newPools: NewPools;
}

/** An attack's effects as cards grouped by when they happen, each a sentence until it's opened. */
export function EffectCards({ riders, onChange, definition, ability, weapon, newPools }: EffectCardsProps) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const holdDc = riderFallbackDc({ ability: "str" }, definition);

  useEffect(() => {
    if (!adding) return;
    menuRef.current?.querySelector("button")?.focus();
    // A click anywhere else closes the menu.
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || addRef.current?.contains(target)) return;
      setAdding(false);
    }
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [adding]);

  const replace = (index: number, next: Rider) => onChange(riders.map((rider, i) => (i === index ? next : rider)));
  const remove = (index: number) => {
    onChange(riders.filter((_, i) => i !== index));
    setOpenIndex(null);
  };
  function add(kind: CardKind) {
    onChange([...riders, blankRider(kind, "on-hit", holdDc)]);
    setOpenIndex(riders.length);
    setAdding(false);
  }

  const groups = [
    ...GATES.map((gate) => ({ title: gate.group, items: riders.map((rider, index) => ({ rider, index })).filter(({ rider }) => rider.kind !== "note" && rider.when === gate.value) })),
    { title: "Notes", items: riders.map((rider, index) => ({ rider, index })).filter(({ rider }) => rider.kind === "note") }
  ].filter((group) => group.items.length > 0);

  return (
    <div className={styles.lines}>
      {riders.length === 0 ? <p className={styles.empty}>No effects: a hit only deals its damage.</p> : null}
      {groups.map((group) => (
        <div key={group.title} className={styles.effectGroup}>
          <h4 className={styles.effectGroupTitle}>{group.title}</h4>
          {group.items.map(({ rider, index }) => (
            <EffectCard
              key={index}
              rider={rider}
              open={openIndex === index}
              onOpen={() => setOpenIndex(index)}
              onClose={() => setOpenIndex(null)}
              onChange={(next) => replace(index, next)}
              onRemove={() => remove(index)}
              definition={definition}
              ability={ability}
              weapon={weapon}
              newPools={newPools}
            />
          ))}
        </div>
      ))}
      <button
        ref={addRef}
        type="button" className={styles.addLine} aria-expanded={adding} aria-haspopup="menu"
        onClick={() => setAdding((v) => !v)}
      >
        <Plus size={12} /> Add effect
      </button>
      {adding ? (
        <div
          ref={menuRef} className={styles.menu} role="menu" aria-label="Add effect"
          onKeyDown={(event) => {
            if (event.key === "Escape") { event.stopPropagation(); setAdding(false); addRef.current?.focus(); }
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            const items = [...(menuRef.current?.querySelectorAll("button") ?? [])];
            const at = items.indexOf(document.activeElement as HTMLButtonElement);
            items[(at + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
          }}
        >
          {CARD_KINDS.map((entry) => (
            <button key={entry.kind} type="button" role="menuitem" onClick={() => add(entry.kind)}>
              {entry.label}
              <span>{entry.hint}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function EffectCard({
  rider, open, onOpen, onClose, onChange, onRemove, definition, ability, weapon, newPools
}: {
  rider: Rider;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onChange: (next: Rider) => void;
  onRemove: () => void;
  definition: CreatureDefinition;
  ability: Ability;
  weapon?: WeaponDefinition;
  newPools: NewPools;
}) {
  const kind = cardKindOf(rider);
  const label = KIND_LABEL[kind];
  const sentence = effectCardText(rider, definition, { ability });
  if (!open) {
    return (
      <div className={`${styles.card} ${styles.cardClosed}`}>
        <p className={styles.cardSentence}>
          <span className={styles.cardKind}>{label}</span>
          {sentence}
        </p>
        <button type="button" className={styles.iconBtn} aria-label={`Edit ${label.toLowerCase()} effect`} onClick={onOpen}><Pencil size={12} /></button>
        <button type="button" className={`${styles.iconBtn} ${styles.danger}`} aria-label={`Remove ${label.toLowerCase()} effect`} onClick={onRemove}><X size={13} /></button>
      </div>
    );
  }
  return (
    <div className={`${styles.card} ${styles.cardOpen}`} role="group" aria-label={`${label} effect`}>
      <div className={styles.cardHead}>
        <strong>{label}</strong>
        <button type="button" className={`${styles.iconBtn} ${styles.danger}`} aria-label={`Remove ${label.toLowerCase()} effect`} onClick={onRemove}><X size={13} /></button>
      </div>
      {rider.kind !== "note" ? <GateField rider={rider} onChange={onChange} /> : null}
      <CardFields rider={rider} kind={kind} onChange={onChange} definition={definition} ability={ability} />
      {rider.kind !== "note" ? (
        <CardMore rider={rider} onChange={onChange} definition={definition} weapon={weapon} newPools={newPools} extraSet={holdExtrasSet(rider)}>
          {rider.kind === "hold" ? <HoldExtras rider={rider} onChange={onChange} definition={definition} /> : null}
        </CardMore>
      ) : null}
      <p className={styles.hint} aria-live="polite">{sentence}</p>
      <button type="button" className={`${styles.btn} ${styles.cardDone}`} onClick={onClose}>Done</button>
    </div>
  );
}

function GateField({ rider, onChange }: { rider: Triggered; onChange: (next: Rider) => void }) {
  const id = useId();
  return (
    <Field copy="effectWhen" id={id}>
      <select id={id} value={rider.when} onChange={(e) => onChange({ ...rider, when: e.target.value as RiderGate })} style={{ alignSelf: "flex-start" }}>
        {GATES.map((gate) => <option key={gate.value} value={gate.value}>{gate.label}</option>)}
        {GATES.some((gate) => gate.value === rider.when) ? null : <option value={rider.when}>{rider.when}</option>}
      </select>
    </Field>
  );
}

function CardFields({ rider, kind, onChange, definition, ability }: {
  rider: Rider;
  kind: CardKind;
  onChange: (next: Rider) => void;
  definition: CreatureDefinition;
  ability: Ability;
}) {
  const damageLines = (components: DamageComponent[], set: (next: DamageComponent[]) => void, label: string, empty: string) => (
    <DamageLines
      lines={components}
      onChange={set}
      label={label}
      averageOf={(component) => componentAverage(component, definition)}
      allowSameAsAttack
      newLine={() => ({ dice: "1d6", damageType: "fire", diceCount: 1, diceSize: 6 })}
      emptyText={empty}
    />
  );
  switch (rider.kind) {
    case "condition":
      return kind === "reactions"
        ? <p className={styles.hint}>The target can&apos;t take reactions until the start of its next turn.</p>
        : <ConditionFields rider={rider} onChange={onChange} definition={definition} ability={ability} />;
    case "damage":
      return damageLines(rider.components, (components) => components.length && onChange({ ...rider, components }), "Extra damage", "Add at least one line of damage.");
    case "push":
      return (
        <Field copy="push">
          <NumberField label="Pushed (ft)" value={rider.distance} min={5} max={120} step={5} onChange={(n) => n !== undefined && onChange({ ...rider, distance: n })} />
        </Field>
      );
    case "hold":
      return (
        <>
          <div className={styles.row}>
            <Field copy="escapeDc">
              <NumberField label="Escape DC" value={rider.escapeDc} min={1} max={40} onChange={(n) => n !== undefined && onChange({ ...rider, escapeDc: n })} />
            </Field>
            <Check copy="restrained" checked={rider.restrained === true} onChange={(on) => { const next = { ...rider }; delete next.restrained; onChange(on ? { ...next, restrained: true } : next); }} />
          </div>
        </>
      );
    case "swallow":
      return (
        <>
          <div className={styles.row}>
            <Check copy="swallowHeld" checked={rider.requiresHeld === true} onChange={(on) => { const next = { ...rider }; delete next.requiresHeld; onChange(on ? { ...next, requiresHeld: true } : next); }} />
            <SizeSelect value={rider.maxSize} onChange={(maxSize) => { const next = { ...rider }; delete next.maxSize; onChange(maxSize ? { ...next, maxSize } : next); }} />
          </div>
          <Check
            copy="swallowSave"
            checked={Boolean(rider.save)}
            onChange={(on) => { const next = { ...rider }; delete next.save; onChange(on ? { ...next, save: { ability: "dex", dc: riderFallbackDc({ ability }, definition) } } : next); }}
          />
          {rider.save ? (
            <div className={styles.row}>
              <AbilitySelect label="Save" value={rider.save.ability} onChange={(saveAbility) => onChange({ ...rider, save: { ...rider.save!, ability: saveAbility } })} />
              <Field copy="saveDc">
                <NumberField label="Swallow save DC" value={rider.save.dc} min={1} max={40} onChange={(n) => n !== undefined && onChange({ ...rider, save: { ...rider.save!, dc: n } })} />
              </Field>
            </div>
          ) : null}
          <Field copy="swallowDamage">
            {damageLines(rider.damage ?? [], (lines) => { const next = { ...rider }; delete next.damage; onChange(lines.length ? { ...next, damage: lines } : next); }, "Damage inside", "None.")}
          </Field>
          <Field copy="regurgitate">
            <span className={styles.inline}>
              <NumberField
                label="Spits it out after damage" value={rider.regurgitate?.damage} optional min={1} max={999} placeholder="never"
                onChange={(n) => { const next = { ...rider }; delete next.regurgitate; onChange(n ? { ...next, regurgitate: { damage: n, dc: rider.regurgitate?.dc ?? 15 } } : next); }}
              />
              <span>damage in one turn</span>
            </span>
          </Field>
        </>
      );
    case "healing":
      return (
        <div className={styles.row}>
          <Field copy="heal">
            <input
              aria-label="Healing dice" value={rider.components[0]?.dice ?? ""} style={{ width: 90 }}
              onChange={(e) => onChange({ ...rider, components: [{ ...(rider.components[0] ?? {}), dice: e.target.value.replace(/\s+/g, "") || "1" }, ...rider.components.slice(1)] })}
            />
          </Field>
          <Field copy="healTarget">
            <Segmented
              label="Heals"
              value={rider.target === "target" ? "target" : "self"}
              options={[{ value: "self", label: "The attacker" }, { value: "target", label: "The target" }]}
              onChange={(target) => onChange({ ...rider, target })}
            />
          </Field>
        </div>
      );
    case "note":
      return (
        <Field copy="note">
          <textarea aria-label="Note for the DM" value={rider.text} placeholder="What happens, for you to resolve." onChange={(e) => onChange({ ...rider, text: e.target.value })} />
        </Field>
      );
  }
}

/** A grapple's rarer settings, shown in the card's "More options". */
function HoldExtras({ rider, onChange, definition }: { rider: Extract<ActionRider, { kind: "hold" }>; onChange: (next: Rider) => void; definition: CreatureDefinition }) {
  return (
    <>
      <div className={styles.row}>
        <SizeSelect value={rider.maxSize} onChange={(maxSize) => { const next = { ...rider }; delete next.maxSize; onChange(maxSize ? { ...next, maxSize } : next); }} />
        <Field copy="holdLimit">
          <NumberField label="Holds at once" value={rider.limit ?? 1} min={1} max={10} onChange={(n) => { const next = { ...rider }; delete next.limit; onChange(n && n > 1 ? { ...next, limit: n } : next); }} />
        </Field>
      </div>
      <Field copy="heldDamage">
        <DamageLines
          lines={rider.recurringDamage ?? []}
          onChange={(lines) => { const next = { ...rider }; delete next.recurringDamage; onChange(lines.length ? { ...next, recurringDamage: lines } : next); }}
          label="Damage while grappled"
          averageOf={(component) => componentAverage(component, definition)}
          newLine={() => ({ dice: "1d6", damageType: "fire", diceCount: 1, diceSize: 6 })}
          emptyText="None."
        />
      </Field>
    </>
  );
}

function holdExtrasSet(rider: Rider): number {
  if (rider.kind !== "hold") return 0;
  return (rider.maxSize ? 1 : 0) + ((rider.limit ?? 1) > 1 ? 1 : 0) + (rider.recurringDamage?.length ? 1 : 0);
}

function ConditionFields({ rider, onChange, definition, ability }: {
  rider: ConditionRider;
  onChange: (next: Rider) => void;
  definition: CreatureDefinition;
  ability: Ability;
}) {
  const conditionId = useId();
  const name = typeof rider.condition === "string" ? rider.condition : rider.condition.custom;
  const choices = CONDITIONS.includes(name as ConditionName) ? CONDITIONS : [...CONDITIONS, name];
  const autoDc = riderFallbackDc({ ability }, definition);
  return (
    <>
      <Field copy="condition" id={conditionId}>
        <select
          id={conditionId}
          value={name}
          style={{ alignSelf: "flex-start" }}
          onChange={(e) => {
            const value = e.target.value;
            // A save still at the old condition's usual ability follows to the new one's (prone's STR to poisoned's CON).
            const follows = rider.save && rider.save.ability === (USUAL_SAVE[name] ?? rider.save.ability) && USUAL_SAVE[value];
            onChange({
              ...rider,
              condition: CONDITIONS.includes(value as ConditionName) ? value as ConditionName : { custom: value },
              ...(follows && rider.save ? { save: { ...rider.save, ability: USUAL_SAVE[value]! } } : {})
            });
          }}
        >
          {choices.map((condition) => <option key={condition} value={condition}>{condition}</option>)}
        </select>
      </Field>
      <Check
        copy="saveGate"
        checked={Boolean(rider.save)}
        onChange={(on) => { const next = { ...rider }; delete next.save; onChange(on ? { ...next, save: { ability: USUAL_SAVE[name] ?? "con", onSuccess: "negates" } } : next); }}
      />
      {rider.save ? (
        <div className={styles.row}>
          <AbilitySelect label="Save" value={rider.save.ability} onChange={(saveAbility) => onChange({ ...rider, save: { ...rider.save!, ability: saveAbility } })} />
          <Field copy="saveDc">
            <NumberField
              label="Save DC" value={rider.save.dc} optional min={1} max={40} placeholder={`${autoDc} (auto)`} wide
              onChange={(n) => { const save = { ...rider.save! }; delete save.dc; onChange({ ...rider, save: n === undefined ? save : { ...save, dc: n } }); }}
            />
          </Field>
        </div>
      ) : null}
      <DurationField rider={rider} onChange={onChange} />
    </>
  );
}

type DurationChoice = "next-turn" | "1-round" | "1-minute" | "rounds" | "save-ends" | "concentration" | "permanent";

function durationChoice(duration: RiderDuration): DurationChoice {
  switch (duration.kind) {
    case "until-start-of-next-turn": return "next-turn";
    case "rounds": return duration.rounds === 1 ? "1-round" : duration.rounds === 10 ? "1-minute" : "rounds";
    default: return duration.kind;
  }
}

function DurationField({ rider, onChange }: { rider: ConditionRider; onChange: (next: Rider) => void }) {
  const id = useId();
  const choice = durationChoice(rider.duration);
  const repeatAt = rider.duration.kind === "save-ends" ? rider.duration.saveAt : rider.duration.kind === "rounds" ? rider.duration.repeatSaveAt : undefined;
  const setDuration = (duration: RiderDuration) => onChange({ ...rider, duration });
  function choose(next: DurationChoice) {
    const repeat = repeatAt ? { repeatSaveAt: repeatAt } : {};
    switch (next) {
      case "next-turn": return setDuration({ kind: "until-start-of-next-turn" });
      case "1-round": return setDuration({ kind: "rounds", rounds: 1, ...repeat });
      case "1-minute": return setDuration({ kind: "rounds", rounds: 10, ...repeat });
      case "rounds": return setDuration({ kind: "rounds", rounds: rider.duration.kind === "rounds" ? rider.duration.rounds : 3, ...repeat });
      case "save-ends": return setDuration({ kind: "save-ends", saveAt: repeatAt ?? "turn-end" });
      case "concentration": return setDuration({ kind: "concentration" });
      case "permanent": return setDuration({ kind: "permanent" });
    }
  }
  return (
    <>
      <Field copy="lasts" id={id}>
        <span className={styles.inline}>
          <select id={id} value={choice} onChange={(e) => choose(e.target.value as DurationChoice)}>
            <option value="next-turn">Until the start of its next turn</option>
            <option value="1-round">1 round</option>
            <option value="1-minute">1 minute (10 rounds)</option>
            <option value="rounds">A number of rounds…</option>
            <option value="save-ends">Until it saves</option>
            <option value="concentration">While the attacker concentrates</option>
            <option value="permanent">Until removed</option>
          </select>
          {choice === "rounds" && rider.duration.kind === "rounds" ? (
            <NumberField label="Rounds" value={rider.duration.rounds} min={1} max={600} onChange={(n) => n !== undefined && rider.duration.kind === "rounds" && setDuration({ ...rider.duration, rounds: n })} />
          ) : null}
        </span>
      </Field>
      {rider.duration.kind === "save-ends" ? (
        <RepeatAt value={rider.duration.saveAt} onChange={(saveAt) => setDuration({ kind: "save-ends", saveAt })} />
      ) : null}
      {rider.duration.kind === "rounds" ? (
        <>
          <Check
            copy="repeatSave"
            checked={Boolean(rider.duration.repeatSaveAt)}
            onChange={(on) => {
              if (rider.duration.kind !== "rounds") return;
              const next = { ...rider.duration };
              delete next.repeatSaveAt;
              setDuration(on ? { ...next, repeatSaveAt: "turn-end" } : next);
            }}
          />
          {rider.duration.repeatSaveAt ? (
            <RepeatAt value={rider.duration.repeatSaveAt} onChange={(repeatSaveAt) => rider.duration.kind === "rounds" && setDuration({ ...rider.duration, repeatSaveAt })} />
          ) : null}
        </>
      ) : null}
    </>
  );
}

function RepeatAt({ value, onChange }: { value: "turn-start" | "turn-end"; onChange: (next: "turn-start" | "turn-end") => void }) {
  return (
    <span className={styles.inline}>
      <span>repeating the save at the</span>
      <Segmented
        label="Repeats the save at"
        value={value}
        options={[{ value: "turn-end", label: "end" }, { value: "turn-start", label: "start" }]}
        onChange={onChange}
      />
      <span>of each of its turns</span>
    </span>
  );
}

function AbilitySelect({ label, value, onChange }: { label: string; value: Ability; onChange: (next: Ability) => void }) {
  const id = useId();
  return (
    <Field copy="saveAbility" id={id}>
      <select id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value as Ability)} style={{ width: 80 }}>
        {ABILITIES.map((ability) => <option key={ability} value={ability}>{ability.toUpperCase()}</option>)}
      </select>
    </Field>
  );
}

function SizeSelect({ value, onChange }: { value: SizeCategory | undefined; onChange: (next: SizeCategory | undefined) => void }) {
  const id = useId();
  return (
    <Field copy="maxSize" id={id}>
      <select id={id} value={value ?? ""} onChange={(e) => onChange((e.target.value || undefined) as SizeCategory | undefined)}>
        <option value="">any size</option>
        {SIZES.map((size) => <option key={size} value={size}>{size} or smaller</option>)}
      </select>
    </Field>
  );
}

/** Charges, once per turn, creature types, and the card's own rarer settings (`children`): what most effects never need. */
function CardMore({ rider, onChange, definition, weapon, newPools, children, extraSet = 0 }: {
  rider: Triggered;
  onChange: (next: Rider) => void;
  definition: CreatureDefinition;
  weapon?: WeaponDefinition;
  newPools: NewPools;
  children?: ReactNode;
  extraSet?: number;
}) {
  const types = rider.restrictToCreatureTypes ?? [];
  const set = (rider.resourceCost ? 1 : 0) + (rider.oncePerTurn ? 1 : 0) + (types.length ? 1 : 0) + extraSet;
  function toggleType(type: CreatureType) {
    const next = types.includes(type) ? types.filter((t) => t !== type) : [...types, type];
    const copy = { ...rider };
    delete copy.restrictToCreatureTypes;
    onChange(next.length ? { ...copy, restrictToCreatureTypes: next } : copy);
  }
  return (
    <More set={set}>
      {children}
      <Check
        copy="costsCharges"
        checked={Boolean(rider.resourceCost)}
        onChange={(on) => {
          const next = { ...rider };
          delete next.resourceCost;
          delete next.activation;
          const firstPool = weapon?.charges?.id ?? Object.keys(definition.resources ?? {})[0];
          onChange(on ? { ...next, ...(firstPool ? { resourceCost: { resourceId: firstPool, amount: 1 } } : { resourceCost: { resourceId: "", amount: 1 } }) } : next);
        }}
      />
      {rider.resourceCost ? (
        <>
          <PoolPicker
            definition={definition}
            weapon={weapon}
            newPools={newPools}
            value={rider.resourceCost.resourceId ? rider.resourceCost : undefined}
            onChange={(resourceCost) => onChange({ ...rider, resourceCost })}
          />
          <Check
            copy="optional"
            checked={rider.activation === "optional"}
            onChange={(on) => { const next = { ...rider }; delete next.activation; onChange(on ? { ...next, activation: "optional" } : next); }}
          />
        </>
      ) : null}
      <Check copy="oncePerTurn" checked={rider.oncePerTurn === true} onChange={(on) => { const next = { ...rider }; delete next.oncePerTurn; onChange(on ? { ...next, oncePerTurn: true } : next); }} />
      <Check
        copy="creatureTypes"
        checked={types.length > 0}
        onChange={(on) => { const next = { ...rider }; delete next.restrictToCreatureTypes; onChange(on ? { ...next, restrictToCreatureTypes: ["undead"] } : next); }}
      />
      {types.length ? (
        <div className={styles.typeChips} role="group" aria-label="Creature types it affects">
          {CREATURE_TYPES.map((option) => (
            <button key={option.value} type="button" aria-pressed={types.includes(option.value)} onClick={() => toggleType(option.value)}>{option.label}</button>
          ))}
        </div>
      ) : null}
    </More>
  );
}
