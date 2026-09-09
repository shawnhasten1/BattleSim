# UI Overhaul Plan — Shell-Style Rebuild

This plan replaces the current monolithic editor UI with the layout and visual
language of `battlesim-ui-shell.html`. It is a **presentation-layer rebuild**:
the combat engine, AI/tactics, store, adapters, and API routes are kept as-is.

Supersedes the UI-facing portions of `FOUNDRY_STYLE_OVERHAUL_PLAN.md`. That
document's non-negotiable architecture rules still apply.

## Why

- `app/page.tsx` is 2,756 lines in one component — every panel, modal, handler,
  and helper lives together. This is the source of the "cluttered / too much"
  feeling.
- `app/globals.css` is 2,554 lines of accumulated selectors with no system.
- The feature surface grew past what one screen can hold: 6 sidebar tabs, 8 left
  tools, a 10-tab edit modal, inline wall/terrain/template inspectors in Settings.
- The shell mockup is calm because it commits to a small, consistent set of
  primitives (`.panel-search`, `.chip-row`, `.list`/`.row`/`.thumb`,
  `.panel-footer`) and only 4 sidebar tabs.

## What does NOT change

- `src/engine/**` — combat, dice, geometry, pathfinding, areas, simulation, batch.
- `src/store/encounter-store.ts` — the action API is clean and stays the binding
  surface. Only exception: `EditorTool` union may gain/lose members if tools change.
- `src/adapters/**`, `app/api/**`, `prisma/**`.
- All existing engine tests must stay green.

## Decisions (locked)

| Question | Choice |
| --- | --- |
| Rebuild depth | Full componentization of `app/` into focused components + hooks |
| Styling | CSS Modules per component + one small token/global file |
| Encounters directory | Moves to a topbar scene dropdown |
| Reports | Renders inside the Combat panel, below initiative |
| Sight / template / terrain tools | Kept as a secondary tool group below a divider |

---

## Target Design System

Ported from the shell. Lives in `app/tokens.css` (imported by `layout.tsx` after
`globals.css`). **Every token is prefixed `--ui-*`** because the legacy
`globals.css` still defines the bare names `--bg` / `--panel` / `--accent` for
its light theme — an un-prefixed token file would silently recolor the running
app during Phases 1–4.

```css
:root {
  --ui-bg: #101317;
  --ui-bg-deep: #0a0b0d;
  --ui-panel: rgba(18, 21, 26, 0.95);
  --ui-panel-2: rgba(255, 255, 255, 0.04);
  --ui-border: rgba(255, 255, 255, 0.09);
  --ui-text: #dcd7c9;
  --ui-text-dim: #83878d;
  --ui-accent: #d98a3d;
  --ui-accent-soft: #c9a227;
  --ui-on-accent: #1a1006;
  --ui-hp-green: #4c7a4c;
  --ui-hp-red: #a1423f;
  --ui-pc: #3d6ea6;
  --ui-hostile: #a1423f;
  --ui-radius: 4px;
  --ui-radius-lg: 8px;
  --ui-font: var(--font-signika), "Signika", ui-sans-serif, system-ui, sans-serif;
  --ui-z-rail: 20; --ui-z-sidebar: 25; --ui-z-topbar: 30; --ui-z-sheet: 40; --ui-z-modal: 100;
}
```

- Font: **Signika** via `next/font/google`, exposed as `--font-signika`. No
  global `font-family` change — new surfaces opt in with `var(--ui-font)`.
- Density: 44px topbar, 52px left rail, 320px sidebar — exact shell metrics.
- Theme: single committed dark look (the shell is dark-only). No light theme.
  `color-scheme: dark` is set per new-surface root, not on `:root`.
- Shared primitives become real components (see `src/components/ui/` below) so a
  "row" or "search bar" is defined once.

The legacy `globals.css` is deleted in Phase 5 once nothing imports its class
names; `tokens.css` then becomes the new `globals.css`. De-prefixing `--ui-*` at
that point is optional (mechanical find/replace across a known file set).

---

## Target File Structure

Components and hooks live under `src/` so they resolve through the existing
`@/*` → `./src/*` path alias (`@/components/ui/Row`, `@/hooks/useViewport`).

```
app/
  layout.tsx                 # Signika via next/font + tokens.css import
  tokens.css                 # --ui-* design tokens (~55 lines) — becomes globals.css in Phase 5
  globals.css                # legacy stylesheet, untouched until Phase 5
  page.tsx                   # ends Phase 5 at ~120 lines: compose shell + wire store
  ui-preview/page.tsx        # SCRATCH primitive gallery — delete in Phase 5

src/components/
  shell/
    AppShell.tsx             # grid: topbar / [rail | canvas | sidebar]
    TopBar.tsx               # scene dropdown, Encounter Builder, undo/redo/settings
    LeftToolRail.tsx         # tool buttons + dividers
    SceneDropdown.tsx        # project/encounter switcher (was Encounters tab)
  scene/                     # [Phase 2 — DONE]
    SceneCanvas.tsx          # container: transform + HUD + zoom controls + grid/img/tokens inline
    SceneOverlays.tsx        # walls, terrain, templates, measure, sight, path SVG
    coords.ts                # pure screen<->grid + anchored-zoom math (unit tested)
    metrics.ts               # deriveSceneMetrics(map) — shared with scene-config modal
    # SceneGrid / SceneTokens / ViewportControls / SceneHud folded into SceneCanvas
  sidebar/                   # [Phase 3 — DONE]
    ActorsPanel.tsx
    CompendiumPanel.tsx
    CombatPanel.tsx          # initiative + turn controls + collapsible Reports & Log
    ScenePanel.tsx           # background / drawing / layers; hosts ContextInspector
    ContextInspector.tsx     # wall / terrain / template / node editor (contextual)
  shell/Sidebar.tsx          # [Phase 1] tab strip + panel host
  shell/SceneDropdown.tsx    # [Phase 3] top-bar scene switcher + encounter directory
  sheet/
    ActorSheet.tsx           # floating, draggable window (replaces edit modal)
    ActorSheetTabs.tsx       # Stats / Actions / Items & Spells / Features / Tactics / Token
    sheet-tabs/*.tsx         # one file per tab body
  modals/
    CreateTokenModal.tsx     # trimmed create form + import JSON
    SceneConfigModal.tsx     # grid calibration, canvas size, image offset/scale
  ui/                        # [Phase 0 — DONE] each is Component.tsx + Component.module.css
    Row  Thumb  HpBar  ChipRow (Chip + ChipRow)  PanelSearch
    PanelFooter  Toggle  AutomationBadge  Modal
    # FloatingWindow — deferred to Phase 4 (built with its one real consumer, ActorSheet)

src/hooks/
  useViewport.ts             # [Phase 2] zoom/pan state + non-passive wheel + Space pan
  useSceneInteraction.ts     # [Phase 2] tool state + selection + derived readouts + handlers
  useSelectedCombatant.ts    # [Phase 2] { selectedCombatant, selectedDefinition } selector
  useCompendium.ts           # [Phase 3] SRD search + import subsystem
  useFloatingWindow.ts       # drag-by-titlebar + minimize + close (Phase 4)

src/lib/                     # [Phase 3] pure, framework-free shared helpers
  compendium.ts  ui-helpers.ts
```

All state still comes from `useEncounterStore`. Components read exactly the
slices they need (avoids the current "destructure 90 fields" pattern and cuts
re-renders).

---

## Feature Consolidation Map (old → new)

### Sidebar tabs: 6 → 4

| Old tab | New home |
| --- | --- |
| Encounters | `TopBar` → `SceneDropdown` (list projects/scenes, load/new/duplicate/rename/delete); "Import/Export encounter" moves into `ScenePanel` footer |
| Actors | `ActorsPanel` (search + list + "New" + drag-to-canvas) |
| SRD | `CompendiumPanel` (chip filters + search + draggable rows) |
| Combat | `CombatPanel` (initiative list + turn controls + collapsible Reports) |
| Reports | Section inside `CombatPanel` ("Batch" — run + win/TPK/rounds/difficulty + per-combatant metrics) |
| Settings | `ScenePanel` (background image, grid, wall visibility) + `SceneConfigModal` for full calibration |

### Left rail: shell core + secondary group

```
select  ↖        (EditorTool "select")
pan     ✋        viewport pan mode (currently space/middle-mouse only — promote to a tool)
token   ●        opens CreateTokenModal
────────
wall    🧱       ("wall" ; label flips to "Wall End" when pendingWallStart)
measure 📐       ("measure")
────────
sight   ◎        ("sight" — line of sight / effect)
template ▽       ("template")
terrain ⬟        ("terrain")
erase   ⌫        ("delete")
────────
grid    ▦        toggles grid visibility (view pref, not an EditorTool)
```

### Edit modal (10 tabs) → floating ActorSheet (6 tabs)

| Old sheet tab(s) | New tab |
| --- | --- |
| summary, stats, resources | **Stats** — portrait, HP bar, AC/speed/init, ability grid, resource counters |
| actions | **Actions** — structured actions + multiattack builder |
| inventory, spells | **Items & Spells** — weapons + spells, each a `Row` with `AutomationBadge` |
| features, automation | **Features** — features/traits; automation-support summary shown inline as badges, not a separate tab |
| tactics | **Tactics** — per-token tactics profile + faction default |
| token | **Token** — image upload (token + definition scope), scale, border, nameplate |

- The sheet is a `FloatingWindow`: draggable titlebar, minimize, close. Opens on
  token double-click or the Actors panel "edit" affordance. Multiple can be open.
- Compendium drag-drop targets the sheet's Items/Spells/Features zones (keeps
  `application/x-battle-sim-compendium` payload + `attachCompendiumToSheet`).

### Turn / run controls

- Live in `CombatPanel`: `Initiative`, `Step` (Next Turn ▶ in footer),
  `Auto Run`, `Batch`.
- `TopBar` keeps only: scene dropdown, **Encounter Builder** (opens
  `CreateTokenModal` and focuses the Actors tab), undo, redo, save, settings
  (opens `SceneConfigModal`).

---

## Implementation Phases

Work on a branch off `main`. Each phase compiles, runs, and keeps tests green.
Old code is deleted as each replacement lands — no long-lived parallel UI.

### Phase 0 — Scaffold (no visible change) — DONE

Shipped:
- `app/layout.tsx`: Signika via `next/font/google` as `--font-signika`; imports
  `tokens.css` after `globals.css`. No global font-family change.
- `app/tokens.css`: `--ui-*` design tokens (palette, radius, font, z-index),
  additive on `:root`, no collision with the legacy light theme.
- `src/components/ui/`: `Row`, `Thumb`, `HpBar`, `ChipRow` (+`Chip`),
  `PanelSearch`, `PanelFooter`, `Toggle`, `AutomationBadge`, `Modal` — each a
  `"use client"` component + colocated `.module.css`, styled to the shell.
  Named exports, direct imports (no barrel). `AutomationBadge` mirrors the
  legacy inline badge; the legacy copy in `page.tsx` stays until Phase 3/4.
- `app/ui-preview/page.tsx` (+`.module.css`): scratch gallery of every
  primitive, dark root, not linked anywhere. **Delete in Phase 5.**
- Deliberately deferred (avoid speculative abstraction): `FloatingWindow` and
  all `src/hooks/*` — built in the phase that has their real consumer.
- Verified: `npm run typecheck`, `npm run build`, `npm test` (58) all pass.

### Phase 1 — Shell frame — DONE

Shipped `src/components/shell/`:
- `AppShell` — pure layout: 44px top bar / [52px rail | canvas | 320px sidebar]
  / optional bottom dock. Owns the dark surface, `--ui-font`, `color-scheme`.
  Center slot is `display:flex` + `.main > * { flex:1 }` so the untouched
  legacy `.scene-stage` (which has no height of its own) fills it.
- `TopBar` — subscribes to the store directly; props are only the two
  page-local openers (`onOpenBuilder`, `onOpenSceneConfig`). Scene `<select>`
  flattened from `projects[].encounters[]`; Encounter Builder → Create Token
  modal + Actors tab; run cluster (initiative→batch) kept here **temporarily**,
  moves to the Combat panel in Phase 3.
- `LeftToolRail` — subscribes for `tool`/`setTool`/`pendingWallStart`; takes
  `showGrid`/`onToggleGrid` (new page-local view state, wired to grid-layer
  opacity). Core tools (select/move/measure/wall), then sim tools
  (sight/template/terrain/erase) below a divider, then the grid toggle. No
  `EditorTool` change — the shell's "pan"/"token" rail items map to existing
  space-pan and the Encounter Builder instead.
- `Sidebar` — chrome only: 4-tab text strip (`SIDEBAR_TABS` in `page.tsx`) over
  a scroll body. `SidebarTab` union reduced to
  `actors | compendium | combat | scene`; the 6 legacy panel blocks stay inline
  in `page.tsx` as `children`, regrouped by `showXPanel` booleans (combat also
  renders the old reports block; scene renders old settings + encounters).

Support:
- `app/legacy-bridge.css` — `.legacy-surface` re-declares the theme vars the
  legacy panels/tracker/modals used to inherit from `.foundry-shell`. Applied
  to the sidebar body, the bottom `<footer>`, and the modal group. Deleted in
  Phase 3.
- `page.tsx` return is now `<><AppShell .../><div className="legacy-surface">
  {modals}</div></>`; deleted `ToolButton` + `SidebarTabButton`; trimmed 13
  now-unused lucide/react imports.

Known interim seams (resolved in Phase 3): legacy cream panel bodies inside the
dark sidebar chrome; run controls in the top bar; bottom tracker still present;
`.pan-ready` grab-cursor-before-drag lost (active-pan cursor retained).

Verified: `typecheck`, `build`, `test` (58), plus a Playwright screenshot of
`/` — frame renders, canvas + tokens + overlays intact, no console errors.

### Phase 2 — Scene canvas extraction — DONE

Pure modules (`src/components/scene/`):
- `coords.ts` — `getCellPoint`, `getSnappedWallPoint`, `anchoredZoom`,
  `pointsMatch`, `uniqueWallNodes`, `clamp`, and the `ViewportState` /
  `MIN_ZOOM` / `MAX_ZOOM` / `INITIAL_VIEWPORT` constants. No React, no `window`.
  `getCellPoint` measures the transformed element, so it is zoom/pan-correct
  without being handed viewport state.
- `metrics.ts` — `deriveSceneMetrics(map)` → cell size, grid/scene pixel dims,
  grid line + image settings. Shared by the canvas and the scene-config modal.
- `tests/scene-coords.test.ts` — 11 cases pinning the screen↔grid math and the
  cursor-anchored zoom invariant at zoom 0.5 / 1 / 2 with pan.

Hooks (`src/hooks/`):
- `useSelectedCombatant` — `{ selectedCombatant, selectedDefinition }` from the
  store (was duplicated ~140× across `page.tsx`; now one selector).
- `useViewport` — pan/zoom state, Space-key tracking, pointer pan handlers, and
  a **non-passive** `wheel` listener bound via effect (fixes the pre-existing
  "Unable to preventDefault inside passive listener" warning; wheel-zoom now
  actually blocks page scroll).
- `useSceneInteraction` — all tool-transient state (measure/sight endpoints,
  wall cursor, template draft), wall/terrain/template/node selection, the
  derived readouts (measured path, LoS/LoE, template targets, movement
  preview), and the `.battlemap` pointer handlers. Pan guard is
  `isPanning || isPanningRef.current` — same two-part check as before.

Components (`src/components/scene/`):
- `SceneCanvas` — store-connected container: HUD + zoom controls + the
  transformed battlemap (image, grid lines, overlays, tokens). Props: just
  `viewport`, `scene`, `showGrid`, and the two canvas drop handlers.
- `SceneOverlays` — the SVG overlay layer, ported verbatim.
- `SceneGrid` / `SceneTokens` / `ViewportControls` / `SceneHud` **not** split
  out — the grid div (~12 lines) and token map (~35) stay inline in
  `SceneCanvas`; HUD + zoom buttons are ~8 lines of local JSX. Splitting them
  would add prop-threading for no gain. Revisit if a later restyle needs it.

`page.tsx`: canvas JSX + ~215 lines of handlers + ~120 lines of state/derived
removed (~300 net); replaced by 3 hook calls, one `scene` destructure block
(temporary — feeds the still-inline legacy Scene panel until Phase 3's
ContextInspector), and `<SceneCanvas … />`. Deleted the local coord helpers;
trimmed 12 now-unused imports.

Canvas keeps the legacy CSS classes (`.scene-stage`, `.battlemap`, `.overlay`,
`.token`, …) — Phase 2 is structural only; canvas restyle is deferred.

Verified: `typecheck`, `build`, `test` (69 — +11 coord cases), and a Playwright
pass driving pan (space-drag), `+`/wheel zoom, viewport reset, measure, wall
draw, and token select — all correct after a pan offset; **zero console
errors**.

### Phase 3 — Panels — DONE

Shipped `src/components/sidebar/` (each `.tsx` + `.module.css`, dark, store-connected):
- `CombatPanel` — turn status, run controls (Initiative / Step / Auto Run /
  Batch — moved off the top bar), party/enemy tactics, the re-sorting
  initiative list, and **collapsible** Batch-report + Combat-log `<details>`
  sections. Owns the log-autoscroll ref/effect.
- `ActorsPanel` — Create Token, selection summary (doubles as the compendium
  drop zone), token actions, and the draggable actor directory. Derives
  `savedDefinitionIds` / `directory` itself.
- `CompendiumPanel` — category `Chip` row, search, draggable result cards.
  Pure — all state/actions come from the `compendium` prop.
- `ScenePanel` + `ContextInspector` — background upload / configure /
  import-export, drawing tool actions + readout, then the contextual editors
  for the selected wall / terrain / template / node, then the layers list.

Shell:
- `SceneDropdown` (`src/components/shell/`) — replaces the Encounters tab: a
  top-bar popover with the project→scene tree and inline new / rename /
  duplicate / delete. `TopBar` lost the run cluster and the `<select>`.
- `AppShell` lost the `bottom` slot; the legacy `<footer>` tracker is gone.

Shared extractions:
- `src/hooks/useCompendium` — the SRD search + import subsystem (search state,
  `attach`, `importCreature`, `onDragStart`), one instance in `page.tsx` fed to
  both panels and the canvas drop. (The legacy edit/create modals keep their
  own copy of `attachCompendiumToSheet` until Phase 4 deletes them.)
- `src/lib/compendium.ts` — compendium types + pure helpers (meta, snippet,
  `conditionFromCompendiumName`, `featureFromCompendiumPayload`, category list,
  `SUPPORTED_CONDITIONS`).
- `src/lib/ui-helpers.ts` — `downloadJson`, `safeFileName`,
  `defaultFactionForDefinition`, `tokenVisualsFor`.
- `src/components/ActorThumbnail.tsx` — shared by ActorsPanel + the edit sheet.

`page.tsx`: ~490 lines of panel JSX + the footer + ~15 dead helpers/functions/
state removed; store destructure cut from 85 names to 37. **2110 → 1257 lines.**
Only the 3 legacy modals (`create` / `edit` / `scene`) remain, still wrapped in
`.legacy-surface` — Phase 4's target.

Restraint: panels read `useEncounterStore` directly (0–3 props each); the dense
scene forms keep functional layouts rather than a bespoke form system;
`SceneGrid`/etc. stayed folded per Phase 2.

Verified: `typecheck`, `build`, `test` (69), and a Playwright pass —
Initiative→Step drives the engine and updates the Combat panel + tokens; the
scene dropdown opens/creates; clicking a layer opens the wall inspector — zero
console errors.

### Phase 4 — Floating ActorSheet — DONE

Window primitive:
- `src/hooks/useFloatingWindow.ts` — title-bar pointer-drag (viewport-clamped)
  + minimize state. Position persists across close/reopen, not to storage.
  Single-window; a z-order manager can layer on later without touching it.
- `src/components/ui/FloatingWindow.tsx` — fixed 340px, scrolling body,
  minimize/close, optional whole-window drop-zone wiring. Not resizable yet.

`src/components/sheet/`:
- `ActorSheet.tsx` — `FloatingWindow` for the selected combatant; 6 tabs
  (Stats / Actions / Loadout / Features / Tactics / Token); worst-automation
  badge in the title bar; the whole window is the compendium drop target
  (`compendium.attach`).
- `sheet-tabs/*.tsx` — one file per tab, each reads `useEncounterStore` and owns
  its own builder-form state (weapon/spell/action/feature/resource forms).
- `SheetControls.tsx` — `EditableItemList`, `SelectAbility`, `SelectDamageType`.
- `sheet.module.css` — one shared compact-form stylesheet for the shell + tabs.
- `src/lib/sheet.ts` — `buildSheetItems(definition)` (weapons/spells/features/
  actions rows + automation counts + worst level), `describeAction`,
  `resourceIdsForEditor`, `formatAutomationSupport`.
- Dropped the side `SheetItemInspector` — no room in a 340px window; the
  per-row `AutomationBadge` + detail line carry the same signal.

`src/components/modals/` (both on the `Modal` primitive, dark):
- `CreateTokenModal.tsx` — custom-token form, import JSON, definition library,
  Open5e creature search (its own state; import via `compendium.importCreature`).
- `SceneConfigModal.tsx` — name / background / grid / canvas & image, values
  from `deriveSceneMetrics`.
- `useCompendium` now also returns `importSpell`; the Loadout tab's Open5e spell
  search uses it.

`page.tsx`: **1257 → 162 lines.** All the sheet/modal/compendium-import state,
handlers, and helper components deleted; only `onCanvasDrop` + the AppShell
composition remain. `activeModal` → `sheetOpen: boolean` + `modal: "create" |
"scene" | null`. `app/legacy-bridge.css` and the `.legacy-surface` wrapper are
gone; `globals.css` now renders nothing (Phase 5 deletes it).

Restraint: one shared `sheet.module.css` instead of per-tab CSS; single window
rather than a multi-window manager; no resize; `useFloatingWindow` stays
generic but isn't over-parameterised.

Verified: `typecheck`, `build`, `test` (69), and a Playwright pass — open the
sheet, drag it by the title bar, switch tabs, open both modals — zero console
errors.

### Phase 5 — Cleanup — DONE

- `app/globals.css` rewritten **2554 → 488 lines**: `--ui-*` tokens (folded in
  from the now-deleted `tokens.css`) + reset/base (dark `body`, Signika,
  scrollbars) + the scene-canvas / SVG-overlay rules. That last block stays
  global on purpose — `SceneOverlays` composes SVG class names dynamically
  (`terrain ${type} ${selected}`), which CSS Modules handle badly. All its
  legacy `var(--accent|danger|path|party|enemy)` references re-mapped to
  `--ui-*`; the canvas HUD + zoom controls now match the shell palette.
- `app/tokens.css` deleted (folded into globals.css); `layout.tsx` imports one
  stylesheet.
- `app/ui-preview/` deleted.
- No orphaned lucide/react imports or unused locals anywhere in `src/components`
  / `src/hooks` / `src/lib` / `app` (verified with a `noUnusedLocals` pass).
- `--ui-` prefix **kept** — self-documenting, greppable; a rename is churn for
  no functional gain.
- `page.tsx` left at 162 lines (no dead code to trim).

Verified: `typecheck`, `test` (69), `build` all clean; `/ui-preview` 404s;
Playwright visual pass — canvas, tokens, walls, terrain, measure gizmo, HUD, and
all four panels render correctly on the re-themed stylesheet, zero console
errors.

**The overhaul is complete.** page.tsx: 2756 → 162 lines. globals.css: 2554 →
488. One monolith is now ~40 focused components + 6 hooks + 4 lib modules,
each reading `useEncounterStore` for exactly the slices it needs; the engine,
store, adapters, and API are untouched and all 58 original engine tests (plus
11 new coordinate tests) still pass.

### Phase 6 — Harden — DONE

- **Tests: 69 → 103.** Added `@testing-library/react` + `happy-dom` (global env
  stays `node`; component tests use a `// @vitest-environment happy-dom`
  docblock). New: `lib-sheet` (`buildSheetItems` / `describeAction` /
  `resourceIdsForEditor`), `scene-metrics` (`deriveSceneMetrics`),
  `useFloatingWindow` (drag delta, viewport clamp, button-ignore, minimize),
  `ui-primitives` (HpBar / AutomationBadge / PanelSearch / Chip / Toggle),
  `panels` (Combat / Actors / Compendium / Scene render + a store round-trip
  against the sample encounter).
- **A11y.** `FloatingWindow`: Escape closes, focus enters on open and is
  restored on close, `role="dialog"` + `aria-label` (non-modal, so Tab is *not*
  trapped). `Modal`: focus trap (Tab cycles in the panel), focus-in / restore,
  `role="dialog"` moved onto the panel with `role="presentation"` on the
  backdrop. ActorSheet tab strip gains `role="tablist"` / `role="tab"` /
  `aria-selected` to match `Sidebar`.
- **Persistence** (`src/lib/persist.ts`, SSR-safe, never throws): viewport
  pan/zoom (debounced), active sidebar tab, grid visibility, and the actor-sheet
  window position — all restored via a mount effect gated behind a `hydrated`
  flag so SSR output stays stable (no hydration mismatch) and the persist
  effects can't clobber the stored value with the default.
- **Small deferrals closed:** `CreateTokenModal` fields now have visible labels;
  the space-held "grab" cursor (`.scene-stage.pan-ready`) is back, distinct from
  the active-drag "grabbing".

Verified: `typecheck`, `build`, `test` (103), and a Playwright pass — reload
keeps tab/grid/zoom, Escape closes the sheet, zero console errors.

---

## Testing

- **Engine tests**: unchanged, must stay green through every phase.
- **Coordinate conversion**: add a focused test (or `hooks/useViewport` pure
  helper test) for screen↔grid math at zoom 0.5 / 1 / 2 with non-zero pan — the
  one place a UI refactor can silently break rules.
- **Store smoke**: light React Testing Library render of `CombatPanel` and
  `ActorsPanel` against a fixture encounter to catch binding breaks.
- **Manual regression checklist** (per phase): load a saved scene with walls +
  terrain + background + custom token images; run Initiative → Step → Auto Run →
  Batch 100; drag an actor and a compendium creature onto the map; edit a token
  sheet; save + reload the project.

---

## Risks & Open Items

- **Coordinate math regressions** during canvas extraction — mitigated by the
  helper test above and doing Phase 2 in one focused pass.
- **`page.tsx` prop-drilling** — prefer components reading `useEncounterStore`
  directly with selectors over threading callbacks.
- **"Encounter Builder" scope** — this plan treats it as "open Create Token +
  focus Actors". If you want a dedicated roster/faction-assignment builder
  surface, that's a follow-up (Phase 6).
- **CSS Modules + Next 16** — supported out of the box; no config needed.
- **Multiple floating sheets** — nice-to-have; ship single-sheet first if window
  management gets fiddly.
```
