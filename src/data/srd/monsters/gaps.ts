/**
 * Gap codes: every part of an SRD statblock the engine can't yet execute is
 * tagged with one of these, so nothing is silently dropped and each engine phase
 * has a measurable exit ("code X occurs on 0 creatures"). See
 * `SRD_MONSTER_LIBRARY_PLAN.md`. Shared by the build-time generator and the
 * runtime browser (tier badge tooltips).
 */
export const GAP_CODES = {
  // ── Phase 2: defenses
  COND_IMMUNITY: "(Retired — now enforced.) Condition immunities.",
  NONMAGIC_EXCEPTION: "(Retired — now enforced.) Silvered / adamantine exceptions to nonmagical resistance.",
  MAGIC_RESISTANCE: "(Retired — now enforced.) Advantage on saves against magic / conditions.",
  DEFENSE_TEXT: "A resistance / immunity clause could not be parsed; see the description.",
  // ── Phase 3: limited use
  RECHARGE: "(Retired — now rolled each turn.) Recharge abilities.",
  LIMITED_USE: "(Retired — now enforced.) N/Day pools, one encounter = one day.",
  REGEN: "Regeneration is reference-only.",
  LEGENDARY_RESISTANCE: "Legendary Resistance is reference-only.",
  SURVIVE_ZERO: "Undead Fortitude / Relentless is reference-only.",
  // ── Phase 4: legendary actions, reactions
  LEGENDARY_ACTIONS: "Legendary actions are recorded but not yet taken.",
  MULTIATTACK_PARSE: "Multiattack text could not be fully compiled.",
  MULTIATTACK_STEP: "A Multiattack step is not an attack (e.g. Frightful Presence first) and is skipped.",
  REACTION: "Reaction is reference-only.",
  // ── Phase 5: movement
  MOVE_FLY: "Flying is not modelled (no altitude); the creature moves as a walker.",
  MOVE_SWIM: "Swim speed is not modelled.",
  MOVE_CLIMB: "Climb speed is not modelled.",
  MOVE_BURROW: "Burrow speed is not modelled.",
  MOVE_TRAIT: "A movement trait (Spider Climb, Incorporeal Movement, Amorphous…) is reference-only.",
  // ── Phase 6: holds
  HOLD_GRAPPLE: "Grapple / restrain-while-held is reference-only (no escape mechanic yet).",
  HOLD_SWALLOW: "Swallow / engulf is reference-only.",
  // ── Phase 7: spells
  SPELLS: "Spellcasting is reference-only.",
  // ── Phase 8: spawn / transform
  SPAWN: "Summoning / splitting is reference-only.",
  TRANSFORM: "Shapechanging is reference-only.",
  // ── Phase 9: long tail
  CHARGE_TRAIT: "Movement-conditioned bonus (Charge, Pounce, Blood Frenzy…) is reference-only.",
  SWARM_DAMAGE: "Swarm rules are not modelled: reduced damage at half HP, and attacking a creature inside the swarm's own space (modelled as an adjacent attack).",
  SAVE_IMMUNITY_AFTER: "Immunity after a successful save (e.g. Frightful Presence) is not modelled.",
  VARIANT: "An optional variant rule is reference-only.",
  // ── Parser gaps (fixed by improving the parser, not the engine)
  ATTACK_UNPARSED: "An attack line could not be parsed.",
  RIDER_TEXT: "Extra on-hit text is kept as a note and not automated.",
  SAVE_UNPARSED: "A saving-throw action could not be fully compiled.",
  SPECIAL_ACTION: "A special action is reference-only.",
  TRAIT_UNMODELED: "A trait with a mechanical effect is reference-only."
} as const;

export type GapCode = keyof typeof GAP_CODES;

export type MonsterTier = "full" | "partial" | "manual";
