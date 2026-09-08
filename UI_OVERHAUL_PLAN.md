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

Ported from the shell. Lives in `app/globals.css` (tokens + reset + font only)
plus `app/theme.css` if we want the palette isolated.

```css
:root{
  --bg: #101317;
  --panel: rgba(18,21,26,0.95);
  --panel-2: rgba(255,255,255,0.04);
  --accent: #d98a3d;
  --accent-soft: #c9a227;
  --text: #dcd7c9;
  --text-dim: #83878d;
  --border: rgba(255,255,255,0.09);
  --hp-green: #4c7a4c;
  --hp-red: #a1423f;
  --pc: #3d6ea6;
  --hostile: #a1423f;
}
```

- Font: **Signika** (Google Fonts), `sans-serif` fallback.
- Density: 44px topbar, 52px left rail, 320px sidebar — exact shell metrics.
- Theme: single committed dark look (the shell is dark-only). No light theme.
- Shared primitives become real components (see `components/ui/` below) so a
  "row" or "search bar" is defined once.

The current `globals.css` is deleted in the final phase once nothing imports its
class names.

---

## Target File Structure

```
app/
  layout.tsx                 # add Signika, keep
  globals.css                # tokens + reset + font ONLY (~80 lines)
  page.tsx                   # ~120 lines: compose shell + wire store, nothing else

components/
  shell/
    AppShell.tsx             # grid: topbar / [rail | canvas | sidebar]
    TopBar.tsx               # scene dropdown, Encounter Builder, undo/redo/settings
    LeftToolRail.tsx         # tool buttons + dividers
    SceneDropdown.tsx        # project/encounter switcher (was Encounters tab)
  scene/
    SceneCanvas.tsx          # viewport transform, wheel/space pan, drop target
    SceneGrid.tsx            # grid + background image layers
    SceneOverlays.tsx        # walls, terrain, templates, measure, sight, path SVG
    SceneTokens.tsx          # token rendering + selection
    ViewportControls.tsx     # zoom in/out/reset (bottom-left, per shell)
    SceneHud.tsx             # grid hint (bottom-right, per shell)
  sidebar/
    Sidebar.tsx              # tab strip + panel host
    ActorsPanel.tsx
    CompendiumPanel.tsx
    CombatPanel.tsx          # initiative + turn controls + Reports section
    ScenePanel.tsx           # background, grid, walls; hosts ContextInspector
    ContextInspector.tsx     # wall / terrain / template / node editor (contextual)
  sheet/
    ActorSheet.tsx           # floating, draggable window (replaces edit modal)
    ActorSheetTabs.tsx       # Stats / Actions / Items & Spells / Features / Tactics / Token
    sheet-tabs/*.tsx         # one file per tab body
  modals/
    CreateTokenModal.tsx     # trimmed create form + import JSON
    SceneConfigModal.tsx     # grid calibration, canvas size, image offset/scale
  ui/
    Row.tsx  Thumb.tsx  PanelSearch.tsx  ChipRow.tsx  PanelFooter.tsx
    Toggle.tsx  HpBar.tsx  AutomationBadge.tsx  Modal.tsx  FloatingWindow.tsx

hooks/
  useViewport.ts             # zoom/pan state + cursor-anchored zoom math
  useSceneInteraction.ts     # pointer handlers keyed by active tool
  useCompendiumSearch.ts     # Open5e search state for the Compendium panel
  useDragToCanvas.ts         # actor + compendium drop payload handling
  useFloatingWindow.ts       # drag-by-titlebar + minimize + close
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

### Phase 0 — Scaffold (no visible change)
- Add Signika to `app/layout.tsx`.
- Create `app/globals.css` v2 tokens alongside the old file (temp name, e.g.
  `theme.css`), imported after `globals.css`.
- Add `components/ui/` primitives with their `.module.css`, built to the shell's
  CSS. Unit-render them in isolation (Storybook-free: a scratch `/ui-preview`
  route is fine, deleted later).

### Phase 1 — Shell frame
- Build `AppShell`, `TopBar`, `LeftToolRail`, `Sidebar` (tab strip only, empty
  panels).
- `page.tsx` renders `AppShell` with the existing canvas still mounted in the
  center slot via a thin adapter, so the app stays usable.
- Wire `setTool`, undo/redo/save, scene dropdown (read `projects` /
  `currentEncounterId`).
- Acceptance: new frame visible, canvas works, no panel regressions.

### Phase 2 — Scene canvas extraction
- Move viewport + pointer logic into `useViewport` / `useSceneInteraction`.
- Split rendering into `SceneGrid` / `SceneOverlays` / `SceneTokens` /
  `ViewportControls` / `SceneHud`.
- Verify grid-cell resolution at all zoom levels (this is the risky part — see
  Testing). Batch simulation must not import any of these.
- Acceptance: pan/zoom/drop/measure/wall/template all behave as before; delete
  the old inline canvas JSX from `page.tsx`.

### Phase 3 — Panels, one at a time
Order: Combat → Actors → Compendium → Scene.
- Each panel is built against `ui/` primitives, wired to the store, then the
  matching block is deleted from `page.tsx`.
- `CombatPanel` absorbs the Reports tab as a collapsible section.
- `ScenePanel` absorbs Settings + hosts `ContextInspector` (wall/terrain/template
  editors appear here only when something is selected on canvas).
- `SceneDropdown` absorbs the Encounters directory.
- Acceptance: sidebar has exactly 4 tabs; every old action is still reachable.

### Phase 4 — Floating ActorSheet
- Build `FloatingWindow` + `ActorSheet` with the 6 consolidated tabs.
- Move compendium drop handling onto the sheet.
- Delete `activeModal === "edit"` and its ~350 lines.
- Keep `CreateTokenModal` and `SceneConfigModal` as the only modals, rebuilt with
  the `Modal` primitive.
- Acceptance: token editing works from a draggable window; no full-screen edit
  modal remains.

### Phase 5 — Cleanup
- Delete old `globals.css`; rename `theme.css` → `globals.css`.
- Remove dead helpers/handlers from `page.tsx` (target < 150 lines).
- Remove `/ui-preview` scratch route.
- Grep for orphaned class names and lucide imports.
- Acceptance: `npm run typecheck`, `npm test`, `npm run build` all pass; visual
  pass against the shell.

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
