# Foundry-Style Simulator Overhaul Plan

This document is the working implementation plan for reshaping the battle simulator into a FoundryVTT-style local encounter lab. The goal is to borrow Foundry's fast scene, tool, directory, drag-and-drop, and sheet workflows while keeping this project focused on deterministic simulation rather than hosted tabletop play.

## Product Direction

The application should feel scene-first:

- The battlemap canvas takes up the full screen.
- Left-side icon tools control scene interaction modes.
- Right-side tabs work like directories and inspectors.
- Actors, items, spells, features, and encounters can be dragged into the scene or onto sheets.
- Combat setup, simulation, reports, and replay remain the main reason the app exists.

Do not turn this into a multiplayer VTT. Avoid chat, campaigns, player permissions, voice/video, marketplace content, and hosting workflows unless they directly improve encounter simulation.

## Non-Negotiable Architecture Rules

- Keep `src/engine` framework-independent and free of browser APIs.
- UI, drag-and-drop, and canvas tools must call engine/store commands rather than duplicate rules.
- Store token and map coordinates in world/grid units, not raw screen pixels.
- Imported SRD/Open5e content must preserve source metadata and must not overwrite saved encounter snapshots.
- Natural-language SRD text is reference data. Executable simulation behavior must be structured.
- Batch simulation must remain headless and must not depend on the canvas renderer.

## Current Starting Point

The repo already has a useful foundation:

- `app/page.tsx`: current monolithic editor UI.
- `app/globals.css`: current panel and map styling.
- `src/store/encounter-store.ts`: Zustand store actions for maps, combatants, projects, definitions, and simulation.
- `src/engine`: deterministic dice, combat, geometry, pathfinding, areas, AI, and batch runs.
- `src/adapters/open5e-client.ts`: Open5e V2 client.
- `src/adapters/open5e-normalize.ts`: Open5e creature and spell normalization.
- `prisma/schema.prisma`: projects, maps, encounters, definitions, and simulation runs.

The overhaul should preserve the engine and migrate the UI into smaller scene/canvas/sidebar components.

## Implementation Status

- Phase 1 - Foundry-Style Application Shell: implemented.
- Phase 2 - Real Pan And Zoom Scene Canvas: implemented with DOM/SVG rendering and viewport transforms.
- Phase 3 - Encounter And Scene Directory: implemented.
- Phase 4 - Actor Directory And Token Images: implemented.
- Phase 5 - SRD / Open5e Compendium Browser: implemented.
- Phase 6 - Foundry-Like Sheets: implemented.
- The `UI_OVERHAUL_PLAN.md` shell rebuild (2024/25) re-implemented Phases 1-6 as
  ~40 focused components + 6 hooks; `page.tsx` 2756 -> 162 lines. That rebuild
  also delivered most of Phase 7 as a side effect (measure/sight/template/path
  tools, wall+terrain inspectors). See each phase below for the delta.
- Phase 7 - Simulation-Focused Scene Tools: ~85% done; remaining = terrain
  polygon vertex editing + free template rotation.
- Phase 8 - Reports, Replay, Playback, AI Inspector: **8a-8c implemented.**
  8a: round-count histogram + surfaced batch warnings + per-combatant resource
  spend in the Batch report. 8b: `src/lib/replay.ts` pure forward-replay reducer
  (`replayTo`), store `replayBase`/`replayIndex`/`replaySpeed`, `useDisplayEncounter`
  + `useReplayPlayback` hooks, `ReplayBar` transport (scrubber / ⏮◀▶▶⏭ / 0.5-4x /
  click-to-scrub log), REPLAY canvas banner, `--token-move-ms` token tween.
  `runAuto` now drops into replay over the pre-run board instead of committing
  the final snapshot (tuning-tool behaviour: the setup stays editable). 8c: the
  `AiDecisionCard` (chosen action + score + expected damage / distance / range +
  reason strings) shows beside the scrubber when parked on an `AiDecision`.
  8d (heatmap overlays) deferred - still a stretch item.
- Phase 9 - Encounter Variants: not started.

### Scope decisions for 7-9 (locked)

- **Batch-tuning tool, not a VTT.** No manual/assisted turn-by-turn play. Step,
  Auto Run, and Batch stay the only drivers. (Drops the "action buttons for
  selected token" / "manual controls" items from Phase 8.)
- **AI inspector = chosen action + its score + reason strings**, which the
  `AiDecision` events already carry. No `simulation.ts` change. Full
  candidate-ranking is a later opt-in.
- **Variant comparison is session-only first** — hold N batch results in memory,
  name them, diff any two. DB persistence (`SimulationRun` model exists) is a
  follow-up once the workflow proves out.
- **Replay = forward-replay the event log as a reducer** over the initial
  snapshot (the log already carries move destinations and damage amounts). No
  re-running the sim to reconstruct intermediate state.

## Phase 1 - Foundry-Style Application Shell

### Goal

Replace the current form-heavy layout with a scene-first shell.

### Tasks

- Split `app/page.tsx` into focused components.
- Add a full-screen application shell.
- Add a slim left vertical tool rail.
- Add a right sidebar with tabbed directories.
- Add a compact top toolbar for save, undo, redo, run controls, mode, and seed.
- Keep initiative and combat log in a bottom collapsible panel.
- Move existing controls into the new regions without changing engine behavior.

### Left Tool Rail

Initial tools:

- Select
- Move token
- Measure
- Wall drawing
- Terrain drawing
- Area template
- Delete / clear selection

### Right Sidebar Tabs

Initial tabs:

- Encounters
- Actors
- SRD / Compendium
- Combat
- Reports
- Settings

### Acceptance Criteria

- The canvas is the primary visual surface.
- Tool selection is icon-first on the left side.
- Right-side content changes by tab instead of one long inspector.
- Existing create/import/edit/save/run functionality remains reachable.

## Phase 2 - Real Pan And Zoom Scene Canvas

### Goal

Make the battlemap behave like a large scene surface rather than a centered scroll box.

### Tasks

- Add viewport state: `zoom`, `panX`, `panY`.
- Add wheel zoom centered on cursor.
- Add middle mouse or space-drag panning.
- Add grid-aware pointer coordinate conversion.
- Render map image, grid, walls, terrain, templates, and tokens in world coordinates.
- Ensure token selection, wall drawing, and movement still use engine grid coordinates.
- Keep map image offset/scale/opacity independent from viewport zoom.

### Renderer Direction

Use PixiJS if the DOM/SVG canvas starts fighting pan/zoom, layering, or token counts. The engine must not know whether rendering uses DOM, SVG, canvas, PixiJS, or Konva.

### Acceptance Criteria

- The canvas can be panned and zoomed smoothly.
- Clicks and drops resolve to correct grid cells at any zoom.
- Walls, terrain, path previews, line-of-effect previews, and tokens stay aligned.
- Automated and batch simulation still work without rendering.

## Phase 3 - Encounter And Scene Directory

### Goal

Make saved encounters feel like Foundry scenes or encounter documents.

### Tasks

- Build the Encounters tab as a real directory.
- Create encounter.
- Rename encounter.
- Duplicate encounter.
- Delete encounter.
- Load encounter into the active scene.
- Add scene configuration modal.
- Move grid and background-image settings into scene configuration.
- Store map image metadata and decide the persistence strategy for actual image data.

### Scene Configuration Modal

Fields:

- Encounter name
- Map name
- Background image upload
- Grid width and height in squares
- Square size in pixels
- Distance per square
- Diagonal mode
- Grid line color, opacity, and width
- Map image offset X/Y
- Map image scale
- Map image opacity
- Canvas width and height

### Acceptance Criteria

- A user can manage encounters from the right sidebar.
- Grid calibration and background image assignment happen in a modal.
- Loading an encounter restores map, grid, walls, terrain, tokens, and combat setup.

## Phase 4 - Actor Directory And Token Images

### Goal

Support Foundry-like actor directories and custom token artwork.

### Data Model Additions

Add token image metadata without affecting engine rules:

- Definition-level default token image.
- Definition-level portrait image if useful.
- Combatant-level token image override.
- Token display options such as scale, tint, border color, and label visibility if needed.

Candidate TypeScript fields:

```ts
interface TokenVisuals {
  imageUrl?: string;
  portraitUrl?: string;
  scale?: number;
  tint?: string;
  borderColor?: string;
  showNameplate?: boolean;
}
```

### Tasks

- Add token visual fields to schemas with backward-compatible defaults.
- Add token image upload to actor/token sheets.
- Render token images on the canvas.
- Fall back to colored initials when no token image exists.
- Build Actors tab showing saved/imported definitions.
- Drag actor from sidebar onto canvas to create a combatant at the drop cell.
- Support duplicate token instances without mutating the base actor.

### Acceptance Criteria

- A user can assign custom token images.
- Actor cards show token thumbnails.
- Dragging an actor onto the map creates a placed token.
- Token visuals do not affect simulation determinism.

## Phase 5 - SRD / Open5e Compendium Browser

### Goal

Make D&D 5e SRD content searchable and draggable like a compendium.

### Tasks

- Turn Open5e creature and spell search into a Compendium tab.
- Add sub-tabs for Creatures, Spells, Items/Weapons, Features, and Conditions.
- Keep source document/version visible on every result.
- Support drag creature to canvas.
- Support drag spell, weapon, feature, or trait onto an actor/token sheet.
- Open a mapping modal when dragged content needs executable behavior.
- Store unsupported content as manual-only reference data.

### Drag Behaviors

- Creature dragged to canvas: import definition and place token.
- Creature dragged to Actors tab: import as reusable actor only.
- Spell dragged to actor sheet: attach spell as reference or mapped action.
- Weapon dragged to actor sheet: create structured attack if fields are known.
- Feature dragged to actor sheet: add manual-only feature or mapped structured effect.
- Condition dragged to token: apply condition if supported.

### Acceptance Criteria

- Search results are draggable.
- Drag targets are visually clear.
- Dragging content never silently invents unsupported automation.
- Same-named content from different sources remains distinguishable.

## Phase 6 - Foundry-Like Sheets

### Goal

Replace the large edit modal with persistent sheets for actors, tokens, items, spells, and features.

### Actor Sheet Tabs

- Summary
- Stats
- Actions
- Inventory / Weapons
- Spells
- Features / Traits
- Resources
- Automation
- Tactics

### Token Sheet Tabs

- Token visual
- Encounter state
- HP and resources
- Conditions
- Position and size
- AI tactics override

### Item / Spell / Feature Sheet

Each sheet should show:

- Name
- Source metadata
- Descriptive source text
- Automation support status
- Structured executable mapping where supported
- Resource cost or usage limits

### Acceptance Criteria

- Editing a token instance is distinct from editing the reusable actor definition.
- Dragged SRD content can be inspected and mapped after import.
- Automation support status is obvious before manual or batch simulation.

## Phase 7 - Simulation-Focused Scene Tools

### Already done (by the shell rebuild)

- Measurement ruler + movement-cost preview (`Measure` tool -> `measuredPath`,
  "N ft direct / N ft path" readout in `ScenePanel`).
- Path preview respecting walls / terrain / occupancy / footprint (`previewPath`
  + `measuredPath` via `findPath`).
- Line-of-sight / line-of-effect test tool (`Sight` tool, `sightResult`, the
  `sight-layer` overlay).
- Area templates for cone / circle / line / square: place, drag, edit size /
  width / origin / colour, live "affected tokens" list (`ContextInspector`).
- Wall inspector: blocks movement / sight / projectiles, door state select +
  toggle, node X/Y edit, canvas node drag, layers list (`ContextInspector`).
- Terrain inspector: name, type, movement multiplier (`ContextInspector`).

### Remaining

1. **Terrain polygon editing** — the terrain tool creates a fixed rectangular
   zone; there is no way to move, add, or remove vertices. Add drag handles on
   each polygon point (mirror the wall-node interaction in `useSceneInteraction`
   / `SceneOverlays`) and an "add point on edge" affordance. Store: extend
   `updateTerrain` or add `moveTerrainVertex` / `addTerrainVertex` /
   `deleteTerrainVertex`.
2. **Free template rotation** — `AreaTemplate.direction` is N/E/S/W only. Add a
   numeric-degrees field to the template inspector and (nice-to-have) an
   on-canvas rotate handle. Cone/line geometry in `src/engine/areas.ts` would
   need to accept an angle instead of a compass direction — an engine change,
   so gate it behind a decision if `areas.ts` churn is unwanted; the 4-way
   version is functional.

### Acceptance

- A drawn terrain zone can be reshaped, not just retyped or deleted.
- Templates can point any direction (or explicitly stay 4-way if `areas.ts` is
  left alone).

## Phase 8 - Reports, Replay, Playback, And AI Inspector

### Goal

Turn the simulator's raw output into something you can *watch and inspect*: run
the sim instantly as today, then play the result back on the board at a
human-watchable pace, pausing to see what each actor decided. **No manual play**
— Step / Auto Run / Batch stay the only drivers; playback is post-hoc, so it
scrubs both directions and replays freely.

### Implemented (8a-8c)

What landed vs. the design below:

- **`src/lib/replay.ts`** — `replayTo(base, log, index)` pure reducer + helpers
  `clampReplayIndex`, `dwellForEvent`, `describeEvent`. Events carry
  *post-mutation absolute* values, so the reducer writes them directly:
  `InitiativeRolled` (re-order per `data.order` + set `initiative`),
  `CombatantMoved` (`data.destination`), `DamageApplied`
  (`data.currentHp`/`data.tempHp`), `HealingApplied` (+ mirrors the engine's
  revive-on-heal), `ConditionApplied`/`ConditionExpired` (by `condition.id`),
  `CombatantDowned`/`Defeated`/`Died`/`Stabilized`, `DeathSaveRolled`
  (`data.deathSaves` + `data.state`), `FeatureEffectApplied` (resource regen,
  absolute `data.next`), `ActionDeclared.resourceCost` (the one delta — floored,
  cosmetic). Round/turn come from every event's stamp. `tests/replay.test.ts`
  (8 cases) incl. full-log fidelity vs. `runAutomatedEncounter().snapshot`.
- **Store** — `replayBase: EncounterSnapshot | null`, `replayIndex: number | null`,
  `replaySpeed: number`; actions `setReplayIndex` / `setReplaySpeed` /
  `exitReplay`. NOT persisted (`partialize` untouched). Any edit path
  (`commitEncounter`, undo/redo, project/scene load) clears replay so a stale
  base can't render. The playback *timer* lives in `useReplayPlayback`, not the
  store.
- **`runAuto` changed** — it no longer `commitEncounter`s the final snapshot.
  It keeps the pre-run board as `replayBase`, sets `replayIndex: 0`, forces
  `tool: "select"`, and still POSTs to `/api/simulation-runs`. Exiting replay
  leaves the original setup intact to tweak and re-run (tuning-tool behaviour).
- **Hooks** — `useDisplayEncounter()` (replay-folded snapshot for the scene +
  Combat panel readouts only; every editing surface still reads
  `state.encounter`), `useIsReplaying()`, `useReplayCursorEvent()`,
  `useReplayPlayback()` (play/pause + per-event-type dwell ÷ speed, auto-plays
  when a run enters replay at 0, pauses at end, persists speed via
  `battlesim:replay-speed`).
- **`ReplayBar`** (`src/components/combat/`) — replaces the flat `<details>` log
  while replaying: header + `N / M` counter + Exit, "now showing" line, range
  scrubber, ⏮ ◀ ▶(play/pause) ▶ ⏭ transport, 0.5/1/2/4x, `AiDecisionCard` when
  parked on an `AiDecision`, and a click-to-scrub event log. The old JSON log
  `<details>` stays in `CombatPanel` for non-replay (Step-mode) runs.
- **`AiDecisionCard`** — `event.message` headline, actor -> target chips, stat
  tiles (score / expected dmg / distance / in-range / OA risk, whichever the
  payload has), `reasons[]` bullets. Pure read-out of `AiDecision.data`.
- **Canvas** — `SceneCanvas` renders `useDisplayEncounter()` combatants (map
  metrics still off the live encounter), shows a "▶ Replay" banner + accent
  outline, sets `--token-move-ms` (~90-900ms, faster at higher speed; `0ms`
  otherwise) consumed by a new `.token { transition: left/top var(--token-move-ms) }`
  rule, and drops all map pointer handlers. `SceneOverlays` takes a `replaying`
  prop that hides the editing gizmos (movement preview, target line,
  measure/sight, wall nodes) while keeping terrain/walls/templates.
- **8a** — `batch.ts`: `roundDistribution: RoundDistributionBin[]` (exact
  per-round counts, sorted) and `CombatantMetrics.resourceSpent` (avg of
  `ActionDeclared.resourceCost.amount`); `ActionDeclared` now carries
  `data.resourceCost`. `CombatPanel` renders the histogram strip + the
  `warnings` list + resource spend. `tests/batch.test.ts` (4 cases).
- **Deferred** — 8d heatmaps; full candidate ranking (needs `simulation.ts`);
  making the Context inspector follow the replay snapshot (kept on the live
  setup by design).

### 8a. Report polish (`CombatPanel` "Batch report" section)

- **Round-distribution histogram** — `batch.ts` already has min/max/median/p90;
  add bucketed counts (`rounds: number[]` -> `distribution: Record<bin, count>`)
  and render a small bar strip.
- **Surface `batchSummary.warnings`** — it exists on the summary and is not
  shown. List them under the metrics with a "manual review" flag.
- **Resource-usage aggregation** — `batch.ts` `aggregateCombatants` reads
  `DamageApplied` / `HealingApplied`; add a `resourceSpent` tally from a new or
  existing event and show per-combatant spend.
- Keep the existing win / TPK / death / rounds / HP / difficulty tiles.

### 8b. Replay scrubber + timed playback ("watch mode")

The core of the phase. Run the sim instantly (as today), then step through the
resulting `log` on the board — manually by scrubbing, or automatically at a set
pace.

**State reconstruction**

- **`src/lib/replay.ts`** — `replayTo(initialSnapshot, log, index): EncounterSnapshot`,
  a pure reducer that folds each event up to `index` forward from the starting
  snapshot: `InitiativeRolled` (initiative + turn order), `CombatantMoved`
  (position — check whether the engine emits `to` only or a `path`; straight
  positions are enough), `DamageApplied` (`targetId` + `totalApplied` -> hp,
  tempHp), `HealingApplied`, `ConditionApplied` / `ConditionExpired`,
  `CombatantDowned` / `Died` / `Defeated` / `Stabilized` (state), `TurnStarted`
  (round/turnIndex). Deterministic, no engine call.
- Unit-test: `replayTo(start, result.log, result.log.length)` deep-equals
  `runAutomatedEncounter(start).snapshot` for the sample encounter.

**Transport UI** (replaces the flat `<details>` log in `CombatPanel`)

- A scrubber row: range slider over `log`, ⏮ ◀ ⏯ ▶ ⏭ buttons, speed selector
  (0.5× / 1× / 2× / 4×), and the current event's message + type + "R{round}
  T{turn}".
- Playback: an interval (cleared on pause / unmount / index-reaches-end) that
  advances `replayIndex` one event per tick. **Per-type dwell** so it reads as
  action, not a slideshow: `AiDecision` ~900ms, `CombatantMoved` ~700ms,
  `AttackRolled` / `SaveRolled` / `DamageApplied` ~600ms, bookkeeping
  (`TurnStarted`, `ConcentrationChecked`, …) ~150ms — all divided by the speed
  multiplier. Or advance one *turn* per tick with the events inside it shown as
  a quick sequence; pick whichever feels right during 8b.
- "Run" (single Auto Run) can drop straight into playback at index 0 instead of
  showing the final board — a `watchOnRun` setting, default on.

**Canvas during replay**

- `SceneCanvas` reads `replaySnapshot ?? encounter` for tokens + conditions;
  everything else (map, walls, terrain) comes from the live encounter. A
  "REPLAY · event N / M" banner with an exit control; scene tools are disabled
  while replaying.
- **Token motion** — add `transition: left <dwell>ms ease, top <dwell>ms ease`
  to `.token` *only in replay mode* (a `data-replay` attribute on the stage, or
  a modifier class), so advancing past a `CombatantMoved` tweens the token to
  its new cell instead of teleporting. Near-free; keep it off during live
  editing so drags don't lag.
- Pulse/outline the acting combatant for the current event; when the event is an
  `AiDecision`, show the 8c card beside the scrubber.

**Store**

- `replayIndex: number | null`, `replayPlaying: boolean`, `replaySpeed: number`,
  `setReplayIndex` / `toggleReplayPlay` / `setReplaySpeed`, `exitReplay`.
  `runAuto` already keeps the full `log`; entering replay is just
  `setReplayIndex(0)`. The interval lives in a `useReplayPlayback` hook in the
  Combat panel, not the store, so the store stays timer-free and testable.

### 8c. AI decision inspector

- When the scrubbed event is an `AiDecision`, show a card: actor, chosen action,
  `score`, `expectedDamage` / `distance` / `reachableNow` where present, and the
  `reasons[]` as a bullet list — all already in `event.data`.
- A per-turn summary: for the current round+turn, the sequence of `AiDecision` +
  `AttackRolled` / `SaveRolled` + `DamageApplied` events, so a whole turn reads
  as a story.
- (Later, opt-in) full candidate ranking would need `simulation.ts` to emit the
  non-chosen candidates behind an `inspect` flag on the engine state.

### 8d. Heatmap overlays (stretch)

- Toggleable SVG overlays computed from the log: cells entered
  (`CombatantMoved` paths), damage dealt/taken per cell, death locations. Pure
  aggregation over `log`; renders as a `<rect>` grid in `SceneOverlays` with an
  opacity ramp.

### Acceptance — met (8a-8c)

- ✓ Batch and single-run output is readable without opening JSON.
- ✓ After "Run", the encounter plays back on the board at a watchable pace —
  tokens move, decisions and attacks resolve in sequence — with pause, speed,
  and scrub-both-ways.
- ✓ The reducer's final replay state matches the engine's own final snapshot
  (`tests/replay.test.ts`, board-signature deep-equal).
- ✓ Pausing on an `AiDecision` shows the actor's chosen action, score, and reasons.

## Phase 9 - Encounter Variants (session-only first)

### Goal

Compare tuning changes side by side without leaving the session.

### Tasks

- **Variant registry in the store** — `variants: Record<id, { id, name, parentId?,
  snapshot: EncounterSnapshot, mapImageDataUrl, batch: BatchSimulationSummary |
  null }>`, plus `activeVariantId`. "Duplicate as variant" clones the current
  encounter + a name ("Baseline", "More Enemies", …).
- **Run batch per variant** — `runBatch` writes into
  `variants[activeVariantId].batch` (keeps the seed via `seedPrefix` as today).
- **Compare view** — a Reports-tab / `CombatPanel` sub-panel: pick two variants,
  show Δ win rate, Δ avg rounds, Δ death rate, Δ damage dealt/taken, Δ HP left,
  with colour-coded up/down and the difficulty label for each.
- Switching `activeVariantId` swaps the loaded encounter (like loading a scene),
  so you can edit each variant's map/roster independently.
- Persistence to the `SimulationRun` DB model is a follow-up, not part of this
  pass.

### Acceptance

- Two variants of an encounter can be built, batch-run, and diffed in one view.
- The diff makes it obvious which variant is easier / harder / swingier.

### Non-goals for this pass

- Cross-session persistence of variants (in-memory only).
- More than pairwise comparison (two at a time is enough to start).

## Implementation Order

Phases 1-6 are done (see `UI_OVERHAUL_PLAN.md`). Remaining order:

1. ~~**8a - Report polish**~~ — done (round histogram, surfaced warnings,
   per-combatant resource spend).
2. ~~**8b - `replay.ts` reducer + scrubber + timed playback + REPLAY canvas
   mode**~~ — done. Pure reducer unit-tested against the engine's own final
   snapshot; playback timer in `useReplayPlayback`, not the store.
3. ~~**8c - AI decision inspector**~~ — done (`AiDecisionCard` reads
   `AiDecision.data` at the scrubbed event).
4. **9 - Session-only variant registry + pairwise compare view.** Needs the
   store to hold multiple batch results; independent of 8b/8c. **Next.**
5. **7 remainder - terrain polygon editing + template rotation.** Lowest
   priority; do when the sim-inspection work is settled.
6. *(later, opt-in)* 8c full candidate ranking (engine change), 8d heatmaps,
   variant DB persistence, Context inspector following the replay snapshot.

## Testing Strategy

Continue adding tests where behavior touches rules or persisted data:

- Engine tests for any new geometry or targeting behavior.
- Store tests or focused integration tests for drag/drop commands if added.
- Schema tests for saved encounter migrations.
- UI smoke checks for pan/zoom coordinate conversion.
- Regression fixture for a saved scene with walls, terrain, background image metadata, and custom token images.

Do not let renderer changes weaken the existing deterministic engine tests.

## Definition Of Done For The Overhaul

The overhaul is complete when:

- The app opens into a full-screen scene canvas.
- Left-side tools switch map interaction modes.
- Right-side tabs manage encounters, actors, SRD content, combat, reports, and settings.
- Encounters can be created, edited, duplicated, deleted, saved, and loaded.
- Grid and background image configuration lives in a scene config modal.
- Actors can be dragged from a directory onto the map.
- Token images can be customized.
- SRD/Open5e content can be searched and dragged to canvas or sheets.
- Unsupported or manual-only imported content is clearly marked.
- Manual, assisted, single auto, and batch simulation remain deterministic.
- Batch reports and replay/debug views remain simulation-focused rather than VTT-hosting-focused.
