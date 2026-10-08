"use client";

import { armorClassOf, effectiveDefinition, type CreatureDefinition } from "@/engine";
import {
  BUILDER_STEPS,
  buildLabel,
  changeSentence,
  orderedChanges,
  stepOf,
  supportOf,
  type BuildChange
} from "@/lib/character-builder";
import { formatBonus } from "@/lib/ui-helpers";
import { SupportDot } from "@/components/rules-card";
import { useBuilder } from "../builder-context";
import { mixedRulesNote } from "../mixed";
import { Panel, StepHeading } from "../parts";
import { scoresProblem } from "../scores";
import styles from "../builder.module.css";

/** HP, AC, speed and the features, as the actor would have them. */
export function Summary({ definition }: { definition: CreatureDefinition }) {
  const features = [...(definition.features ?? []), ...(definition.traits ?? [])];
  // As it would fight: Fast Movement, Unarmored Movement and Tough are effects on the stored creature.
  const actual = effectiveDefinition(definition);
  return (
    <div className={styles.summary}>
      <span className={styles.stat}>HP <strong>{actual.maxHp}</strong></span>
      <span className={styles.stat}>AC <strong>{armorClassOf(definition).total}</strong></span>
      <span className={styles.stat}>Speed <strong>{actual.speed} ft</strong></span>
      <span className={styles.stat}>Proficiency <strong>{formatBonus(definition.proficiencyBonus ?? 2)}</strong></span>
      <p className={styles.featureChips}>
        {features.map((feature) => (
          <span key={feature.id} className={styles.featureChip}>
            <SupportDot support={supportOf(feature)} />
            {feature.name}
          </span>
        ))}
      </p>
    </div>
  );
}

/** The changes applying would make, with "use the build's" for each the DM changed. */
export function ChangeList({ changes, update, onUpdate }: { changes: BuildChange[]; update: string[]; onUpdate: (keys: string[]) => void }) {
  if (!changes.length) return null;
  return (
    <ul className={styles.changes} aria-label="Changes">
      {changes.map((change) => (
        <li key={change.key} className={styles[`change_${change.kind}`]}>
          {changeSentence(change)}
          {change.kind === "kept" ? (
            <label className={styles.update}>
              <input
                type="checkbox" checked={update.includes(change.key)}
                onChange={(event) => onUpdate(event.target.checked ? [...update, change.key] : update.filter((key) => key !== change.key))}
              />
              Use the build&apos;s instead
            </label>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

/**
 * Review (CHARACTER_BUILDER_UX_PLAN.md §3.6): before creating or applying, what's still open (each a link to where it's
 * made), whether the scores fit, what the simulator won't run, the summary, and, editing, what applying changes.
 */
export function ReviewStep({ update, onUpdate, adoptNotes, twins, removeTwins, onRemoveTwins }: {
  update: string[];
  onUpdate: (keys: string[]) => void;
  adoptNotes?: string[];
  twins: Array<{ name: string }>;
  removeTwins: boolean;
  onRemoveTwins: (on: boolean) => void;
}) {
  const { build, built, preview, sources, creating, adopting, definition, go } = useBuilder();
  const open = built.choices.filter((slot) => slot.pending);
  const problem = scoresProblem(build.abilities);
  const mixed = mixedRulesNote(build, sources);
  const definitionNow = preview.definition;
  const dmRuns = [
    ...[...(definitionNow.features ?? []), ...(definitionNow.traits ?? [])].filter((feature) => supportOf(feature) === "manual").map((feature) => feature.name),
    ...(definitionNow.spells ?? []).filter((spell) => spell.automationSupport === "manual-only" || spell.automationSupport === "unsupported").map((spell) => spell.name)
  ];
  const changes = creating ? [] : orderedChanges(preview.changes).filter((change) => !(change.kind === "field" && change.key === "field:classes"));
  const stepLabel = (slot: (typeof open)[number]) => BUILDER_STEPS.find((step) => step.id === stepOf(slot))?.label ?? "";
  return (
    <div className={styles.stepBody}>
      {adopting ? (
        <div className={styles.warning} role="note">
          <p>
            {definition?.name} becomes a built character: its class features become the {build.edition} rules&apos; versions, its
            ability scores and hit point maximum stay as they are, and nothing is added to its equipment. Its own abilities stay too.
          </p>
          {adoptNotes?.length ? <ul>{adoptNotes.map((note) => <li key={note}>{note}</li>)}</ul> : null}
        </div>
      ) : null}

      <Panel label="Before you go">
        <StepHeading icon="shield">{creating ? "Before you create the character" : "Before you apply"}</StepHeading>
        <ul className={styles.checklist}>
          {open.length ? (
            open.map((slot) => (
              <li key={`${JSON.stringify(slot.scope)}|${slot.path.join("/")}`} data-state="open">
                <span>{slot.owner}: {"label" in slot.spec && slot.spec.label ? slot.spec.label : slot.spec.kind === "skills" ? "skills" : slot.spec.kind}</span>
                <button type="button" className={styles.linkButton} onClick={() => go(stepOf(slot))}>Choose in {stepLabel(slot)} ›</button>
              </li>
            ))
          ) : <li data-state="done">Every choice is made.</li>}
          {open.length ? <li className={styles.dim}>You can still go ahead: open choices are left out until they&apos;re made.</li> : null}
          <li data-state={problem ? "problem" : "done"}>
            {problem ?? (build.abilities.method === "standard-array" ? "The scores are the standard array." : build.abilities.method === "point-buy" ? "The scores fit point buy." : "The scores are typed by hand.")}
            {problem ? <button type="button" className={styles.linkButton} onClick={() => go("abilities")}>Fix in Abilities ›</button> : null}
          </li>
          {mixed ? <li data-state="info">{mixed}</li> : null}
          <li data-state="info">
            <strong>The DM runs these</strong> (the simulator doesn&apos;t): {dmRuns.length ? dmRuns.join(", ") : "nothing"}.
          </li>
        </ul>
      </Panel>

      <Panel label={creating ? "Summary" : "What changes"}>
        <StepHeading icon="star">{creating ? "Summary" : "What applying changes"}</StepHeading>
        <p className={styles.lede}>{buildLabel(build, sources)}</p>
        <Summary definition={preview.definition} />
        {creating ? null : <ChangeList changes={changes} update={update} onUpdate={onUpdate} />}
        {!creating && changes.length === 0 ? <p className={styles.dim}>Nothing: the actor already matches this build.</p> : null}
      </Panel>

      {twins.length ? (
        <section className={styles.panel} aria-label="Named twice">
          <StepHeading icon="star">Named like what the builder adds</StepHeading>
          <p className={styles.dim}>
            These are its own, made by hand, and the builder adds one of the same name: {twins.map((twin) => twin.name).join(", ")}.
            Keep them to compare, or take them off.
          </p>
          <label className={styles.checkRow}>
            <input type="checkbox" checked={removeTwins} onChange={(event) => onRemoveTwins(event.target.checked)} />
            Remove my versions when rebuilding
          </label>
        </section>
      ) : null}
    </div>
  );
}
