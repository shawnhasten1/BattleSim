import type { ChoiceSlot } from "./build";

/** The builder's steps (CHARACTER_BUILDER_UX_PLAN.md D2), in order. None is locked: any can be visited at any time. */
export type BuilderStep = "class" | "origin" | "abilities" | "spells" | "equipment" | "review";

export const BUILDER_STEPS: ReadonlyArray<{ id: BuilderStep; label: string }> = [
  { id: "class", label: "Class" },
  { id: "origin", label: "Origin" },
  { id: "abilities", label: "Abilities" },
  { id: "spells", label: "Spells" },
  { id: "equipment", label: "Equipment" },
  { id: "review", label: "Review" }
];

/**
 * Where a choice is made. Spells in Spells, wherever they come from. Ability increases in Abilities, but an Ability
 * Score Improvement's points stay with their feat in Class (Abilities shows them). Everything else a background or a
 * species asks is Origin; everything a level asks is Class.
 */
export function stepOf(slot: ChoiceSlot): BuilderStep {
  if (slot.spec.kind === "spells") return "spells";
  if (slot.spec.kind === "abilities") return slot.scope.kind === "level" ? "class" : "abilities";
  return slot.scope.kind === "level" ? "class" : "origin";
}

/** How many choices are still open on each step. */
export function openChoices(choices: readonly ChoiceSlot[]): Record<BuilderStep, number> {
  const counts: Record<BuilderStep, number> = { class: 0, origin: 0, abilities: 0, spells: 0, equipment: 0, review: 0 };
  for (const slot of choices) if (slot.pending) counts[stepOf(slot)] += 1;
  return counts;
}

/** The first step, in order, with a choice still open. */
export function firstOpenStep(choices: readonly ChoiceSlot[]): BuilderStep | undefined {
  const counts = openChoices(choices);
  return BUILDER_STEPS.find((step) => counts[step.id] > 0)?.id;
}
