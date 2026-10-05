import type { ActionDefinition, DamageType, ItemDefinition, SpellDefinition } from "@/engine";
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
    [{ kind: "armor-class-bonus", bonus: { base: 2 } }],
    "whether it wears armor or a shield: take them off a creature that does"),
  worn("brooch-of-shielding", "Brooch of Shielding",
    "An uncommon brooch (requires attunement). While wearing it, you have resistance to force damage, and immunity to damage from the magic missile spell.",
    [{ kind: "damage-adjustment", adjustment: { type: "resistance", damageType: "force" } }],
    "the immunity to magic missile"),
  worn("ring-of-resistance", "Ring of Resistance",
    "A rare ring (requires attunement). You have resistance to one damage type while wearing it; its gem shows which, as the DM chooses. This one resists fire (a garnet): change it in While carried.",
    [{ kind: "damage-adjustment", adjustment: { type: "resistance", damageType: "fire" } }]),

  // ── Carried for reference: rules the engine can't run yet ───────────────────
  reference("alchemists-fire", "Alchemist's Fire", "thrown",
    "As an action, you can throw this flask up to 20 feet, shattering it on impact. Make a ranged attack against a creature, treating it as an improvised weapon. On a hit, the target takes 1d4 fire damage at the start of each of its turns, until it uses its action to make a DC 10 Dexterity check to put out the flames. Not simulated yet: roll it by hand.",
    { supply: supply(1) }),
  reference("healers-kit", "Healer's Kit", "gear",
    "A leather pouch of bandages, salves and splints, with ten uses. As an action, you can expend one use to stabilize a creature that has 0 hit points, without a Wisdom (Medicine) check. Not simulated yet: stabilize by hand.",
    { supply: supply(10) }),
  reference("potion-of-giant-strength", "Potion of Giant Strength", "potion",
    "When you drink this potion, your Strength score changes for 1 hour, to the giant's (hill 21, frost or stone 23, fire 25, cloud 27, storm 29). It has no effect if your Strength is already that high or higher. Not simulated yet: set the score by hand.",
    { magical: true, supply: supply(1) }),
  reference("potion-of-flying", "Potion of Flying", "potion",
    "A very rare potion. When you drink it, you gain a flying speed equal to your walking speed for 1 hour and can hover. If you're in the air when it wears off, you fall unless you have some other means of staying aloft. Not simulated yet: give the creature a flying speed by hand.",
    { magical: true, supply: supply(1) }),
  reference("elixir-of-health", "Elixir of Health", "potion",
    "A rare potion. When you drink it, it cures any disease afflicting you, and it removes the blinded, deafened, paralyzed and poisoned conditions. Not simulated yet: remove them by hand.",
    { magical: true, supply: supply(1) }),
  reference("gauntlets-of-ogre-power", "Gauntlets of Ogre Power", "worn",
    "Uncommon gauntlets (requires attunement). Your Strength score is 19 while you wear them. They have no effect if your Strength is already 19 or higher. Not simulated yet: set the score by hand.",
    { magical: true, attunement: { attuned: true } }),
  reference("amulet-of-health", "Amulet of Health", "worn",
    "A rare amulet (requires attunement). Your Constitution score is 19 while you wear it. It has no effect if your Constitution is already 19 or higher. Not simulated yet: set the score by hand.",
    { magical: true, attunement: { attuned: true } })
];
