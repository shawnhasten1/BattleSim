import type { ActionDefinition, DamageType, FeatureDefinition, FeatureEffect } from "@/engine";
import { BARBARIAN } from "@/data/srd/2024/classes/barbarian";
import type { CatalogEntry, ClassDefinition, PickOption, SubclassDefinition } from "@/lib/character-builder";

/**
 * The party's homebrew (PC builder plan, Phase 8e): the Arcane Trickster, the Path of the Zealot and the Totem Warrior
 * as subclasses of the SRD 5.2 Rogue and Barbarian, and the Spiritbound Marksman (a homebrew class, from
 * dnd.spudfurd.dev/spiritbound_marksman) with its three paths. These aren't SRD content, so they live here, not in
 * `src/`: written in the engine's terms with short descriptions of our own, for the DM to import
 * (`party.catalog.json`, made from this file by `scripts/write-party-homebrew.ts`). What doesn't run is marked so.
 */

const homebrew = { provider: "homebrew" as const };
const spell = (slug: string) => `srd:spell:${slug}-2024`;
const twenty = <T>(values: (level: number) => T): T[] => Array.from({ length: 20 }, (_, index) => values(index + 1));

/** A feature that runs. */
function runs(id: string, name: string, description: string, extra: Partial<FeatureDefinition> = {}): FeatureDefinition {
  return { id, name, category: "feature", description, automationSupport: "full", ...extra };
}

/** A feature that runs in part: what doesn't is said after its description. */
function partly(id: string, name: string, description: string, notSimulated: string, extra: Partial<FeatureDefinition> = {}): FeatureDefinition {
  return { id, name, category: "feature", description: `${description}\n\nNot simulated: ${notSimulated}`, automationSupport: "partial", ...extra };
}

/** A feature the engine can't run: on the actor as text for the DM. */
function reference(id: string, name: string, description: string): FeatureDefinition {
  return { id, name, category: "feature", description, automationSupport: "manual-only" };
}

/** A feature with nothing to do in a fight. */
function informational(id: string, name: string, description: string): FeatureDefinition {
  return { ...reference(id, name, description), informational: true };
}

const resistances = (types: DamageType[], whileCondition?: string): FeatureEffect[] =>
  types.map((damageType) => ({ kind: "damage-adjustment", adjustment: { type: "resistance", damageType }, ...(whileCondition ? { whileCondition } : {}) }));

/* ── Arcane Trickster (a third caster on the 2024 Rogue) ──────────────────────────────────────────────────────────── */

export const ARCANE_TRICKSTER: SubclassDefinition = {
  id: "homebrew:subclass:arcane-trickster",
  name: "Arcane Trickster",
  source: homebrew,
  edition: "2024",
  classId: "srd:class:rogue",
  description: "A rogue who adds wizard spells to sneaking and stabbing. Third caster: Intelligence, the wizard's list.",
  // Mage Hand is always known besides these.
  spellcasting: {
    ability: "int", kind: "third", list: "wizard",
    cantrips: twenty((level) => (level < 3 ? 0 : level < 10 ? 2 : 3)),
    prepared: [0, 0, 3, 4, 4, 4, 5, 6, 6, 7, 8, 8, 9, 10, 10, 11, 11, 11, 12, 13]
  },
  levels: [
    {
      level: 3,
      grants: [
        { key: "spellcasting", feature: informational("spellcasting", "Spellcasting", "Wizard spells cast with Intelligence, slots as a third caster; Mage Hand always known."), spells: [spell("mage-hand")] },
        { key: "mage-hand-legerdemain", feature: informational("mage-hand-legerdemain", "Mage Hand Legerdemain", "The spectral hand is invisible and can pick pockets, stow objects and work locks and traps.") }
      ]
    },
    { level: 9, grants: [{ key: "magical-ambush", feature: reference("magical-ambush", "Magical Ambush", "While invisible, a creature saving against the trickster's spell does so with disadvantage that turn.") }] },
    { level: 13, grants: [{ key: "versatile-trickster", feature: reference("versatile-trickster", "Versatile Trickster", "A Trip from Cunning Strike can also topple a creature beside the spectral hand.") }] },
    { level: 17, grants: [{ key: "spell-thief", feature: reference("spell-thief", "Spell Thief", "As a reaction to a spell aimed at it, the trickster can try to steal the spell, negating it and keeping it for 8 hours.") }] }
  ]
};

/* ── Path of the Zealot (2024 Barbarian) ──────────────────────────────────────────────────────────────────────────── */

const RAGE = "rage-active";
const rage = (BARBARIAN.levels[0]!.grants.find((grant) => grant.key === "rage")!.feature as FeatureDefinition).grantedActions![0]! as Extract<ActionDefinition, { kind: "activate-feature" }>;

export const ZEALOT: SubclassDefinition = {
  id: "homebrew:subclass:path-of-the-zealot",
  name: "Path of the Zealot",
  source: homebrew,
  edition: "2024",
  classId: "srd:class:barbarian",
  description: "A barbarian whose rage is a god's fury: radiant damage, divine healing, and allies made bold.",
  table: [{ id: "warrior-of-the-gods", label: "Warrior of the Gods dice", values: twenty((level) => (level < 3 ? null : level < 6 ? 4 : level < 12 ? 5 : level < 17 ? 6 : 7)) }],
  levels: [
    {
      level: 3,
      grants: [
        {
          key: "divine-fury",
          // Radiant here; necrotic does the same damage (edit the type for a necrotic zealot).
          feature: runs("divine-fury", "Divine Fury", "While raging, the first creature it hits each turn with a weapon or an Unarmed Strike takes 1d6 + half its Barbarian level more radiant damage.", {
            effects: [{ kind: "damage-bonus", oncePerTurn: true, whileCondition: RAGE, attackTypes: ["melee", "ranged"], damage: [{ dice: "1d6+1", damageType: "radiant" }] }]
          }),
          scale: [{ path: "effects.0.damage.0.dice", value: "1d6+{level/2}" }]
        },
        {
          key: "warrior-of-the-gods",
          feature: partly("warrior-of-the-gods", "Warrior of the Gods", "A pool of d12s (4, growing to 7): as a bonus action, spend dice and heal the total rolled.", "spending more than two dice at once.", {
            grantedActions: [
              { kind: "healing", id: "warrior-of-the-gods-1", name: "Warrior of the Gods (1 die)", actionType: "bonus", range: 0, healing: [{ dice: "1d12" }], targeting: { target: "self" }, resourceCost: { resourceId: "warrior-of-the-gods", amount: 1 }, automationSupport: "full" },
              { kind: "healing", id: "warrior-of-the-gods-2", name: "Warrior of the Gods (2 dice)", actionType: "bonus", range: 0, healing: [{ dice: "2d12" }], targeting: { target: "self" }, resourceCost: { resourceId: "warrior-of-the-gods", amount: 2 }, automationSupport: "full" }
            ]
          }),
          pool: { id: "warrior-of-the-gods", size: "{col:warrior-of-the-gods}" }
        }
      ]
    },
    {
      level: 6,
      grants: [{
        key: "fanatical-focus",
        feature: partly("fanatical-focus", "Fanatical Focus", "Once per rage, a failed save can be rerolled, adding its Rage Damage bonus.", "it's once a fight, raging or not.", {
          effects: [{ kind: "d20-change", rolls: ["save"], change: "reroll", bonus: { base: 2 }, resourceCost: { resourceId: "fanatical-focus", amount: 1 } }]
        }),
        scale: [{ path: "effects.0.bonus.base", value: "{col:rage-damage}" }],
        pool: { id: "fanatical-focus", size: 1 }
      }]
    },
    {
      level: 10,
      grants: [{
        key: "zealous-presence",
        feature: partly("zealous-presence", "Zealous Presence", "A bonus action battle cry: up to ten other creatures within 60 ft have advantage on attack rolls and saves until its next turn. Once a long rest.", "getting it back by spending a Rage use.", {
          grantedActions: [{
            kind: "buff", id: "zealous-presence", name: "Zealous Presence", actionType: "bonus", range: 60,
            targeting: { target: "chosen", count: 10, notSelf: true },
            appliedCondition: { id: "zealous-presence", name: "custom", durationRounds: 1, effects: [{ kind: "attack-advantage", condition: "always" }, { kind: "save-advantage" }] },
            resourceCost: { resourceId: "zealous-presence", amount: 1 }, automationSupport: "full"
          }]
        }),
        pool: { id: "zealous-presence", size: 1 }
      }]
    },
    {
      level: 14,
      grants: [{
        key: "rage-of-the-gods",
        // Rage again, as a divine warrior: flying, and resisting necrotic, psychic and radiant damage. Once a long rest.
        feature: partly("rage-of-the-gods", "Rage of the Gods", "Raging, it can take a divine warrior's form for a minute: a fly speed, and resistance to necrotic, psychic and radiant damage.", "Revivification (a reaction spending a Rage use to keep a creature within 30 ft above 0 hit points).", {
          grantedActions: [{
            ...structuredClone(rage), id: "rage-of-the-gods", name: "Rage (Rage of the Gods)",
            resourceCost: { resourceId: "rage-of-the-gods", amount: 1 }, extraCost: { resourceId: "rage", amount: 1 },
            condition: {
              ...structuredClone(rage.condition!),
              modifiers: { ...(rage.condition!.modifiers ?? {}), flySpeed: 40 },
              effects: [...structuredClone(rage.condition!.effects ?? []), ...resistances(["necrotic", "psychic", "radiant"])]
            }
          }]
        }),
        scale: [{ path: "grantedActions.0.condition.effects.0.damage.0.dice", value: "{col:rage-damage}" }],
        pool: { id: "rage-of-the-gods", size: 1 }
      }]
    }
  ]
};

/* ── Path of the Totem Warrior (2014, on the 2024 Barbarian) ──────────────────────────────────────────────────────── */

const totem = (id: string, name: string, grants: PickOption["grants"], description: string): PickOption => ({ id, name, description, grants });

export const TOTEM_WARRIOR: SubclassDefinition = {
  id: "homebrew:subclass:path-of-the-totem-warrior",
  name: "Path of the Totem Warrior",
  source: homebrew,
  edition: "2014",
  classId: "srd:class:barbarian",
  description: "A barbarian guided by an animal spirit: the bear's toughness, the eagle's sight, the wolf's pack.",
  levels: [
    {
      level: 3,
      grants: [{ key: "spirit-seeker", feature: informational("spirit-seeker", "Spirit Seeker", "Beast Sense and Speak with Animals as rituals.") }],
      choices: [{
        kind: "pick", id: "totem-spirit", label: "Totem Spirit", count: 1, options: [
          totem("bear", "Bear", [{
            key: "totem-bear",
            feature: runs("totem-bear", "Totem Spirit: Bear", "While raging, resistance to every damage type but psychic.", {
              effects: resistances(["acid", "cold", "fire", "force", "lightning", "necrotic", "poison", "radiant", "thunder"], RAGE)
            })
          }], "Resistance to all damage but psychic while raging."),
          totem("eagle", "Eagle", [{ key: "totem-eagle", feature: reference("totem-eagle", "Totem Spirit: Eagle", "While raging, others have disadvantage on opportunity attacks against it, and it can Dash as a bonus action.") }], "Hard to pin down while raging."),
          totem("wolf", "Wolf", [{ key: "totem-wolf", feature: reference("totem-wolf", "Totem Spirit: Wolf", "While raging, its allies have advantage on melee attacks against hostile creatures within 5 ft of it.") }], "Allies strike true beside it while it rages.")
        ]
      }]
    },
    {
      level: 6,
      grants: [],
      choices: [{
        kind: "pick", id: "aspect-of-the-beast", label: "Aspect of the Beast", count: 1, options: [
          totem("bear", "Bear", [{ key: "aspect-bear", feature: informational("aspect-bear", "Aspect of the Bear", "Twice the carrying capacity, and advantage on Strength checks to push, pull, lift or break.") }], "Strength of the bear."),
          totem("eagle", "Eagle", [{ key: "aspect-eagle", feature: informational("aspect-eagle", "Aspect of the Eagle", "Sees far without trouble, and dim light doesn't hinder its Perception.") }], "The eagle's eyesight."),
          totem("wolf", "Wolf", [{ key: "aspect-wolf", feature: informational("aspect-wolf", "Aspect of the Wolf", "Tracks at a fast pace, and moves stealthily at a normal pace.") }], "The wolf's hunting sense.")
        ]
      }]
    },
    { level: 10, grants: [{ key: "spirit-walker", feature: informational("spirit-walker", "Spirit Walker", "Commune with Nature as a ritual.") }] },
    {
      level: 14,
      grants: [],
      choices: [{
        kind: "pick", id: "totemic-attunement", label: "Totemic Attunement", count: 1, options: [
          totem("bear", "Bear", [{ key: "attunement-bear", feature: reference("attunement-bear", "Totemic Attunement: Bear", "While raging, hostile creatures within 5 ft have disadvantage on attacks against anyone else.") }], "Draws foes' attacks."),
          totem("eagle", "Eagle", [{ key: "attunement-eagle", feature: reference("attunement-eagle", "Totemic Attunement: Eagle", "While raging, it flies at its walking speed (falling if it ends a turn in the air).") }], "Flight while raging."),
          totem("wolf", "Wolf", [{ key: "attunement-wolf", feature: reference("attunement-wolf", "Totemic Attunement: Wolf", "While raging, a bonus action knocks a Large or smaller creature it hit with a melee attack prone.") }], "Knocks foes down.")
        ]
      }]
    }
  ]
};

/* ── Spiritbound Marksman (a homebrew half caster) and its paths ──────────────────────────────────────────────────── */

/** The gun's attack, as the builder places it: `<class slug>-<grant key>-granted-1`. Effects name it by this id. */
export const GUN = "spiritbound-marksman-spiritfire-gun-granted-1";

const MARKSMAN_SPELLS = [
  "fire-bolt", "ray-of-frost", "mage-hand", "mending", "light", "guidance", "acid-splash", "poison-spray", "shocking-grasp", "spare-the-dying",
  "resistance", "dancing-lights", "message", "prestidigitation",
  "cure-wounds", "faerie-fire", "grease", "detect-magic", "disguise-self", "expeditious-retreat", "false-life", "feather-fall", "identify",
  "jump", "longstrider", "sanctuary", "alarm",
  "scorching-ray", "web", "blur", "aid", "darkvision", "enhance-ability", "heat-metal", "invisibility", "lesser-restoration", "levitate",
  "magic-weapon", "spider-climb", "rope-trick", "arcane-lock", "see-invisibility",
  "dispel-magic", "fly", "haste", "protection-from-energy", "revivify", "glyph-of-warding", "blink",
  "freedom-of-movement", "stoneskin", "fabricate", "arcane-eye",
  "greater-restoration", "wall-of-stone", "animate-objects", "creation"
].map(spell);

export const SPIRITBOUND_MARKSMAN: ClassDefinition = {
  id: "homebrew:class:spiritbound-marksman",
  name: "Spiritbound Marksman",
  source: { provider: "homebrew", url: "https://dnd.spudfurd.dev/spiritbound_marksman" },
  edition: "2024",
  hitDie: 8,
  primaryAbilities: ["wis", "dex"],
  saves: ["con", "wis"],
  skills: { count: 2, from: ["arcana", "history", "insight", "investigation", "nature", "perception", "sleight_of_hand"] },
  weaponProficiency: ["simple"],
  armorTraining: ["light", "medium", "shield"],
  // Half caster from 1st level, Wisdom, its own (artificer-like) list. Prepared: Wisdom modifier + half its level,
  // taken here with a Wisdom of 16 rising to 20.
  spellcasting: {
    ability: "wis", kind: "half", list: "spiritbound-marksman", spells: MARKSMAN_SPELLS,
    cantrips: twenty((level) => (level < 10 ? 2 : level < 14 ? 3 : 4)),
    prepared: [3, 4, 4, 6, 6, 7, 7, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15]
  },
  subclassLevel: 3,
  subclassLabel: "Spirit Path",
  featLevels: [4, 8, 12, 16],
  table: [{ id: "shots", label: "Spiritfire Shots", values: twenty((level) => (level < 5 ? 1 : level < 11 ? 2 : level < 17 ? 3 : 4)) }],
  levels: [
    {
      level: 1,
      grants: [
        { key: "spellcasting", feature: informational("spellcasting", "Spellcasting", "Spells channeled through objects, cast with Wisdom; prepares Wisdom modifier + half its level.") },
        {
          key: "spiritfire-gun",
          feature: runs("spiritfire-gun", "Spiritfire Gun", "A spirit-imbued firearm: a ranged spell attack with Wisdom, 1d10 force a shot; 2 shots at 5th level, 3 at 11th, 4 at 17th.", {
            grantedActions: [
              {
                kind: "attack", id: "spiritfire-gun", name: "Spiritfire Gun", actionType: "action", attackType: "spell", ability: "wis",
                attackBonusFormula: { ability: "wis", proficiency: true }, range: 120,
                damage: [{ dice: "1d10", damageType: "force", magical: true }], automationSupport: "full"
              },
              { kind: "multiattack", id: "spiritfire-volley", name: "Spiritfire Volley", actionType: "action", attacks: [{ actionId: GUN, count: 1 }], automationSupport: "full" }
            ]
          }),
          scale: [{ path: "grantedActions.1.attacks.0.count", value: "{col:shots}" }]
        },
        { key: "tools-of-the-trade", feature: informational("tools-of-the-trade", "Tools of the Trade", "Gunsmith's tools and one artisan's tool.") }
      ]
    },
    {
      level: 2,
      grants: [{
        key: "lesser-echo-marks",
        // Agonizing Echo is the mark a fight wants: every shot of the turn's attack.
        feature: partly("lesser-echo-marks", "Lesser Echo Marks", "Once a turn, before firing, one mark: Agonizing Echo (Wisdom modifier on each shot), Binding Shot or Grasping Shot.", "Binding Shot (speed −10 ft) and Grasping Shot (pulled 10 ft on a failed Strength save): Agonizing Echo is always the one used.", {
          effects: [{ kind: "damage-bonus", actionIds: [GUN], damage: [{ dice: "0", damageType: "same-as-attack", bonusFormula: { ability: "wis" } }] }]
        })
      }]
    },
    { level: 7, grants: [{ key: "harmonized-echo", feature: informational("harmonized-echo", "Harmonized Echo", "Enhances non-magical objects for an hour: light, a compass to a creature it hit, silence, a reroll.") }] },
    { level: 8, grants: [{ key: "greater-echo-marks", feature: reference("greater-echo-marks", "Greater Echo Marks", "More marks: Warding Ember (+2 AC on a hit until its next turn), Spiritbrand Shot (tracking), Recoil Step (10 ft without opportunity attacks after firing).") }] },
    { level: 9, grants: [{ key: "echo-forged-arsenal", feature: informational("echo-forged-arsenal", "Echo-Forged Arsenal", "A second gun of another path, swapped on a rest.") }] },
    { level: 10, grants: [{ key: "spiritual-circuitry", feature: reference("spiritual-circuitry", "Spiritual Circuitry", "One Lesser Echo Mark is always active, beside the turn's chosen mark.") }] },
    { level: 13, grants: [{ key: "echoforge-imprint", feature: informational("echoforge-imprint", "Echoforge Imprint", "An hour's ritual binds a trap or ward to an object or place.") }] },
    { level: 14, grants: [{ key: "arsenal-upgrade", feature: informational("arsenal-upgrade", "Echo-Forged Arsenal Upgrade", "A third gun.") }] },
    {
      level: 18,
      grants: [{
        key: "avatar-of-the-forgotten",
        feature: partly("avatar-of-the-forgotten", "Avatar of the Forgotten", "Once a long rest, a minute in Spiritform: resistance to all damage but force and psychic, and 1d10 more force damage a shot.", "ignoring difficult terrain and moving through others' spaces.", {
          grantedActions: [{
            kind: "activate-feature", id: "avatar-of-the-forgotten", name: "Avatar of the Forgotten", actionType: "bonus", featureId: "",
            resourceCost: { resourceId: "avatar-of-the-forgotten", amount: 1 },
            condition: {
              id: "spiritform", name: "custom", durationRounds: 10,
              effects: [
                ...resistances(["acid", "bludgeoning", "cold", "fire", "lightning", "necrotic", "piercing", "poison", "radiant", "slashing", "thunder"]),
                { kind: "damage-bonus", actionIds: [GUN], damage: [{ dice: "1d10", damageType: "force" }] }
              ]
            },
            automationSupport: "full"
          }]
        }),
        pool: { id: "avatar-of-the-forgotten", size: 1 }
      }]
    },
    {
      level: 20,
      grants: [{
        key: "echoforged-apex",
        feature: partly("echoforged-apex", "Echoforged Apex", "Gun shots crit on a 19 or 20; two Echo Marks at once; two guns at hand.", "the second mark and the second gun.", {
          effects: [{ kind: "critical-range", minimum: 19, actionIds: [GUN] }]
        })
      }]
    }
  ],
  startingEquipment: [
    { id: "A", label: "A light crossbow, a dagger and studded leather", items: [{ ref: "srd:weapon:light-crossbow" }, { ref: "srd:weapon:dagger" }, { ref: "srd:item:studded-leather-armor" }] },
    { id: "B", label: "Gold to spend", items: [], gold: 125 }
  ],
  suggested: {
    abilities: ["wis", "dex", "con", "int", "cha", "str"],
    tactics: "basic-ranged",
    skills: ["perception", "insight"],
    equipment: "A",
    cantrips: [spell("fire-bolt"), spell("ray-of-frost"), spell("shocking-grasp")],
    spells: [spell("faerie-fire"), spell("cure-wounds"), spell("web"), spell("scorching-ray"), spell("haste"), spell("fly"), spell("stoneskin"), spell("wall-of-stone")]
  },
  description: "A gunslinger bound to spirits: a Wisdom spell-gun that fires more shots as it grows, echo marks, and a path that shapes the gun."
};

/** A path's gun: the class's attack, given this range. */
const gunForm = (key: string, name: string, description: string, range: number, longRange: number) => ({
  key,
  feature: runs(key, name, description),
  actionPatch: { grant: "spiritfire-gun", action: 0, patch: { range, longRange } }
});

const brand = (dice: string, rounds: number): FeatureEffect => ({
  kind: "apply-condition-on-hit", actionIds: [GUN], target: "target", oncePerTurn: true,
  appliedCondition: {
    id: "deaths-brand", name: "custom", durationRounds: rounds,
    effects: [{ kind: "incoming-hit-damage", damage: [{ dice, damageType: "necrotic" }], consumeCondition: true }]
  }
});

export const DEADEYE: SubclassDefinition = {
  id: "homebrew:subclass:path-of-the-deadeye",
  name: "Path of the Deadeye",
  source: homebrew,
  edition: "2024",
  classId: SPIRITBOUND_MARKSMAN.id,
  description: "A six-shooter for precise, controlled fire, and brands that make a target easier for everyone to kill.",
  levels: [
    {
      level: 3,
      grants: [
        gunForm("six-shooter", "Six-Shooter", "The gun is a six-shooter: range 60/120 ft.", 60, 120),
        { key: "deaths-brand", feature: runs("deaths-brand", "Death's Brand", "Once a turn, a shot that hits brands the target: the next creature to hit it before the marksman's next turn deals 1d6 more necrotic damage.", { effects: [brand("1d6", 1)] }) }
      ]
    },
    {
      level: 6,
      grants: [{
        key: "mark-of-the-last-breath", replaces: "deaths-brand",
        feature: partly("mark-of-the-last-breath", "Mark of the Last Breath", "Death's Brand lasts until the end of the marksman's next turn and deals 2d6 necrotic.", "branding a second creature once a long rest.", { effects: [brand("2d6", 2)] })
      }]
    },
    {
      level: 14,
      grants: [{
        key: "bullet-beyond-death",
        feature: partly("bullet-beyond-death", "Bullet Beyond Death", "Once a long rest, a missed shot is rolled again with advantage.", "moving the brand to another creature within 60 ft when the branded one dies.", {
          effects: [{ kind: "d20-change", rolls: ["attack"], change: "reroll", advantage: true, resourceCost: { resourceId: "bullet-beyond-death", amount: 1 } }]
        }),
        pool: { id: "bullet-beyond-death", size: 1 }
      }]
    }
  ]
};

export const SILENT_VEIL: SubclassDefinition = {
  id: "homebrew:subclass:path-of-the-silent-veil",
  name: "Path of the Silent Veil",
  source: homebrew,
  edition: "2024",
  classId: SPIRITBOUND_MARKSMAN.id,
  description: "A long spirit rifle for stealth and assassination.",
  levels: [
    {
      level: 3,
      grants: [
        gunForm("spirit-rifle", "Spirit Rifle", "The gun is a spirit rifle: range 120/300 ft.", 120, 300),
        { key: "silent-requiem", feature: reference("silent-requiem", "Silent Requiem", "Shots make no sound or flash, so firing from hiding needn't give the marksman away.") }
      ]
    },
    {
      level: 6,
      grants: [{
        key: "whisper-in-the-fog",
        feature: partly("whisper-in-the-fog", "Whisper in the Fog", "Wisdom on Stealth while hidden, harder to spot after firing from beyond 60 ft, and Invisibility on itself once a short rest.", "the Stealth and Perception parts."),
        freeCasts: [{ spell: spell("invisibility"), uses: 1 }]
      }]
    },
    { level: 14, grants: [{ key: "fade-into-the-mists", feature: reference("fade-into-the-mists", "Fade into the Mists", "A reaction when a creature ends its turn within 15 ft: teleport 30 ft and be heavily obscured until its next turn (Wisdom modifier times a long rest).") }] }
  ]
};

export const BAYOU_BLIGHT: SubclassDefinition = {
  id: "homebrew:subclass:path-of-the-bayou-blight",
  name: "Path of the Bayou Blight",
  source: homebrew,
  edition: "2024",
  classId: SPIRITBOUND_MARKSMAN.id,
  description: "A scattergun for close-range blasts that leave foes open to force.",
  levels: [
    {
      level: 3,
      grants: [
        gunForm("scattergun", "Scattergun", "The gun is a scattergun: range 30/90 ft.", 30, 90),
        { key: "shatterpulse-round", feature: reference("shatterpulse-round", "Shatterpulse Round", "On a hit, creatures within 5 ft of the target make a Dexterity save or take 1d6 force; all of the attack's shots go at one target.") }
      ]
    },
    {
      level: 6,
      grants: [{
        key: "swampburst-shards",
        feature: partly("swampburst-shards", "Swampburst Shards", "Once a turn, a hit makes the creature save (Constitution) or be vulnerable to force damage until the end of the marksman's next turn.", "that the creature must be within 10 ft.", {
          effects: [{
            kind: "apply-condition-on-hit", actionIds: [GUN], target: "target", oncePerTurn: true,
            save: { ability: "con", dcFormula: { base: 8, ability: "wis", proficiency: true } },
            appliedCondition: { id: "swampburst", name: "custom", durationRounds: 2, effects: [{ kind: "damage-adjustment", adjustment: { type: "vulnerability", damageType: "force" } }] }
          }]
        })
      }]
    },
    { level: 14, grants: [{ key: "spiritual-backblast", feature: reference("spiritual-backblast", "Spiritual Backblast", "Shatterpulse Round can push everyone it hits 10 ft, or give the marksman 10 temporary hit points and a free 10 ft move.") }] }
  ]
};

/** Everything, in import order (classes before their subclasses). */
export const PARTY_HOMEBREW: CatalogEntry[] = [
  { kind: "class", entry: SPIRITBOUND_MARKSMAN },
  { kind: "subclass", entry: DEADEYE },
  { kind: "subclass", entry: SILENT_VEIL },
  { kind: "subclass", entry: BAYOU_BLIGHT },
  { kind: "subclass", entry: ARCANE_TRICKSTER },
  { kind: "subclass", entry: ZEALOT },
  { kind: "subclass", entry: TOTEM_WARRIOR }
];
