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
  REGEN: "(Retired — now enforced.) Regeneration.",
  REGEN_TERRAIN: "Regeneration that stops in sunlight or running water: the map has no such terrain tag yet, so it always works.",
  LEGENDARY_RESISTANCE: "(Retired — now enforced.) Legendary Resistance.",
  SURVIVE_ZERO: "(Retired — now enforced.) Undead Fortitude / Relentless.",
  // ── Phase 4: legendary actions, reactions
  LEGENDARY_ACTIONS: "A legendary action that is not an attack or save (Move, Teleport, Cast a Spell, Heal Self…) is reference-only; the rest are taken.",
  MULTIATTACK_PARSE: "Multiattack text could not be fully compiled.",
  MULTIATTACK_STEP: "A Multiattack step is a spell, breath replacement or other non-attack and is skipped.",
  REACTION: "A reaction other than Parry (Unnerving Mask, Rock Catching, a guardian's Shield) is reference-only.",
  // ── Phase 5: movement
  MOVE_FLY: "(Retired — see ALTITUDE.) Flying speed.",
  MOVE_SWIM: "(Retired — now a movement mode.) Swim speed.",
  MOVE_CLIMB: "(Retired — now a movement mode.) Climb speed.",
  MOVE_BURROW: "(Retired — now a movement mode.) Burrow speed.",
  ALTITUDE: "Flying moves fast and ignores ground terrain, but there is no altitude yet: a flier can still be meleed by everything and never falls.",
  MOVE_TRAIT: "A movement trait (Spider Climb, Incorporeal Movement, Amorphous…) is reference-only.",
  // ── Phase 6: holds
  HOLD_GRAPPLE: "A grapple that is not a plain grapple-on-hit (attaching, a save-based grapple, a grapple-gated attack) is reference-only.",
  HOLD_SWALLOW: "Engulfing (a gelatinous cube, a shambling mound) is reference-only; swallows are automated.",
  // ── Phase 7: spells
  SPELLS: "A combat spell this creature casts isn't in the spell library yet, so it is reference text.",
  SPELL_UTILITY: "Utility spells (senses, travel, illusions, communication) are reference text — nothing for a fight to simulate.",
  // ── Phase 8: spawn / transform
  SPAWN: "Summoning / splitting is reference-only.",
  TRANSFORM: "Shapechanging is reference-only (open-ended Change Shape, Doppelganger, Mimic; the fixed-shape lycanthropes and the vampire are automated).",
  FORM_STATS: "A shapechanger's forms differ in more than actions (AC, size, speed); only the actions are modelled.",
  // ── Phase 9: long tail
  CHARGE_TRAIT: "Movement-conditioned bonus (Charge, Pounce, Blood Frenzy…) is reference-only.",
  SWARM_DAMAGE: "Swarm rules are not modelled: reduced damage at half HP, and attacking a creature inside the swarm's own space (modelled as an adjacent attack).",
  SAVE_IMMUNITY_AFTER: "(Retired — now enforced.) Immunity after a successful save.",
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
