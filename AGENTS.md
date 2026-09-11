# D&D Battle Simulator

> **AI Agent Development Specification**
>
> **Purpose:** Build a map-aware D&D 5e encounter simulator for testing combat difficulty, positioning, terrain, tactics, spells, and encounter balance.

> **Primary Development Principle**
>
> Build the simulator as a deterministic rules engine with a visual battlemap layered on top. Combat state and rules must not depend on the UI. This allows automated simulations, manual playtesting, replay, testing, and future rules variants to use the same engine.

Target: local-first web application with persistent encounter projects and optional automated simulation.

# 1. Product Goal

Create a battle simulator that lets a Dungeon Master import or build a battlemap, place player characters and enemies, define walls and terrain, and run a complete D&D 5e combat encounter. The system must support both manual turn-by-turn playtesting and automated simulations so encounter tuning can account for actual geometry instead of relying only on CR or encounter-budget math.

## Core questions the application should answer

- Can this party defeat the encounter?
- How many rounds does the encounter usually last?
- How much HP and how many major resources does the party lose?
- Do map size, chokepoints, walls, cover, difficult terrain, and starting positions materially change the outcome?
- Are specific monsters or abilities disproportionately dangerous?
- Is an encounter too easy, too swingy, or likely to produce a character death or total party kill?
- How do results change if combatants use different tactical behavior?

> **Scope boundary**
>
> This is an encounter-testing tool, not a full virtual tabletop. Do not prioritize multiplayer networking, campaign management, chat, character-sheet automation, fog of war for players, dice cosmetics, or content marketplaces until the encounter simulator is complete.

# 2. Recommended Technical Direction

Use a web architecture that keeps rendering, rules, persistence, and external content adapters separate. The exact libraries may change during implementation, but the boundaries below should remain.

| **Layer**               | **Recommended approach**                                | **Responsibility**                                                           |
|-------------------------|---------------------------------------------------------|------------------------------------------------------------------------------|
| Frontend                | Next.js + TypeScript                                    | Application shell, editor panels, encounter setup, reports                   |
| Battlemap renderer      | PixiJS or Konva.js                                      | Pan/zoom, grid, tokens, walls, terrain overlays, templates, measurement      |
| State management        | Zustand                                                 | Transient editor and simulation UI state                                     |
| Rules/simulation engine | Framework-independent TypeScript package                | Initiative, movement, attacks, saves, damage, conditions, actions, turns, AI |
| Persistence             | Prisma + SQLite initially; PostgreSQL-compatible schema | Projects, maps, actors, encounters, custom abilities, saved runs             |
| External content        | Open5e V2 adapter                                       | Search/import creatures, spells, rules, and conditions                       |
| Testing                 | Vitest + deterministic RNG seeds                        | Unit tests, scenario tests, reproducible simulation results                  |

If the coding agent has a strong reason to substitute a library, it may do so only if it preserves the same module boundaries and supports deterministic automated testing.

# 3. Open5e Integration

Use Open5e API V2. V1 is deprecated. The current API supports global search, per-resource search, filtering, nested-field filtering, field inclusion/exclusion, ordering, and pagination. Imported content must be cached or copied into local normalized records so a saved encounter does not change unexpectedly if remote content changes later.

## Open5e requirements

- Create a dedicated `Open5eClient` or provider adapter. No UI component should call Open5e directly.
- Use V2 endpoints. Prefer explicit /v2 paths rather than relying on the unversioned default.
- Support creature search/import first, then spell import, then rules/conditions as useful reference data.
- Store the Open5e source document, key/slug, imported payload version, and import timestamp.
- Allow imported creatures and spells to be cloned into editable homebrew records.
- Do not assume every monster action or spell description can be converted automatically into executable combat logic.
- Separate descriptive source text from executable simulation definitions.

| **Content**     | **Example API use**                      | **Application behavior**                                                      |
|-----------------|------------------------------------------|-------------------------------------------------------------------------------|
| Creature search | /v2/creatures/?name\_\_icontains=...     | Show searchable monster browser and import selected creature                  |
| General search  | /v2/search/?query=...                    | Optional unified content search                                               |
| Source filter   | document\_\_key or nested source filters | Let DM select rules/source documents                                          |
| Field selection | fields=...                               | Request lightweight result lists, then fetch details as needed                |
| Spells          | V2 spell resource                        | Import descriptive spell data; map supported spells to executable definitions |

> **Important content rule**
>
> Open5e provides content from multiple source documents and game versions. Preserve source metadata and do not silently merge same-named creatures or spells. The UI should clearly show the selected source/version.

# 4. Primary User Workflow

1.  Create an Encounter Project.
2.  Upload a battlemap image.
3.  Calibrate the grid by entering grid size or matching two known grid points.
4.  Draw walls, doors, difficult terrain, hazards, elevation/terrain zones, and optional cover objects.
5.  Create or import player characters.
6.  Search Open5e and add enemy creatures; allow custom/homebrew actors.
7.  Place all combatants on the map and choose starting HP/resources.
8.  Configure encounter rules, party behavior, enemy behavior, and optional simulation assumptions.
9.  Run the encounter manually, automatically, or in batch simulation mode.
10. Review combat log, outcome, resource expenditure, damage, deaths/downed characters, and map/tactical findings.
11. Adjust positions, creatures, terrain, tactics, or stats and rerun.

# 5. Battlemap and Spatial System

The map is part of the simulation rules, not decoration. Movement, range, line of sight, cover, area effects, and pathfinding must use the same spatial model used by the renderer.

## Map configuration

- Upload PNG, JPG, or WebP battlemap images.
- Support square grids first. Hex grids are out of scope for MVP.
- Grid calibration: pixel size per grid square, grid offset X/Y, distance per square, and optional visible grid overlay.
- Default D&D scale: 5 feet per square, but make scale configurable.
- Pan, zoom, snap-to-grid, token drag, and measurement ruler.
- Token footprint sizes: Tiny, Small, Medium, Large, Huge, Gargantuan, plus custom footprint overrides.
- Store coordinates in world/grid units rather than raw screen pixels.

## Walls and doors

- Wall drawing tool using line segments or connected polylines.
- Walls block movement and line of sight by default.
- Wall properties should independently control movement blocking, sight blocking, and projectile blocking.
- Door objects can be open, closed, locked, or destroyed. Closed doors typically behave as walls until opened.
- Collision tests must account for actor footprint, not only token center points.

## Terrain and map zones

| **Zone type**     | **Required behavior**                                                     |
|-------------------|---------------------------------------------------------------------------|
| Normal terrain    | Standard movement cost                                                    |
| Difficult terrain | Costs additional movement according to selected rules                     |
| Impassable        | Cannot enter                                                              |
| Hazard            | Triggers configured effect when entered, started in, ended in, or crossed |
| Cover zone/object | Contributes half or three-quarters cover where supported                  |
| Elevation         | Stores elevation value and influences range/line of sight in later phases |
| Custom zone       | Named polygon with tags and programmable trigger hooks                    |

## Spatial calculations

- Distance measurement must be a configurable rules strategy. Start with standard grid counting and support optional 5-10-5 diagonals.
- Pathfinding must respect walls, closed doors, occupied spaces, footprint size, and difficult terrain costs.
- Line of sight and line of effect must be separate concepts in the engine.
- Area templates required: circle/radius, cone, line, cube/square, and sphere represented in 2D.
- Area effects must resolve which occupied grid cells/token footprints intersect the template.

# 6. `Combatant` and Data Model

Use normalized definition records plus encounter-instance records. A `CreatureDefinition` represents reusable stats. A `Combatant` represents one specific creature in one encounter with current HP, location, conditions, resources, and initiative.

| **Entity**                | **Key fields**                                                                                                                                                                                                                                 |
|---------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `CreatureDefinition`        | id, name, source, size, type, AC, max HP/default HP, speed modes, abilities, saves, skills, resistances, immunities, vulnerabilities, senses, traits, actions, bonus actions, reactions, legendary actions, spellcasting, proficiency metadata |
| PlayerCharacterDefinition | All core creature fields plus level, class metadata, spell slots/resources, death save rules, player tactics profile                                                                                                                           |
| `Combatant`Instance         | definitionId, encounterId, faction, x/y, elevation, currentHP, tempHP, initiative, movementRemaining, action economy, conditions, concentration, resource state, alive/downed/dead state                                                       |
| ActionDefinition          | name, action type, targeting rules, range/reach, attack/save/check configuration, damage/healing components, effect components, resource cost, recharge/cooldown, automation support level                                                     |
| SpellDefinition           | level, school, casting time, range, components metadata, duration, concentration, targeting shape, save/attack logic, damage/effect scaling, executable support metadata                                                                       |
| ConditionDefinition       | name, duration rules, modifiers/restrictions, save-at-end/start behavior, source, executable hooks                                                                                                                                             |
| Encounter                 | mapId, ruleProfile, combatants, round, turn index, seed, status, objectives, simulation settings                                                                                                                                               |
| SimulationRun             | encounter snapshot, seed, outcome, rounds, per-combatant metrics, combat log, warnings/errors                                                                                                                                                  |

# 7. Rules Engine Requirements

> **Architecture rule**
>
> All dice and combat resolution must be callable without rendering a map or mounting UI components. A headless test should be able to load an encounter JSON document and simulate it to completion.

## Dice and deterministic randomness

- Central `DiceService` supporting d4, d6, d8, d10, d12, d20, d100 and arbitrary dice expressions.
- Every simulation uses a seedable pseudo-random generator.
- Record raw dice rolls, modifiers, advantage/disadvantage state, and final result in the combat log.
- Allow manual roll override in manual simulation mode.
- Same encounter snapshot + same seed + same tactics profile must produce the same result.

## Turn structure

- Roll initiative and establish turn order. Support ties deterministically.
- Round start events.
- Turn start effects and saves.
- Movement, Action, Bonus Action, object/free interactions where modeled.
- Reactions can interrupt other turns through an event/trigger system.
- Turn end effects and saves.
- Round end events, recharge rolls, and next round.

## Attack resolution

- Attack rolls with modifiers, advantage/disadvantage, natural 1/20 handling, critical-hit strategy, target AC, and cover adjustment.
- Multiple damage components and damage types.
- Resistance, immunity, and vulnerability processing.
- Temporary HP before normal HP.
- Reach/range validation and ranged-attack disadvantage where configured.
- Multiattack represented as a composite action containing child actions or repeated attack steps.

## Saving throws and checks

- Ability saving throws against DC.
- Advantage/disadvantage and static bonuses.
- Damage/effect on success vs failure.
- Repeat saves at start/end of turn.
- Saving throws triggered by entering/remaining in terrain or spell zones.

## HP, downed states, and death

- Enemies default to defeated at 0 HP unless a rule profile states otherwise.
- Player characters should support unconscious at 0 HP, death saving throws, stabilization, healing from 0 HP, and optional simplified simulation mode.
- Track downed, stabilized, dead, removed-from-combat, and fled as distinct states.
- Encounter victory conditions must be configurable rather than always requiring every opponent to die.

# 8. Actions, Spells, and Effects

Do not implement executable abilities by parsing natural-language descriptions at runtime. Build a structured action/effect model. Imported Open5e text can be displayed, while executable behavior is authored or mapped into components.

## Action component model

| **Component**   | **Examples**                                                                                     |
|-----------------|--------------------------------------------------------------------------------------------------|
| Target selector | self, single creature, N creatures, point, area template, all creatures in zone                  |
| Requirement     | within range, line of sight, line of effect, target type, HP threshold, condition present/absent |
| Roll            | melee attack, ranged attack, spell attack, ability save, ability check, opposed check            |
| Outcome         | damage, healing, temp HP, apply/remove condition, forced movement, teleport, resource change     |
| Duration        | instant, until turn start/end, rounds, concentration, save ends, persistent zone                 |
| Resource        | spell slot, uses/day, recharge, ammunition, class resource, custom counter                       |
| Trigger         | action, bonus action, reaction, turn start/end, damaged, moved, enters zone, enemy leaves reach  |

## Spell support strategy

- Phase 1: attack-roll spells, saving-throw damage spells, simple healing, simple buffs/debuffs, and basic area damage.
- Phase 2: concentration, persistent areas, forced movement, ongoing damage, condition application, summons, and more reactions.
- Phase 3: complex spells that alter geometry, create objects, transform actors, or require high-level interpretation.
- Every spell has an automationSupport field: full, partial, manual-only, or unsupported.
- Manual mode must let the DM resolve unsupported effects while preserving the rest of the simulation state.

# 9. Conditions and Effect Engine

Use an event-driven modifier/effect system rather than hardcoding every condition into attack functions. Conditions may modify movement, attack rolls, incoming attacks, saves, AC, action availability, visibility, targeting, damage, or other rules.

- Effects need source, target, start time, duration, expiration rule, stacks/refresh behavior, and optional concentration owner.
- Support hooks such as beforeAttackRoll, afterAttackRoll, beforeSave, beforeDamage, afterDamage, movementCost, canAct, canMove, canReact, turnStart, and turnEnd.
- Avoid arbitrary eval/string execution. Use typed effect handlers or a constrained effect schema.
- Provide an effect inspector in the UI so the DM can understand why a roll or movement value was modified.

# 10. Automated `Combatant` AI

Automated simulations require tactical decision making, but the first version should use understandable heuristic scoring rather than machine learning. The goal is reproducibility and reasonable D&D behavior, not perfect play.

## Tactics profiles

| **Profile**       | **Behavior**                                                                                                |
|-------------------|-------------------------------------------------------------------------------------------------------------|
| Basic melee       | Move toward reachable hostile target; prefer nearest/highest target score; use strongest valid melee action |
| Basic ranged      | Maintain preferred range, seek line of sight, avoid melee where possible, use ranged action                 |
| Skirmisher        | Attack then reposition; values cover and safe movement                                                      |
| Controller/caster | Scores area effects, disabling conditions, concentration safety, and target clusters                        |
| Brute             | Prioritizes damage and vulnerable/downed targets according to configurable ruthlessness                     |
| Defender          | Protects designated allies, blocks chokepoints, values opportunity attacks                                  |
| Custom            | Weighted behavior parameters selected per creature or faction                                               |

## Resource stance

Independent of tactics profile, each combatant (and each faction in bulk, via the Combat panel) carries a `resourceStance` of `conservative`, `balanced`, or `liberal`. It scales the resource-cost penalty applied when scoring any action with a `resourceCost` (spell slots, per-encounter recharges): `conservative` leans hard on at-will options and only spends when the payoff clearly justifies it, `liberal` spends freely — good for a fight the DM knows is the boss — and `balanced` reproduces the default scoring. See `resourceStanceMultiplier()` in `engine/simulation.ts`.

## Decision scoring

- Generate legal candidate actions, targets, movement destinations, and action sequences.
- Score candidates using expected damage/effect, kill/down chance, target priority, resource cost (scaled by resource stance), risk, positioning, cover, concentration safety, friendly fire, and objective value.
- Select highest score, with optional small seeded variance so simulations do not always choose identical tactics.
- Keep scoring output in debug mode so a DM/developer can inspect why the AI made a choice.

> **Do not cheat**
>
> Automated combatants may only use information permitted by the simulation rules. Do not path around unseen walls or target hidden creatures merely because the engine knows their coordinates. MVP may assume perfect battlefield awareness if fog/stealth is explicitly disabled, but this assumption must be visible in the simulation settings.

# 11. Simulation Modes

| **Mode**         | **Purpose**                                         | **Required controls**                                                                             |
|------------------|-----------------------------------------------------|---------------------------------------------------------------------------------------------------|
| Manual           | DM directly playtests encounter                     | Advance turns, move tokens, choose actions/targets, roll or auto-roll dice, edit HP/effects, undo |
| Assisted         | DM controls one faction while AI controls the other | Same manual controls plus AI step/auto-turn                                                       |
| Single auto run  | Observe one complete automated battle               | Play, pause, step, speed, seed, full log, replay                                                  |
| Batch simulation | Evaluate encounter statistics                       | Run N seeds headlessly, aggregate outcomes, no animation required                                 |
| Replay           | Inspect a prior run                                 | Scrub events/turns and reconstruct combat state from event log or snapshots                       |

# 12. Encounter Results and Tuning Report

The result screen should emphasize encounter tuning rather than simply showing win/loss.

- Party win rate and enemy win rate.
- Total-party-kill rate and character death rate.
- Average, median, minimum, maximum, and percentile encounter length in rounds.
- Remaining HP by combatant and faction.
- Number of times each PC was reduced to 0 HP.
- Damage dealt, damage taken, healing, misses, saves passed/failed, critical hits.
- Spell slots and limited-use resources spent.
- Per-creature contribution: damage, control effects, kills/downed targets, survival rounds.
- First-round burst damage and round-by-round damage curves.
- Outcome variance across seeds to identify swingy encounters.
- Optional map heatmaps: movement paths, death/down locations, commonly occupied squares, area spell placement.
- Warnings when unsupported/manual-only abilities were omitted from automated runs.

## Difficulty labels

Do not present a single hard-coded CR-derived label as truth. Allow a configurable heuristic that combines win rate, deaths/downed PCs, remaining resources, encounter duration, and variance. Always show the raw measurements behind any Easy/Moderate/Hard/Deadly-style summary.

# 13. User Interface Requirements

## Encounter editor layout

- Center: battlemap canvas.
- Left panel: project/map tools, walls, terrain, measurement, selection layers.
- Right panel: selected token/terrain/action properties.
- Bottom or collapsible panel: initiative tracker and combat log.
- Top toolbar: encounter setup, add combatant, run controls, simulation mode, undo/redo, save.

## `Combatant` editor

- Search/import Open5e creature.
- Edit core stats without modifying the original imported definition unless cloning to homebrew.
- Build actions with a form-based structured editor.
- Add spell list/resources and map supported spells to executable definitions.
- Assign faction and tactics profile.
- Duplicate creatures for multiple instances and auto-number display names if desired.

## Wall/terrain editor

- Layer visibility and lock controls.
- Draw, select, move, split, delete wall segments.
- Polygon terrain painter with type and movement/effect settings.
- Visual indication of blocking walls and difficult/impassable terrain.
- Test-path and test-line-of-sight debug tools.

# 14. Persistence, Snapshots, Undo, and Event Log

- Autosave encounter projects locally/database-backed.
- Encounter setup should serialize to a versioned JSON-compatible schema.
- Simulation start creates an immutable encounter snapshot.
- Combat changes should emit structured events such as TurnStarted, `Combatant`Moved, AttackRolled, SaveRolled, DamageApplied, ConditionApplied, ResourceSpent, `Combatant`Downed, and CombatEnded.
- Use events for logs and replays; periodic state snapshots may be stored for faster replay.
- Manual mode requires undo/redo for editor actions and preferably combat events before committing subsequent dependent actions.
- Schema versions and migrations are required so saved projects survive engine evolution.

# 15. Testing and Validation Requirements

The rules engine must have comprehensive automated tests before large amounts of UI polish are added.

## Minimum test categories

- Dice parsing and seeded determinism.
- Initiative ordering and ties.
- Attack hit/miss/critical behavior.
- Advantage/disadvantage.
- Saving throws and success/failure outcomes.
- Damage resistance/immunity/vulnerability and temp HP.
- Movement distance and difficult terrain.
- Wall collision and pathfinding around obstacles.
- Line-of-sight/line-of-effect blocking.
- Area template intersection.
- Conditions expiring at correct turn/round boundaries.
- Concentration loss checks once supported.
- Death saves and healing from 0 HP.
- AI never selects illegal actions or destinations.
- A saved seeded scenario produces an expected event sequence/outcome.

> **Regression fixtures**
>
> Create several small encounter fixtures with known maps and actors. Preserve these fixtures as regression tests whenever movement, targeting, or combat resolution code changes.

# 16. Phased Implementation Plan

| **Phase**                           | **Deliverable**                                                                                                                              |
|-------------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------|
| Phase 0 - Foundation                | Repository setup, Next.js shell, TypeScript domain package, Prisma schema, seeded RNG, versioned encounter schema, unit-test infrastructure. |
| Phase 1 - Map Editor                | Upload map, square-grid calibration, pan/zoom, tokens, walls, movement blocking, terrain polygons, ruler, save/load.                         |
| Phase 2 - Basic Combat              | `Combatant`s, initiative, movement, melee/ranged attacks, saves, damage, HP, basic action economy, combat log, manual battle to victory.       |
| Phase 3 - Open5e Import             | V2 creature browser/import, normalized local creature definitions, source metadata, editable clone/homebrew flow.                            |
| Phase 4 - Automated Basic Combat    | Tactics profiles for basic melee/ranged actors, pathfinding, legal action generation, single seeded auto battle.                             |
| Phase 5 - Batch Simulator & Reports | Headless N-run execution, aggregate metrics, win/death/down rates, round/resource/damage reports.                                            |
| Phase 6 - Spells & Conditions       | Structured effects, spell attacks/saves, areas, healing, buffs/debuffs, conditions, concentration, limited resources.                        |
| Phase 7 - Advanced Map Rules        | Cover, doors, hazards/triggers, opportunity attacks, forced movement, elevation improvements, persistent areas.                              |
| Phase 8 - Tactical AI & Replay      | Controller/caster AI, objective scoring, reactions, detailed replay, AI decision inspector, heatmaps.                                        |
| Phase 9 - Expansion                 | Additional rules profiles, import/export, encounter templates, optional cloud sync/multidevice features.                                     |

# 17. MVP Definition of Done

The MVP is complete when all of the following can be demonstrated in one saved encounter:

- A user uploads a gridded or gridless battlemap and calibrates a square grid.
- The user draws at least one blocking wall and one difficult-terrain region.
- The user imports an Open5e V2 creature and places multiple enemy instances.
- The user creates at least four custom player characters with AC, HP, speed, saves, and attack actions.
- Initiative is rolled and combat proceeds using map-aware movement and range.
- Attack rolls, saving throws, damage, resistances, HP, and defeat states work.
- The user can manually run the battle to completion.
- Basic melee/ranged AI can run the same encounter automatically to completion.
- The user can run at least 100 headless simulations with different seeds.
- The report shows win rate, rounds, HP remaining, downed/dead PCs, damage, and basic variance.
- Every run is reproducible by rerunning the same snapshot and seed.
- Automated tests cover core combat and geometry logic.

# 18. Explicit Non-Goals for Initial Development

- Real-time multiplayer VTT gameplay.
- Full character builder covering every class/subclass/feat/item interaction.
- Automatic natural-language interpretation of every published monster or spell ability.
- 3D maps or physics.
- Hex grids.
- Dynamic lighting/fog-of-war comparable to mature VTTs.
- Voice/video/chat.
- Campaign/world management.
- Perfect tactical AI.
- Rules content that the chosen legal/source data does not permit the application to distribute.

# 19. Instructions to the AI Coding Agent

> **Agent directive**
>
> Treat this document as the product specification. Implement incrementally. Do not skip directly to complex spell automation or tactical AI before the deterministic combat engine, spatial system, and automated tests are stable.

- Before each phase, inspect the existing codebase and write a concise implementation plan tied to the phase acceptance criteria.
- Keep the rules engine framework-independent and free from browser APIs.
- Never duplicate combat resolution logic in UI components or AI code. Both must call the same engine commands.
- Use TypeScript types/schemas for all domain data and validate persisted/imported external data at boundaries.
- Use seeded randomness exclusively inside simulation logic. Avoid `Math.random()` in the rules engine.
- Prefer explicit structured definitions over parsing descriptive text.
- When an ability cannot be simulated reliably, mark it partial/manual-only rather than inventing behavior.
- Add or update tests with every rules or geometry feature.
- Preserve backward compatibility of saved encounter schemas through versioning/migrations.
- Optimize batch simulations by bypassing animation/rendering entirely.
- Log enough structured information to explain every roll, modifier, movement decision, damage calculation, and AI choice.
- Do not let imported remote data overwrite a saved encounter snapshot.
- Keep UI tools usable with six or more player characters and many enemies; avoid workflows requiring repeated modal dialogs for each token.

# 20. Acceptance Scenarios

| **Scenario**            | **Expected behavior**                                                                                            |
|-------------------------|------------------------------------------------------------------------------------------------------------------|
| Wall blocks melee path  | A creature cannot move through the wall; pathfinder routes around it if a legal route exists.                    |
| Wall blocks targeting   | A ranged/spell target on the opposite side cannot be selected when line of effect is required.                   |
| Difficult terrain       | A route through difficult terrain consumes more movement and may cause AI to choose a longer but cheaper path.   |
| Large creature corridor | A Large token cannot pass through a one-square corridor if its footprint cannot legally fit.                     |
| Area spell              | Template identifies intersecting targets, rolls each required save, then applies correct success/failure damage. |
| Downed PC               | PC reaches 0 HP, becomes unconscious/downed, makes death saves on turns, and can return after healing.           |
| Seed replay             | The same encounter snapshot and seed reproduces rolls, AI choices, and final outcome.                            |
| Batch run               | 100+ simulations run without rendering the animated map and produce aggregate statistics.                        |
| Unsupported ability     | Automation warns that the ability is unsupported and does not silently approximate it.                           |
| Open5e duplicate name   | Two same-named entries from different source documents remain distinguishable and import with source metadata.   |

# 21. Future Enhancements

- Stealth, hidden creatures, perception, and imperfect AI information.
- Opportunity attacks and sophisticated reactions.
- Cover ray-casting and corner rules.
- Lair actions, legendary actions, mythic/multi-phase encounters.
- Summons and dynamically spawned creatures.
- Interactive objects, destructible terrain, traps, and environmental initiative.
- Multiple encounter objectives: escape, survive N rounds, protect NPC, capture point, stop ritual.
- Automatic encounter variants and parameter sweeps (enemy count, HP multiplier, starting positions).
- Monte Carlo comparison dashboard between encounter versions.
- Import/export encounter JSON and shareable encounter packages containing map assets.
- Custom rule profiles for 2014/2024 or other compatible 5e variants.
- Optional LLM-assisted ability authoring that converts descriptive text into a proposed structured action schema for human review, never silently executing unreviewed interpretations.

# 22. External API Notes

Open5e should be treated as an external content provider, not as the application rules engine. As of this specification, Open5e documents V2 as the current API and V1 as deprecated. V2 provides search, resource filtering, field selection/exclusion, ordering, and pagination. The API/site also exposes monsters/creatures, spells, rules, and conditions from multiple source documents. Build the provider adapter so future API changes can be isolated from the rest of the application.

Reference: [Open5e API Documentation](https://open5e.com/api-docs)

# Final success criterion

> **The tool is successful when...**
>
> a Dungeon Master can change the map, starting positions, monster roster, creature stats, spells/effects, or tactics and receive reproducible evidence showing how those changes affect the encounter on the actual battlefield.

