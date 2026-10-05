/**
 * Fixes to the SRD 5.2 data as Open5e serves it, checked against SRD_CC_v5.2.pdf. Applied by the generator
 * (`npm run srd:2024`); never edit `generated/` by hand. Every entry says why, so a fix can be dropped once the source
 * is right.
 */

export interface FeatureOverride {
  reason: string;
  name?: string;
  levels?: number[];
  text?: string;
}

export interface ColumnOverride {
  reason: string;
  /** The column's id in templates (`{col:<id>}`). */
  id?: string;
  label?: string;
}

/** By Open5e feature key. */
export const FEATURE_OVERRIDES: Record<string, FeatureOverride> = {
  "srd-2024_fighter_studied-attacks": {
    reason: "Misspelled \"Studdied Attacks\" in the source; the SRD 5.2 PDF has \"Studied Attacks\".",
    name: "Studied Attacks"
  },
  "srd-2024_monk_unarmored-movement": {
    reason: "Misspelled \"Unarmoed Movement\" in the source; the SRD 5.2 PDF has \"Unarmored Movement\".",
    name: "Unarmored Movement"
  },
  "srd-2024_warlock_magical-cunning": {
    reason: "Named \"Magic Cunning\" in the source; the SRD 5.2 PDF has \"Magical Cunning\".",
    name: "Magical Cunning"
  },
  "srd-2024_monk_deflect-attacks": {
    reason: "No level in the source; the SRD 5.2 PDF has \"Level 3: Deflect Attacks\".",
    levels: [3]
  },
  "srd-2024_bard_bard-subclass": {
    reason: "No level in the source; the SRD 5.2 PDF has \"Level 3: Bard Subclass\".",
    levels: [3]
  },
  "srd-2024_druid_circle-of-the-land_natures-ward": {
    reason: "The source has Nature's Sanctuary's text here; this is the PDF's \"Level 10: Nature's Ward\".",
    text:
      "You are immune to the Poisoned condition, and you have Resistance to a damage type associated with your current land "
      + "choice in the Circle Spells feature, as shown in the Nature's Ward table.\n\nTable: Nature's Ward\n\n"
      + "|Land Type|Resistance|\n|---|---|\n|Arid|Fire|\n|Polar|Cold|\n|Temperate|Lightning|\n|Tropical|Poison|"
  },
  "srd-2024_druid_circle-of-the-land_natures-sanctuary": {
    reason: "The source repeats Natural Recovery's text here; this is the PDF's \"Level 14: Nature's Sanctuary\".",
    text:
      "As a Magic action, you can expend a use of your Wild Shape and cause spectral trees and vines to appear in a 15-foot "
      + "Cube on the ground within 120 feet of yourself. They last there for 1 minute or until you have the Incapacitated "
      + "condition or die. You and your allies have Half Cover while in that area, and your allies gain the current "
      + "Resistance of your Nature's Ward while there.\n\nAs a Bonus Action, you can move the Cube up to 60 feet to ground "
      + "within 120 feet of yourself."
  }
};

/** By Open5e feature key of the column. */
export const COLUMN_OVERRIDES: Record<string, ColumnOverride> = {
  "srd-2024_druid_wild-shape-uses": {
    reason: "Labelled \"Cantrips Known\" in the source; it's the Druid Features table's Wild Shape column (2, 3 at 6th, 4 at 17th).",
    id: "wild-shape",
    label: "Wild Shape"
  }
};
