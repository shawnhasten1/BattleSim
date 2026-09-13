"use client";

import type { Ability, ActionRider, ConditionName, CreatureType, RiderDuration, RiderGate } from "@/engine";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { CREATURE_TYPES } from "@/lib/creature-types";
import { DiceInput } from "./BuilderForm";
import { parseDiceValue, diceValueToString } from "./schemas";
import styles from "./builders.module.css";

const CREATURE_TYPE_FILTER_HELP = (
  <p>
    When enabled, this effect only applies to targets whose creature type is checked below — every other
    target automatically resists it (no roll, it just has no effect on them). Leave unchecked for an effect
    that works on any creature.
  </p>
);

const TRIGGER_HELP = (
  <dl>
    <div>
      <dt>On weapon attacks</dt>
      <dd>"On a hit" fires on any hit; "On a critical hit" only on a nat-20-style crit; "Always" fires even on a miss.</dd>
    </div>
    <div>
      <dt>On saves / area effects</dt>
      <dd>"On a failed save" is the usual case; "On a successful save" is rare (e.g. half the effect still lands); "Always" ignores the save entirely.</dd>
    </div>
  </dl>
);

const ACTIVATION_HELP = (
  <dl>
    <div>
      <dt>Always spend if affordable</dt>
      <dd>The charge is spent automatically whenever this effect triggers and the pool can pay for it — not a choice.</dd>
    </div>
    <div>
      <dt>Optional — spend only when worth it</dt>
      <dd>The charge can be spent for this upgrade, but doesn't have to be — the plain effect stays available too, so a charge can be held back.</dd>
    </div>
  </dl>
);

const DURATION_HELP = (
  <dl>
    <div>
      <dt>A number of rounds</dt>
      <dd>Counts down and expires after that many rounds.</dd>
    </div>
    <div>
      <dt>Until the target saves</dt>
      <dd>The target gets to re-roll its save (usually at the end of its turn) to end the effect early.</dd>
    </div>
    <div>
      <dt>While concentrating</dt>
      <dd>Ends immediately if whoever applied it loses concentration.</dd>
    </div>
    <div>
      <dt>Until its next turn</dt>
      <dd>Ends automatically at the start of the target's very next turn — no save needed.</dd>
    </div>
    <div>
      <dt>Until removed</dt>
      <dd>Permanent — lasts until something else clears it.</dd>
    </div>
  </dl>
);

const CONDITIONS: ConditionName[] = [
  "blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated",
  "invisible", "paralyzed", "poisoned", "prone", "restrained", "stunned", "unconscious"
];
const ABILITIES: Ability[] = ["str", "dex", "con", "int", "wis", "cha"];

type RiderContext = "weapon" | "save" | "area";
type RiderKind = ActionRider["kind"];

function defaultGate(context: RiderContext): RiderGate {
  return context === "weapon" ? "on-hit" : "on-save-fail";
}

function blankRider(kind: RiderKind, context: RiderContext): ActionRider {
  const when = defaultGate(context);
  switch (kind) {
    case "damage":
      return { kind: "damage", when, components: [{ dice: "1d6", damageType: "necrotic" }] };
    case "healing":
      return { kind: "healing", when, components: [{ dice: "1d4" }] };
    case "push":
      return { kind: "push", when, distance: 10 };
    case "note":
      return { kind: "note", text: "" };
    case "condition":
    default:
      return {
        kind: "condition",
        when,
        condition: "frightened",
        save: context === "weapon" ? { ability: "wis", onSuccess: "negates" } : undefined,
        duration: { kind: "rounds", rounds: 10 }
      };
  }
}

function durationKind(duration: RiderDuration | undefined): RiderDuration["kind"] {
  return duration?.kind ?? "rounds";
}

export function RiderEditor({
  value, onChange, context, hasActionSave
}: {
  value: ActionRider[];
  onChange: (next: ActionRider[]) => void;
  context: RiderContext;
  hasActionSave: boolean;
}) {
  const riders = value ?? [];
  const replace = (index: number, next: ActionRider) => onChange(riders.map((rider, i) => (i === index ? next : rider)));
  const remove = (index: number) => onChange(riders.filter((_, i) => i !== index));

  return (
    <div className={styles.riderList}>
      {riders.map((rider, index) => (
        <div key={index} className={styles.riderCard}>
          <div className={styles.riderHead}>
            <select
              aria-label="Effect kind"
              value={rider.kind}
              onChange={(e) => replace(index, blankRider(e.target.value as RiderKind, context))}
            >
              <option value="condition">Condition</option>
              <option value="damage">Extra damage</option>
              <option value="push">Push</option>
              <option value="note">Reference note</option>
            </select>
            <button type="button" className={styles.riderRemove} onClick={() => remove(index)} aria-label="Remove effect">×</button>
          </div>

          {rider.kind === "condition" ? (
            <ConditionRiderFields
              rider={rider}
              context={context}
              hasActionSave={hasActionSave}
              onChange={(next) => replace(index, next)}
            />
          ) : null}

          {rider.kind === "damage" ? (
            <div className={styles.riderRow}>
              <DiceInput
                id={`rider-dmg-${index}`}
                value={parseDiceValue(rider.components[0]?.dice, rider.components[0]?.damageType)}
                onChange={(dice) => replace(index, { ...rider, components: [{ dice: diceValueToString(dice), damageType: (dice.type as never) ?? "necrotic" }] })}
                showAbility={false}
              />
              <GateSelect context={context} value={rider.when} onChange={(when) => replace(index, { ...rider, when })} />
            </div>
          ) : null}

          {rider.kind === "push" ? (
            <div className={styles.riderRow}>
              <label className={styles.fieldInlineLabel}>
                Distance (ft)
                <input type="number" min={5} step={5} value={rider.distance} onChange={(e) => replace(index, { ...rider, distance: Number(e.target.value) || 5 })} />
              </label>
              <GateSelect context={context} value={rider.when} onChange={(when) => replace(index, { ...rider, when })} />
            </div>
          ) : null}

          {rider.kind === "note" ? (
            <textarea
              className={styles.riderNote}
              placeholder="Resolved manually — describe the effect for the DM."
              value={rider.text}
              onChange={(e) => replace(index, { ...rider, text: e.target.value })}
            />
          ) : (
            <>
              <RiderChargeCost rider={rider} onChange={(next) => replace(index, next)} />
              <RiderCreatureTypeFilter rider={rider} onChange={(next) => replace(index, next)} />
            </>
          )}
        </div>
      ))}

      <button type="button" className={styles.riderAdd} onClick={() => onChange([...riders, blankRider("condition", context)])}>
        + Add effect
      </button>
    </div>
  );
}

function GateSelect({
  context, value, onChange
}: { context: RiderContext; value: RiderGate; onChange: (w: RiderGate) => void }) {
  const options: Array<[RiderGate, string]> = context === "weapon"
    ? [["on-hit", "On a hit"], ["on-crit", "On a critical hit"], ["always", "Always"]]
    : [["on-save-fail", "On a failed save"], ["on-save-success", "On a successful save"], ["always", "Always"]];
  return (
    <label className={styles.fieldInlineLabel}>
      <span className={styles.fieldLabelRow}>
        Triggers
        <InfoTooltip label="About trigger timing" content={TRIGGER_HELP} />
      </span>
      <select value={value} onChange={(e) => onChange(e.target.value as RiderGate)}>
        {options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
      </select>
    </label>
  );
}

/** Shared "costs charges" block for any rider except `note` — amount, which pool, and whether spending it is automatic or optional. */
function RiderChargeCost({
  rider, onChange
}: { rider: Exclude<ActionRider, { kind: "note" }>; onChange: (next: Exclude<ActionRider, { kind: "note" }>) => void }) {
  const hasCost = Boolean(rider.resourceCost);
  return (
    <div className={styles.riderRow}>
      <label className={styles.fieldInlineLabel}>
        <input
          type="checkbox"
          checked={hasCost}
          onChange={(e) => onChange({
            ...rider,
            resourceCost: e.target.checked ? { resourceId: rider.resourceCost?.resourceId ?? "charge", amount: 1 } : undefined,
            activation: e.target.checked ? rider.activation : undefined
          })}
        />
        Costs charges
      </label>
      {hasCost ? (
        <>
          <label className={styles.fieldInlineLabel}>
            Amount
            <input
              type="number" min={1} step={1} style={{ width: 56 }}
              value={rider.resourceCost?.amount ?? 1}
              onChange={(e) => onChange({
                ...rider,
                resourceCost: { resourceId: rider.resourceCost?.resourceId ?? "charge", amount: Math.max(1, Number(e.target.value) || 1) }
              })}
            />
          </label>
          <label className={styles.fieldInlineLabel}>
            Pool
            <input
              type="text" style={{ width: 90 }}
              value={rider.resourceCost?.resourceId ?? "charge"}
              onChange={(e) => onChange({
                ...rider,
                resourceCost: { resourceId: e.target.value || "charge", amount: rider.resourceCost?.amount ?? 1 }
              })}
            />
          </label>
          <label className={styles.fieldInlineLabel}>
            <span className={styles.fieldLabelRow}>
              Activation
              <InfoTooltip label="About optional charges" content={ACTIVATION_HELP} />
            </span>
            <select
              value={rider.activation ?? "always"}
              onChange={(e) => onChange({ ...rider, activation: e.target.value === "optional" ? "optional" : undefined })}
            >
              <option value="always">Always spend if affordable</option>
              <option value="optional">Optional — spend only when worth it</option>
            </select>
          </label>
        </>
      ) : null}
    </div>
  );
}

/** Shared "only affects certain creature types" filter for any rider except `note`. */
function RiderCreatureTypeFilter({
  rider, onChange
}: { rider: Exclude<ActionRider, { kind: "note" }>; onChange: (next: Exclude<ActionRider, { kind: "note" }>) => void }) {
  const selected = rider.restrictToCreatureTypes ?? [];
  const restricted = selected.length > 0;

  const toggle = (type: CreatureType) => {
    const next = selected.includes(type) ? selected.filter((t) => t !== type) : [...selected, type];
    onChange({ ...rider, restrictToCreatureTypes: next.length ? next : undefined });
  };

  return (
    <div className={styles.riderRow}>
      <div className={styles.riderTypeFilter}>
        <label className={styles.riderTypeToggle}>
          <input
            type="checkbox"
            checked={restricted}
            onChange={(e) => onChange({ ...rider, restrictToCreatureTypes: e.target.checked ? ["undead"] : undefined })}
          />
          Restrict to creature types
          <InfoTooltip label="About creature-type restriction" content={CREATURE_TYPE_FILTER_HELP} />
        </label>
        {restricted ? (
          <div className={styles.riderTypeGroup}>
            {CREATURE_TYPES.map((option) => (
              <label key={option.value} className={styles.riderTypeItem}>
                <input
                  type="checkbox"
                  checked={selected.includes(option.value)}
                  onChange={() => toggle(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ConditionRiderFields({
  rider, context, hasActionSave, onChange
}: {
  rider: Extract<ActionRider, { kind: "condition" }>;
  context: RiderContext;
  hasActionSave: boolean;
  onChange: (next: Extract<ActionRider, { kind: "condition" }>) => void;
}) {
  const conditionName = typeof rider.condition === "string" ? rider.condition : "frightened";
  // A weapon rider needs its own save to gate; a save/area rider is already gated
  // by the action's save, so its `save` block only feeds the repeat.
  const saveIsGate = context === "weapon";
  const requiresSave = saveIsGate ? Boolean(rider.save) : true;
  const dk = durationKind(rider.duration);

  const setDuration = (next: RiderDuration) => onChange({ ...rider, duration: next });

  return (
    <>
      <div className={styles.riderRow}>
        <label className={styles.fieldInlineLabel}>
          Condition
          <select value={conditionName} onChange={(e) => onChange({ ...rider, condition: e.target.value as ConditionName })}>
            {CONDITIONS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        {saveIsGate ? (
          <label className={styles.fieldInlineLabel}>
            <input
              type="checkbox"
              checked={requiresSave}
              onChange={(e) => onChange({ ...rider, save: e.target.checked ? { ability: "wis", onSuccess: "negates" } : undefined })}
            />
            Requires a saving throw?
          </label>
        ) : null}
      </div>

      {requiresSave ? (
        <div className={styles.riderRow}>
          <label className={styles.fieldInlineLabel}>
            Save
            <select
              value={rider.save?.ability ?? "wis"}
              onChange={(e) => onChange({ ...rider, save: { ...(rider.save ?? { onSuccess: "negates" }), ability: e.target.value as Ability } })}
            >
              {ABILITIES.map((a) => <option key={a} value={a}>{a.toUpperCase()}</option>)}
            </select>
          </label>
          <label className={styles.fieldInlineLabel}>
            DC (blank = auto)
            <input
              type="number"
              value={rider.save?.dc ?? ""}
              onChange={(e) => onChange({ ...rider, save: { ...(rider.save ?? { ability: "wis", onSuccess: "negates" }), dc: e.target.value === "" ? undefined : Number(e.target.value) } })}
            />
          </label>
        </div>
      ) : null}

      <div className={styles.riderRow}>
        <label className={styles.fieldInlineLabel}>
          <span className={styles.fieldLabelRow}>
            Duration
            <InfoTooltip label="About effect durations" content={DURATION_HELP} />
          </span>
          <select
            value={dk}
            onChange={(e) => {
              const kind = e.target.value as RiderDuration["kind"];
              if (kind === "rounds") setDuration({ kind: "rounds", rounds: 10 });
              else if (kind === "save-ends") setDuration({ kind: "save-ends", saveAt: "turn-end" });
              else if (kind === "concentration") setDuration({ kind: "concentration" });
              else if (kind === "until-start-of-next-turn") setDuration({ kind: "until-start-of-next-turn" });
              else setDuration({ kind: "permanent" });
            }}
          >
            <option value="rounds">A number of rounds</option>
            <option value="save-ends">Until the target saves</option>
            <option value="concentration">While concentrating</option>
            <option value="until-start-of-next-turn">Until its next turn</option>
            <option value="permanent">Until removed</option>
          </select>
        </label>
        {dk === "rounds" ? (
          <label className={styles.fieldInlineLabel}>
            Rounds
            <input
              type="number" min={1}
              value={(rider.duration as Extract<RiderDuration, { kind: "rounds" }>).rounds}
              onChange={(e) => setDuration({ kind: "rounds", rounds: Math.max(1, Number(e.target.value) || 1), repeatSaveAt: (rider.duration as Extract<RiderDuration, { kind: "rounds" }>).repeatSaveAt })}
            />
          </label>
        ) : null}
      </div>

      <label className={styles.fieldInlineLabel}>
        <input
          type="checkbox"
          checked={Boolean(rider.modifiers?.deniesReactions)}
          onChange={(e) => onChange({
            ...rider,
            modifiers: e.target.checked
              ? { ...(rider.modifiers ?? {}), deniesReactions: true }
              : (() => { const { deniesReactions, ...rest } = rider.modifiers ?? {}; return Object.keys(rest).length ? rest : undefined; })(),
            duration: e.target.checked ? { kind: "until-start-of-next-turn" } : rider.duration
          })}
        />
        Also: target can&apos;t take reactions until its next turn (Shocking Grasp)
      </label>
    </>
  );
}
