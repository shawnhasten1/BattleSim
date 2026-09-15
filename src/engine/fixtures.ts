import type { EncounterSnapshot } from "./types";
import { DEFAULT_GRID_VISUALS, DEFAULT_MAP_IMAGE_SETTINGS, ENCOUNTER_SCHEMA_VERSION } from "./types";

export const sampleEncounter: EncounterSnapshot = {
  schemaVersion: ENCOUNTER_SCHEMA_VERSION,
  id: "enc-sample",
  name: "Hallway Ambush",
  seed: "battle-sim-sample",
  round: 0,
  turnIndex: 0,
  rules: {
    playerDeathSaves: true,
    enemiesDropAtZero: true,
    requireLineOfEffect: true,
    cover: true
  },
  map: {
    id: "map-sample",
    name: "Training Hall",
    grid: {
      width: 12,
      height: 8,
      distancePerSquare: 5,
      diagonalMode: "standard",
      ...DEFAULT_GRID_VISUALS
    },
    image: { ...DEFAULT_MAP_IMAGE_SETTINGS },
    canvas: {
      widthPx: 12 * DEFAULT_GRID_VISUALS.squareSizePx,
      heightPx: 8 * DEFAULT_GRID_VISUALS.squareSizePx
    },
    walls: [
      {
        id: "wall-center",
        start: { x: 5, y: 1 },
        end: { x: 5, y: 5 },
        blocksMovement: true,
        blocksSight: true,
        blocksProjectiles: true,
        cover: "total"
      }
    ],
    terrain: [
      {
        id: "terrain-rubble",
        name: "Rubble",
        type: "difficult",
        movementMultiplier: 2,
        polygon: [
          { x: 2, y: 4 },
          { x: 5, y: 4 },
          { x: 5, y: 7 },
          { x: 2, y: 7 }
        ]
      }
    ]
  },
  definitions: [
    {
      id: "def-fighter",
      name: "Test Fighter",
      source: { provider: "homebrew" },
      size: "medium",
      type: "humanoid",
      armorClass: 16,
      maxHp: 32,
      speed: 30,
      abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
      resources: { "second-wind": 1, "action-surge": 1 },
      features: [
        {
          id: "second-wind-feature",
          name: "Second Wind",
          category: "feature",
          automationSupport: "full",
          description: "Once per short rest: a bonus action to regain 1d10 + your level hit points.",
          grantedActions: [
            {
              kind: "healing",
              id: "second-wind",
              name: "Second Wind",
              actionType: "bonus",
              range: 0,
              healing: [{ dice: "1d10+5" }],
              targeting: { target: "self" },
              resourceCost: { resourceId: "second-wind", amount: 1 },
              automationSupport: "full"
            }
          ]
        },
        {
          id: "action-surge-feature",
          name: "Action Surge",
          category: "feature",
          automationSupport: "full",
          description: "Once per short rest: take one additional action on your turn.",
          effects: [{ kind: "extra-action", slot: "action" }],
          grantedActions: [
            {
              kind: "activate-feature",
              id: "action-surge-activate",
              name: "Action Surge",
              actionType: "free",
              featureId: "action-surge-feature",
              resourceCost: { resourceId: "action-surge", amount: 1 },
              automationSupport: "full"
            }
          ]
        }
      ],
      actions: [
        {
          kind: "attack",
          id: "longsword",
          name: "Longsword",
          actionType: "action",
          attackType: "melee",
          ability: "str",
          attackBonus: 5,
          range: 5,
          reach: 5,
          damage: [{ dice: "1d8", damageType: "slashing", abilityModifier: "str" }],
          automationSupport: "full"
        }
      ]
    },
    {
      id: "def-archer",
      name: "Test Archer",
      source: { provider: "homebrew" },
      size: "medium",
      type: "humanoid",
      armorClass: 14,
      maxHp: 24,
      speed: 30,
      abilities: { str: 10, dex: 16, con: 12, int: 10, wis: 12, cha: 10 },
      actions: [
        {
          kind: "attack",
          id: "shortbow",
          name: "Shortbow",
          actionType: "action",
          attackType: "ranged",
          ability: "dex",
          attackBonus: 5,
          range: 80,
          longRange: 320,
          damage: [{ dice: "1d6", damageType: "piercing", abilityModifier: "dex" }],
          automationSupport: "full"
        }
      ]
    },
    {
      id: "def-goblin",
      name: "Imported Goblin Stand-in",
      source: {
        provider: "open5e",
        documentKey: "wotc-srd",
        documentName: "5e SRD",
        slug: "goblin",
        importedAt: "2026-09-06T00:00:00.000Z"
      },
      size: "small",
      type: "humanoid",
      armorClass: 15,
      maxHp: 7,
      speed: 30,
      abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
      traits: [
        {
          id: "nimble-escape",
          name: "Nimble Escape",
          category: "trait",
          automationSupport: "full",
          description: "You can take the Disengage or Hide action as a bonus action on each of your turns.",
          grantedActions: [
            { kind: "utility", id: "nimble-escape-disengage", name: "Nimble Escape: Disengage", actionType: "bonus", mode: "disengage", automationSupport: "full" },
            { kind: "utility", id: "nimble-escape-hide", name: "Nimble Escape: Hide", actionType: "bonus", mode: "hide", automationSupport: "partial" }
          ]
        }
      ],
      actions: [
        {
          kind: "attack",
          id: "scimitar",
          name: "Scimitar",
          actionType: "action",
          attackType: "melee",
          ability: "dex",
          attackBonus: 4,
          range: 5,
          reach: 5,
          damage: [{ dice: "1d6", damageType: "slashing", abilityModifier: "dex" }],
          automationSupport: "full"
        },
        {
          kind: "attack",
          id: "shortbow",
          name: "Shortbow",
          actionType: "action",
          attackType: "ranged",
          ability: "dex",
          attackBonus: 4,
          range: 80,
          longRange: 320,
          damage: [{ dice: "1d6", damageType: "piercing", abilityModifier: "dex" }],
          automationSupport: "full"
        }
      ]
    }
  ],
  combatants: [
    {
      id: "pc-fighter",
      definitionId: "def-fighter",
      displayName: "Fighter",
      faction: "party",
      position: { x: 1, y: 1 },
      currentHp: 32,
      tempHp: 0,
      state: "active",
      tacticsProfile: "basic-melee",
      resourceStance: "balanced",
      resources: { "second-wind": 1, "action-surge": 1 }
    },
    {
      id: "pc-archer",
      definitionId: "def-archer",
      displayName: "Archer",
      faction: "party",
      position: { x: 1, y: 3 },
      currentHp: 24,
      tempHp: 0,
      state: "active",
      tacticsProfile: "basic-ranged",
      resourceStance: "balanced"
    },
    {
      id: "enemy-goblin-1",
      definitionId: "def-goblin",
      displayName: "Goblin 1",
      faction: "enemy",
      position: { x: 8, y: 2 },
      currentHp: 7,
      tempHp: 0,
      state: "active",
      tacticsProfile: "basic-ranged",
      resourceStance: "balanced"
    },
    {
      id: "enemy-goblin-2",
      definitionId: "def-goblin",
      displayName: "Goblin 2",
      faction: "enemy",
      position: { x: 8, y: 5 },
      currentHp: 7,
      tempHp: 0,
      state: "active",
      tacticsProfile: "basic-melee",
      resourceStance: "balanced"
    }
  ]
};
