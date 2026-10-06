import type { ActionDefinition, ArmorStats, DamageType, ItemDefinition, SpellDefinition } from "@/engine";
import { itemSpellUse } from "./item-spells";
import { SRD_SPELLS } from "./spells";

/**
 * Bundled item library (ITEMS_PLAN.md §7): SRD 5.1 magic items and gear the engine can run, as plain `ItemDefinition`
 * records.
 *
 * Authoring contract (see `README.md`):
 * - `id` is `srd:item:<kebab-slug>`, unique across the file.
 * - A stack or charges is `supply: { id: "supply", size, unit }`, and every use that spends it names `"supply"`: the
 *   pool is renamed `item:<new item id>` on attach (`withItemPool`). Use ids are placeholders, re-minted on attach.
 * - A potion's use is drinking it: a heal or a buff aimed at itself, with `give` for what giving it to a creature within
 *   5 ft takes. In SRD 5.1, drinking or administering a potion takes an action.
 * - A potion's use carries the potion's own name, so the log and the AI's reasons read naturally.
 * - An item the engine can't run yet is reference-only (`automationSupport: "manual-only"`), so the DM can still carry it.
 */

const supply = (size: number, unit: "count" | "charges" = "count") => ({ id: "supply", size, unit });
const ALL_SAVES = { str: 2, dex: 2, con: 2, int: 2, wis: 2, cha: 2 } as const;
const ALL_DAMAGE_TYPES: DamageType[] = [
  "acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"
];

/** A Potion of Healing of some rarity: a stack of one, drunk or given for an action. */
function potionOfHealing(slug: string, name: string, dice: string, rarity: string): ItemDefinition {
  return {
    id: `srd:item:${slug}`,
    name,
    type: "potion",
    magical: true,
    description: `A ${rarity} potion. You regain ${dice.replace("+", " + ")} hit points when you drink it; whatever its potency, its red liquid glimmers when agitated. Drinking or administering a potion takes an action.`,
    supply: supply(1),
    give: { actionType: "action" },
    grantedActions: [{
      kind: "healing",
      id: "drink",
      name,
      actionType: "action",
      range: 0,
      healing: [{ dice }],
      targeting: { target: "self" },
      resourceCost: { resourceId: "supply", amount: 1 },
      automationSupport: "full"
    }],
    automationSupport: "full"
  };
}

/** A potion whose drink is a benefit on the drinker for a while: a stack of one, drunk or given for an action. */
function buffPotion(
  slug: string,
  name: string,
  description: string,
  drink: Omit<Extract<ActionDefinition, { kind: "buff" }>, "kind" | "id" | "name" | "actionType" | "range" | "targeting" | "resourceCost">,
  notSimulated?: string
): ItemDefinition {
  const support = drink.automationSupport;
  return {
    id: `srd:item:${slug}`,
    name,
    type: "potion",
    magical: true,
    description,
    ...(notSimulated ? { notSimulated } : {}),
    supply: supply(1),
    give: { actionType: "action" },
    grantedActions: [{
      kind: "buff", id: "drink", name, actionType: "action", range: 0, targeting: { target: "self" },
      resourceCost: { resourceId: "supply", amount: 1 }, ...drink
    }],
    automationSupport: support
  };
}

/** A flask or vial thrown at a creature within 20 ft (60 at disadvantage): a ranged attack as an improvised weapon. */
function thrownFlask(slug: string, name: string, description: string, hit: Pick<Extract<ActionDefinition, { kind: "attack" }>, "damage" | "riders">): ItemDefinition {
  return {
    id: `srd:item:${slug}`,
    name,
    type: "thrown",
    description,
    supply: supply(1),
    grantedActions: [{
      kind: "attack", id: "throw", name, actionType: "action", attackType: "ranged", ability: "dex",
      // An improvised weapon: Dexterity, without proficiency.
      attackBonusFormula: { ability: "dex" },
      range: 20, longRange: 60, ...hit,
      resourceCost: { resourceId: "supply", amount: 1 }, automationSupport: "full"
    }],
    automationSupport: "full"
  };
}

function spell(slug: string): SpellDefinition {
  const found = SRD_SPELLS.find((candidate) => candidate.id === `srd:spell:${slug}`);
  if (!found) throw new Error(`SRD items: no spell ${slug}`);
  return found;
}

/**
 * A wand with 7 charges that regains 1d6 + 1 at dawn (for reference: a fight starts with every charge). `byCharges`: one
 * charge casts the spell at its own level, and each extra charge a level higher.
 */
function wand(slug: string, name: string, rarity: string, spellSlug: string, options: { dc?: number; byCharges: boolean; attunement: boolean }): ItemDefinition {
  const source = spell(spellSlug);
  const use = itemSpellUse(source, { dc: options.dc }, {
    id: spellSlug,
    ...(options.byCharges ? { upcast: { ...source.upcast, byCharges: true } } : {})
  })!;
  const dc = options.dc ? ` (save DC ${options.dc})` : "";
  const more = options.byCharges
    ? ` For 1 charge, you cast the ${ordinal(source.level)}-level version of the spell. You can increase the spell slot level by one for each additional charge you expend.`
    : "";
  return {
    id: `srd:item:${slug}`,
    name,
    type: "wand",
    magical: true,
    description: `A ${rarity} wand${options.attunement ? " (requires attunement by a spellcaster)" : ""}. It has 7 charges. While holding it, you can use an action to expend ${options.byCharges ? "1 or more of its charges" : "1 of its charges"} to cast the ${source.name.toLowerCase()} spell${dc} from it.${more} It regains 1d6 + 1 expended charges daily at dawn. If you expend its last charge, roll a d20: on a 1, it crumbles into ashes and is destroyed.`,
    supply: { ...supply(7, "charges"), regains: { dice: "1d6+1" } },
    grantedActions: [use],
    ...(options.attunement ? { attunement: { attuned: true } } : {}),
    automationSupport: "full"
  };
}

function ordinal(n: number): string {
  return `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
}

/** A ring, a cloak or a brooch: what it gives while carried (and attuned). */
function worn(slug: string, name: string, description: string, effects: NonNullable<ItemDefinition["effects"]>, notSimulated?: string): ItemDefinition {
  return {
    id: `srd:item:${slug}`, name, type: "worn", magical: true, description, effects, attunement: { attuned: true },
    ...(notSimulated ? { notSimulated, automationSupport: "partial" as const } : { automationSupport: "full" as const })
  };
}

/**
 * A suit of armor or a shield (ARMOR_PLAN.md): its AC, worn. Light armor adds the wearer's Dexterity modifier, medium at
 * most +2, heavy none; a shield adds +2.
 */
function armor(slug: string, name: string, stats: ArmorStats, description: string, extra: Partial<ItemDefinition> = {}): ItemDefinition {
  return {
    id: `srd:item:${slug}`, name, type: stats.category === "shield" ? "shield" : "armor", description, armor: stats,
    automationSupport: "full", ...extra
  };
}

const PLATE: ArmorStats = { category: "heavy", ac: 18, strength: 15, stealthDisadvantage: true };

/** An item the engine can't run yet (ITEMS_PLAN.md §9): carried for reference, its rules applied by the DM. */
function reference(slug: string, name: string, type: ItemDefinition["type"], description: string, extra: Partial<ItemDefinition> = {}): ItemDefinition {
  return { id: `srd:item:${slug}`, name, type, description, automationSupport: "manual-only", ...extra };
}

const NECKLACE_FIREBALL = itemSpellUse(spell("fireball"), { dc: 15 }, { id: "bead", upcast: { ...spell("fireball").upcast, byCharges: true } })!;

export const SRD_ITEMS: readonly ItemDefinition[] = [
  // ── Potions of Healing ──────────────────────────────────────────────────────
  potionOfHealing("potion-of-healing", "Potion of Healing", "2d4+2", "common"),
  potionOfHealing("potion-of-greater-healing", "Potion of Greater Healing", "4d4+4", "uncommon"),
  potionOfHealing("potion-of-superior-healing", "Potion of Superior Healing", "8d4+8", "rare"),
  potionOfHealing("potion-of-supreme-healing", "Potion of Supreme Healing", "10d4+20", "very rare"),

  // ── Potions that help ───────────────────────────────────────────────────────
  buffPotion("potion-of-heroism", "Potion of Heroism",
    "A rare potion. For 1 hour after drinking it, you gain 10 temporary hit points that last for 1 hour, and for the same duration you are under the effect of the bless spell (no concentration required). Bless's d4 is simulated as +2. Its blue liquid bubbles and steams as if boiling.",
    {
      tempHp: [{ dice: "10" }],
      appliedCondition: { name: "custom", durationRounds: 600, modifiers: { attackRoll: 2, savingThrows: { ...ALL_SAVES } } },
      automationSupport: "full"
    }),
  buffPotion("potion-of-giant-strength", "Potion of Giant Strength",
    "When you drink this potion, your Strength score changes for 1 hour, to the giant's (hill 21, frost or stone 23, fire 25, cloud 27, storm 29). It has no effect if your Strength is already that high or higher. This one is a hill giant's: change the score in What it does.",
    {
      appliedCondition: { name: "custom", durationRounds: 600, effects: [{ kind: "ability-score", ability: "str", setTo: 21 }] },
      automationSupport: "full"
    }),
  buffPotion("potion-of-flying", "Potion of Flying",
    "A very rare potion. When you drink it, you gain a flying speed equal to your walking speed for 1 hour and can hover. If you're in the air when it wears off, you fall unless you have some other means of staying aloft.",
    {
      appliedCondition: { name: "custom", durationRounds: 600, effects: [{ kind: "speed", modes: { fly: "walk" }, hover: true }] },
      automationSupport: "full"
    }),
  buffPotion("potion-of-invulnerability", "Potion of Invulnerability",
    "A rare potion. For 1 minute after you drink it, you have resistance to all damage. Its syrupy liquid looks like liquefied iron.",
    {
      appliedCondition: { name: "custom", durationRounds: 10, modifiers: { damageAdjustments: ALL_DAMAGE_TYPES.map((damageType) => ({ type: "resistance" as const, damageType })) } },
      automationSupport: "full"
    }),
  buffPotion("potion-of-resistance", "Potion of Resistance",
    "An uncommon potion. When you drink it, you gain resistance to one type of damage for 1 hour: acid, cold, fire, force, lightning, necrotic, poison, psychic, radiant or thunder, as the DM chooses. This one resists fire: change it in What it does.",
    {
      appliedCondition: { name: "custom", durationRounds: 600, modifiers: { damageAdjustments: [{ type: "resistance", damageType: "fire" }] } },
      automationSupport: "full"
    }),
  buffPotion("potion-of-growth", "Potion of Growth",
    "An uncommon potion. When you drink it, you gain the \"enlarge\" effect of the enlarge/reduce spell for 1d4 hours (no concentration required): you grow a size larger, have advantage on Strength checks and saving throws, and your weapon attacks deal 1d4 extra damage.",
    {
      appliedCondition: {
        name: "custom", durationRounds: 600,
        effects: [
          { kind: "damage-bonus", damage: [{ dice: "1d4", damageType: "same-as-attack" }], attackTypes: ["melee", "ranged"] },
          { kind: "save-advantage", ability: "str" }
        ]
      },
      automationSupport: "partial"
    },
    "the larger size and the advantage on Strength checks"),
  buffPotion("potion-of-invisibility", "Potion of Invisibility",
    "A very rare potion. When you drink it, you become invisible for 1 hour, with anything you wear or carry. The effect ends early if you attack or cast a spell. Attacks against an invisible creature are simulated at −4 (for disadvantage).",
    {
      appliedCondition: { name: "invisible", durationRounds: 600, modifiers: { incomingAttackRoll: -4 } },
      automationSupport: "partial"
    },
    "its ending when the drinker attacks or casts a spell: end it by hand"),
  buffPotion("potion-of-speed", "Potion of Speed",
    "A very rare potion. When you drink it, you gain the effect of the haste spell for 1 minute (no concentration required): your speed doubles, you gain +2 to AC and advantage on Dexterity saving throws, and an extra limited action each turn.",
    {
      appliedCondition: { name: "custom", durationRounds: 10, modifiers: { armorClass: 2 }, effects: [{ kind: "save-advantage", ability: "dex" }] },
      automationSupport: "partial"
    },
    "the doubled speed and the extra action"),

  // ── Thrown ──────────────────────────────────────────────────────────────────
  thrownFlask("acid-vial", "Vial of Acid",
    "As an action, you can splash the contents of this vial onto a creature within 5 feet or throw it up to 20 feet, shattering it on impact. Either way, make a ranged attack against the creature, treating the acid as an improvised weapon. On a hit, the target takes 2d6 acid damage.",
    { damage: [{ dice: "2d6", damageType: "acid" }] }),
  thrownFlask("holy-water", "Flask of Holy Water",
    "As an action, you can splash the contents of this flask onto a creature within 5 feet or throw it up to 20 feet, shattering it on impact. Either way, make a ranged attack against the creature, treating the holy water as an improvised weapon. If the target is a fiend or undead, it takes 2d6 radiant damage.",
    { damage: [], riders: [{ kind: "damage", when: "on-hit", components: [{ dice: "2d6", damageType: "radiant" }], restrictToCreatureTypes: ["fiend", "undead"] }] }),

  // ── Wands ───────────────────────────────────────────────────────────────────
  wand("wand-of-magic-missiles", "Wand of Magic Missiles", "uncommon", "magic-missile", { byCharges: true, attunement: false }),
  wand("wand-of-web", "Wand of Web", "uncommon", "web", { dc: 15, byCharges: false, attunement: true }),
  wand("wand-of-fireballs", "Wand of Fireballs", "rare", "fireball", { dc: 15, byCharges: true, attunement: true }),
  wand("wand-of-lightning-bolts", "Wand of Lightning Bolts", "rare", "lightning-bolt", { dc: 15, byCharges: true, attunement: true }),

  // ── Beads ───────────────────────────────────────────────────────────────────
  {
    id: "srd:item:necklace-of-fireballs",
    name: "Necklace of Fireballs",
    type: "gear",
    magical: true,
    description: "A rare necklace with 1d6 + 3 beads (this one has 6: change it in Use & cost). As an action, you can detach a bead and throw it up to 60 feet away, where it detonates as a 3rd-level fireball spell (save DC 15). You can hurl several beads, or the whole necklace, as one action: the fireball is a level higher for each bead beyond the first.",
    supply: supply(6),
    grantedActions: [{ ...NECKLACE_FIREBALL, name: "Fireball bead", range: 60, targeting: { origin: "point", range: 60 } } as ActionDefinition],
    automationSupport: "full"
  },

  // ── Worn ────────────────────────────────────────────────────────────────────
  worn("ring-of-protection", "Ring of Protection",
    "A rare ring (requires attunement). You gain a +1 bonus to AC and saving throws while wearing it.",
    [{ kind: "armor-class-bonus", bonus: { base: 1 } }, { kind: "save-bonus", bonus: { base: 1 } }]),
  worn("cloak-of-protection", "Cloak of Protection",
    "An uncommon cloak (requires attunement). You gain a +1 bonus to AC and saving throws while you wear it.",
    [{ kind: "armor-class-bonus", bonus: { base: 1 } }, { kind: "save-bonus", bonus: { base: 1 } }]),
  worn("bracers-of-defense", "Bracers of Defense",
    "Rare bracers (requires attunement). While wearing them, you gain a +2 bonus to AC if you are wearing no armor and using no shield.",
    [{ kind: "armor-class-bonus", bonus: { base: 2 }, unarmoredOnly: true }]),
  worn("brooch-of-shielding", "Brooch of Shielding",
    "An uncommon brooch (requires attunement). While wearing it, you have resistance to force damage, and immunity to damage from the magic missile spell.",
    [{ kind: "damage-adjustment", adjustment: { type: "resistance", damageType: "force" } }],
    "the immunity to magic missile"),
  {
    ...worn("boots-of-speed", "Boots of Speed",
      "Rare boots (requires attunement). While you wear them, you can use a bonus action to click their heels together: they double your walking speed, and any creature that makes an opportunity attack against you has disadvantage on the attack roll. Clicking them again ends it. Once used for 10 minutes in all, they stop working until you finish a long rest.",
      []),
    grantedActions: [{
      kind: "buff", id: "click-heels", name: "Boots of Speed", actionType: "bonus", range: 0, targeting: { target: "self" },
      appliedCondition: {
        name: "custom", durationRounds: 100,
        effects: [{ kind: "speed", multiplier: 2 }, { kind: "attack-defense", against: "opportunity" }]
      },
      automationSupport: "full"
    }]
  },
  worn("boots-of-striding-and-springing", "Boots of Striding and Springing",
    "Uncommon boots (requires attunement). While you wear them, your walking speed becomes 30 feet, unless it's higher, and your speed isn't reduced if you're encumbered or wearing heavy armor. You can also jump three times the normal distance.",
    [{ kind: "speed", minimumFt: 30, noArmorSlowdown: true }],
    "the longer jumps"),
  worn("winged-boots", "Winged Boots",
    "Uncommon boots (requires attunement). While you wear them, you have a flying speed equal to your walking speed. They work for up to 4 hours a day, in shorter flights, and regain 2 hours of flying for every 12 hours they aren't used.",
    [{ kind: "speed", modes: { fly: "walk" } }],
    "the 4 hours a day"),
  { ...worn("ring-of-swimming", "Ring of Swimming",
    "An uncommon ring. You have a swimming speed of 40 feet while wearing it.",
    [{ kind: "speed", modes: { swim: 40 } }]), attunement: undefined },
  worn("ring-of-free-action", "Ring of Free Action",
    "A rare ring (requires attunement). While you wear it, difficult terrain doesn't cost you extra movement, and magic can neither reduce your speed nor cause you to be paralyzed or restrained.",
    [{ kind: "ignore-difficult-terrain" }, { kind: "condition-immunity", conditions: ["paralyzed", "restrained"] }],
    "that only magic is stopped: it can't be paralyzed or restrained by anything, and a spell can still slow it"),
  worn("gauntlets-of-ogre-power", "Gauntlets of Ogre Power",
    "Uncommon gauntlets (requires attunement). Your Strength score is 19 while you wear them. They have no effect if your Strength is already 19 or higher.",
    [{ kind: "ability-score", ability: "str", setTo: 19 }]),
  worn("amulet-of-health", "Amulet of Health",
    "A rare amulet (requires attunement). Your Constitution score is 19 while you wear it. It has no effect if your Constitution is already 19 or higher.",
    [{ kind: "ability-score", ability: "con", setTo: 19 }]),
  worn("headband-of-intellect", "Headband of Intellect",
    "An uncommon headband (requires attunement). Your Intelligence score is 19 while you wear it. It has no effect if your Intelligence is already 19 or higher.",
    [{ kind: "ability-score", ability: "int", setTo: 19 }]),
  ...([
    ["hill", "Hill", 21, "rare"], ["stone", "Stone", 23, "very rare"], ["frost", "Frost", 23, "very rare"],
    ["fire", "Fire", 25, "very rare"], ["cloud", "Cloud", 27, "legendary"], ["storm", "Storm", 29, "legendary"]
  ] as const).map(([slug, kind, score, rarity]) => worn(`belt-of-${slug}-giant-strength`, `Belt of ${kind} Giant Strength`,
    `A ${rarity} belt (requires attunement). While wearing it, your Strength score is ${score}. It has no effect if your Strength is already ${score} or higher.`,
    [{ kind: "ability-score", ability: "str", setTo: score }])),
  worn("ring-of-resistance", "Ring of Resistance",
    "A rare ring (requires attunement). You have resistance to one damage type while wearing it; its gem shows which, as the DM chooses. This one resists fire (a garnet): change it in While carried.",
    [{ kind: "damage-adjustment", adjustment: { type: "resistance", damageType: "fire" } }]),

  // ── Armor and shields ───────────────────────────────────────────────────────
  armor("padded-armor", "Padded Armor", { category: "light", ac: 11, stealthDisadvantage: true },
    "Light armor of quilted layers of cloth and batting: AC 11 + Dexterity modifier, with disadvantage on Stealth."),
  armor("leather-armor", "Leather Armor", { category: "light", ac: 11 },
    "Light armor: a breastplate and shoulder protectors of leather stiffened by boiling in oil, the rest softer and more flexible. AC 11 + Dexterity modifier."),
  armor("studded-leather-armor", "Studded Leather Armor", { category: "light", ac: 12 },
    "Light armor of tough but flexible leather, reinforced with close-set rivets or spikes. AC 12 + Dexterity modifier."),
  armor("hide-armor", "Hide Armor", { category: "medium", ac: 12 },
    "Medium armor of thick furs and pelts. AC 12 + Dexterity modifier (max 2)."),
  armor("chain-shirt", "Chain Shirt", { category: "medium", ac: 13 },
    "Medium armor of interlocking metal rings, worn between layers of clothing or leather. AC 13 + Dexterity modifier (max 2)."),
  armor("scale-mail", "Scale Mail", { category: "medium", ac: 14, stealthDisadvantage: true },
    "Medium armor: a coat and leggings of leather covered with overlapping pieces of metal, like a fish's scales. AC 14 + Dexterity modifier (max 2), with disadvantage on Stealth."),
  armor("breastplate", "Breastplate", { category: "medium", ac: 14 },
    "Medium armor: a fitted metal chest piece worn with supple leather. AC 14 + Dexterity modifier (max 2)."),
  armor("half-plate", "Half Plate", { category: "medium", ac: 15, stealthDisadvantage: true },
    "Medium armor of shaped metal plates that cover most of the wearer's body. AC 15 + Dexterity modifier (max 2), with disadvantage on Stealth."),
  armor("ring-mail", "Ring Mail", { category: "heavy", ac: 14, stealthDisadvantage: true },
    "Heavy armor: leather with heavy rings sewn into it. AC 14, with disadvantage on Stealth."),
  armor("chain-mail", "Chain Mail", { category: "heavy", ac: 16, strength: 13, stealthDisadvantage: true },
    "Heavy armor of interlocking metal rings over quilted fabric, with gauntlets. AC 16. A wearer with a Strength score below 13 is 10 feet slower; disadvantage on Stealth."),
  armor("splint-armor", "Splint Armor", { category: "heavy", ac: 17, strength: 15, stealthDisadvantage: true },
    "Heavy armor of narrow vertical strips of metal riveted to a leather backing over cloth padding. AC 17. A wearer with a Strength score below 15 is 10 feet slower; disadvantage on Stealth."),
  armor("plate-armor", "Plate Armor", PLATE,
    "Heavy armor of shaped, interlocking metal plates covering the entire body, with gauntlets, boots and a visored helmet. AC 18. A wearer with a Strength score below 15 is 10 feet slower; disadvantage on Stealth."),
  armor("shield", "Shield", { category: "shield", ac: 2 },
    "A shield of wood or metal, carried in one hand: +2 AC while it's worn."),

  // ── Magic armor and shields ─────────────────────────────────────────────────
  armor("shield-plus-1", "Shield +1", { category: "shield", ac: 2, magicBonus: 1 },
    "An uncommon magic shield. While holding it, you have a +1 bonus to AC on top of the shield's normal +2.", { magical: true }),
  armor("shield-plus-2", "Shield +2", { category: "shield", ac: 2, magicBonus: 2 },
    "A rare magic shield. While holding it, you have a +2 bonus to AC on top of the shield's normal +2.", { magical: true }),
  armor("shield-plus-3", "Shield +3", { category: "shield", ac: 2, magicBonus: 3 },
    "A very rare magic shield. While holding it, you have a +3 bonus to AC on top of the shield's normal +2.", { magical: true }),
  armor("elven-chain", "Elven Chain", { category: "medium", ac: 13, magicBonus: 1 },
    "A rare chain shirt. You gain a +1 bonus to AC while you wear it, and you're considered proficient with it even without proficiency in medium armor.", { magical: true }),
  armor("glamoured-studded-leather", "Glamoured Studded Leather", { category: "light", ac: 12, magicBonus: 1 },
    "Rare studded leather armor. While wearing it, you gain a +1 bonus to AC, and you can use a bonus action to make it look like a normal set of clothing or some other kind of armor.", { magical: true }),
  armor("mithral-half-plate", "Mithral Half Plate", { category: "medium", ac: 15 },
    "Uncommon half plate of mithral, a light, flexible metal: unlike other half plate, it doesn't impose disadvantage on Stealth.", { magical: true }),
  armor("mithral-chain-mail", "Mithral Chain Mail", { category: "heavy", ac: 16 },
    "Uncommon chain mail of mithral, a light, flexible metal: it has no Strength requirement and doesn't impose disadvantage on Stealth.", { magical: true }),
  armor("adamantine-plate", "Adamantine Plate", PLATE,
    "Uncommon plate armor reinforced with adamantine, one of the hardest substances in existence. While you're wearing it, any critical hit against you becomes a normal hit.",
    { magical: true, effects: [{ kind: "no-critical-hits" }] }),
  armor("dwarven-plate", "Dwarven Plate", { ...PLATE, magicBonus: 2 },
    "Very rare plate armor. While wearing it, you gain a +2 bonus to AC. In addition, if an effect moves you against your will along the ground, you can use your reaction to reduce the distance you're moved by up to 10 feet.",
    { magical: true, notSimulated: "the reaction that cuts forced movement by 10 feet", automationSupport: "partial" }),
  armor("armor-of-invulnerability", "Armor of Invulnerability", PLATE,
    "Legendary plate armor (requires attunement). You have resistance to nonmagical damage while you wear it. As an action, you can make yourself immune to nonmagical damage for 10 minutes or until you're no longer wearing it; once used, this can't be used again until the next dawn.",
    {
      magical: true,
      attunement: { attuned: true },
      supply: { id: "supply", size: 1, unit: "charges", regains: "dawn" },
      effects: ALL_DAMAGE_TYPES.map((damageType) => ({ kind: "damage-adjustment" as const, adjustment: { type: "resistance" as const, damageType, nonMagicalOnly: true } })),
      grantedActions: [{
        kind: "buff", id: "invulnerable", name: "Invulnerable", actionType: "action", range: 0, targeting: { target: "self" },
        appliedCondition: { name: "custom", durationRounds: 100, modifiers: { damageAdjustments: ALL_DAMAGE_TYPES.map((damageType) => ({ type: "immunity" as const, damageType, nonMagicalOnly: true })) } },
        resourceCost: { resourceId: "supply", amount: 1 }, automationSupport: "full"
      }]
    }),
  armor("dragon-scale-mail", "Dragon Scale Mail", { category: "medium", ac: 14, magicBonus: 1, stealthDisadvantage: true },
    "Very rare scale mail made of a dragon's scales (requires attunement). While wearing it, you gain a +1 bonus to AC, advantage on saving throws against dragons' Frightful Presence and breath weapons, and resistance to one damage type set by the dragon's kind. This one is red: fire. As an action once a day, you can sense the closest dragon of that kind within 30 miles.",
    {
      magical: true,
      attunement: { attuned: true },
      effects: [{ kind: "damage-adjustment", adjustment: { type: "resistance", damageType: "fire" } }],
      notSimulated: "the advantage on saves against dragons' Frightful Presence and breath weapons, and sensing dragons",
      automationSupport: "partial"
    }),
  armor("demon-armor", "Demon Armor", { ...PLATE, magicBonus: 1 },
    "Very rare plate armor (requires attunement). While wearing it, you gain a +1 bonus to AC and can understand and speak Abyssal, and its clawed gauntlets make your unarmed strikes magic weapons that deal 1d8 slashing damage, with a +1 bonus to attack and damage rolls. Cursed: you can't take it off, and you have disadvantage on attacks against demons and on saves against their spells and special abilities.",
    {
      magical: true,
      attunement: { attuned: true },
      grantedActions: [{
        kind: "attack", id: "claws", name: "Clawed Gauntlets", actionType: "action", attackType: "melee", ability: "str",
        attackBonusFormula: { base: 1, ability: "str", proficiency: true }, range: 5, reach: 5,
        damage: [{ dice: "1d8+1", damageType: "slashing", abilityModifier: "str", magical: true }], automationSupport: "full"
      }],
      notSimulated: "its curse: disadvantage on attacks against demons and on saves against their spells and abilities",
      automationSupport: "partial"
    }),
  armor("spellguard-shield", "Spellguard Shield", { category: "shield", ac: 2 },
    "A very rare shield (requires attunement). While holding it, you have advantage on saving throws against spells and other magical effects, and spell attacks have disadvantage against you.",
    {
      magical: true,
      attunement: { attuned: true },
      effects: [{ kind: "save-advantage", against: { source: "magical" } }],
      notSimulated: "spell attacks' disadvantage against its bearer",
      automationSupport: "partial"
    }),

  // ── Carried for reference: rules the engine can't run yet ───────────────────
  reference("alchemists-fire", "Alchemist's Fire", "thrown",
    "As an action, you can throw this flask up to 20 feet, shattering it on impact. Make a ranged attack against a creature, treating it as an improvised weapon. On a hit, the target takes 1d4 fire damage at the start of each of its turns, until it uses its action to make a DC 10 Dexterity check to put out the flames. Not simulated yet: roll it by hand.",
    { supply: supply(1) }),
  reference("healers-kit", "Healer's Kit", "gear",
    "A leather pouch of bandages, salves and splints, with ten uses. As an action, you can expend one use to stabilize a creature that has 0 hit points, without a Wisdom (Medicine) check. Not simulated yet: stabilize by hand.",
    { supply: supply(10) }),
  reference("elixir-of-health", "Elixir of Health", "potion",
    "A rare potion. When you drink it, it cures any disease afflicting you, and it removes the blinded, deafened, paralyzed and poisoned conditions. Not simulated yet: remove them by hand.",
    { magical: true, supply: supply(1) })
];
