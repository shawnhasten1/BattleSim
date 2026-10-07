import type { ColumnOverride, FeatureOverride, SpellOverride } from "../2024/overrides";

/**
 * Fixes to the SRD 5.1 data as Open5e serves it, checked against SRD-OGL_V5.1.pdf / SRD_CC_v5.1.pdf. Applied by the
 * generator (`npm run srd:2014`); never edit `generated/` by hand. Every entry says why, so a fix can be dropped once the
 * source is right.
 */

/** By Open5e feature key (`srd_fighter_second-wind`). */
export const FEATURE_OVERRIDES: Record<string, FeatureOverride> = {
  "srd_warlock_eldritch-invocation-list": {
    reason: "Armor of Shadows lost its heading: the SRD heads it like every other invocation, so it ran into Agonizing Blast.",
    replace: [["on a hit.\r\nArmor of Shadows\r\n", "on a hit.\r\n\r\n### Armor of Shadows\r\n"]]
  }
};

/** By Open5e feature key, for a column of a class's table. */
export const COLUMN_OVERRIDES: Record<string, ColumnOverride> = {};

/** By Open5e spell key (`srd_fireball`). */
export const SPELL_OVERRIDES: Record<string, SpellOverride> = {};
