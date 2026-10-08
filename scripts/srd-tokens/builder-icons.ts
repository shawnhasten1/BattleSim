/**
 * The character builder's icons (CHARACTER_BUILDER_UX_PLAN.md D14): a game-icons.net glyph for each SRD class, species
 * and spell school, by `"<group>/<name>"` (the name is the SRD id's slug without its edition: `wizard` for both
 * Wizards). Values are `"<author>/<icon>"`, as in `icon-map.ts`: the author is who the CC BY 3.0 credit names. Most are
 * icons the monster tokens already use; `lorc/lyre` and `delapouite/hobbit-door` were checked against the GitHub folders
 * (each is in that author's folder only).
 */
export const BUILDER_ICONS: Record<string, string> = {
  "class/barbarian": "delapouite/barbarian",
  "class/bard": "lorc/lyre",
  "class/cleric": "delapouite/sun-priest",
  "class/druid": "cathelineau/holy-oak",
  "class/fighter": "lorc/visored-helm",
  "class/monk": "delapouite/monk-face",
  "class/paladin": "lorc/winged-sword",
  "class/ranger": "lorc/bowman",
  "class/rogue": "lorc/cloak-dagger",
  "class/sorcerer": "lorc/smoking-orb",
  "class/warlock": "delapouite/warlock-hood",
  "class/wizard": "lorc/wizard-staff",

  "species/dragonborn": "lorc/dragon-head",
  "species/dwarf": "delapouite/dwarf-face",
  "species/elf": "delapouite/woman-elf-face",
  "species/gnome": "cathelineau/bad-gnome",
  "species/goliath": "delapouite/giant",
  "species/half-elf": "lorc/duality-mask",
  "species/half-orc": "lorc/tribal-mask",
  "species/halfling": "delapouite/hobbit-door",
  "species/human": "delapouite/person",
  "species/orc": "delapouite/orc-head",
  "species/tiefling": "delapouite/devil-mask",

  "school/abjuration": "delapouite/trident-shield",
  "school/conjuration": "lorc/magic-lamp",
  "school/divination": "lorc/sunken-eye",
  "school/enchantment": "lorc/lips",
  "school/evocation": "lorc/fluffy-flame",
  "school/illusion": "lorc/double-face-mask",
  "school/necromancy": "sbed/death-skull",
  "school/transmutation": "lorc/erlenmeyer"
};

/** A builder icon as a file: the glyph alone, to be drawn as a mask in whatever colour the builder's look gives it. */
export function renderBuilderIconSvg(body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${body}</svg>\n`;
}
