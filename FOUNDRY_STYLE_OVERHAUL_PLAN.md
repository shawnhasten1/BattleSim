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
- Next recommended phase: Phase 7 - Simulation-Focused Scene Tools.

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

### Goal

Add Foundry-like tools that are especially useful for encounter simulation.

### Tasks

- Add measurement ruler with movement cost preview.
- Add path preview respecting walls, terrain, occupied spaces, and footprint size.
- Add line-of-sight and line-of-effect test tools.
- Add area template placement for cones, circles, lines, and squares.
- Add template drag/rotate/resize controls where useful.
- Add wall node editing, wall type toggles, and door state controls in a compact inspector.
- Add terrain polygon editing and terrain type controls.

### Acceptance Criteria

- A user can test movement, range, and targeting directly on the map.
- Area templates identify affected tokens before resolving actions.
- Wall and terrain tools support editing, not only creation/deletion.

## Phase 8 - Combat, Reports, Replay, And AI Inspector

### Goal

Make the simulator outputs feel like first-class Foundry panels, not raw debug data.

### Combat Tab

- Initiative tracker
- Current turn summary
- Action buttons for selected/current token
- HP/resource controls
- Conditions
- Manual/assisted/auto controls

### Reports Tab

- Batch run controls
- Win rate
- TPK/death/down rates
- Round distribution
- Remaining HP
- Damage dealt/taken
- Resource usage
- Unsupported automation warnings
- Difficulty label with raw metrics visible

### Replay / Inspector Tools

- Event log scrubber.
- Reconstruct state at selected event or round.
- AI decision inspector showing candidate actions, movement, scores, and selected action.
- Optional heatmap overlays for movement, damage, deaths, and common occupied cells.

### Acceptance Criteria

- Single-run and batch-run outputs are readable without opening JSON details.
- Warnings explain omitted or manual-only content.
- AI decisions are inspectable enough to tune tactics.

## Phase 9 - Encounter Variants

### Goal

Make encounter tuning fast.

### Tasks

- Add duplicate-as-variant workflow.
- Add named snapshots such as Baseline, More Enemies, Wider Start, No Chokepoint.
- Compare two or more batch reports.
- Show deltas in win rate, rounds, deaths, damage, and resource use.
- Preserve exact seed and snapshot used for every run.

### Acceptance Criteria

- A user can quickly test map, position, enemy, and tactics changes.
- Reports make it clear which variant is easier, harder, or more volatile.

## Implementation Order

Use this order unless a blocker forces a smaller prerequisite change:

1. Componentize the current page.
2. Build the Foundry-style shell.
3. Add viewport pan/zoom.
4. Add scene configuration modal.
5. Add encounter directory CRUD.
6. Add token visual fields and rendering.
7. Add actor dragging to canvas.
8. Add compendium dragging to canvas/sheets.
9. Replace edit modal with sheets.
10. Add advanced measurement/template tools.
11. Improve reports/replay/AI inspection.
12. Add encounter variants and report comparison.

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
