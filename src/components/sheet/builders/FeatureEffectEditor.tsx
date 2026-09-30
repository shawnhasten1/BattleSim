"use client";

import type { Ability, ConditionName, DamageType, FeatureCondition, FeatureEffect, NumericFormula } from "@/engine";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { AdjustmentGroupEditor, DAMAGE_TYPES } from "./DamageAdjustmentGroup";
import styles from "./builders.module.css";

/** Conditions a save can be "against being …" (custom labels have no fixed name to match). */
const SAVE_CONDITIONS: ConditionName[] = [
  "blinded", "charmed", "deafened", "frightened", "grappled", "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious"
];
const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

const GATE_OPTIONS: Array<[FeatureCondition, string]> = [
  ["always", "Always"],
  ["self-bloodied", "While I'm bloodied"],
  ["target-bloodied", "While the target is bloodied"],
  ["attack-has-advantage", "When the attack has advantage"],
  ["ally-adjacent-to-target", "When an ally is next to the target"],
  ["charged", "After charging straight at the target"],
  ["target-injured", "When the target is missing any HP"],
  ["target-surprised", "When the target is surprised"],
  ["target-grappled-by-self", "When I'm grappling the target"]
];

const SCOPE_OPTIONS: Array<[string, string]> = [
  ["any", "any attack"], ["melee", "melee attacks"], ["ranged", "ranged attacks"], ["spell", "spell attacks"]
];

/**
 * Editor-facing effect kinds (a superset of `FeatureEffect["kind"]`, split so the
 * two adv/disadv concerns and the "penalty" damage case read clearly).
 */
type EditorKind =
  | "damage-bonus" | "damage-adjustment" | "attack-bonus" | "attack-advantage"
  | "incoming-attack-modifier" | "armor-class-bonus" | "save-bonus" | "save-advantage"
  | "save-dc-bonus" | "extra-action" | "resource-regain" | "avoids-opportunity-attacks"
  | "hp-regen" | "survive-lethal" | "auto-succeed-save" | "apply-condition-on-hit";

const KIND_LABELS: Array<[EditorKind, string]> = [
  ["damage-bonus", "Bonus / penalty damage"],
  ["apply-condition-on-hit", "Condition on a hit (knock prone, poison…)"],
  ["damage-adjustment", "Resistance / immunity / vulnerability"],
  ["attack-bonus", "To-hit modifier"],
  ["attack-advantage", "Advantage / disadvantage on my attacks"],
  ["incoming-attack-modifier", "Advantage / disadvantage on attacks against me"],
  ["armor-class-bonus", "AC modifier"],
  ["save-bonus", "Saving-throw modifier"],
  ["save-advantage", "Advantage on saving throws"],
  ["save-dc-bonus", "Save DC modifier (spell focus, etc.)"],
  ["extra-action", "Regain a spent action / bonus action / reaction"],
  ["resource-regain", "Regain a resource"],
  ["avoids-opportunity-attacks", "Never provokes opportunity attacks"],
  ["hp-regen", "Regenerate hit points each turn"],
  ["survive-lethal", "Drop to 1 HP instead of 0 (Undead Fortitude, Relentless)"],
  ["auto-succeed-save", "Succeed on a failed save (Legendary Resistance)"]
];

const KIND_DESCRIPTIONS: Record<EditorKind, string> = {
  "damage-bonus": "Extra (or reduced) damage added to a qualifying hit.",
  "apply-condition-on-hit": "A qualifying hit also gives the target a condition — optionally only if it fails a saving throw (a charge's \"DC 13 Strength save or be knocked prone\").",
  "damage-adjustment": "Resistance, immunity, or vulnerability to a damage type.",
  "attack-bonus": "A flat modifier to this creature's attack rolls — pick \"spell attacks\" under Applies to for a spellcasting focus's bonus.",
  "attack-advantage": "Advantage or disadvantage on this creature's own attack rolls.",
  "incoming-attack-modifier": "Advantage or disadvantage on attack rolls made against this creature.",
  "armor-class-bonus": "A flat modifier to this creature's AC.",
  "save-bonus": "A flat modifier to this creature's saving throws.",
  "save-advantage": "Advantage on this creature's saving throws — optionally only against spells and magic (Magic Resistance) or against being charmed, frightened, etc.",
  "save-dc-bonus": "A flat modifier to the save DC this creature imposes with its own saving-throw effects (a spellcasting focus boosting spell save DC, etc.).",
  "extra-action": "Regain a spent action, bonus action, or reaction so it can be used again this turn.",
  "resource-regain": "Refund some amount of a limited-use resource (a spell slot, a charge, etc.).",
  "avoids-opportunity-attacks": "This creature never provokes opportunity attacks by moving.",
  "hp-regen": "Regains hit points at the start of its turn (a troll's Regeneration), optionally switched off for a turn by some damage types.",
  "survive-lethal": "When damage would reduce it to 0 HP it stays at 1 HP instead — after a saving throw (Undead Fortitude) or once per encounter for a small enough hit (Relentless).",
  "auto-succeed-save": "Spends one use of a resource pool to turn a failed saving throw into a success. The creature's resource stance decides when it's worth it."
};

const KIND_HELP = (
  <dl>
    {KIND_LABELS.map(([value, label]) => (
      <div key={value}>
        <dt>{label}</dt>
        <dd>{KIND_DESCRIPTIONS[value]}</dd>
      </div>
    ))}
  </dl>
);

const GATE_DESCRIPTIONS: Record<FeatureCondition, string> = {
  always: "Applies with no condition.",
  "self-bloodied": "Only while this creature is at half HP or less.",
  "target-bloodied": "Only while the target of the action is at half HP or less.",
  "attack-has-advantage": "Only when the attack roll already has advantage.",
  "attack-has-no-disadvantage": "Only when the attack roll doesn't have disadvantage.",
  "ally-adjacent-to-target": "Only when one of this creature's allies is within 5 ft of the target (e.g. Pack Tactics).",
  charged: "Only when this creature moved straight toward the target this turn — at least the charge distance you set, 20 ft by default — before hitting it (Charge, Pounce, Trampling Charge).",
  "target-injured": "Only against a target that is missing any of its hit points (Blood Frenzy).",
  "target-surprised": "Only against a surprised target (Surprise Attack, Assassinate).",
  "target-grappled-by-self": "Only against a target this creature is grappling (Grappler)."
};

const GATE_HELP = (
  <dl>
    {GATE_OPTIONS.map(([value, label]) => (
      <div key={value}>
        <dt>{label}</dt>
        <dd>{GATE_DESCRIPTIONS[value]}</dd>
      </div>
    ))}
  </dl>
);

function blankEffect(kind: EditorKind): FeatureEffect {
  switch (kind) {
    case "damage-bonus":
      return { kind: "damage-bonus", condition: "always", damage: [{ dice: "2", damageType: "same-as-attack" }] };
    case "damage-adjustment":
      return { kind: "damage-adjustment", condition: "always", adjustment: { type: "resistance", damageType: "slashing" } };
    case "attack-bonus":
      return { kind: "attack-bonus", condition: "always", bonus: { base: 1 } };
    case "attack-advantage":
      return { kind: "attack-advantage", condition: "always", mode: "advantage" };
    case "incoming-attack-modifier":
      return { kind: "incoming-attack-modifier", condition: "always", amount: 5 };
    case "armor-class-bonus":
      return { kind: "armor-class-bonus", bonus: { base: 1 } };
    case "save-bonus":
      return { kind: "save-bonus", bonus: { base: 1 } };
    case "save-dc-bonus":
      return { kind: "save-dc-bonus", bonus: { base: 1 }, spellsOnly: true };
    case "save-advantage":
      return { kind: "save-advantage" };
    case "extra-action":
      return { kind: "extra-action", condition: "always", slot: "action" };
    case "resource-regain":
      return { kind: "resource-regain", timing: "on-activate", resourceId: "", amount: { base: 1 } };
    case "avoids-opportunity-attacks":
      return { kind: "avoids-opportunity-attacks", condition: "always" };
    case "hp-regen":
      return { kind: "hp-regen", amount: 10 };
    case "survive-lethal":
      return { kind: "survive-lethal", save: { ability: "con", dcBase: 5 } };
    case "auto-succeed-save":
      return { kind: "auto-succeed-save", resourceId: "legendary-resistance" };
    case "apply-condition-on-hit":
      return { kind: "apply-condition-on-hit", condition: "always", attackTypes: ["melee"], appliedCondition: { name: "prone" }, save: { ability: "str", dc: 13 } };
  }
}

/**
 * Collapse a `FeatureEffect[]` into editor cards: every `damage-adjustment` of
 * the same `type` + `nonMagicalOnly` folds into a single multi-type card.
 */
interface EffectCard {
  effect: FeatureEffect;
  /** For a collapsed `damage-adjustment` card, all of its damage types. */
  damageTypes?: DamageType[];
}

function toCards(effects: FeatureEffect[]): EffectCard[] {
  const cards: EffectCard[] = [];
  const adjIndex = new Map<string, number>();
  for (const effect of effects) {
    if (effect.kind === "damage-adjustment") {
      const key = `${effect.adjustment.type}|${effect.adjustment.nonMagicalOnly ? 1 : 0}|${[...(effect.adjustment.exceptMaterials ?? [])].sort().join(",")}`;
      const at = adjIndex.get(key);
      if (at != null) {
        cards[at]!.damageTypes!.push(effect.adjustment.damageType);
        continue;
      }
      adjIndex.set(key, cards.length);
      cards.push({ effect, damageTypes: [effect.adjustment.damageType] });
    } else {
      cards.push({ effect });
    }
  }
  return cards;
}

function fromCards(cards: EffectCard[]): FeatureEffect[] {
  return cards.flatMap((card): FeatureEffect[] => {
    if (card.effect.kind === "damage-adjustment") {
      const base = card.effect;
      const { type, nonMagicalOnly, exceptMaterials } = base.adjustment;
      const types = card.damageTypes?.length ? card.damageTypes : [base.adjustment.damageType];
      return types.map((damageType) => ({ ...base, adjustment: { type, damageType, nonMagicalOnly, ...(exceptMaterials ? { exceptMaterials } : {}) } }));
    }
    return [card.effect];
  });
}

type AttackScope = "melee" | "ranged" | "spell";

export function FeatureEffectEditor({
  value, onChange
}: { value: FeatureEffect[]; onChange: (next: FeatureEffect[]) => void }) {
  const cards = toCards(value ?? []);
  const commit = (next: EffectCard[]) => onChange(fromCards(next));
  const replace = (index: number, next: EffectCard) => commit(cards.map((card, i) => (i === index ? next : card)));

  return (
    <div className={styles.riderList}>
      {cards.map((card, index) => (
        <div key={index} className={styles.riderCard}>
          <div className={styles.riderHead}>
            <select
              aria-label="Effect type"
              value={card.effect.kind}
              onChange={(e) => replace(index, { effect: blankEffect(e.target.value as EditorKind), damageTypes: e.target.value === "damage-adjustment" ? ["slashing"] : undefined })}
            >
              {KIND_LABELS.map(([value_, label]) => <option key={value_} value={value_}>{label}</option>)}
            </select>
            <InfoTooltip label="About effect types" content={KIND_HELP} />
            <button type="button" className={styles.riderRemove} aria-label="Remove effect" onClick={() => commit(cards.filter((_, i) => i !== index))}>×</button>
          </div>
          <EffectFields card={card} onChange={(next) => replace(index, next)} />
          {"condition" in card.effect ? (
            <label className={styles.fieldInlineLabel}>
              <span className={styles.fieldLabelRow}>
                When
                <InfoTooltip label="About effect conditions" content={GATE_HELP} />
              </span>
              <select
                value={(card.effect as { condition?: FeatureCondition }).condition ?? "always"}
                onChange={(e) => replace(index, { ...card, effect: { ...card.effect, condition: e.target.value as FeatureCondition } as FeatureEffect })}
              >
                {GATE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          ) : null}
          {"condition" in card.effect && (card.effect as { condition?: FeatureCondition }).condition === "charged" ? (
            <label className={styles.fieldInlineLabel}>
              Charge distance (ft)
              <input
                type="number" min={5} step={5} style={{ width: 64 }} aria-label="Charge distance"
                value={(card.effect as { chargeFeet?: number }).chargeFeet ?? 20}
                onChange={(e) => replace(index, { ...card, effect: { ...card.effect, chargeFeet: Math.max(5, Number(e.target.value) || 20) } as FeatureEffect })}
              />
            </label>
          ) : null}
        </div>
      ))}
      <button type="button" className={styles.riderAdd} onClick={() => commit([...cards, { effect: blankEffect("damage-bonus") }])}>
        + Add effect
      </button>
    </div>
  );
}

/* ── per-kind fields ─────────────────────────────────────────────────────── */

function EffectFields({ card, onChange }: { card: EffectCard; onChange: (next: EffectCard) => void }) {
  const { effect } = card;
  const set = (next: FeatureEffect) => onChange({ ...card, effect: next });

  if (effect.kind === "damage-bonus") {
    const first = effect.damage[0] ?? { dice: "2", damageType: "same-as-attack" as const };
    return (
      <>
        <div className={styles.riderRow}>
          <DamageAmount value={first.dice} onChange={(dice) => set({ ...effect, damage: [{ ...first, dice }] })} />
          <select
            aria-label="Damage type"
            value={first.damageType}
            onChange={(e) => set({ ...effect, damage: [{ ...first, damageType: e.target.value as never }] })}
          >
            <option value="same-as-attack">same as the attack</option>
            {DAMAGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className={styles.riderRow}>
          <span className={styles.fieldInlineLabel}>Or choose per hit (the type the target resists least)</span>
          <div className={styles.damageAmount}>
            {DAMAGE_TYPES.map((t) => {
              const options = first.damageTypeOptions ?? [];
              return (
                <label key={t} className={styles.fieldInlineLabel}>
                  <input
                    type="checkbox"
                    checked={options.includes(t)}
                    onChange={(e) => {
                      const next = e.target.checked ? [...options, t] : options.filter((o) => o !== t);
                      set({ ...effect, damage: [{ ...first, damageTypeOptions: next.length > 1 ? next : undefined }] });
                    }}
                  />
                  {t}
                </label>
              );
            })}
          </div>
        </div>
        <div className={styles.riderRow}>
          <ScopeSelect value={effect.attackTypes} onChange={(attackTypes) => set({ ...effect, attackTypes })} />
          <label className={styles.fieldInlineLabel}>
            Ability
            <select value={effect.abilities?.[0] ?? "any"} onChange={(e) => set({ ...effect, abilities: e.target.value === "any" ? undefined : [e.target.value as Ability] })}>
              <option value="any">any</option>
              {ABILITIES.map((a) => <option key={a} value={a}>{a.toUpperCase()}</option>)}
            </select>
          </label>
          <label className={styles.fieldInlineLabel}>
            Applies
            <select value={effect.oncePerTurn ? "once" : "every"} onChange={(e) => set({ ...effect, oncePerTurn: e.target.value === "once" ? true : undefined })}>
              <option value="every">to every hit</option>
              <option value="once">once per turn</option>
            </select>
          </label>
          <label className={styles.fieldInlineLabel}>
            <input type="checkbox" checked={effect.critical === true} onChange={(e) => set({ ...effect, critical: e.target.checked ? true : undefined })} />
            only on a crit
          </label>
        </div>
        <div className={styles.riderRow}>
          <label className={styles.fieldInlineLabel}>
            Only if the base attack already deals
            <select
              value={effect.damageTypes?.[0] ?? "any"}
              onChange={(e) => set({ ...effect, damageTypes: e.target.value === "any" ? undefined : [e.target.value as never] })}
            >
              <option value="any">any damage type</option>
              {DAMAGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
        </div>
      </>
    );
  }

  if (effect.kind === "damage-adjustment") {
    return (
      <AdjustmentGroupEditor
        group={{
          type: effect.adjustment.type,
          damageTypes: card.damageTypes ?? [effect.adjustment.damageType],
          nonMagicalOnly: effect.adjustment.nonMagicalOnly,
          exceptMaterials: effect.adjustment.exceptMaterials
        }}
        onChange={(group) => onChange({
          damageTypes: group.damageTypes,
          effect: {
            ...effect,
            adjustment: {
              type: group.type, damageType: group.damageTypes[0] ?? effect.adjustment.damageType,
              nonMagicalOnly: group.nonMagicalOnly, ...(group.exceptMaterials ? { exceptMaterials: group.exceptMaterials } : {})
            }
          }
        })}
      />
    );
  }

  if (effect.kind === "attack-bonus" || effect.kind === "armor-class-bonus" || effect.kind === "save-bonus") {
    return (
      <div className={styles.riderRow}>
        <NumericFormulaInput
          value={effect.bonus}
          onChange={(bonus) => set({ ...effect, bonus } as FeatureEffect)}
        />
        {effect.kind === "attack-bonus" ? <ScopeSelect value={effect.attackTypes} onChange={(attackTypes) => set({ ...effect, attackTypes })} /> : null}
        {effect.kind === "save-bonus" ? (
          <label className={styles.fieldInlineLabel}>
            Save
            <select value={effect.ability ?? "any"} onChange={(e) => set({ ...effect, ability: e.target.value === "any" ? undefined : e.target.value as Ability })}>
              <option value="any">any</option>
              {ABILITIES.map((a) => <option key={a} value={a}>{a.toUpperCase()}</option>)}
            </select>
          </label>
        ) : null}
      </div>
    );
  }

  if (effect.kind === "save-dc-bonus") {
    return (
      <div className={styles.riderRow}>
        <NumericFormulaInput value={effect.bonus} onChange={(bonus) => set({ ...effect, bonus })} />
        <label className={styles.fieldInlineLabel}>
          <input
            type="checkbox"
            checked={Boolean(effect.spellsOnly)}
            onChange={(e) => set({ ...effect, spellsOnly: e.target.checked ? true : undefined })}
          />
          spells only
        </label>
      </div>
    );
  }

  if (effect.kind === "attack-advantage") {
    return (
      <div className={styles.riderRow}>
        <select value={effect.mode ?? "advantage"} onChange={(e) => set({ ...effect, mode: e.target.value as "advantage" | "disadvantage" })}>
          <option value="advantage">Advantage</option>
          <option value="disadvantage">Disadvantage</option>
        </select>
        <ScopeSelect value={effect.attackTypes} onChange={(attackTypes) => set({ ...effect, attackTypes })} />
      </div>
    );
  }

  if (effect.kind === "incoming-attack-modifier") {
    const preset = effect.amount === 5 ? "adv" : effect.amount === -5 ? "disadv" : "custom";
    return (
      <div className={styles.riderRow}>
        <select
          value={preset}
          onChange={(e) => set({ ...effect, amount: e.target.value === "adv" ? 5 : e.target.value === "disadv" ? -5 : effect.amount })}
        >
          <option value="adv">Attackers have advantage (+5)</option>
          <option value="disadv">Attackers have disadvantage (−5)</option>
          <option value="custom">A flat modifier</option>
        </select>
        {preset === "custom" ? (
          <label className={styles.fieldInlineLabel}>
            Amount
            <input type="number" value={effect.amount} onChange={(e) => set({ ...effect, amount: Number(e.target.value) || 0 })} />
          </label>
        ) : null}
      </div>
    );
  }

  if (effect.kind === "save-advantage") {
    const abilities = new Set<Ability>([...(effect.ability ? [effect.ability] : []), ...(effect.abilities ?? [])]);
    const conditions = new Set(effect.against?.conditions ?? []);
    const setAbilities = (next: Set<Ability>) => set({ ...effect, ability: undefined, abilities: next.size ? ABILITIES.filter((a) => next.has(a)) : undefined });
    const setAgainst = (against: { source?: "spell" | "magical"; conditions?: ConditionName[] }) =>
      set({ ...effect, against: against.source || against.conditions?.length ? against : undefined });
    return (
      <>
        <div className={styles.riderRow}>
          <span className={styles.fieldInlineLabel}>On saves (none selected = all)</span>
        </div>
        <div className={styles.chips}>
          {ABILITIES.map((a) => (
            <button
              key={a} type="button" className={abilities.has(a) ? styles.chipOn : undefined}
              onClick={() => { const next = new Set(abilities); next.has(a) ? next.delete(a) : next.add(a); setAbilities(next); }}
            >
              {a.toUpperCase()}
            </button>
          ))}
        </div>
        <label className={styles.fieldInlineLabel}>
          Against
          <select
            aria-label="Save source"
            value={effect.against?.source ?? "any"}
            onChange={(e) => setAgainst({ ...effect.against, source: e.target.value === "any" ? undefined : e.target.value as "spell" | "magical" })}
          >
            <option value="any">any source</option>
            <option value="magical">spells and other magical effects</option>
            <option value="spell">spells only</option>
          </select>
        </label>
        <div className={styles.riderRow}>
          <span className={styles.fieldInlineLabel}>…and only against being (none selected = anything)</span>
        </div>
        <div className={styles.chips}>
          {SAVE_CONDITIONS.map((c) => (
            <button
              key={c} type="button" className={conditions.has(c) ? styles.chipOn : undefined}
              onClick={() => {
                const next = new Set(conditions);
                next.has(c) ? next.delete(c) : next.add(c);
                setAgainst({ ...effect.against, conditions: next.size ? SAVE_CONDITIONS.filter((candidate) => next.has(candidate)) : undefined });
              }}
            >
              {c}
            </button>
          ))}
        </div>
      </>
    );
  }

  if (effect.kind === "hp-regen") {
    const suppressed = new Set(effect.suppressedByDamageTypes ?? []);
    return (
      <>
        <div className={styles.riderRow}>
          <label className={styles.fieldInlineLabel}>
            Regains
            <input type="number" min={1} value={effect.amount} onChange={(e) => set({ ...effect, amount: Math.max(1, Number(e.target.value) || 1) })} />
            HP at the start of its turn
          </label>
          <label className={styles.fieldInlineLabel}>
            <input type="checkbox" checked={effect.worksAtZero === true} onChange={(e) => set({ ...effect, worksAtZero: e.target.checked ? true : undefined })} />
            even at 0 HP (stays down instead of dying)
          </label>
        </div>
        <div className={styles.riderRow}>
          <span className={styles.fieldInlineLabel}>Switched off for a turn by damage of type (none = never)</span>
        </div>
        <div className={styles.chips}>
          {DAMAGE_TYPES.map((t) => (
            <button
              key={t} type="button" className={suppressed.has(t) ? styles.chipOn : undefined}
              onClick={() => {
                const next = new Set(suppressed);
                next.has(t) ? next.delete(t) : next.add(t);
                set({ ...effect, suppressedByDamageTypes: next.size ? DAMAGE_TYPES.filter((candidate) => next.has(candidate)) : undefined });
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </>
    );
  }

  if (effect.kind === "survive-lethal") {
    const excluded = new Set(effect.excludedDamageTypes ?? []);
    return (
      <>
        <div className={styles.riderRow}>
          <label className={styles.fieldInlineLabel}>
            <input
              type="checkbox" checked={Boolean(effect.save)}
              onChange={(e) => set({ ...effect, save: e.target.checked ? { ability: "con", dcBase: 5 } : undefined })}
            />
            needs a saving throw
          </label>
          {effect.save ? (
            <>
              <select aria-label="Save ability" value={effect.save.ability} onChange={(e) => set({ ...effect, save: { ...effect.save!, ability: e.target.value as Ability } })}>
                {ABILITIES.map((a) => <option key={a} value={a}>{a.toUpperCase()}</option>)}
              </select>
              <label className={styles.fieldInlineLabel}>
                DC = <input type="number" aria-label="Base DC" value={effect.save.dcBase} onChange={(e) => set({ ...effect, save: { ...effect.save!, dcBase: Number(e.target.value) || 0 } })} /> + damage taken
              </label>
            </>
          ) : null}
        </div>
        <div className={styles.riderRow}>
          <label className={styles.fieldInlineLabel}>
            Only if the hit is at most
            <input
              type="number" min={1} placeholder="any" aria-label="Largest hit covered" value={effect.maxDamage ?? ""}
              onChange={(e) => set({ ...effect, maxDamage: e.target.value === "" ? undefined : Number(e.target.value) })}
            />
          </label>
          <label className={styles.fieldInlineLabel}>
            Uses (resource id)
            <input type="text" placeholder="unlimited" aria-label="Uses pool" value={effect.resourceId ?? ""} onChange={(e) => set({ ...effect, resourceId: e.target.value || undefined })} />
          </label>
        </div>
        <div className={styles.riderRow}>
          <label className={styles.fieldInlineLabel}>
            <input
              type="checkbox" checked={excluded.has("radiant")}
              onChange={(e) => set({ ...effect, excludedDamageTypes: e.target.checked ? ["radiant"] : undefined })}
            />
            not against radiant damage
          </label>
          <label className={styles.fieldInlineLabel}>
            <input type="checkbox" checked={effect.excludeCritical === true} onChange={(e) => set({ ...effect, excludeCritical: e.target.checked ? true : undefined })} />
            not against a critical hit
          </label>
        </div>
      </>
    );
  }

  if (effect.kind === "auto-succeed-save") {
    return (
      <div className={styles.riderRow}>
        <label className={styles.fieldInlineLabel}>
          Spends one use of
          <input type="text" aria-label="Uses pool" value={effect.resourceId} onChange={(e) => set({ ...effect, resourceId: e.target.value })} />
        </label>
        <label className={styles.fieldInlineLabel}>
          on saves against
          <select
            aria-label="Save source"
            value={effect.against?.source ?? "any"}
            onChange={(e) => set({ ...effect, against: e.target.value === "any" ? undefined : { source: e.target.value as "spell" | "magical" } })}
          >
            <option value="any">anything</option>
            <option value="magical">spells and other magical effects</option>
            <option value="spell">spells only</option>
          </select>
        </label>
      </div>
    );
  }

  if (effect.kind === "apply-condition-on-hit") {
    const save = effect.save;
    return (
      <div className={styles.riderRow}>
        <label className={styles.fieldInlineLabel}>
          Condition
          <select
            aria-label="Condition"
            value={effect.appliedCondition.name ?? "prone"}
            onChange={(e) => set({ ...effect, appliedCondition: { ...effect.appliedCondition, name: e.target.value as ConditionName } })}
          >
            {SAVE_CONDITIONS.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label className={styles.fieldInlineLabel}>
          Unless it saves
          <select
            aria-label="Save"
            value={save?.ability ?? "none"}
            onChange={(e) => set({ ...effect, save: e.target.value === "none" ? undefined : { ability: e.target.value as Ability, dc: save?.dc ?? 13 } })}
          >
            <option value="none">no save</option>
            {ABILITIES.map((a) => <option key={a} value={a}>{a.toUpperCase()}</option>)}
          </select>
        </label>
        {save ? (
          <label className={styles.fieldInlineLabel}>
            DC
            <input type="number" min={1} max={30} style={{ width: 52 }} aria-label="Save DC" value={save.dc ?? 13}
              onChange={(e) => set({ ...effect, save: { ...save, dc: Math.max(1, Number(e.target.value) || 13) } })} />
          </label>
        ) : null}
        <ScopeSelect value={effect.attackTypes} onChange={(attackTypes) => set({ ...effect, attackTypes })} />
      </div>
    );
  }

  if (effect.kind === "extra-action") {
    return (
      <label className={styles.fieldInlineLabel}>
        Regain
        <select value={effect.slot} onChange={(e) => set({ ...effect, slot: e.target.value as "action" | "bonus" | "reaction" })}>
          <option value="action">an action</option>
          <option value="bonus">a bonus action</option>
          <option value="reaction">a reaction</option>
        </select>
      </label>
    );
  }

  if (effect.kind === "resource-regain") {
    return (
      <div className={styles.riderRow}>
        <label className={styles.fieldInlineLabel}>
          Resource
          <input type="text" placeholder="rage" value={effect.resourceId} onChange={(e) => set({ ...effect, resourceId: e.target.value })} />
        </label>
        <label className={styles.fieldInlineLabel}>
          Amount
          <input type="number" min={1} style={{ width: 52 }} value={effect.amount.base ?? 1} onChange={(e) => set({ ...effect, amount: { base: Math.max(1, Number(e.target.value) || 1) } })} />
        </label>
        <label className={styles.fieldInlineLabel}>
          When
          <select value={effect.timing} onChange={(e) => set({ ...effect, timing: e.target.value as "on-activate" | "turn-start" | "turn-end" })}>
            <option value="on-activate">on activation</option>
            <option value="turn-start">at turn start</option>
            <option value="turn-end">at turn end</option>
          </select>
        </label>
        <label className={styles.fieldInlineLabel}>
          Max
          <input type="number" min={1} style={{ width: 52 }} value={effect.max ?? ""} onChange={(e) => set({ ...effect, max: e.target.value === "" ? undefined : Number(e.target.value) })} />
        </label>
      </div>
    );
  }

  return null;
}

type DamageMode = "flat" | "dice" | "dice-flat";

/**
 * A damage bonus / penalty as one `dice` string: a flat amount (`"2"` / `"-2"`),
 * extra dice (`"3d6"` / `"-1d4"`), or dice + a per-attack flat (`"1d6+2"` — the
 * sign applies to the whole bonus).
 */
function DamageAmount({ value, onChange }: { value: string; onChange: (dice: string) => void }) {
  const negative = value.trim().startsWith("-");
  const bare = value.replace(/^[+-]/, "");
  const dm = /^(\d*)d(\d+)(?:[+-](\d+))?$/i.exec(bare);
  const count = dm ? Number(dm[1] || "1") : 0;
  const die = dm ? Number(dm[2]) : 6;
  const flat = dm ? Number(dm[3] ?? "0") : Math.abs(Number(bare) || 0);
  const mode: DamageMode = count > 0 ? (flat !== 0 ? "dice-flat" : "dice") : "flat";

  const emit = (n: { negative?: boolean; count?: number; die?: number; flat?: number; mode?: DamageMode }) => {
    const neg = n.negative ?? negative;
    const m = n.mode ?? mode;
    const c = m === "flat" ? 0 : Math.max(1, n.count ?? (count || 1));
    const d = n.die ?? die;
    const f = m === "dice" ? 0 : Math.max(0, n.flat ?? (flat || (m === "dice-flat" ? 1 : 2)));
    const sign = neg ? "-" : "";
    const body = c > 0 && f > 0 ? `${sign}${c}d${d}${neg ? "-" : "+"}${f}`
      : c > 0 ? `${sign}${c}d${d}`
        : `${sign}${f}`;
    onChange(body);
  };

  return (
    <div className={styles.damageAmount}>
      <select aria-label="Bonus kind" className={styles.damageAmountKind} value={mode} onChange={(e) => emit({ mode: e.target.value as DamageMode })}>
        <option value="flat">Flat amount</option>
        <option value="dice">Extra dice</option>
        <option value="dice-flat">Extra dice + flat</option>
      </select>
      <select aria-label="Sign" value={negative ? "-" : "+"} onChange={(e) => emit({ negative: e.target.value === "-" })}>
        <option value="+">+</option>
        <option value="-">−</option>
      </select>
      {mode !== "flat" ? (
        <>
          <input aria-label="Dice count" type="number" min={1} value={count || 1} onChange={(e) => emit({ count: Math.max(1, Number(e.target.value) || 1) })} />
          <span>d</span>
          <select aria-label="Die size" value={die} onChange={(e) => emit({ die: Number(e.target.value) })}>
            {[4, 6, 8, 10, 12, 20].map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </>
      ) : null}
      {mode !== "dice" ? (
        <input aria-label="Flat amount" type="number" min={0} value={mode === "flat" ? (flat || 2) : flat} onChange={(e) => emit({ flat: Math.abs(Number(e.target.value) || 0) })} />
      ) : null}
    </div>
  );
}

function NumericFormulaInput({ value, onChange }: { value: NumericFormula; onChange: (next: NumericFormula) => void }) {
  const byAbility = Boolean(value.ability);
  return (
    <>
      <label className={styles.fieldInlineLabel}>
        <select value={byAbility ? "ability" : "flat"} onChange={(e) => onChange(e.target.value === "ability" ? { ability: value.ability ?? "str" } : { base: value.base ?? 1 })}>
          <option value="flat">A flat number</option>
          <option value="ability">An ability modifier</option>
        </select>
      </label>
      {byAbility ? (
        <select aria-label="Ability" value={value.ability} onChange={(e) => onChange({ ability: e.target.value as Ability })}>
          {ABILITIES.map((a) => <option key={a} value={a}>{a.toUpperCase()}</option>)}
        </select>
      ) : (
        <input aria-label="Amount" type="number" style={{ width: 60 }} value={value.base ?? 0} onChange={(e) => onChange({ base: Number(e.target.value) || 0 })} />
      )}
    </>
  );
}

function ScopeSelect({ value, onChange }: { value: AttackScope[] | undefined; onChange: (next: AttackScope[] | undefined) => void }) {
  const current = value?.[0] ?? "any";
  return (
    <label className={styles.fieldInlineLabel}>
      Applies to
      <select value={current} onChange={(e) => onChange(e.target.value === "any" ? undefined : [e.target.value as AttackScope])}>
        {SCOPE_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}
