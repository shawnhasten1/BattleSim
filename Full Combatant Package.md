### Full Combatant Package

The importer accepts a friendly **combatant template** format and normalizes it into the stricter **runtime package** used by the rules engine. Hand-authored/player-builder JSON should optimize for clarity. Runtime snapshots and exported combatants should use the normalized shape.

The rules engine only executes structured actions and typed effects. Descriptive feature text is preserved for the UI, but prose is not interpreted during combat.

### Full Package Wrapper

```json
{
  "kind": "battle-sim-combatant",
  "schemaVersion": 1,
  "exportedAt": "2026-09-07T00:00:00.000Z",
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

### Raw Definition

A raw creature definition can be imported without the package wrapper. The importer creates the combatant instance automatically.

### Required Fields

`definition` or a raw creature definition must include:

- `name`: display name for the reusable sheet.
- `size`: `tiny`, `small`, `medium`, `large`, `huge`, or `gargantuan`.
- `armorClass`: integer AC.
- `maxHp`: integer maximum HP.
- `speed`: feet per turn.
- `abilities`: all six ability scores: `str`, `dex`, `con`, `int`, `wis`, `cha`.

Optional definition fields include `id`, `source`, `type`, `proficiencyBonus`, `character`, `saves`, `damageAdjustments`, `weapons`, `spells`, `features`, `traits`, `actions`, `bonusActions`, and `reactions`.

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
        "subclass": {
          "id": "path-of-the-deadeye",
          "name": "Path of the Deadeye"
        },
        "source": {
          "provider": "homebrew",
          "url": "https://dnd.spudfurd.dev/spiritbound_marksman"
        }
      }
    ]
  }
}
```

### Template Conveniences

The importer normalizes common hand-authored shapes.

Saving throw proficiencies may be written as objects:

```json
{
  "proficiencyBonus": 3,
  "abilities": { "str": 18, "dex": 14, "con": 16, "int": 8, "wis": 10, "cha": 8 },
  "saves": {
    "str": { "proficiency": true },
    "con": { "proficiency": true }
  }
}
```

The runtime result is numeric total save bonuses:

```json
{
  "saves": {
    "str": 7,
    "con": 6
  }
}
```

Weapons may use compact damage fields:

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
      "magicBonus": 1
    }
  ]
}
```

The importer normalizes that weapon into `attackType`, `ability`, `range`, `reach`, and a damage component array. If a weapon name matches an explicit action name, the weapon links to that action instead of creating a duplicate visible attack.

Feature categories such as `"class-feature"` normalize to `"feature"`. Legacy template actions with `"kind": "feature"` normalize to `"activate-feature"`.

### Action Types

Supported action kinds are:

- `attack`: attack roll against AC.
- `save`: one target makes a saving throw.
- `area-save`: creatures in an area make saving throws.
- `healing`: restores HP.
- `multiattack`: repeats one or more child attack actions.
- `activate-feature`: spends a resource and optionally applies a condition.
- `unsupported`: preserved for reference, skipped by automation.

All executable automated actions should set `automationSupport` to `full`. Values of `partial`, `manual-only`, and `unsupported` are retained as reference data but skipped by automated combat.

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

Use `reach` for melee attacks when it differs from `range`. Use `longRange` for ranged or spell attacks that can target beyond normal range with disadvantage.

### Saving Throw Damage

```json
{
  "kind": "save",
  "name": "Poison Spray",
  "actionType": "action",
  "saveAbility": "con",
  "dcFormula": { "base": 8, "ability": "wis", "proficiency": true },
  "range": 10,
  "damage": [
    { "dice": "1d12", "damageType": "poison" }
  ],
  "halfDamageOnSuccess": false,
  "automationSupport": "full"
}
```

Use either `dc` or `dcFormula`.

### Area Saving Throw Damage

```json
{
  "kind": "area-save",
  "name": "Burning Hands",
  "actionType": "action",
  "saveAbility": "dex",
  "dc": 13,
  "range": 15,
  "area": { "type": "cone", "size": 15, "direction": "east" },
  "damage": [
    { "dice": "3d6", "damageType": "fire" }
  ],
  "halfDamageOnSuccess": true,
  "affects": "hostile",
  "automationSupport": "full"
}
```

Supported area types are `circle`, `cone`, `line`, and `square`.

### Healing

```json
{
  "kind": "healing",
  "name": "Healing Word",
  "actionType": "bonus",
  "range": 60,
  "healing": [
    { "dice": "1d4", "abilityModifier": "wis" }
  ],
  "resourceCost": { "resourceId": "slot-1", "amount": 1 },
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
      "id": "claw",
      "name": "Claw",
      "actionType": "action",
      "attackType": "melee",
      "ability": "str",
      "attackBonusFormula": { "ability": "str", "proficiency": true },
      "range": 5,
      "reach": 5,
      "damage": [
        { "dice": "1d6", "damageType": "slashing", "abilityModifier": "str" }
      ],
      "automationSupport": "full"
    },
    {
      "kind": "multiattack",
      "id": "two-claws",
      "name": "Two Claws",
      "actionType": "action",
      "attacks": [
        { "actionId": "claw", "count": 2 }
      ],
      "automationSupport": "full"
    }
  ]
}
```

### Activate Feature

Use `activate-feature` for bonus actions or actions such as Rage, class stances, and other resource-spending feature activations.

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
          {
            "kind": "damage-bonus",
            "attackTypes": ["melee"],
            "abilities": ["str"],
            "damage": [{ "dice": "2", "damageType": "same-as-attack" }]
          },
          {
            "kind": "damage-adjustment",
            "adjustment": { "type": "resistance", "damageType": "bludgeoning" }
          },
          {
            "kind": "damage-adjustment",
            "adjustment": { "type": "resistance", "damageType": "piercing" }
          },
          {
            "kind": "damage-adjustment",
            "adjustment": { "type": "resistance", "damageType": "slashing" }
          },
          {
            "kind": "save-advantage",
            "ability": "str"
          }
        ]
      },
      "automationSupport": "full"
    }
  ]
}
```

### Damage Components

Damage components support:

- `dice`: dice expression or static number, such as `1d8`, `2d6+3`, or `5`.
- `damageType`: `acid`, `bludgeoning`, `cold`, `fire`, `force`, `lightning`, `necrotic`, `piercing`, `poison`, `psychic`, `radiant`, `slashing`, or `thunder`. Feature damage can also use `same-as-attack`.
- `abilityModifier`: optional ability added to damage.
- `bonusFormula`: optional numeric formula.

### Numeric Formulas

```json
{
  "base": 8,
  "ability": "wis",
  "proficiency": true,
  "multiplier": 1
}
```

- `base` defaults to `0`.
- `ability` adds that ability modifier.
- `proficiency: true` adds the creature proficiency bonus.
- `multiplier` defaults to `1`.

### Resources

Actions can spend named counters.

```json
{
  "resources": { "rage": 4, "slot-1": 2 }
}
```

```json
{
  "resourceCost": { "resourceId": "rage", "amount": 1 }
}
```

The action is skipped by automation, or rejected by direct engine resolution, if the combatant cannot pay the cost.

### Damage Adjustments

Use `damageAdjustments` for always-on resistance, immunity, and vulnerability.

```json
{
  "damageAdjustments": [
    { "type": "resistance", "damageType": "fire" },
    { "type": "immunity", "damageType": "poison" },
    { "type": "vulnerability", "damageType": "radiant" }
  ]
}
```

Temporary or activated resistances should be modeled through feature activation conditions and typed effects as those hooks are added. Do not put Rage resistances in `damageAdjustments` unless the character should always resist that damage.

### Features And Traits

Features and traits can be descriptive reference entries or structured effects.

```json
{
  "traits": [
    {
      "name": "Pack Tactics",
      "category": "trait",
      "automationSupport": "full",
      "effects": [
        {
          "kind": "attack-advantage",
          "condition": "ally-adjacent-to-target"
        }
      ]
    }
  ]
}
```

Supported structured effect kinds currently include attack advantage, attack bonus, damage bonus, save-gated damage, apply condition on hit, incoming hit damage, damage adjustment, save advantage, swarm damage, AC bonus, save bonus, save DC bonus, and resource regain.

Attack-scoped effects can use `actionIds`, `attackTypes`, and/or `abilities`. Conditional effects may use one `condition`, `allConditions`, and `anyConditions`; supported conditions are `always`, `ally-adjacent-to-target`, `attack-has-advantage`, `attack-has-no-disadvantage`, `target-bloodied`, and `self-bloodied`.

Use `damage-bonus` for damage that is added directly to a hit. Set `oncePerTurn` for effects such as Sneak Attack.

```json
{
  "kind": "damage-bonus",
  "actionIds": ["shortsword-attack", "light-crossbow-attack"],
  "damage": [{ "dice": "4d6", "damageType": "piercing" }],
  "oncePerTurn": true,
  "allConditions": ["attack-has-no-disadvantage"],
  "anyConditions": ["attack-has-advantage", "ally-adjacent-to-target"]
}
```

Use `save-gated-damage` for damage added on a hit where the target rolls a saving throw before the damage amount is finalized.

```json
{
  "kind": "save-gated-damage",
  "actionIds": ["shortsword-attack", "light-crossbow-attack"],
  "damage": [{ "dice": "7d6", "damageType": "poison" }],
  "save": { "ability": "con", "dc": 15, "halfDamageOnSuccess": true },
  "critical": false
}
```

Use `apply-condition-on-hit` with `incoming-hit-damage` for marks, brands, curses, and other effects that are placed by one hit and triggered by a later hit.

```json
{
  "kind": "apply-condition-on-hit",
  "actionIds": ["spiritfire-shot"],
  "oncePerTurn": true,
  "appliedCondition": {
    "id": "deaths-brand-active",
    "name": "custom",
    "durationRounds": 1,
    "effects": [
      {
        "kind": "incoming-hit-damage",
        "damage": [{ "dice": "2d6", "damageType": "necrotic" }],
        "consumeCondition": true
      }
    ]
  }
}
```

Use `save-dc-bonus` for items or features that raise spell save DCs. Scope it with `actionIds` when the bonus should only apply to specific spell actions.

```json
{
  "id": "plus-one-magic-focus",
  "name": "+1 Magic Focus",
  "category": "feature",
  "automationSupport": "full",
  "effects": [
    {
      "kind": "attack-bonus",
      "bonus": { "base": 1 },
      "attackTypes": ["spell"]
    },
    {
      "kind": "save-dc-bonus",
      "bonus": { "base": 1 },
      "actionIds": ["vicious-mockery", "shatter", "fireball"]
    }
  ]
}
```

### Combatant Instance Fields

The optional `combatant` object stores encounter-instance data:

- `displayName`: token name.
- `faction`: `party`, `enemy`, or `neutral`.
- `position`: `{ "x": 0, "y": 0 }`. Imports are placed in the next open cell, so this is mostly archival.
- `currentHp`: current HP.
- `tempHp`: temporary HP.
- `state`: `active`, `downed`, `dead`, `defeated`, or `fled`.
- `tacticsProfile`: `basic-melee` or `basic-ranged`.
- `resources`: optional counters such as spell slots, Rage uses, or limited uses.
- `conditions`: optional active conditions.
- `deathSaves`: optional player death-save state.

The importer ignores exported `id`, `definitionId`, `initiative`, `actionEconomy`, and `concentration` and recreates encounter-local state.
