/**
 * The character builder (PC_BUILDER_PLAN.md): a player character's build is a recipe, and its actor is what the recipe
 * makes. `buildCharacter` works the recipe out; `applyBuild` puts it on the actor, keeping what the DM edited;
 * `withSuggestions` makes every choice still open (Quick build).
 */
export * from "./catalog";
export * from "./build-record";
export * from "./build";
export * from "./apply";
export * from "./quick";
export * from "./summary";
export * from "./homebrew";
export * from "./catalog-edit";
export * from "./adoption";
export * from "./describe";
export * from "./steps";
export { fingerprint } from "./fingerprint";
export { evaluateTemplate, evaluateNumber, type TemplateScope } from "./template";
export { spellSlots, casterLevelFor, FULL_CASTER_SLOTS, PACT_SLOTS } from "./slots";
