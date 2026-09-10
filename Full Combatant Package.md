### Full Combatant Package

The importer accepts a friendly **combatant template** format and normalizes it into the stricter **runtime package** used by the rules engine. Hand-authored / player-builder JSON should optimize for clarity. Runtime snapshots and exported combatants use the normalized shape.

The rules engine only executes structured actions and typed effects. Descriptive feature text is preserved for the UI, but prose is not interpreted during combat.

### JSON import still works

Importing a combatant from JSON is fully supported. In the app: **Create Token → “Import Player / Enemy JSON”**, pick a `.json` file. The file may be either:

- a **full package** — an object with `"kind": "battle-sim-combatant"` (see below), or
- a **raw creature definition** — any object with the required definition fields. The importer wraps it and creates the combatant instance automatically.

Import is the inverse of the sidebar’s **Export** button, so an exported combatant re-imports unchanged. Every field below is optional unless listed under **Required Fields**; the normalizer fills defaults and repairs malformed values rather than rejecting the file. Unknown keys are preserved.

### Full Package Wrapper

```json
{
  "kind": "battle-sim-combatant",
  "schemaVersion": 1,
  "exportedAt": "2026-09-09T00:00:00.000Z",
  "definition": {
    "id": "def-fighter",
    "name": "Fighter",
    "source": { "provider": "homebrew" },
    "size": "medium",
    "armorClass": 16,
    "maxHp": 32,
    "speed": 30,
    "proficiencyBonus": 2,
    "abilities": {
      "str": 16,
      "dex": 12,
      "con": 14,
      "int": 10,
      "wis": 10,
      "cha": 10
    },
    "actions": [
      {
        "kind": "attack",
        "id": "longsword",
        "name": "Longsword",
        "actionType": "action",
        "attackType": "melee",
        "ability": "str",
        "attackBonusFormula": { "ability": "str", "proficiency": true },
        "range": 5,
        "reach": 5,
        "damage": [
          { "dice": "1d8", "damageType": "slashing", "abilityModifier": "str" }
        ],
        "automationSupport": "full"
      }
    ]
  },
  "combatant": {
    "displayName": "Fighter",
    "faction": "party",
    "position": { "x": 0, "y": 0 },
    "currentHp": 32,
    "tempHp": 0,
    "state": "active",
    "tacticsProfile": "basic-melee"
  }
}
```

`schemaVersion` is currently `1`. `exportedAt` is informational.

### Raw Definition

A raw creature definition can be imported without the package wrapper. The importer creates the combatant instance automatically.

### Required Fields

`definition` (or a raw creature definition) must include:

- `name`: display name for the reusable sheet.
- `size`: `tiny`, `small`, `medium`, `large`, `huge`, or `gargantuan`.
- `armorClass`: integer AC.
- `maxHp`: integer maximum HP.
- `speed`: feet per turn.
- `abilities`: all six ability scores: `str`, `dex`, `con`, `int`, `wis`, `cha`.

Optional definition fields: `id`, `source`, `type`, `proficiencyBonus`, `character`, `saves`, `damageAdjustments`, `resources`, `tokenVisuals`, `weapons`, `spells`, `features`, `traits`, `actions`, `bonusActions`, and `reactions`.

Use `character` metadata for player classes, subclasses, custom class paths, and other progression context. Executable behavior still belongs in actions, features, traits, and effects.

```json
{
  "character": {
    "level": 6,
    "classes": [
      {
        "id": "spiritbound-marksman",
        "name": "Spiritbound Marksman",
        "level": 6,
        "subclass": { "id": "path-of-the-deadeye", "name": "Path of the Deadeye" },
        "source": {
          "provider": "homebrew",
          "url": "https://dnd.spudfurd.dev/spiritbound_marksman"
        }
      }
    ]
  }
}
```

### Where actions live

A creature has three authored action lists plus two derived sources:

| Field | Economy slot | Notes |
| --- | --- | --- |
| `actions` | `action` (default) | Also the home for `multiattack` and standard actions. |
| `bonusActions` | `bonus` (default) | Off-hand attacks, Rage, Cunning Action, Spiritual Weapon, etc. |
| `reactions` | `reaction` (default) | Needs a `reaction` trigger block (see **Reactions**). |
| `weapons[]` | compiled per `usableAs` | Each weapon compiles to one or more attack actions. |
| `spells[]` | from `castingTime` | The spell’s `action` becomes an executable action. |
| `features[].grantedActions` / `traits[].grantedActions` | per entry `actionType` | How Rage / Second Wind / Cunning Action attach their activation. |

Each entry’s own `actionType` overrides the list default, so a `bonus`-cost entry can sit in `actions` and still cost a bonus action.

### Action Types

`actionType` is one of:

- `action`
- `bonus`
- `reaction`
- `free` — costs no economy slot (Action Surge activation, a free object interaction, Reckless Attack toggle). Still blocked by incapacitation.

### Action Kinds

- `attack`: attack roll against AC.
- `save`: one target makes a saving throw.
- `area-save`: creatures in an area make saving throws.
- `healing`: restores HP.
- `multiattack`: repeats one or more child attack actions, optionally split across targets.
- `activate-feature`: spends a resource and/or applies a condition; also how reaction buffs (Shield) are modeled.
- `utility`: a standard action — `dash`, `disengage`, `dodge`, `hide`, or `help`.
- `unsupported`: preserved for reference, skipped by automation.

All executable automated actions should set `automationSupport` to `full`. Values of `partial`, `manual-only`, and `unsupported` are retained as reference data but skipped by automated combat. The engine also *downgrades* an authored `full` to `partial` at compile time when an action carries a rider it cannot resolve (a `note`, or a `{ custom }` condition rider with no `modifiers`).

### Attack

```json
{
  "kind": "attack",
  "name": "Longbow",
  "actionType": "action",
  "attackType": "ranged",
  "ability": "dex",
  "attackBonusFormula": { "ability": "dex", "proficiency": true },
  "range": 150,
  "longRange": 600,
  "damage": [
    { "dice": "1d8", "damageType": "piercing", "abilityModifier": "dex" }
  ],
  "automationSupport": "full"
}
```

- `attackType`: `melee`, `ranged`, or `spell`.
- Use `reach` for melee attacks when it differs from `range` (halberd/pike/lance = 10).
- Use `longRange` for ranged or spell attacks that can target beyond normal range with disadvantage.
- `attackBonus` (flat integer) is an alternative to `attackBonusFormula`.
- `riders`: on-hit effects — see **Riders**.
- `attackDelivery: "beams"` with `beamCount` / `beamCountByLevel` / `autoHit` models Magic Missile / Scorching Ray / Eldritch Blast.
- `reaction`: present only when `actionType` is `reaction` — see **Reactions**.

### Saving Throw Damage

```json
{
  "kind": "save",
  "name": "Poison Spray",
  "actionType": "action",
  "saveAbility": "con",
  "dcFormula": { "base": 8, "ability": "wis", "proficiency": true },
  "range": 10,
  "damage": [{ "dice": "1d12", "damageType": "poison" }],
  "onSuccess": "none",
  "automationSupport": "full"
}
```

- Use either `dc` (flat) or `dcFormula`.
- `onSuccess`: `half`, `none`, or `negates`. `halfDamageOnSuccess: true/false` is the legacy spelling and is kept in sync.
- `targeting: { "target": "self" }` aims a buff / self-effect at the caster.

### Area Saving Throw Damage

```json
{
  "kind": "area-save",
  "name": "Burning Hands",
  "actionType": "action",
  "saveAbility": "dex",
  "dc": 13,
  "range": 15,
  "area": { "type": "cone", "size": 15 },
  "targeting": { "origin": "self", "aimedFromSelf": true, "range": 0 },
  "damage": [{ "dice": "3d6", "damageType": "fire" }],
  "onSuccess": "half",
  "affects": "hostile",
  "automationSupport": "full"
}
```

- Area types: `circle` (radius), `cone` (length), `line` / `rectangle` (length, plus `width`), `square` (side).
- `targeting.origin`: `point` (aim within `range`) or `self` (centered on caster). `aimedFromSelf` points a cone / line from the caster toward the aim point.
- `affects`: `hostile` (default) or `all`.

### Healing

```json
{
  "kind": "healing",
  "name": "Healing Word",
  "actionType": "bonus",
  "range": 60,
  "healing": [{ "dice": "1d4", "abilityModifier": "wis" }],
  "resourceCost": { "resourceId": "slot-1", "amount": 1 },
  "targeting": { "target": "self" },
  "automationSupport": "full"
}
```

### Multiattack

Multiattack references child attack actions. If you omit action IDs, use `actionName` and place the referenced child action before the multiattack in the `actions` array.

```json
{
  "actions": [
    {
      "kind": "attack",
      "id": "longsword",
      "name": "Longsword",
      "actionType": "action",
      "attackType": "melee",
      "ability": "str",
      "attackBonusFormula": { "ability": "str", "proficiency": true },
      "range": 5, "reach": 5,
      "damage": [{ "dice": "1d8", "damageType": "slashing", "abilityModifier": "str" }],
      "automationSupport": "full"
    },
    {
      "kind": "attack",
      "id": "shortsword",
      "name": "Shortsword",
      "actionType": "action",
      "attackType": "melee",
      "ability": "str",
      "attackBonusFormula": { "ability": "str", "proficiency": true },
      "range": 5, "reach": 5,
      "damage": [{ "dice": "1d6", "damageType": "piercing", "abilityModifier": "str" }],
      "automationSupport": "full"
    },
    {
      "kind": "multiattack",
      "id": "veteran-multiattack",
      "name": "Multiattack",
      "actionType": "action",
      "attacks": [
        { "actionId": "longsword",  "count": 2, "targetGroup": 0 },
        { "actionId": "shortsword", "count": 1, "targetGroup": 1 }
      ],
      "automationSupport": "full"
    }
  ]
}
```

- `count`: how many swings that step makes.
- `targetGroup` (optional, default `0`): which supplied target this step aims at — `0` = primary, `1` = second target, and so on. Out-of-range indices clamp to the last target; a step whose target is already down falls through to the next live one. Omit it (or use `0`) for a plain single-target multiattack. This is how a split multiattack (“two swings at A, one at B”) is authored.

### Standard Actions (Dash / Disengage / Dodge / Hide / Help)

Every creature automatically has the `action`-cost Dash, Disengage, Dodge, Hide, and Help — you do **not** author them. Dash, Disengage, and Dodge are engine-driven; Hide and Help are reference-only.

Author a `utility` entry only to add an *exception*, most commonly a cheaper copy:

```json
{
  "features": [
    {
      "id": "cunning-action",
      "name": "Cunning Action",
      "category": "feature",
      "automationSupport": "full",
      "grantedActions": [
        { "kind": "utility", "id": "ca-dash", "name": "Cunning Action: Dash", "actionType": "bonus", "mode": "dash", "automationSupport": "full" },
        { "kind": "utility", "id": "ca-disengage", "name": "Cunning Action: Disengage", "actionType": "bonus", "mode": "disengage", "automationSupport": "full" },
        { "kind": "utility", "id": "ca-hide", "name": "Cunning Action: Hide", "actionType": "bonus", "mode": "hide", "automationSupport": "partial" }
      ]
    }
  ]
}
```

An authored `action`-cost `utility` of a given `mode` replaces the synthesized one; a `bonus`-cost one is added alongside it. `mode: "hide"` / `"help"` always normalize to `partial`.

### Reactions

A `reaction`-typed action needs a `reaction` block describing what makes it available. Reactions live in `reactions[]`, or on a weapon (via `usableAs` / `reactionTrigger`), or on a spell whose `castingTime` is `"reaction"`.

```json
{
  "reaction": {
    "trigger": { "kind": "hit-by-attack" },
    "target": "trigger-source",
    "priority": "worthwhile"
  }
}
```

**`trigger.kind`:**

| kind | fires when | extra fields |
| --- | --- | --- |
| `enemy-leaves-reach` | a creature you threaten leaves melee reach (opportunity attack) | — |
| `targeted-by-attack` | you are targeted by an attack, before the roll (Shield) | `meleeOnly?` |
| `hit-by-attack` | an attack hits you (Hellish Rebuke) | `meleeOnly?` |
| `ally-targeted-by-attack` | an ally within `withinFt` is targeted (Protection) | `withinFt` |
| `enemy-casts-spell` | an enemy within `withinFt` casts a spell (Counterspell) | `withinFt`, `maxSpellLevel?` |
| `manual` | author-described; never auto-fires | `note` |

**`target`** — who the reaction acts on: `trigger-source` (the attacker / caster / mover, default), `trigger-target` (the creature the triggering attack was aimed at), or `self`.

**`priority`** — how eagerly it auto-fires: `always` (whenever the trigger and any resource cost are satisfied), `worthwhile` (default — only when the engine judges it worth the slot: a damaging retaliation that averages ≥ 4, a spell of level ≥ 2 for Counterspell, a badly hurt ally for Protection), or `manual` (never auto-fires; reference only).

Any melee weapon can already make an opportunity attack through the built-in scan, so you only need an explicit `enemy-leaves-reach` reaction to change its trigger or bar it.

**Opportunity attack, reaction retaliation, defensive buff, and counterspell:**

```json
{
  "reactions": [
    {
      "kind": "save",
      "id": "hellish-rebuke",
      "name": "Hellish Rebuke",
      "actionType": "reaction",
      "reaction": { "trigger": { "kind": "hit-by-attack" }, "target": "trigger-source", "priority": "worthwhile" },
      "saveAbility": "dex",
      "dcFormula": { "base": 8, "ability": "cha", "proficiency": true },
      "range": 60,
      "damage": [{ "dice": "2d10", "damageType": "fire" }],
      "onSuccess": "half",
      "resourceCost": { "resourceId": "slot-1", "amount": 1 },
      "automationSupport": "full"
    },
    {
      "kind": "activate-feature",
      "id": "shield",
      "name": "Shield",
      "actionType": "reaction",
      "featureId": "shield",
      "reaction": { "trigger": { "kind": "targeted-by-attack" }, "target": "self", "priority": "always" },
      "resourceCost": { "resourceId": "slot-1", "amount": 1 },
      "condition": { "id": "shield-active", "name": "custom", "durationRounds": 1, "modifiers": { "armorClass": 5 } },
      "automationSupport": "full"
    },
    {
      "kind": "activate-feature",
      "id": "counterspell",
      "name": "Counterspell",
      "actionType": "reaction",
      "featureId": "counterspell",
      "reaction": { "trigger": { "kind": "enemy-casts-spell", "withinFt": 60 }, "priority": "worthwhile" },
      "resourceCost": { "resourceId": "slot-3", "amount": 1 },
      "automationSupport": "full"
    }
  ]
}
```

A reaction `activate-feature` does not need a matching `features[]` record when its whole effect is its `condition` buff or the window result (Shield, Counterspell). Counterspell v1 auto-succeeds while the spending slot’s level is at least the incoming spell’s level.

### Activate Feature

Use `activate-feature` for bonus actions, actions, free toggles, or reactions such as Rage, class stances, and other resource-spending activations. Put a lingering buff in `condition` (with `effects` and/or `modifiers`); an instantaneous effect (regaining an action, refilling a resource) goes on the **feature’s own** `effects`, since that is where the resolver looks.

```json
{
  "features": [
    {
      "id": "rage",
      "name": "Rage",
      "category": "feature",
      "description": "While raging, the barbarian gains bonus damage and resistances.",
      "automationSupport": "full"
    }
  ],
  "bonusActions": [
    {
      "kind": "activate-feature",
      "id": "activate-rage",
      "name": "Rage",
      "actionType": "bonus",
      "featureId": "rage",
      "resourceCost": { "resourceId": "rage", "amount": 1 },
      "condition": {
        "id": "rage-active",
        "name": "custom",
        "durationRounds": 10,
        "effects": [
          { "kind": "damage-bonus", "attackTypes": ["melee"], "abilities": ["str"], "damage": [{ "dice": "2", "damageType": "same-as-attack" }] },
          { "kind": "damage-adjustment", "adjustment": { "type": "resistance", "damageType": "bludgeoning" } },
          { "kind": "damage-adjustment", "adjustment": { "type": "resistance", "damageType": "piercing" } },
          { "kind": "damage-adjustment", "adjustment": { "type": "resistance", "damageType": "slashing" } },
          { "kind": "save-advantage", "ability": "str" }
        ]
      },
      "automationSupport": "full"
    }
  ]
}
```

**Action Surge** — an instantaneous economy refresh, so the effect sits on the feature and the activation is `free`:

```json
{
  "features": [
    {
      "id": "action-surge",
      "name": "Action Surge",
      "category": "feature",
      "automationSupport": "full",
      "effects": [{ "kind": "extra-action", "slot": "action" }],
      "grantedActions": [
        {
          "kind": "activate-feature",
          "id": "activate-action-surge",
          "name": "Action Surge",
          "actionType": "free",
          "featureId": "action-surge",
          "resourceCost": { "resourceId": "action-surge", "amount": 1 },
          "automationSupport": "full"
        }
      ]
    }
  ]
}
```

The `condition` block accepts:

- `id`, `name` (a `ConditionName` or `"custom"`), `durationRounds`.
- `modifiers` — see **Condition modifiers**.
- `effects` — an array of feature effects, applied while the condition is active.

### Weapons

Weapons may use compact damage fields; the importer expands them into `attackType`, `ability`, `range`, `reach`, and a damage component array. If a weapon name matches an explicit action name, the weapon links to that action instead of creating a duplicate visible attack.

```json
{
  "weapons": [
    {
      "id": "plus-one-longsword",
      "name": "+1 Longsword",
      "category": "martial",
      "attackType": "melee",
      "ability": "str",
      "damage": "1d8",
      "damageType": "slashing",
      "versatileDamage": [{ "dice": "1d10", "damageType": "slashing" }],
      "properties": ["versatile"],
      "grip": "versatile",
      "reach": 5,
      "magicBonus": 1,
      "usableAs": ["action", "reaction"]
    },
    {
      "id": "scimitar-offhand",
      "name": "Off-hand Scimitar",
      "attackType": "melee",
      "ability": "finesse",
      "damage": "1d6",
      "damageType": "slashing",
      "properties": ["light", "finesse"],
      "usableAs": ["bonus"]
    }
  ]
}
```

Weapon fields:

- `attackType`: `melee` or `ranged` (or the alias `type`, e.g. `"martial-melee"`).
- `ability`: an ability, or `"finesse"` (resolved to the better of STR/DEX at attack time).
- `damage` / `damageType`: compact form, or a full `damage` component array.
- `versatileDamage`: damage used when wielded two-handed.
- `grip`: `one-handed`, `two-handed`, or `versatile`. If omitted, it is derived from `properties` (`versatile` / `two-handed`). `two-handed` always uses `versatileDamage`; `versatile` uses it only when no off-hand weapon is drawn.
- `reach`: melee reach in feet (defaults to `range`).
- `range` / `longRange`: normal and long range for ranged weapons.
- `magicBonus`: `+1` / `+2` / `+3` — added to both the attack roll and every damage component. `toHitBonus` is a flat to-hit-only modifier; `magical: true` marks damage as magical at `+0`.
- `proficient: false`: drop the proficiency bonus from the attack roll.
- `usableAs`: which economy slots compile an attack — `["action"]` (default for anything but a plain melee weapon), `["action", "bonus"]` (adds an off-hand attack), `["bonus"]` (bonus-action only — off-hand weapon, monk strike), `["action", "reaction"]` (opportunity-attack copy), any combination. A plain melee weapon with no `usableAs` still gets an opportunity attack from the built-in scan.
- `reactionTrigger`: overrides the trigger for the compiled `reaction` copy (default `{ "kind": "enemy-leaves-reach" }`).
- `powerAttack: true`: also compile a Great Weapon Master / Sharpshooter variant at −5 to hit / +10 damage; the AI weighs it against the plain attack.
- `onHit`: rider array — see **Riders**.
- `charges`: limited-use pool for spell-like `onHit` riders (see below).
- `resourceCost`: charges the attack itself spends (rare).

Compact martial example:

```json
{
  "weapons": [
    {
      "id": "plus-one-greataxe",
      "name": "+1 Greataxe",
      "type": "martial-melee",
      "damage": "1d12",
      "damageType": "slashing",
      "properties": ["heavy", "two-handed"],
      "magicBonus": 1,
      "powerAttack": true
    }
  ]
}
```

### Charges (limited-use weapon abilities)

```json
{
  "charges": { "id": "fear-strike", "max": 1, "recharge": "dawn" },
  "onHit": [
    {
      "kind": "condition",
      "when": "on-hit",
      "condition": "frightened",
      "save": { "ability": "wis", "dc": 15, "onSuccess": "negates" },
      "duration": { "kind": "rounds", "rounds": 10 },
      "resourceCost": { "resourceId": "fear-strike", "amount": 1 }
    }
  ]
}
```

On attach, `charges.id` is namespaced to `<weaponId>:<id>`, the matching rider `resourceCost.resourceId` is rewritten, and the pool is seeded on the definition and every existing combatant. `recharge` (`dawn` / `short-rest` / `long-rest` / `{ "dice": "1d6" }`) is advisory — there is no rest loop yet.

### Spells

`spells[]` entries are `SpellDefinition` records. The spell’s `action` is the executable; `castingTime` drives its economy slot.

```json
{
  "spells": [
    {
      "id": "fireball",
      "name": "Fireball",
      "level": 3,
      "school": "evocation",
      "castingTime": "action",
      "range": 150,
      "resourceCost": { "resourceId": "slot-3", "amount": 1 },
      "upcast": { "perSlotAboveBase": { "damageDice": "1d6" } },
      "automationSupport": "full",
      "action": {
        "kind": "area-save",
        "id": "fireball-action",
        "name": "Fireball",
        "actionType": "action",
        "saveAbility": "dex",
        "dcFormula": { "base": 8, "ability": "int", "proficiency": true },
        "range": 150,
        "area": { "type": "circle", "size": 20 },
        "targeting": { "origin": "point", "range": 150 },
        "damage": [{ "dice": "8d6", "damageType": "fire", "magical": true }],
        "onSuccess": "half",
        "affects": "all",
        "resourceCost": { "resourceId": "slot-3", "amount": 1 },
        "automationSupport": "full"
      }
    }
  ]
}
```

- `castingTime`: `action`, `bonus`, or `reaction`. A `reaction` spell’s `action` needs a `reaction` trigger block (see **Reactions**).
- `range`: feet, or `"self"` / `"touch"`.
- `level`: `0` for cantrips.
- `upcast.perSlotAboveBase`: `damageDice`, `beams`, `targets`, and/or `areaSize` growth per slot level above the spell’s base.
- Cantrip scaling by character level: put `scaling: { "mode": "cantrip-by-level", "steps": [{ "atLevel": 5, "dice": "2d10" }, …] }` on a damage component.

### Riders

Riders are small composable effects attached to an attack (`onHit`), or to a save / area-save / healing action (`riders`). Consumed after the hit / save resolves.

```json
{
  "riders": [
    { "kind": "damage", "when": "on-hit", "components": [{ "dice": "1d6", "damageType": "fire" }] },
    { "kind": "push", "when": "on-hit", "distance": 10 },
    {
      "kind": "condition",
      "when": "on-save-fail",
      "condition": "prone",
      "duration": { "kind": "save-ends", "saveAt": "turn-end" },
      "save": { "ability": "str", "dc": 15, "onSuccess": "negates" }
    },
    {
      "kind": "condition",
      "when": "on-hit",
      "condition": { "custom": "reaction-locked" },
      "modifiers": { "deniesReactions": true },
      "duration": { "kind": "until-start-of-next-turn" }
    },
    { "kind": "note", "text": "The target is also blinded until it uses an action to wipe its eyes." }
  ]
}
```

- `kind`: `damage`, `healing`, `push`, `condition`, or `note`.
- `when` (gate): `always`, `on-hit`, `on-miss`, `on-crit`, `on-save-fail`, `on-save-success`. Defaults to the natural gate for the action kind.
- `oncePerTurn: true`: applies at most once per turn (Sneak Attack, brand triggers).
- `resourceCost`: a cost the rider spends when it fires (Divine Smite, weapon charges).
- **condition rider** extras: `condition` (a `ConditionName` or `{ "custom": "name" }`), `duration` (see **Durations**), `save` (`{ ability, dc | dcFormula, onSuccess: "negates" | "ends-early" }`), `modifiers` (see **Condition modifiers**), and `effects` (feature effects applied while the condition holds).
- A `note` rider, or a `{ custom }` condition rider **without** `modifiers`, marks the action `partial` (needs a human).

### Durations

Used by condition riders and applied conditions:

- `{ "kind": "rounds", "rounds": 3, "repeatSaveAt": "turn-end" }` — a number alone is shorthand for `{ kind: "rounds", rounds: N }`.
- `{ "kind": "save-ends", "saveAt": "turn-start" | "turn-end" }`
- `{ "kind": "until-start-of-next-turn" }`
- `{ "kind": "concentration" }`
- `{ "kind": "permanent" }`

### Condition modifiers

A `modifiers` object (on a condition rider, an `activate-feature` `condition`, or an applied `ConditionInstance`) may set:

- `armorClass`: flat ± to AC (Shield = `5`).
- `attackRoll`: flat ± to the bearer’s attack rolls.
- `incomingAttackRoll`: ± to attack rolls made *against* the bearer. Positive = easier to hit (prone, stunned proxy); negative = harder (Dodge).
- `savingThrows`: `{ "dex": 2, "wis": -2 }` — per-ability ± to saves.
- `movementMultiplier`: e.g. `0` (can’t move), `0.5` (difficult terrain proxy).
- `damageAdjustments`: an array of `{ type, damageType, nonMagicalOnly? }` granted while active.
- `deniesActions` / `deniesBonusActions` / `deniesReactions`: the bearer cannot spend that slot. Shocking Grasp’s rider sets `deniesReactions`; incapacitating conditions set all three.

### Feature effects

Features and traits can be descriptive reference entries or structured effects. Effects go on `effects` for a passive feature, or inside an `activate-feature` `condition.effects` for one that turns on.

```json
{
  "traits": [
    {
      "name": "Pack Tactics",
      "category": "trait",
      "automationSupport": "full",
      "effects": [{ "kind": "attack-advantage", "condition": "ally-adjacent-to-target" }]
    }
  ]
}
```

Supported effect kinds:

| kind | effect |
| --- | --- |
| `attack-advantage` | Advantage (or `mode: "disadvantage"`) on the bearer’s attack rolls. |
| `attack-bonus` | `bonus` (NumericFormula) added to the bearer’s attack rolls. |
| `incoming-attack-modifier` | `amount` added to attack rolls *against* the bearer (`+5` ≈ attackers have advantage, `-5` ≈ disadvantage). |
| `damage-bonus` | `damage[]` added to a hit. `oncePerTurn` for Sneak Attack; `critical: true` to add only on a crit. |
| `save-gated-damage` | `damage[]` added on a hit, reduced by the target’s `save` first. |
| `apply-condition-on-hit` | Places `appliedCondition` (with its own `effects` / `modifiers`) on `target` or `self`. |
| `incoming-hit-damage` | Damage dealt to the bearer the next time it is hit (marks, brands); `consumeCondition` / `damageSource`. |
| `damage-adjustment` | A resistance / immunity / vulnerability while active (Rage, Bear Totem). |
| `save-advantage` | Advantage on the bearer’s saves (optionally a single `ability`). |
| `save-bonus` | `bonus` (NumericFormula) to saves (optionally a single `ability`). |
| `save-dc-bonus` | `bonus` to spell save DCs; scope with `actionIds`. |
| `armor-class-bonus` | `bonus` (NumericFormula) to AC (Defense fighting style, Shield of Faith). |
| `swarm-damage` | `fullHpDamage` / `bloodiedDamage` auto-damage for swarm auras. |
| `extra-action` | Activating the feature hands back a spent slot — `slot: "action" | "bonus" | "reaction"` (Action Surge, War Caster). |
| `resource-regain` | Refill `resourceId` by `amount` (NumericFormula), capped at `max`. `timing`: `"on-activate"` (fires from the activation) / `"turn-start"` / `"turn-end"`. |
| `avoids-opportunity-attacks` | The bearer never provokes opportunity attacks (Mobile). |

**Scope** (attack-related effects): `actionIds`, `attackTypes` (`["melee", "ranged", "spell"]`), and/or `abilities`.

**Conditions** on any effect: one `condition`, or `allConditions` / `anyConditions` arrays. Supported values: `always`, `ally-adjacent-to-target`, `attack-has-advantage`, `attack-has-no-disadvantage`, `target-bloodied`, `self-bloodied`.

```json
{
  "kind": "damage-bonus",
  "actionIds": ["shortsword-attack", "shortbow-attack"],
  "damage": [{ "dice": "3d6", "damageType": "same-as-attack" }],
  "oncePerTurn": true,
  "anyConditions": ["attack-has-advantage", "ally-adjacent-to-target"]
}
```

```json
{
  "id": "plus-one-magic-focus",
  "name": "+1 Magic Focus",
  "category": "feature",
  "automationSupport": "full",
  "effects": [
    { "kind": "attack-bonus", "bonus": { "base": 1 }, "attackTypes": ["spell"] },
    { "kind": "save-dc-bonus", "bonus": { "base": 1 }, "actionIds": ["vicious-mockery", "shatter", "fireball"] }
  ]
}
```

`same-as-attack` in a feature-effect damage component copies the triggering attack’s damage type.

### Damage Components

- `dice`: dice expression or static number — `1d8`, `2d6+3`, `5`. The structured mirror `diceCount` / `diceSize` / `flatBonus` is filled in on import for clean `NdM(+K)` forms.
- `damageType`: `acid`, `bludgeoning`, `cold`, `fire`, `force`, `lightning`, `necrotic`, `piercing`, `poison`, `psychic`, `radiant`, `slashing`, `thunder`. Feature damage can also use `same-as-attack`.
- `abilityModifier`: optional ability added to damage.
- `magical: true`: bypasses non-magical resistance.
- `bonusFormula`: optional NumericFormula.
- `scaling`: `cantrip-by-level` or `per-slot-above-base`.

### Numeric Formulas

```json
{ "base": 8, "ability": "wis", "proficiency": true, "multiplier": 1 }
```

- `base` defaults to `0`.
- `ability` adds that ability modifier.
- `proficiency: true` adds the creature proficiency bonus.
- `multiplier` defaults to `1`.

### Saving Throw Proficiencies

Saving-throw proficiencies may be written as objects and are normalized to numeric totals:

```json
{
  "proficiencyBonus": 3,
  "abilities": { "str": 18, "dex": 14, "con": 16, "int": 8, "wis": 10, "cha": 8 },
  "saves": { "str": { "proficiency": true }, "con": { "proficiency": true, "base": 1 } }
}
```

→

```json
{ "saves": { "str": 7, "con": 7 } }
```

A plain number in `saves` is taken as the final bonus as-is.

### Resources

Actions, riders, and weapon charges spend named counters.

```json
{ "resources": { "rage": 4, "slot-1": 2, "slot-3": 3, "action-surge": 1, "second-wind": 1 } }
```

```json
{ "resourceCost": { "resourceId": "rage", "amount": 1 } }
```

`resources` may be authored on the definition, on the `combatant`, or both — the importer copies a combatant-only pool onto the definition. Slot ids follow the `slot-<level>` convention; Counterspell / Shield read the numeric level from that id. An action is skipped by automation (or rejected by direct resolution) if the combatant cannot pay.

### Damage Adjustments

Use `damageAdjustments` for always-on resistance, immunity, and vulnerability.

```json
{
  "damageAdjustments": [
    { "type": "resistance", "damageType": "fire" },
    { "type": "resistance", "damageType": "bludgeoning", "nonMagicalOnly": true },
    { "type": "immunity", "damageType": "poison" },
    { "type": "vulnerability", "damageType": "radiant" }
  ]
}
```

`nonMagicalOnly: true` models “resistance to … from nonmagical attacks” — a `magical` damage component bypasses it. Temporary or activated resistances belong in a feature activation’s `condition.effects` as `damage-adjustment` effects, not here.

### Features And Traits

```json
{
  "features": [
    {
      "id": "second-wind",
      "name": "Second Wind",
      "category": "feature",
      "description": "Bonus action: regain 1d10 + your level hit points, once per short rest.",
      "automationSupport": "full",
      "grantedActions": [
        {
          "kind": "healing",
          "id": "second-wind-heal",
          "name": "Second Wind",
          "actionType": "bonus",
          "range": 0,
          "healing": [{ "dice": "1d10+5" }],
          "targeting": { "target": "self" },
          "resourceCost": { "resourceId": "second-wind", "amount": 1 },
          "automationSupport": "full"
        }
      ]
    }
  ]
}
```

- `category`: `feature` or `trait`. `"class-feature"` normalizes to `feature`.
- Legacy template actions with `"kind": "feature"` normalize to `"activate-feature"`.
- `grantedActions`: any action kind — `activate-feature`, `attack`, `healing`, `utility`. Each is grouped by its own `actionType`. Their ids are re-minted on attach and `featureId` is pointed back at the feature.
- `effects`: passive feature effects (also where an instantaneous `extra-action` / `resource-regain@on-activate` belongs).
- `modifiers`: `{ armorClass, attackRoll, savingThrows }` as NumericFormulas — always-on passive numeric buffs.

### Combatant Instance Fields

The optional `combatant` object stores encounter-instance data:

- `displayName`: token name.
- `faction`: `party`, `enemy`, or `neutral`.
- `position`: `{ "x": 0, "y": 0 }`. Imports are placed in the next open cell, so this is mostly archival.
- `currentHp`, `tempHp`.
- `state`: `active`, `reserve`, `downed`, `dead`, `defeated`, or `fled`.
- `arrivesRound`: a 1-based round number. Set it (with `state: "reserve"`, or just set `arrivesRound` — the importer benches the token automatically when it is `> 1`) to stage a **reinforcement**: the token stays off the board — no turns, untargetable, blocks nothing, drawn ghosted — until the start of that round, when the engine flips it to `active`. Its faction still counts as "in the fight" while it waits, so combat does not end before it arrives.
- `tacticsProfile`: `basic-melee`, `basic-ranged`, `skirmisher`, `brute`, `defender`, or `controller`.
- `resources`: instance counters (spell slots, Rage uses, limited uses).
- `conditions`: active conditions.
- `deathSaves`: player death-save state.

The importer ignores exported `id`, `definitionId`, `initiative`, `actionEconomy`, and `concentration` and recreates encounter-local state.
