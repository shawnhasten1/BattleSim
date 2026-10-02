"use client";

import { Fragment, useEffect, useId, useState } from "react";
import type { ActorTag, CombatantState, CreatureDefinition, TacticsProfile } from "@/engine";
import { isSrdMonsterId, loadSrdMonster } from "@/data/srd/monsters";
import { useEncounterStore } from "@/store/encounter-store";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { TACTICS_PROFILES } from "@/lib/tactics-profiles";
import { RESOURCE_STANCES } from "@/lib/resource-stances";
import { AUTOMATION_HELP } from "@/lib/sheet-help";
import { aiUses, type AiUse } from "@/lib/actor-sheet/ai-uses";
import { tokensOf } from "@/lib/actor-sheet/scope";
import { tacticsLine } from "@/lib/actor-sheet/summaries";
import { defaultTacticsOf } from "@/lib/actor-sheet/token";
import type { AbilityRef } from "@/lib/ability-editor/refs";
import { Segmented } from "../ability-editor/controls";
import { SheetSection } from "../SheetSection";
import { Row } from "./Row";
import abilityStyles from "../abilities/abilities.module.css";
import styles from "../sheet.module.css";

const TACTICS_PROFILE_HELP = (
  <dl>
    {TACTICS_PROFILES.map((option) => (
      <div key={option.value}>
        <dt>{option.label}</dt>
        <dd>{option.description}</dd>
      </div>
    ))}
  </dl>
);

const HOW_IT_FIGHTS_HELP = (
  <p>
    Each turn the AI scores the moves, actions and targets this token can legally take, weighted by its profile, and
    takes the best. Spending weighs what a spell slot or a limited use costs against what it would do. The AI paths around
    walls, terrain and other tokens for its size, and never uses an ability marked ○. The Combat panel sets a whole side
    at once.
  </p>
);

type Priority = "normally" | "first" | "last";

const PRIORITIES: Array<{ value: Priority; label: string; hint: string }> = [
  { value: "normally", label: "Normally", hint: "Enemies weigh it like anyone else." },
  { value: "first", label: "First", hint: "Enemies go for it first (a brute beelines for it), and its allies heal it a little sooner." },
  { value: "last", label: "Last", hint: "Enemies leave it for last, and its allies heal and buff it last." }
];

const labelOf = (profile: TacticsProfile) => TACTICS_PROFILES.find((option) => option.value === profile)?.label ?? profile;
const stanceOf = (stance: CombatantState["resourceStance"]) => RESOURCE_STANCES.find((option) => option.value === stance)?.label ?? stance;

/** The tactics the SRD statblock gives this creature, once its chunk has loaded; undefined for a creature of its own. */
function useSrdTactics(definitionId: string): TacticsProfile | undefined {
  const [srd, setSrd] = useState<{ id: string; tactics?: TacticsProfile }>();
  useEffect(() => {
    if (!isSrdMonsterId(definitionId)) return;
    let live = true;
    void loadSrdMonster(definitionId).then((monster) => {
      if (live) setSrd({ id: definitionId, tactics: monster?.defaultTactics });
    });
    return () => { live = false; };
  }, [definitionId]);
  return srd?.id === definitionId ? srd.tactics : undefined;
}

/** Abilities by name, each opening in the ability editor: "Greatsword, Parry (reaction)". */
function Names({ uses, onOpen }: { uses: AiUse[]; onOpen: (ref: AbilityRef) => void }) {
  return (
    <>
      {uses.map(({ row, how }, index) => (
        <Fragment key={row.key}>
          {index ? ", " : null}
          <button type="button" className={styles.linkBtn} title={`Open ${row.name} in the ability editor`} onClick={() => onOpen(row.ref)}>
            {row.name}
          </button>
          {how ? ` (${how})` : null}
        </Fragment>
      ))}
    </>
  );
}

/**
 * How this token fights and how others treat it (plan §3.5): its profile and spending with what they do, the creature's
 * default and "Use these for every Knight", where enemies put it in their order, and what the AI will use, by the
 * Abilities list's dots.
 */
export function TacticsSection({ combatant, definition, open, onToggle, onOpenAbility }: {
  combatant: CombatantState;
  definition: CreatureDefinition;
  open: boolean;
  onToggle: () => void;
  onOpenAbility: (ref: AbilityRef) => void;
}) {
  const id = useId();
  const updateTactics = useEncounterStore((s) => s.updateTactics);
  const updateResourceStance = useEncounterStore((s) => s.updateResourceStance);
  const updateTags = useEncounterStore((s) => s.updateTags);
  const setCreatureBehavior = useEncounterStore((s) => s.setCreatureBehavior);
  const combatants = useEncounterStore((s) => s.encounter.combatants);
  const srdTactics = useSrdTactics(definition.id);

  const tags = combatant.tags ?? [];
  const first = tags.includes("high-priority");
  const last = tags.includes("low-priority");
  // Both can be on from before; neither shows picked until one is chosen.
  const priority: Priority | undefined = first && last ? undefined : first ? "first" : last ? "last" : "normally";

  function setTags(next: ActorTag[]) {
    updateTags(combatant.id, next.length ? next : undefined);
  }
  function setPriority(next: Priority) {
    const kept = tags.filter((tag) => tag !== "high-priority" && tag !== "low-priority");
    setTags(next === "first" ? [...kept, "high-priority"] : next === "last" ? [...kept, "low-priority"] : kept);
  }

  // What a new token starts with, and where that came from.
  const defaultTactics = defaultTacticsOf(definition);
  const defaultStance = definition.defaultResourceStance ?? "balanced";
  const from = definition.defaultTactics === undefined ? " (chosen from its attacks)"
    : srdTactics !== undefined && definition.defaultTactics === srdTactics && definition.defaultResourceStance === undefined ? " (the SRD's choice)"
      : "";
  const others = tokensOf({ combatants }, definition.id);
  const matches = (token: Pick<CombatantState, "tacticsProfile" | "resourceStance">) =>
    token.tacticsProfile === combatant.tacticsProfile && token.resourceStance === combatant.resourceStance;
  const differs = !matches({ tacticsProfile: defaultTactics, resourceStance: defaultStance }) || others.some((token) => !matches(token));
  const everyTitle = `A new ${definition.name} starts as ${labelOf(combatant.tacticsProfile)}, ${stanceOf(combatant.resourceStance)}`
    + `, and so ${others.length === 1 ? "does this token" : `do its ${others.length} tokens in the scene`}.`;

  const uses = aiUses(definition, combatant);
  const nothing = !uses.simulated.length && !uses.partly.length && !uses.reference.length && !uses.off.length;

  return (
    <SheetSection title="Tactics" summary={tacticsLine(combatant)} open={open} onToggle={onToggle}>
      <span className={styles.subhead}>
        How it fights
        <InfoTooltip label="About how the AI plays it" content={HOW_IT_FIGHTS_HELP} />
      </span>
      <div className={styles.rows}>
        <Row label="Profile" htmlFor={`${id}-profile`} help={TACTICS_PROFILE_HELP}>
          <select
            id={`${id}-profile`} aria-label="Tactics profile" className={styles.profileSelect} value={combatant.tacticsProfile}
            onChange={(e) => updateTactics(combatant.id, e.target.value as TacticsProfile)}
          >
            {TACTICS_PROFILES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </Row>
        <p className={`${styles.note} ${styles.rowNote}`}>{TACTICS_PROFILES.find((option) => option.value === combatant.tacticsProfile)?.description}</p>
        <Row label="Spending">
          <Segmented
            label="Spending" value={combatant.resourceStance} onChange={(stance) => updateResourceStance(combatant.id, stance)}
            options={RESOURCE_STANCES.map(({ value, label }) => ({ value, label }))}
          />
        </Row>
        <p className={`${styles.note} ${styles.rowNote}`}>{RESOURCE_STANCES.find((option) => option.value === combatant.resourceStance)?.description}</p>
      </div>
      <div className={styles.defaultLine}>
        <span>
          A new {definition.name} starts as {labelOf(defaultTactics)}, {stanceOf(defaultStance)}{from}.
        </span>
        {differs ? (
          <button type="button" className={styles.addSmall} title={everyTitle} onClick={() => setCreatureBehavior(definition.id, { tactics: combatant.tacticsProfile, stance: combatant.resourceStance })}>
            Use these for every {definition.name}
          </button>
        ) : null}
      </div>

      <span className={styles.subhead}>How others treat it</span>
      <div className={styles.rows}>
        <Row label="Enemies target it">
          <Segmented label="Enemies target it" value={priority} onChange={setPriority} options={PRIORITIES.map(({ value, label, hint }) => ({ value, label, title: hint }))} />
        </Row>
        <p className={`${styles.note} ${styles.rowNote}`}>
          {priority ? PRIORITIES.find((option) => option.value === priority)!.hint : "It was set to be targeted both first and last: pick one."}
        </p>
        <Row label="Protect it" htmlFor={`${id}-protect`}>
          <label className={styles.checkLine}>
            <input
              id={`${id}-protect`} type="checkbox" checked={tags.includes("protected")}
              onChange={(e) => setTags(e.target.checked ? [...tags, "protected"] : tags.filter((tag) => tag !== "protected"))}
            />
            its allies guard it even at full HP, and heal and buff it first
          </label>
        </Row>
      </div>

      <span className={styles.subhead}>
        What the AI will use
        <InfoTooltip label="About automation levels" content={AUTOMATION_HELP} />
      </span>
      <ul className={styles.aiUses}>
        {uses.simulated.length ? (
          <li>
            <span className={abilityStyles.dot} data-automation="simulated" role="img" aria-label="Simulated" />
            <span><Names uses={uses.simulated} onOpen={onOpenAbility} /></span>
          </li>
        ) : null}
        {uses.partly.map((use) => (
          <li key={use.row.key}>
            <span className={abilityStyles.dot} data-automation="partial" role="img" aria-label="Partly simulated" />
            <span><Names uses={[use]} onOpen={onOpenAbility} />: {use.note}</span>
          </li>
        ))}
        {uses.reference.length ? (
          <li>
            <span className={abilityStyles.dot} data-automation="reference" role="img" aria-label="Reference only" />
            <span><Names uses={uses.reference} onOpen={onOpenAbility} />: reference only, so you play {uses.reference.length === 1 ? "it" : "them"} by hand</span>
          </li>
        ) : null}
        {uses.off.length ? (
          <li>
            <span className={abilityStyles.dot} data-automation="reference" role="img" aria-label="Switched off" />
            <span><Names uses={uses.off} onOpen={onOpenAbility} />: {uses.off.length === 1 ? "an optional rule" : "optional rules"}, switched off on the Abilities tab</span>
          </li>
        ) : null}
        {nothing ? <li>Nothing yet: its abilities are added on the Abilities tab.</li> : null}
      </ul>
    </SheetSection>
  );
}
