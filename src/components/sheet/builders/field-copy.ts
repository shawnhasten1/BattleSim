/**
 * The single source of truth for every guided-builder field's visible label and
 * one-line hint. Keeping them in one map (rather than inline JSX) keeps wording
 * consistent across the weapon / spell / action builders and makes the whole set
 * reviewable at a glance. A missing key falls back to the key itself, which the
 * `builder-fields` test flags.
 */
export interface FieldCopy {
  label: string;
  hint?: string;
}

export const FIELD_COPY: Record<string, FieldCopy> = {
  // shared
  name: { label: "Name" },
  timing: { label: "Action cost", hint: "Whether using this takes an action, a bonus action, or a reaction" },
  automationSupport: { label: "Automation", hint: "How much of this the simulator resolves on its own" },

  // weapon
  "weapon.kind": { label: "Attack type" },
  "weapon.ability": { label: "Attack roll uses", hint: "Which ability modifier is added to the attack roll" },
  "weapon.nonProficient": { label: "Not proficient", hint: "Drop the proficiency bonus from the attack roll" },
  "weapon.damage": { label: "Damage" },
  "weapon.magicBonus": { label: "Magic bonus", hint: "A +1 / +2 / +3 that adds to both the attack roll and every damage roll" },
  "weapon.magical": { label: "Magical", hint: "Damage counts as magical — it ignores resistance to non-magical attacks" },
  "weapon.toHitBonus": { label: "Extra to-hit", hint: "A flat bonus or penalty applied to the attack roll only" },
  "weapon.reach": { label: "Reach (ft)" },
  "weapon.range": { label: "Range (ft)" },
  "weapon.longRange": { label: "Long range (ft)", hint: "Attacks past normal range are made with disadvantage up to this distance" },
  "weapon.versatile": { label: "Two-handed damage", hint: "Damage when the weapon is wielded with both hands (versatile)" },
  "weapon.properties": { label: "Properties" },
  "weapon.category": { label: "Category" },
  "weapon.onHit": { label: "On-hit effect", hint: "An extra effect — a condition, more damage, a shove — that triggers when this weapon hits" },
  "weapon.charges": { label: "Limited uses", hint: "A charge pool on-hit effects and granted actions can spend; the plain attack still works when it is empty" },
  "weapon.chargesMax": { label: "Charge pool size" },
  "weapon.chargesRecharge": { label: "Refills" },
  "weapon.grantedActions": { label: "Granted spells / actions", hint: "Independent effects this item lets the wielder use — a focus's tiered spells, or a weapon that also casts something for charges" },
  "weapon.effects": { label: "Passive bonuses", hint: "Bonuses while this item is carried — spell attack / save DC, a damage-type boost" },
  "weapon.bonusOnly": { label: "Bonus action only", hint: "An off-hand / monk flurry strike — not usable as your main action" },
  "weapon.usableAsBonus": { label: "Also usable as a bonus action", hint: "Two-weapon fighting, Crossbow Expert — attack once more as a bonus action" },
  "weapon.usableAsReaction": { label: "Can make opportunity attacks", hint: "Melee weapons can react to a creature leaving reach; turn this off to opt out" },
  "weapon.grip": { label: "Grip", hint: "Two-handed / versatile use the larger damage die" },
  "weapon.powerAttack": { label: "Power attack option", hint: "Great Weapon Master / Sharpshooter: also offer a -5 to hit / +10 damage swing" },
  "weapon.reactionTrigger": { label: "Reaction trigger" },

  // spell / action
  "spell.level": { label: "Spell level", hint: "0 for a cantrip" },
  "spell.range": { label: "Range (ft)", hint: '"Self" and "Touch" are also accepted' },
  "spell.repositionRange": { label: "Teleport range (ft)", hint: "How far the destination may be from wherever the caster is standing when this is cast — also how far away the creature being moved may be, in \"one creature\" mode" },
  "spell.shape": { label: "What it does" },
  "spell.attackAbility": { label: "Spell attack uses" },
  "spell.attackDelivery": { label: "Delivery" },
  "spell.beamCount": { label: "Number of beams" },
  "spell.autoHit": { label: "Always hits", hint: "No attack roll — the damage lands automatically (Magic Missile)" },
  "spell.castingAbility": { label: "Spellcasting ability", hint: "The caster's own casting stat (Int/Wis/Cha) — drives the DC. Not necessarily the same ability the target rolls to save." },
  "spell.saveAbility": { label: "Saving throw", hint: "The ability the target rolls to resist this spell" },
  "spell.saveDc": { label: "Save DC", hint: "Leave blank to auto-calculate from the caster's spellcasting stat" },
  "spell.onSuccess": { label: "On a successful save" },
  "spell.damage": { label: "Damage" },
  "spell.dealsDamage": { label: "Deals damage" },
  "spell.healDice": { label: "Healing" },
  "spell.healTarget": { label: "Heals" },
  "spell.repositionTarget": { label: "Who teleports", hint: '"The caster" for a self-blink like Misty Step; "one creature" to also move a willing ally, like Dimension Door' },
  "spell.repositionRequiresLos": { label: "Requires line of sight to destination", hint: "Off by default — most teleport spells bypass normal sightline blocking. Turn on for a spell that explicitly requires seeing the destination." },
  "spell.riders": { label: "Effects" },
  "spell.concentration": { label: "Concentration", hint: "Casting another concentration spell ends this one" },
  "spell.ritual": { label: "Ritual" },
  "spell.resourceId": { label: "Spends resource", hint: 'e.g. "slot-3" for a 3rd-level slot' },
  "spell.upcastDamage": { label: "Extra damage per slot above base", hint: 'e.g. "1d6" for Fireball' },
  "spell.reactionTrigger": { label: "Reaction trigger", hint: "What has to happen for you to cast this as a reaction" },
  "spell.reactionTarget": { label: "Reaction acts on" },
  "spell.reactionPriority": { label: "AI eagerness", hint: "How readily the simulator spends the reaction on this" },

  // death effect
  "deathEffect.description": { label: "Reference text", hint: "Flavor text — not used by the simulator" },

  // feature
  "feature.category": { label: "Kind" },
  "feature.shape": { label: "What it does" },
  "feature.effects": { label: "Effects", hint: "Add one or more — each fires while the feature is active" },
  "feature.auraEnabled": { label: "Radiates as an aura", hint: "Also applies these effects to other nearby combatants, not just the bearer — Aura of Protection-style" },
  "feature.auraRange": { label: "Range (ft)" },
  "feature.auraAffects": { label: "Affects" },
  "feature.auraRequiresConscious": { label: "Stops if the bearer is knocked out or killed", hint: "Unchecking lets the aura keep working even while the bearer is unconscious or dead — uncommon, most auras (Aura of Protection) require the bearer conscious" },
  "feature.activateAs": { label: "Activate as" },
  "feature.resourceId": { label: "Spends resource", hint: 'e.g. "rage", "action-surge" — a pool is seeded for you' },
  "feature.durationRounds": { label: "Lasts (rounds)" },
  "feature.reactionTrigger": { label: "Reaction trigger" },
  "feature.grantsDash": { label: "Grants a bonus-action Dash" },
  "feature.grantsDisengage": { label: "Grants a bonus-action Disengage" },
  "feature.grantsHide": { label: "Grants a bonus-action Hide" },
  "feature.description": { label: "Reference text" },

  // reaction-trigger control
  "reactionTrigger.kind": { label: "When" },
  "reactionTrigger.withinFt": { label: "Within (ft)" },
  "reactionTrigger.meleeOnly": { label: "Melee attacks only" },
  "reactionTrigger.maxSpellLevel": { label: "Up to spell level" },
  "reactionTrigger.note": { label: "Describe the trigger" },

  // area
  "area.type": { label: "Shape" },
  "area.size": { label: "Radius (ft)" },
  "area.width": { label: "Width (ft)" },
  "area.origin": { label: "Centred on" },
  "area.aimedFromSelf": { label: "Aimed from the caster", hint: "The shape points from the caster toward the chosen spot" },
  "area.affects": { label: "Affects" },

  // persistent zone
  "zone.enabled": { label: "Leaves a persistent zone", hint: "Settles onto the board instead of (or as well as) resolving once — Insect Plague, Web, Cloudkill" },
  "zone.anchor": { label: "Follows", hint: "Spirit Guardians-style: re-centers on the caster every time they move, instead of staying where it was cast" },
  "zone.durationKind": { label: "Lasts" },
  "zone.durationRounds": { label: "Rounds" },
  "zone.applyOnCast": { label: "Also resolves immediately on cast", hint: "Most persistent zones (Insect Plague, Web) don't hit anyone the instant they're cast — only later, when a creature triggers them" },
  "zone.triggerEnter": { label: "Triggers when a creature enters the area", hint: "Insect Plague, Cloudkill, Web, Moonbeam all use this" },
  "zone.triggerStart": { label: "Triggers when a creature starts its turn there", hint: "Cloudkill deals its damage this way — a creature standing in the cloud is hit again every round" },
  "zone.triggerEnd": { label: "Triggers when a creature ends its turn there", hint: "Less common — most zones only care about entering or starting a turn there" },
  "zone.drifts": { label: "Drifts away from the caster", hint: "Cloudkill-style: automatically moves away from the caster at the start of each of the caster's turns — not a choice" },
  "zone.driftFeet": { label: "Feet per turn" },
  "zone.movementDamageEnabled": { label: "Damages creatures that move through it", hint: "Spike Growth-style: no saving throw, rolled once per step a creature takes into or within the zone" },
  "zone.movementDamage": { label: "Movement damage" },
  "zone.terrainEnabled": { label: "Becomes difficult or impassable terrain", hint: "Web, Spike Growth-style: layered onto the map wherever the zone currently sits" },
  "zone.terrainType": { label: "Terrain" },
  "zone.terrainMultiplier": { label: "Movement cost multiplier", hint: "5e default is double cost (2)" },
  "zone.blocksSight": { label: "Heavily obscures the area", hint: "Checked by the manual sight-measurement tool only — doesn't gate targeting" },
  "zone.repositionable": { label: "Caster can reposition it", hint: "Moonbeam-style: spends the caster's bonus action to move the zone toward the nearest hostile it hasn't caught yet" },
  "zone.repositionFeet": { label: "Feet per turn" },

  // rider editor
  "rider.effectType": { label: "Effect" },
  "rider.condition": { label: "Condition" },
  "rider.requiresSave": { label: "Requires a saving throw?" },
  "rider.saveAbility": { label: "Save ability" },
  "rider.saveDc": { label: "Save DC", hint: "Leave blank to auto-calculate from the source's stats" },
  "rider.saveOnSuccess": { label: "On a successful save" },
  "rider.duration": { label: "Duration" },
  "rider.durationRounds": { label: "Rounds" },
  "rider.repeatSave": { label: "Repeat the save at end of turn" },
  "rider.when": { label: "Triggers" },
  "rider.damage": { label: "Extra damage" },
  "rider.push": { label: "Push (ft)" },
  "rider.chargeCost": { label: "Charges spent" },
  "rider.note": { label: "Reference text" },

  // multiattack
  "multiattack.name": { label: "Name" },
  "multiattack.attacks": { label: "Attacks made" },
  "multiattack.count": { label: "Times each" }
};

/** Look up a label; used by controls that render their own `<label>`. */
export function fieldLabel(key: string): string {
  return FIELD_COPY[key]?.label ?? key;
}
