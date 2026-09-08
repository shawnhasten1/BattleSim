# D&D Battle Simulator

Local-first, map-aware D&D 5e encounter simulator. The current implementation establishes the project foundation and a deterministic engine slice that the UI consumes directly.

## Scripts

- `npm run dev` starts the Next.js app.
- `npm test` runs engine regression tests.
- `npm run typecheck` runs TypeScript validation.
- `npm run build` creates a production build.
- `npm run db:init` pushes the Prisma schema to the configured Postgres database.
- `npm run db:push` is the explicit Prisma schema push command.
- `npm run prisma:generate` generates the Prisma client.
- `npm run prisma:migrate` runs Prisma migrations after `DATABASE_URL` is configured.

## Architecture

- `src/engine` contains framework-independent combat, dice, geometry, pathfinding, and simulation code.
- `src/adapters` contains external service boundaries such as Open5e V2.
- `src/store` contains UI state only.
- `app` contains the Next.js interface.
- `prisma/schema.prisma` defines Postgres persistence models for projects, maps, encounters, definitions, and simulation runs.

## Planning References

- `FOUNDRY_STYLE_OVERHAUL_PLAN.md` tracks the planned Foundry-style scene, sidebar, drag-and-drop, token image, compendium, sheet, and simulation-report overhaul.

## Current Acceptance Coverage

- Seeded dice rolls and deterministic initiative.
- Versioned encounter snapshot validation.
- Movement-blocking walls and projectile line-of-effect checks.
- Difficult terrain movement cost.
- Large creature footprint legality.
- Attack resolution, critical support, damage adjustments, HP, and defeat/downed state transitions.
- Basic melee/ranged automated encounters with reproducible logs.
- Open5e V2 compendium search for creatures, spells, items/weapons, features/rules, and conditions.
- Drag-and-drop compendium import to the map or selected actor sheet with manual-only fallback for unsupported automation.
- Foundry-like token/actor sheet tabs separate token instance state from reusable actor definition data.
- Imported weapons, spells, features, traits, and actions expose source metadata and automation support in a sheet inspector.

## Player And Enemy JSON

Players and enemies can be exported from the selected token with `Export JSON`, then imported from the Create Token modal with `Import Player / Enemy JSON`.

The importer accepts two shapes:

- A full combatant package exported by the app.
- A raw creature definition object for hand-authored JSON.

Imported files are cloned into the current encounter with fresh internal IDs, so importing the same file multiple times will not overwrite an existing token or sheet.

### Full Combatant Package

This is the preferred format when sharing a built player or enemy.

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

### Raw Creature Definition

This lighter format is useful for hand-written monsters or PCs. The importer creates the combatant instance automatically.

```json
{
  "name": "Bandit Captain",
  "size": "medium",
  "armorClass": 15,
  "maxHp": 65,
  "speed": 30,
  "proficiencyBonus": 2,
  "abilities": {
    "str": 15,
    "dex": 16,
    "con": 14,
    "int": 14,
    "wis": 11,
    "cha": 14
  },
  "actions": [
    {
      "kind": "attack",
      "name": "Scimitar",
      "actionType": "action",
      "attackType": "melee",
      "ability": "dex",
      "attackBonusFormula": { "ability": "dex", "proficiency": true },
      "range": 5,
      "reach": 5,
      "damage": [
        { "dice": "1d6", "damageType": "slashing", "abilityModifier": "dex" }
      ],
      "automationSupport": "full"
    }
  ]
}
```

### Required Definition Fields

`definition` or a raw creature definition should include:

- `name`: display name for the reusable sheet.
- `size`: `tiny`, `small`, `medium`, `large`, `huge`, or `gargantuan`.
- `armorClass`: integer AC.
- `maxHp`: integer maximum HP.
- `speed`: feet per turn.
- `abilities`: all six ability scores: `str`, `dex`, `con`, `int`, `wis`, `cha`.

Optional definition fields include `id`, `source`, `type`, `proficiencyBonus`, `tokenVisuals`, `character`, `saves`, `damageAdjustments`, `weapons`, `spells`, `features`, `traits`, `actions`, `bonusActions`, and `reactions`.

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

### IDs

IDs are optional for hand-authored JSON in most places. The importer generates missing IDs for:

- Creature definitions.
- Actions, bonus actions, and reactions.
- Weapons.
- Spells.
- Features and traits.

Keep explicit IDs when another object references them. Multiattack is the main example.

### Combatant Instance Fields

The optional `combatant` object stores encounter-instance data:

- `displayName`: token name.
- `faction`: `party`, `enemy`, or `neutral`.
- `position`: `{ "x": 0, "y": 0 }`. Imports are placed in the next open cell, so this is mostly archival.
- `currentHp`: current HP.
- `tempHp`: temporary HP.
- `state`: `active`, `downed`, `dead`, `defeated`, or `fled`.
- `tacticsProfile`: `basic-melee` or `basic-ranged`.
- `resources`: optional counters such as spell slots or limited uses.
- `tokenVisuals`: optional per-token visual override.
- `conditions`: optional active conditions.
- `deathSaves`: optional player death-save state.

The importer ignores exported `id`, `definitionId`, `initiative`, `actionEconomy`, and `concentration` and recreates encounter-local state.

### Token Visuals

Definitions can set default token art, and combatant instances can override it.

```json
{
  "tokenVisuals": {
    "imageUrl": "data:image/png;base64,...",
    "scale": 1,
    "borderColor": "#ffffff",
    "showNameplate": true
  }
}
```

### Action Types

All executable actions should set `automationSupport` to `full`. Values of `partial`, `manual-only`, and `unsupported` are retained as reference data but skipped by automated combat.

#### Attack

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

#### Saving Throw Damage

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

#### Area Saving Throw Damage

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

#### Healing

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

#### Multiattack

Multiattack references child attack actions. If you omit action IDs, use `actionName` and place the referenced child action before the multiattack in the `actions` array.

```json
{
  "actions": [
    {
      "kind": "attack",
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
      "name": "Multiattack",
      "actionType": "action",
      "attacks": [
        { "actionName": "Claw", "count": 2 }
      ],
      "automationSupport": "full"
    }
  ]
}
```

Explicit IDs also work:

```json
{
  "kind": "multiattack",
  "name": "Multiattack",
  "actionType": "action",
  "attacks": [
    { "actionId": "claw", "count": 2 }
  ],
  "automationSupport": "full"
}
```

### Damage Components

Damage components support:

- `dice`: dice expression or static number, such as `1d8`, `2d6+3`, or `5`.
- `damageType`: `acid`, `bludgeoning`, `cold`, `fire`, `force`, `lightning`, `necrotic`, `piercing`, `poison`, `psychic`, `radiant`, `slashing`, or `thunder`.
- `abilityModifier`: optional ability added to damage.
- `bonusFormula`: optional numeric formula.

### Numeric Formulas

Numeric formulas let attacks, damage, saves, and features reference stats.

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
  "resources": { "slot-1": 2, "limited-use": 1 }
}
```

```json
{
  "resourceCost": { "resourceId": "slot-1", "amount": 1 }
}
```

The action is skipped if the combatant cannot pay the cost.

### Damage Adjustments

Use `damageAdjustments` for resistance, immunity, and vulnerability.

```json
{
  "damageAdjustments": [
    { "type": "resistance", "damageType": "fire" },
    { "type": "immunity", "damageType": "poison" },
    { "type": "vulnerability", "damageType": "radiant" }
  ]
}
```

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

Feature damage can use `"damageType": "same-as-attack"` for effects such as Rage. Use `damage-adjustment` for active or permanent resistances, immunities, and vulnerabilities, and `save-advantage` for effects such as Rage's Strength saving throw advantage.

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
