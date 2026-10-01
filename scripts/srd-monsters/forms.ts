import type { ActionDefinition, CreatureDefinition, MultiattackStep, TransformActionDefinition } from "../../src/engine/types";
import type { ParsedMonster } from "./monster";
import { slugify } from "./util";

/**
 * Shapechangers whose statblock says which shape each action belongs to ("Wolf or Hybrid Form Only" — the five
 * lycanthropes and the vampire's bat). Each shape becomes its own definition: the browsable base creature keeps the
 * actions of its true form, the others are `hidden` actors that exist only as transform targets, and every one of
 * them carries the same `transform` action so a creature can always change again. The lycanthropes start their
 * fights already in hybrid form (`defaultActiveForm`), the way a DM runs them.
 *
 * Not modelled (kept as a `FORM_STATS` gap): the differences that aren't about actions — a werewolf's AC and a
 * wererat's size change with shape, and a bat has a different speed.
 */

const TRUE_FORMS = ["humanoid", "vampire"];

/** "Wolf or Hybrid Form Only" → ["wolf", "hybrid"]; "Bite in Beast Form" → []. */
function formWords(tag: string): string[] {
  const match = /^([\w ]+?) Form Only$/i.exec(tag.trim());
  return match ? match[1]!.split(/\s+or\s+/i).map((word) => word.trim().toLowerCase()) : [];
}

const title = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

export function splitForms(monster: ParsedMonster): ParsedMonster[] {
  const tags = monster.meta.formTags.map((entry) => ({ name: entry.name, words: formWords(entry.tag) }));
  // Only creatures that say "X or Y": the single-shape tags ("Oni Form Only") have nothing to split.
  if (!monster.meta.formTags.some((entry) => / or /i.test(entry.tag))) return [monster];
  const all = [...new Set(tags.flatMap((entry) => entry.words))];
  const trueForm = TRUE_FORMS.find((word) => all.includes(word));
  if (!trueForm) return [monster];

  const base = monster.definition;
  const others = all.filter((word) => word !== trueForm);
  const formId = (word: string) => `${base.id}--${slugify(word)}`;

  /** Which of the base's actions a shape has: the untagged ones, plus the ones tagged with it. */
  const actionsFor = (word: string): ActionDefinition[] => {
    const allowed = base.actions.filter((action) => {
      const limits = tags.filter((entry) => action.name === entry.name || action.name.startsWith(`${entry.name} (`) || action.name.startsWith(`${entry.name} `));
      return limits.length === 0 || limits.some((entry) => entry.words.includes(word));
    });
    const ids = new Set(allowed.map((action) => action.id));
    // A shape keeps the multiattack routines it has every named attack for ("two claw attacks" in bear form, "two
    // greataxe attacks" as a humanoid); when its main routine goes, the first routine left takes its place.
    return allowed.flatMap((action): ActionDefinition[] => {
      if (action.kind !== "multiattack") return [action];
      const fits = (attacks: MultiattackStep[]) => attacks.every((step) => !step.actionId || ids.has(step.actionId));
      const [main, ...options] = [{ attacks: action.attacks }, ...(action.options ?? [])].filter((routine) => fits(routine.attacks));
      if (!main) return [];
      const { options: _all, ...rest } = action;
      return [{ ...rest, attacks: main.attacks, ...(options.length ? { options } : {}) }];
    });
  };

  // The statblock's Shapechanger trait is the action itself: its text goes on the action, and the trait isn't listed twice.
  const isShapechanger = (trait: { name: string }) => /^Shapechanger/i.test(trait.name);
  const shapechangerText = base.traits?.find(isShapechanger)?.description;
  const transform: TransformActionDefinition = {
    kind: "transform", id: "shapechanger", name: "Shapechanger", ...(shapechangerText ? { description: shapechangerText } : {}),
    actionType: "action", canRevert: true, revertOnDeath: true,
    forms: others.map((word) => ({ id: slugify(word), label: title(word), definitionId: formId(word) })),
    automationSupport: "full"
  };
  const build = (definition: CreatureDefinition, word: string): CreatureDefinition => {
    const actions = [...actionsFor(word), transform];
    const ids = new Set(actions.map((action) => action.id));
    // Legendary actions that point at an attack this shape doesn't have go with it.
    const legendaryActions = (definition.legendary?.actions ?? []).filter((ref) => !ref.actionId || ids.has(ref.actionId));
    return {
    ...definition,
    ...(definition.legendary ? { legendary: legendaryActions.length > 0 ? { ...definition.legendary, actions: legendaryActions } : undefined } : {}),
    actions,
    traits: (definition.traits ?? []).filter((trait) => !isShapechanger(trait))
    };
  };

  const gapNotes = [
    ...monster.gapNotes.filter((gap) => gap.code !== "TRANSFORM"),
    { code: "FORM_STATS" as const, note: "AC, size and speed differences between shapes are not modelled" }
  ];
  const withGaps = (parsed: ParsedMonster): ParsedMonster => ({
    ...parsed, gapNotes, gaps: [...new Set(gapNotes.map((gap) => gap.code))].sort()
  });

  const hybrid = others.includes("hybrid") ? "hybrid" : undefined;
  const baseDefinition: CreatureDefinition = { ...build(structuredClone(base), trueForm), ...(hybrid ? { defaultActiveForm: formId(hybrid) } : {}) };
  const forms = others.map((word): ParsedMonster => withGaps({
    ...monster,
    slug: `${monster.slug}--${slugify(word)}`,
    definition: {
      ...build(structuredClone(base), word),
      id: formId(word), name: `${base.name} (${title(word)})`, hidden: true, formOf: base.id, defaultActiveForm: undefined
    }
  }));
  return [withGaps({ ...monster, definition: baseDefinition }), ...forms];
}
