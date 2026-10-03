"use client";

import { MoreHorizontal } from "lucide-react";
import { useMemo, useState } from "react";
import type { EncounterSnapshot } from "@/engine";
import { ContextMenu, type ContextMenuItem } from "@/components/ui/ContextMenu";
import { useDisplayEncounter } from "@/hooks/useDisplayEncounter";
import { describeRoll, outcomeWord, overrideChoices, recentRolls, type RollItem } from "@/lib/play/rolls";
import { useEncounterStore } from "@/store/encounter-store";
import styles from "./play.module.css";

const SHOWN = 4;

/** A roll in a few words, for a chip: who, the total against what, how it came out (as ruled). */
function shortRoll(item: RollItem, board: EncounterSnapshot): string {
  const line = shortLine(item, board);
  return item.rolled ? `${line} (DM override)` : line;
}

function shortLine(item: RollItem, board: EncounterSnapshot): string {
  const request = item.request;
  const name = (id: string | undefined) => board.combatants.find((combatant) => combatant.id === id)?.displayName ?? "Someone";
  switch (request.purpose) {
    case "attack": return `${name(request.rollerId)} → ${name(request.targetId)}: ${request.total} vs AC ${request.against}, ${outcomeWord(request)}`;
    case "save": return `${name(request.rollerId)}'s save: ${request.total} vs DC ${request.against}, ${outcomeWord(request)}`;
    case "concentration": return `${name(request.rollerId)}'s concentration: ${request.total} vs DC ${request.against}, ${outcomeWord(request)}`;
    case "death-save": return `${name(request.rollerId)}'s death save: ${request.natural}, ${outcomeWord(request)}`;
    case "check": return `${name(request.rollerId)}'s escape: ${request.total} vs DC ${request.against}, ${outcomeWord(request)}`;
    case "recharge": return `${name(request.rollerId)}'s ${request.label ?? "recharge"}: ${outcomeWord(request)}`;
  }
}

/** The menu that overrules `item`: what it can be ruled to instead. */
export function overruleItems(item: RollItem, overrideRoll: (stepIndex: number, key: string, outcome: RollItem["request"]["outcome"]) => void): ContextMenuItem[] {
  return [
    { heading: "Overrule the roll" },
    ...overrideChoices(item.request).map((choice): ContextMenuItem => ({
      label: choice.label,
      onSelect: () => overrideRoll(item.stepIndex, item.key, choice.outcome)
    }))
  ];
}

/**
 * The rolls since your last command, newest first, as chips under the banner (PLAY_MODE_PLAN.md §2.10): the AI's as
 * their playback reaches them. Each has a ⋯ that overrules it — the step it was made in runs again with it ruled, and
 * everything after follows.
 */
export function RollStrip() {
  const play = useEncounterStore((state) => state.play);
  const overrideRoll = useEncounterStore((state) => state.overrideRoll);
  const board = useDisplayEncounter();
  const [menu, setMenu] = useState<{ x: number; y: number; item: RollItem } | null>(null);
  const items = useMemo(() => recentRolls(play), [play]);
  if (!play || items.length === 0) return null;
  const shown = items.slice(0, SHOWN);
  const locked = Boolean(play.playback);
  return (
    <div className={styles.rollStrip} role="list" aria-label="Rolls since your last command">
      {shown.map((item) => (
        <div
          key={`${item.stepIndex}-${item.key}`}
          role="listitem"
          className={styles.rollChip}
          data-outcome={item.request.outcome}
          data-overridden={item.rolled ? "" : undefined}
          title={describeRoll(item.request, board, item.rolled)}
        >
          <span>{shortRoll(item, board)}</span>
          <button
            type="button"
            aria-label={`Overrule: ${describeRoll(item.request, board, item.rolled)}`}
            title={locked ? "Wait for the playback to finish" : "Overrule this roll"}
            disabled={locked}
            onClick={(event) => setMenu({ x: event.clientX, y: event.clientY, item })}
          >
            <MoreHorizontal size={12} />
          </button>
        </div>
      ))}
      {items.length > SHOWN ? <span className={styles.rollMore}>{`+${items.length - SHOWN} earlier`}</span> : null}
      {menu ? <ContextMenu x={menu.x} y={menu.y} items={overruleItems(menu.item, overrideRoll)} onClose={() => setMenu(null)} /> : null}
    </div>
  );
}
