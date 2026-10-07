"use client";

import { Bot, ChevronDown, ChevronUp, Flag, Undo2, X } from "lucide-react";
import { useEffect, useMemo } from "react";
import { armorClassOf, findActionDefinition, getDefinition, reactionPolicyKey, type EncounterSnapshot, type MovePreview, type ReactionPolicy } from "@/engine";
import { PlaySegmented, POLICY_OPTIONS } from "./PlaySegmented";
import { chooseOption, finishAiming, pressHotbar, type AimView } from "@/hooks/usePlayAim";
import { makePlayMove, planKeyOf, usePlayMovePlan, type PlayMoveView } from "@/hooks/usePlayMove";
import { hotbarFor, type HotbarButton, type HotbarModel } from "@/lib/play/hotbar";
import { useEncounterStore } from "@/store/encounter-store";
import { armedFor, usePlayUiStore } from "@/store/play-ui-store";
import styles from "./play.module.css";

const ALTITUDE_STEP = 5;
const ORDINALS = ["Cantrips", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"];

/** What a move sets off, in words: the opportunity attacks it draws and the hazards on the way. */
export function moveWarnings(board: EncounterSnapshot, preview: MovePreview): string[] {
  const attacks = preview.opportunityAttacks.map((threat) => {
    const reactor = board.combatants.find((combatant) => combatant.id === threat.reactorId);
    const weapon = reactor ? findActionDefinition(getDefinition(board, reactor), threat.actionId)?.name : undefined;
    return `${reactor?.displayName ?? "Someone"}${weapon ? ` (${weapon})` : ""}`;
  });
  const hazards = [...new Set(preview.hazards.map((hazard) => hazard.name))];
  return [
    ...(attacks.length ? [`Opportunity ${attacks.length === 1 ? "attack" : "attacks"} from ${listOf(attacks)}.`] : []),
    ...(hazards.length ? [`On the way: ${listOf(hazards)}.`] : [])
  ];
}

function listOf(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** A click on a hotbar button leaves the focus where it was, so Enter still ends the turn rather than pressing it again. */
const keepFocus = (event: { preventDefault: () => void }) => event.preventDefault();

/** Keys that shouldn't be taken from wherever they're typed. */
function typingIn(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(element && (/^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName) || element.isContentEditable));
}

/**
 * The hotbar, at the bottom of the map on a person's creature's turn (PLAY_MODE_PLAN.md §2.2): the creature and what's
 * left of its turn (action, bonus action, reaction, movement, the height it flies at), everything it can use — a tab
 * for what it takes, grouped inside by what it is (HOTBAR_REDESIGN_PLAN.md §1) — End turn, "AI: take this turn" and
 * Undo. A button is used at once, or armed to be aimed on the map; a greyed-out one says why. Keys 1–0 press the tab's
 * first ten buttons, counted across its groups; Enter uses an ability on the creatures picked so far, or ends the turn
 * when nothing is armed.
 */
export function Hotbar({ move, aim }: { move?: PlayMoveView | null; aim?: AimView | null }) {
  const plan = usePlayMovePlan();
  const encounter = useEncounterStore((state) => state.encounter);
  const playCommand = useEncounterStore((state) => state.playCommand);
  const control = useEncounterStore((state) => state.play?.control);
  const setPlayControl = useEncounterStore((state) => state.setPlayControl);
  const undo = useEncounterStore((state) => state.undo);
  const canUndo = useEncounterStore((state) => state.undoStack.length > 0);
  const tab = usePlayUiStore((state) => state.tab);
  const setTab = usePlayUiStore((state) => state.setTab);
  const setAltitude = usePlayUiStore((state) => state.setAltitude);
  const popWaypoint = usePlayUiStore((state) => state.popWaypoint);
  const clearPlan = usePlayUiStore((state) => state.clearPlan);
  const note = usePlayUiStore((state) => state.note);
  const armed = usePlayUiStore((state) => (plan ? armedFor(state, plan.planKey) : null));
  const actorId = plan?.actor.id;
  const model = useMemo(() => (actorId ? hotbarFor(encounter, actorId) : null), [encounter, actorId]);

  // 1–0 press the tab's buttons; Enter uses what's picked, or ends the turn.
  useEffect(() => {
    if (!model) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || typingIn(event.target)) return;
      const ui = usePlayUiStore.getState();
      const buttons = model.tabs.find((entry) => entry.id === ui.tab)?.buttons ?? [];
      if (/^[0-9]$/.test(event.key)) {
        const button = buttons[event.key === "0" ? 9 : Number(event.key) - 1];
        if (button && !button.problem) {
          event.preventDefault();
          pressHotbar(button);
        }
        return;
      }
      // Enter on a focused button presses that button; only Enter elsewhere is ours.
      if (event.key === "Enter" && !(event.target as HTMLElement | null)?.closest?.("button, a, [role='button']")) {
        event.preventDefault();
        if (finishAiming()) return;
        const state = useEncounterStore.getState();
        if (!armedFor(ui, planKeyOf(model.actorId, state.log.length))) state.playCommand({ kind: "end-turn", actorId: model.actorId });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [model]);

  if (!plan || !model) return null;
  const { actor } = plan;
  const definition = getDefinition(encounter, actor);
  const economy = actor.actionEconomy ?? { action: true, bonus: true, reaction: true };
  const preview = move?.planKey === plan.planKey ? move.preview : null;
  const afterFeet = preview?.reachable ? preview.remainingFeet : plan.leftFeet;
  const share = (feet: number) => `${plan.totalFeet > 0 ? Math.min(100, Math.max(0, (feet / plan.totalFeet) * 100)) : 0}%`;
  const altitudeNow = actor.altitude ?? 0;
  const altitudeNext = plan.altitude ?? altitudeNow;
  const current = model.tabs.find((entry) => entry.id === tab) ?? model.tabs[0]!;
  // By the variant armed: a weapon's action and bonus-action buttons are one family, with one key.
  const holds = (button: HotbarButton) => Boolean(armed && button.variants.some((variant) => variant.actionId === armed.actionId));
  const armedButton = armed ? model.tabs.flatMap((entry) => entry.buttons).find(holds) : undefined;
  const countOf = (entry: HotbarModel["tabs"][number]) => (entry.id === "reactions" ? model.reactions.length : entry.buttons.length);

  return (
    <section className={styles.hotbar} aria-label={`${actor.displayName}'s turn`}>
      <div className={styles.hotbarTop}>
        <div className={styles.dockWho}>
          <strong>{actor.displayName}</strong>
          <span>{`HP ${actor.currentHp}/${definition.maxHp}${actor.tempHp ? ` +${actor.tempHp}` : ""} · AC ${armorClassOf(definition, actor).total}`}</span>
          {model.concentration ? <span className={styles.concentrating}>{`Concentrating: ${model.concentration}`}</span> : null}
        </div>
        <div className={styles.dockEconomy} role="list" aria-label="What's left of the turn">
          <span role="listitem" data-spent={economy.action === false} title={economy.action === false ? "Action used" : "Action"}>Action</span>
          <span role="listitem" data-spent={economy.bonus === false} title={economy.bonus === false ? "Bonus action used" : "Bonus action"}>Bonus</span>
          <span role="listitem" data-spent={economy.reaction === false} title={economy.reaction === false ? "Reaction used" : "Reaction"}>Reaction</span>
        </div>
        <div className={styles.dockMove}>
          <div className={styles.moveBar} aria-hidden="true">
            <i style={{ width: share(plan.leftFeet) }} data-part="cost" />
            <i style={{ width: share(afterFeet) }} data-part="left" />
          </div>
          <span className={styles.moveText}>
            <span>{`${plan.leftFeet} of ${plan.totalFeet} ft`}</span>
            {actor.turnFlags?.dashed ? <em>Dashed</em> : null}
            {actor.turnFlags?.disengaged ? <em>Disengaged</em> : null}
          </span>
          {plan.flies ? (
            <span className={styles.altitude} role="group" aria-label="Height to fly at">
              <button type="button" aria-label="Lower" disabled={altitudeNext <= 0} onClick={() => setAltitude(plan.planKey, Math.max(0, altitudeNext - ALTITUDE_STEP))}>
                <ChevronDown size={13} />
              </button>
              <span>{altitudeNext === altitudeNow ? `${altitudeNow} ft up` : `${altitudeNow} → ${altitudeNext} ft`}</span>
              <button type="button" aria-label="Higher" onClick={() => setAltitude(plan.planKey, altitudeNext + ALTITUDE_STEP)}>
                <ChevronUp size={13} />
              </button>
              {altitudeNext !== altitudeNow ? (
                <button type="button" className={styles.dockLink} onClick={() => makePlayMove(actor.position)}>
                  {altitudeNext > altitudeNow ? "Rise here" : altitudeNext === 0 ? "Land here" : "Drop here"}
                </button>
              ) : null}
            </span>
          ) : null}
        </div>
        <div className={styles.hotbarEnd}>
          <button type="button" className={styles.button} disabled={!canUndo} onClick={undo} title="Take back the last command" aria-label="Undo">
            <Undo2 size={13} />
          </button>
          <button type="button" className={styles.button} onClick={() => playCommand({ kind: "ai-turn", actorId: actor.id })} title="The AI plays the rest of this turn, then ends it">
            <Bot size={13} /> AI: take this turn
          </button>
          <button type="button" className={styles.primary} onClick={() => playCommand({ kind: "end-turn", actorId: actor.id })} title="End the turn (Enter)">
            <Flag size={13} /> End turn
          </button>
        </div>
      </div>

      <div className={styles.hotbarTabs}>
        <div role="tablist" aria-label="Abilities">
          {model.tabs.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={entry.id === current.id}
              disabled={countOf(entry) === 0}
              onClick={() => setTab(entry.id)}
            >
              {entry.label}
              {countOf(entry) ? <small>{countOf(entry)}</small> : null}
            </button>
          ))}
        </div>
        {current.groups.some((group) => group.id === "spells") && model.slots.length ? <SlotPips slots={model.slots} /> : null}
      </div>

      {current.id === "reactions" ? (
        <div className={styles.hotbarReactions} role="tabpanel" aria-label={current.label}>
          {model.reactions.map((reaction) => {
            const key = reactionPolicyKey(actor.id, reaction.key);
            return (
              <div key={reaction.key} className={styles.row}>
                <span><strong>{reaction.name}</strong>{reaction.detail ? <small>{reaction.detail}</small> : null}</span>
                <PlaySegmented
                  label={`${reaction.name}, this fight`}
                  value={control?.reactions?.[key] ?? "ask"}
                  options={POLICY_OPTIONS}
                  onChange={(value: ReactionPolicy) => control && setPlayControl({ ...control, reactions: { ...(control.reactions ?? {}), [key]: value } })}
                />
              </div>
            );
          })}
          {control && (control.askReactions === false || control.askOpportunityAttacks === false) ? (
            <span className={styles.hint}>Asking is off in the setup: the AI decides any left on Ask.</span>
          ) : null}
        </div>
      ) : (
        <div className={styles.hotbarGroups} role="tabpanel" aria-label={current.label}>
          {current.groups.map((group) => (
            <div key={group.id} className={styles.hotGroup} role="group" aria-label={group.label}>
              <span className={styles.hotGroupLabel} aria-hidden="true">{group.label}</span>
              <div className={styles.hotbarButtons}>
                {group.buttons.map((button) => (
                  <HotbarItem
                    key={`${button.key}-${button.slot}`}
                    button={button}
                    index={current.buttons.indexOf(button)}
                    armedActionId={holds(button) ? armed!.actionId : undefined}
                  />
                ))}
              </div>
            </div>
          ))}
          {current.buttons.length === 0 ? <span className={styles.hint}>Nothing here.</span> : null}
        </div>
      )}

      <HotbarHint
        model={model}
        armedButton={armedButton}
        armed={armed}
        aim={aim ?? null}
        note={note}
        preview={preview}
        board={encounter}
        waypoints={plan.waypoints.length}
        onTakeBack={() => popWaypoint(plan.planKey)}
        onClear={clearPlan}
      />
    </section>
  );
}

function SlotPips({ slots }: { slots: HotbarModel["slots"] }) {
  return (
    <div className={styles.slotPips} aria-label="Spell slots">
      {slots.map(({ level, left, full }) => (
        <span key={level} title={`${ORDINALS[level]}-level slots: ${left} of ${full}`}>
          <b>{level}</b>
          {Array.from({ length: full }, (_, index) => <i key={index} data-left={index < left} />)}
        </span>
      ))}
    </div>
  );
}

/** One button: its key, name and cost, a mark when the engine runs it only in part or not at all, and its variants. */
function HotbarItem({ button, index, armedActionId }: { button: HotbarButton; index: number; armedActionId?: string }) {
  const automationNote = button.automation === "partial" ? "Partly simulated: the engine runs some of it"
    : button.automation === "by-hand" ? "By hand: it takes its slot and cost and is logged; you apply what it does"
      : undefined;
  // The tab says what it takes; only a free one says so.
  const cost = [button.cost, button.slot === "free" ? "free" : undefined].filter(Boolean).join(" · ");
  return (
    <div className={styles.hotItem} data-armed={Boolean(armedActionId)}>
      <button
        type="button"
        className={styles.hotButton}
        disabled={Boolean(button.problem)}
        aria-pressed={Boolean(armedActionId)}
        onMouseDown={keepFocus}
        title={button.problem ?? `${button.title}. ${button.text}`}
        onClick={() => pressHotbar(button)}
      >
        {index < 10 ? <span className={styles.hotKey} aria-hidden="true">{(index + 1) % 10}</span> : null}
        <span className={styles.hotName}>{button.name}</span>
        {cost || automationNote ? (
          <span className={styles.hotCost}>
            {cost}
            {automationNote ? <span className={styles.hotDot} data-automation={button.automation} title={automationNote}>{button.automation === "partial" ? "partly" : "by hand"}</span> : null}
          </span>
        ) : null}
      </button>
      {button.variants.length > 1 ? (
        <div className={styles.hotVariants} role="group" aria-label={`${button.name}: which`}>
          {button.variants.map((variant) => {
            // Five slots or more (a high-level caster's Magic Missile): each chip just its slot, what it adds on hover.
            const compact = button.variants.length >= 5 && variant.slotLevel !== undefined;
            const shown = compact ? variant.label.split(" · ")[0]! : variant.label;
            return (
              <button
                key={variant.actionId}
                type="button"
                disabled={Boolean(variant.problem)}
                onMouseDown={keepFocus}
                aria-pressed={armedActionId === variant.actionId}
                aria-label={compact && shown !== variant.label ? variant.label : undefined}
                title={variant.problem ?? (compact ? variant.label : variant.cost ?? variant.label)}
                onClick={() => pressHotbar(button, variant)}
              >
                {shown}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function HotbarHint({ model, armedButton, armed, aim, note, preview, board, waypoints, onTakeBack, onClear }: {
  model: HotbarModel;
  armedButton?: HotbarButton;
  armed: ReturnType<typeof armedFor>;
  aim: AimView | null;
  note: string | null;
  preview: MovePreview | null;
  board: EncounterSnapshot;
  waypoints: number;
  onTakeBack: () => void;
  onClear: () => void;
}) {
  if (armed && armed.aim.kind === "option") {
    const name = armedButton?.name ?? "it";
    return (
      <div className={styles.dockHint} role="group" aria-label={`${name}: which`}>
        <span>{`${name}: which?`}</span>
        {armed.aim.options.map((option) => (
          <button key={option.id} type="button" className={styles.button} onClick={() => chooseOption(option.id)}>{option.label}</button>
        ))}
        <span>Esc puts it away.</span>
      </div>
    );
  }
  if (armed && (armed.aim.kind === "area" || armed.aim.kind === "place" || armed.aim.kind === "zone")) {
    const name = armedButton?.name ?? "it";
    const area = aim?.area;
    const problem = area?.problem ?? aim?.place?.problem;
    let lead: string;
    let warning = "";
    if (armed.aim.kind === "area") {
      const names = (ids: string[]) => ids.map((id) => board.combatants.find((combatant) => combatant.id === id)?.displayName ?? id);
      const foes = names(area?.caught.filter((caught) => caught.hostile).map((caught) => caught.id) ?? []);
      const friends = names(area?.caught.filter((caught) => !caught.hostile).map((caught) => caught.id) ?? []);
      lead = area?.heals
        ? `Click where to put ${name}.${friends.length ? ` It heals ${listOf(friends)}.` : ""}`
        : `Click where to put ${name}.${foes.length ? ` It catches ${listOf(foes)}.` : ""}${area?.settlesOnly ? " It settles as a lasting zone." : ""}`;
      if (!area?.heals && friends.length) warning = ` It will catch ${listOf(friends)} too.`;
    } else if (armed.aim.kind === "place") {
      const mover = armed.picked[0] ? board.combatants.find((combatant) => combatant.id === armed.picked[0])?.displayName : undefined;
      lead = armed.aim.moves === "other" && !mover ? `Pick who ${name} moves.` : `Click where ${name} takes ${mover ?? "it"}.`;
    } else {
      lead = `Click where ${name.replace(/^Move /, "")} goes (up to ${armed.aim.maxFeet} ft).`;
    }
    return (
      <p className={styles.dockHint} data-problem={Boolean(problem)} data-warning={Boolean(warning) && !problem}>
        <span>{problem ? `${problem}.` : `${lead}${warning}`} Esc puts it away.</span>
        {note && note !== problem ? <span className={styles.dockNote}>{note}</span> : null}
      </p>
    );
  }
  if (armed) {
    const name = armedButton?.name ?? "it";
    const variant = armedButton?.variants.find((candidate) => candidate.actionId === armed.actionId);
    const many = armed.aim.kind === "creatures" && armed.aim.count > 1;
    const lead = armed.aim.kind === "routine"
      ? `Pick the first target for ${name}: you pick each swing after it.`
      : many
        ? `Pick up to ${armed.aim.kind === "creatures" ? armed.aim.count : 1} ${armed.aim.kind === "creatures" && armed.aim.repeat ? "targets (one can be picked again)" : "creatures"} for ${name}${armed.picked.length ? `: ${armed.picked.length} picked, Enter to use it on them` : ""}.`
        : `Pick a target for ${name}${variant && variant.label !== "Normal" && armedButton && armedButton.variants.length > 1 ? ` (${variant.label})` : ""}.`;
    const concentration = armedButton?.concentration && model.concentration ? ` It ends your concentration on ${model.concentration}.` : "";
    return (
      <p className={styles.dockHint} data-warning={Boolean(concentration)}>
        <span>{`${lead}${concentration} Esc puts it away.`}</span>
        {note ? <span className={styles.dockNote}>{note}</span> : null}
      </p>
    );
  }
  const stops = waypoints > 0
    ? `${waypoints} ${waypoints === 1 ? "stop" : "stops"} planned. Esc or right-click takes back the last.`
    : "Click a square to move there. Shift-click to stop on the way.";
  const warnings = preview && !preview.problem ? moveWarnings(board, preview) : [];
  const hint = preview?.problem ?? [...warnings, ...(warnings.length && waypoints === 0 ? [] : [stops])].join(" ");
  return (
    <p className={styles.dockHint} data-problem={Boolean(preview?.problem)} data-warning={warnings.length > 0}>
      <span>{hint}</span>
      {waypoints > 0 ? (
        <>
          <button type="button" className={styles.dockLink} onClick={onTakeBack}>Take back the last stop</button>
          <button type="button" className={styles.dockLink} onClick={onClear} aria-label="Clear the plan"><X size={12} /></button>
        </>
      ) : null}
    </p>
  );
}
