/**
 * What aiming an ability at a creature would do, in a line, from the engine's own previews (PLAY_MODE_PLAN.md §2.4):
 * "70% to hit · +6 against AC 15 (half cover) · advantage: Pack Tactics · 6.5 damage on a hit", "45% to fail a DC 14
 * Dexterity save · 28 damage, half on a success", or why it can't be aimed there. Pure.
 */
import {
  averageHealing,
  findActionDefinition,
  getDefinition,
  getExecutableActions,
  previewAttack,
  previewRoutine,
  previewSave,
  validateBuffTargeting,
  validateHealingTargeting,
  type EncounterSnapshot,
  type Id
} from "@/engine";

export interface TargetLine {
  /** It can be aimed at this creature. */
  ok: boolean;
  /** What it would do, or why it can't. */
  text: string;
}

const ABILITY_NAMES = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" } as const;
const COVER_NAMES = { half: "half cover", "three-quarters": "three-quarters cover", total: "total cover" } as const;

const percent = (chance: number) => `${Math.round(chance * 100)}%`;
const signed = (value: number) => `${value >= 0 ? "+" : ""}${value}`;
const amount = (value: number) => `${Math.round(value * 10) / 10}`;

function thrown(check: () => void): string | undefined {
  try {
    check();
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** What `actionId`, used by `actorId`, would do to `targetId` on `board`. */
export function targetLine(board: EncounterSnapshot, actorId: Id, actionId: Id, targetId: Id): TargetLine {
  const actor = board.combatants.find((combatant) => combatant.id === actorId);
  const target = board.combatants.find((combatant) => combatant.id === targetId);
  if (!actor || !target) return { ok: false, text: "Not in the fight" };
  const definition = getDefinition(board, actor);
  const action = findActionDefinition(definition, actionId) ?? getExecutableActions(definition).find((candidate) => candidate.id === actionId);
  if (!action) return { ok: false, text: `${actor.displayName} has no ${actionId}` };
  if (target.state !== "active" && action.kind !== "healing") return { ok: false, text: `${target.displayName} is ${target.state}` };

  switch (action.kind) {
    case "attack": {
      const preview = previewAttack(board, actorId, targetId, actionId);
      if (preview.problem) return { ok: false, text: preview.problem };
      const cover = preview.cover !== "none" ? ` (${COVER_NAMES[preview.cover]})` : "";
      const mode = preview.rollMode === "normal" ? []
        : [`${preview.rollMode}${preview.modeReasons.length ? `: ${preview.modeReasons.join(", ")}` : ""}`];
      return {
        ok: true,
        text: [
          `${percent(preview.hitChance)} to hit`,
          `${signed(preview.bonus)} against AC ${preview.targetAc}${cover}`,
          ...mode,
          `${amount(preview.damageOnHit)} damage on a hit`
        ].join(" · ")
      };
    }
    case "multiattack": {
      const preview = previewRoutine(board, actorId, targetId, actionId);
      if (preview.problem) return { ok: false, text: preview.problem };
      return {
        ok: true,
        text: `${preview.swings} ${preview.swings === 1 ? "attack" : "attacks"} · the first ${percent(preview.first.hitChance)} to hit · ${amount(preview.expectedDamage)} damage expected in all`
      };
    }
    case "save": {
      const preview = previewSave(board, actorId, targetId, actionId);
      if (preview.problem) return { ok: false, text: preview.problem };
      if (preview.immune) return { ok: false, text: `${target.displayName} already resisted it and is immune` };
      const damage = preview.damageOnFail > 0
        ? [`${amount(preview.damageOnFail)} damage${preview.damageOnSuccess > 0 ? ", half on a success" : ", none on a success"}`]
        : [];
      return {
        ok: true,
        text: [
          `${percent(preview.failChance)} to fail a DC ${preview.dc} ${ABILITY_NAMES[preview.ability]} save`,
          ...damage,
          ...(preview.advantage ? [`advantage${preview.advantageSources.length ? `: ${preview.advantageSources.join(", ")}` : ""}`] : []),
          ...(preview.legendaryResistance ? ["it has Legendary Resistance"] : [])
        ].join(" · ")
      };
    }
    case "healing": {
      const problem = thrown(() => validateHealingTargeting(board, actor, target, action));
      return problem ? { ok: false, text: problem } : { ok: true, text: `Heals about ${Math.round(averageHealing(action, definition))} HP` };
    }
    case "buff": {
      const problem = thrown(() => validateBuffTargeting(board, actor, target, action));
      return problem ? { ok: false, text: problem } : { ok: true, text: `Gives ${target.displayName} ${action.name}` };
    }
    default:
      return { ok: true, text: action.name };
  }
}
