# Token Editing UX Plan

Quality-of-life upgrades for manipulating tokens directly on the board,
mirroring the wall-editing work (`WALL_EDITING_UX_PLAN.md`) and reusing the same
`ContextMenu` primitive.

1. ✅ **Right-click a token for a context menu** — single selection: *Edit sheet*,
   *Set health* (inline ± stepper), *Duplicate*, *Delete*.
2. ✅ **Shift+click to multi-select tokens** — with 2+ selected the menu offers
   only *Duplicate all* / *Delete all*.
3. ✅ **Move tool = free placement** — the Move tool drops a token on any cell
   with no movement-range / reachability check, no opportunity attacks, no cost
   log.
4. ✅ **Drag a token** — with the Move tool active, press a token and drag it to
   its destination; drop to place.

**Status:** All four features shipped (239 tests green, `tsc` + `next build`
clean, browser-verified).

---

## Scope decisions (locked)

- **Move tool replaces range-checked movement entirely.** The `tool === "move"`
  branch no longer calls `moveCombatant` (budget check + OA + `CombatantMoved`
  log). It calls a new `placeCombatant(id, cell)` that just sets the position in
  one undo step. The "Destination is not reachable this turn" warning path is
  removed. Rules-enforced movement stays only in the automated turn / simulation
  code, which already calls the engine `moveCombatant` directly — untouched.
- **Drag is the Move-tool interaction.** Press-drag-drop on a token while
  `tool === "move"`. Click-to-destination (select token, click cell) still works
  too because `handleMapClick`'s move branch also routes to `placeCombatant`.
  Under every other tool a token click behaves as today (select; `delete` tool
  removes).
- **Health editing is an inline ± stepper** inside the context menu — no popover.
  `ContextMenu` grows one new item shape (`stepper`) that renders a horizontal
  row: `label  [−5][−1]  cur / max  [+1][+5]`. Plus plain items "Set to full"
  and "Down (0 HP)" under the same heading.
- **Multi-select lives in `useSceneInteraction`,** like the wall/node selection —
  not in the store's persisted state. `selectedCombatantIds: string[]` on the
  hook; it keeps the store's single `selectedCombatantId` (sheet, sidebar, AI
  preview, `useSelectedCombatant`) pointed at the most-recent member so nothing
  downstream changes. Plain click replaces, Shift+click toggles.
- **Duplicate offsets to a free nearby cell** (reuse `findOpenCell`), keeps
  faction / tokenVisuals / tacticsProfile / conditions, resets `currentHp` to
  max, `tempHp` to 0, `initiative` undefined, `state` active — same rules as the
  existing `duplicateSelected`.
- **Free placement allows overlap.** A DM dropping a token anywhere is not
  blocked by another token or a wall; only clamped so the footprint stays on the
  grid. (Movement legality is a play-time concern, not an editor concern.)
- **Reuse `ContextMenu`** (`src/components/ui/ContextMenu.tsx`) verbatim — it is
  already portalled, viewport-clamped, and dismiss-on-outside/Escape/scroll.

---

## Current state

- **Tokens** render in `SceneCanvas` as `<button className="token …">` with only
  `onClick` → `tool === "delete" ? removeCombatant(id) : selectCombatant(id)`.
  No pointer-drag, no `onContextMenu`. `.token { cursor: pointer }` in
  `app/globals.css`; `.token.selected { outline … }`.
- **Selection** is a single `selectedCombatantId: string | null` in the store
  (persisted). `useSelectedCombatant` resolves it (falling back to
  `combatants[0]`) for the sheet and every sidebar panel.
  `selectCombatant: (id) => set({ selectedCombatantId: id })`.
- **Move** — `handleMapClick` (`encounter-store.ts` ~line 407): when
  `tool === "move"` and something is selected, it builds an engine state and
  calls `moveCombatant(engine, selectedId, point, { provokeOpportunityAttacks })`,
  which **throws** if `path.cost > movementBudget`; the catch pushes an
  `AutomationWarning` log line.
- **`useSceneInteraction`** already owns the analogous wall pieces: multi-select
  arrays + `selectWall`/`selectNode`/`clearWallSelection`, a `wallMenu: {x,y}`
  state with `openWallMenu`/`openNodeMenu`/`closeWallMenu`, a `suppressNextMapClickRef`
  to swallow the click that ends a drag, and drag plumbing for wall nodes
  (`onWallNodePointerDown` + `onMapPointerMove`/`onMapPointerUp`) and templates
  (`onTemplatePointerDown`, capturing the pointer on `.battlemap`). Drag preview
  is done by deriving `displayWalls` from a transient `wallDragPoint` rather than
  committing every move.
- **`ContextMenu`** item shapes today: action (`label`,`icon`,`onSelect`,
  `danger`,`checked`,`disabled`,`keepOpen`), `{ separator: true }`,
  `{ heading: string }`.
- **Sheet open/close** is `sheetOpen` React state in `app/page.tsx`; the page
  passes `onOpenSheet={() => setSheetOpen(true)}` to `ActorsPanel`. `SceneCanvas`
  has no route to it yet.
- **Store mutators**: `updateHp(id, hp)` (clamps ≥0, flips `state` to
  downed/defeated/active), `removeCombatant(id)` (filters, re-points
  `selectedCombatantId` to `combatants[0]`), `duplicateSelected()`,
  `updateCombatant(id, { position | … })`. `commitEncounter(next, extras?)` is
  the single undo-step writer.
- `sizeFootprint(size)`, `findOpenCell(encounter)`, `getCellPoint(el,cx,cy,cell)`
  (floored, zoom/pan-correct) are all available.

---

## Feature A — Token context menu (single selection)  ✅ done

Shipped as designed. `ContextMenu` gained the `stepper` item shape; the token
menu (`SceneCanvas.tokenMenuItems`) renders a `<displayName>` heading, *Edit
sheet* (→ `selectCombatant` + a new `onEditActor` prop wired from
`app/page.tsx`'s `setSheetOpen`), a "Health" section with the `[-5][-1] cur / max
[+1][+5]` stepper (`updateHp`, value clamped `0..maxHp`) plus *Set to full*
(disabled at full) / *Down (0 HP)* (disabled at 0), then *Duplicate*
(`duplicateCombatant`) and *Delete* (`removeCombatant`). `useSceneInteraction`
owns `tokenMenu: { x, y, combatantId }` + `openTokenMenu` / `closeTokenMenu`;
opening it finishes an in-progress wall chain (parity), closes any wall menu and
clears the wall selection, and it auto-closes on tool change, on
`onMapContextMenu`, and when its target combatant disappears. Store
`duplicateSelected` is now a wrapper over `duplicateCombatant(id)` (which
`structuredClone`s the source so nested state isn't shared). Tests:
`tests/token-editing.test.tsx`. `openTokenMenu` keeps a `combatantId` in state so
Feature B only needs to add the "keep an existing multi-selection" branch.

### Original design

### `ContextMenu` — new `stepper` item shape (`ContextMenu.tsx` + `.module.css`)

```ts
export type ContextMenuItem =
  | { label: string; icon?: ReactNode; onSelect: () => void; danger?: boolean; checked?: boolean; disabled?: boolean; keepOpen?: boolean }
  | { separator: true }
  | { heading: string }
  | {
      stepper: {
        label: string;
        value: number;
        sub?: string;                 // e.g. "/ 30" shown dim after the value
        steps: number[];              // e.g. [-5, -1, 1, 5]
        onStep: (delta: number) => void;
      };
    };
```

Render (`role="group"`, not a `menuitem`): a flex row — `<span>` label, then a
button per `steps` entry (`−5 −1` left of the value, `+1 +5` right; label from
`n > 0 ? "+"+n : n`), a centered `<strong>{value}<em>{sub}</em></strong>`.
Each button calls `onStep(delta)` and **does not close** the menu (implicit
`keepOpen`). New CSS: `.stepperRow`, `.stepBtn`, `.stepperValue` — same tokens
(`--ui-panel`, `--ui-border`, 12px) as `.item`.

### Menu state — `useSceneInteraction.ts`

Mirror the wall menu:
```ts
const [tokenMenu, setTokenMenu] = useState<{ x: number; y: number; combatantId: string } | null>(null);
```
- `openTokenMenu(combatantId, x, y)` — `finishChainIfDrawing()` guard (parity
  with `openWallMenu`); `setWallMenu(null)`; if `combatantId` is **not** in
  `selectedCombatantIds`, replace the selection with just it
  (`selectCombatantOnBoard(combatantId, false)`); `setTokenMenu({ x, y, combatantId })`.
- `closeTokenMenu` — `useCallback(() => setTokenMenu(null), [])`.
- Close it in the `useEffect([tool])` cleanup (already clears `wallMenu`); also
  clear when the target combatant disappears (fold into the combatant-prune
  effect from Feature B) and from `onMapContextMenu`.
- `openWallMenu` / `openNodeMenu` also `setTokenMenu(null)` so only one menu is
  ever open.

### Wiring — `SceneCanvas.tsx`

- Token `<button>` gains
  `onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); scene.openTokenMenu(combatant.id, e.clientX, e.clientY); }}`
  (guarded by `!replaying`). `stopPropagation` keeps it off `.battlemap`'s
  `onMapContextMenu`.
- New prop `onEditActor?: () => void` (threaded from `app/page.tsx` as
  `() => setSheetOpen(true)`).
- Render `{scene.tokenMenu && !replaying ? <ContextMenu x=… y=… items={tokenMenuItems(scene.tokenMenu)} onClose={scene.closeTokenMenu} /> : null}`
  next to the existing wall `<ContextMenu>`.
- `tokenMenuItems({ combatantId })`:
  - `ids = scene.selectedCombatantIds.includes(combatantId) ? scene.selectedCombatantIds : [combatantId]`
  - **`ids.length >= 2` → multi menu** (Feature B).
  - **single**:
    ```
    heading  <displayName>
      ▸ Edit sheet          → selectCombatant(id); onEditActor?.()
    separator
    heading  "Health"
      stepper  { label: "HP", value: currentHp, sub: `/ ${maxHp}`,
                 steps: [-5,-1,1,5], onStep: (d) => updateHp(id, currentHp + d) }
      ○ Set to full          → updateHp(id, maxHp)
      ○ Down (0 HP)          → updateHp(id, 0)
    separator
      ▸ Duplicate            → duplicateCombatant(id)
      ✗ Delete   (danger)    → removeCombatant(id); scene.clearCombatantSelection()
    ```
  `currentHp` / `maxHp` come from the live `encounter` / `getDefinition` already
  in scope in `SceneCanvas` (`tokenLayouts`). Because `updateHp` commits, the
  menu re-renders with the new value between clicks (same mechanism as the wall
  block-flag toggles).

---

## Feature B — Shift+click multi-select  ✅ done

Shipped, with a sturdier sync model than the sketch below. `useSceneInteraction`
owns `selectedCombatantIds: string[]` (lazy-init from the store's primary). Two
imperative helpers — `applyBoardSelection(next)` (updates a live ref mirror,
records `reconciledPrimaryRef`, `setState`s, and pushes the newest member to the
store's `selectCombatant` when it differs) and, on top of it,
`selectCombatantOnBoard(id, additive)` (Shift toggles, plain replaces) and
`clearCombatantSelection()` (collapse to the store's primary). Store→board sync
is a **`useEncounterStore.subscribe`** listener (not a subscribed selector +
effect): it fires synchronously with the store write, skips changes whose
`selectedCombatantId` matches `reconciledPrimaryRef` (our own pushes), and
collapses the board set onto any *external* primary move (Combat panel row, turn
advance, duplicate, delete re-point, scene load) that isn't already in the set.
This avoids the stale-value ping-pong a bidirectional effect pair hits. A
`[encounter.combatants]` prune effect drops dead ids (and keeps the ref in
step). `openTokenMenu` keeps a 2+ selection when the right-clicked token is a
member, else replaces via `selectCombatantOnBoard(id, false)`. Token `onClick`
is Shift-aware; the `.selected` class is `selectedCombatantIds.includes(id)` so
every member is outlined. Empty-canvas plain click and a no-chain Escape collapse
the extras (only when `length > 1`). `tokenMenuItems` gains an `ids.length >= 2`
branch: `${n} tokens` heading + *Duplicate all* (`forEach duplicateCombatant`) +
*Delete all* (`removeCombatants(present)` + `clearCombatantSelection()`). Store
gains `removeCombatants(ids)` (one undo step; keeps the current selection if it
survives, else re-points to `combatants[0]`); `removeCombatant` is now a wrapper.
Tests: `tests/token-editing.test.tsx` (+10). Browser-verified: shift-build a
2-set (both outlined), member right-click → "2 tokens" / Duplicate all / Delete
all only, non-member right-click collapses to the single menu, Delete all /
Duplicate all move the count by 2, empty-canvas click and an external initiative
-row click collapse the extras; no console errors.

### Original design

### Selection state — `useSceneInteraction.ts`

```ts
const [selectedCombatantIds, setSelectedCombatantIds] = useState<string[]>([]);

const selectCombatantOnBoard = useCallback((id: string, additive = false) => {
  setSelectedCombatantIds((prev) => {
    const next = additive
      ? (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
      : [id];
    // keep the store's single selection pointed at the newest member
    useEncounterStore.getState().selectCombatant(next[next.length - 1] ?? null);
    return next;
  });
}, []);

const clearCombatantSelection = useCallback(() => setSelectedCombatantIds([]), []);
```

- Prune when the roster changes (new effect, `[encounter.combatants]` dep) —
  drop ids that no longer exist; if the pruned set is empty and `tokenMenu` is
  open, close it. Mirrors the existing `selectedWallIds` prune effect.
- Keep the hook's derived `selectedCombatant` for callers that want the object
  (already provided via `useSelectedCombatant`; no change there — it still reads
  the store id, which `selectCombatantOnBoard` keeps current).
- Escape (already handled for walls) also calls `clearCombatantSelection()` when
  no wall chain is in progress. Plain click on empty canvas in `onMapClick`
  (the `tool !== "wall" && !shiftKey` branch that clears wall selection) clears
  the combatant selection too.

### Click plumbing — `SceneCanvas.tsx`

- Token `onClick`:
  ```ts
  onClick={(e) => {
    if (tool === "delete" && !replaying) return removeCombatant(combatant.id);
    scene.selectCombatantOnBoard(combatant.id, e.shiftKey);
  }}
  ```
  (Selecting via `selectCombatantOnBoard` also updates the store id, so the
  sheet / sidebar follow the newest pick.)
- Token `className` `selected` ← `scene.selectedCombatantIds.includes(combatant.id)`
  (replaces `combatant.id === scene.selectedCombatant?.id`). Every member of a
  multi-selection gets the outline.
- `onContextMenu` (Feature A) already keeps a 2+ selection when you right-click a
  member, else replaces.

### Multi menu — `tokenMenuItems` (`ids.length >= 2`)

```
heading  `${ids.length} tokens`
  ▸ Duplicate all           → ids.forEach(duplicateCombatant)   // one undo step: see store note
  ✗ Delete all   (danger)   → removeCombatants(ids); scene.clearCombatantSelection()
```

No sheet / health rows in multi mode (per the request).

---

## Feature C — Move tool = free placement  ✅ done

Shipped as designed. Store `placeCombatant(combatantId, cell)` floors + clamps
the cell so the footprint stays on the grid (`0 .. width - footprint`), sets
`position` in one `commitEncounter`, and returns early (no undo entry) when the
cell is unchanged. `handleMapClick`'s move branch is now just
`if (tool !== "move" || !selectedId) return; get().placeCombatant(selectedId, point);`
— the `createEngineState` / engine-`moveCombatant` / try-catch / "Destination is
not reachable this turn" `AutomationWarning` are gone, and the engine
`moveCombatant` import is dropped from the store (automated turns / simulations
still call the engine directly). Rail label: **"Move / place token"**. Tests:
`tests/token-editing.test.tsx` (`placeCombatant` range-ignore / no-op / clamp /
unknown-id; `handleMapClick` routes to it with no warning).

### Store — `placeCombatant(id, cell)` (`encounter-store.ts`)

```ts
placeCombatant: (combatantId, cell) => {
  const { encounter } = get();
  const combatant = encounter.combatants.find((c) => c.id === combatantId);
  if (!combatant) return;
  const footprint = sizeFootprint(getDefinition(encounter, combatant).size);
  const position = {
    x: clamp(Math.floor(cell.x), 0, encounter.map.grid.width  - footprint),
    y: clamp(Math.floor(cell.y), 0, encounter.map.grid.height - footprint)
  };
  if (position.x === combatant.position.x && position.y === combatant.position.y) return; // no-op, no undo entry
  commitEncounter({
    ...encounter,
    combatants: encounter.combatants.map((c) => (c.id === combatantId ? { ...c, position } : c))
  });
},
```
(Type: `placeCombatant: (combatantId: string, cell: { x: number; y: number }) => void` in the store interface.)

### `handleMapClick` move branch (`encounter-store.ts` ~407-429)

Replace the `createEngineState` / `moveCombatant` / `try-catch` block with:
```ts
if (state.tool !== "move" || !selectedId) return;
get().placeCombatant(selectedId, point);
```
Deletes the `moveCombatant` import usage here and the "not reachable this turn"
`AutomationWarning` push. (`moveCombatant` stays imported for nothing in the
store — remove the import.) Automated turns / simulation keep using the engine
`moveCombatant` directly; unaffected.

### Rail copy

`LeftToolRail` — change the Move tool label from `"Move token"` to
`"Move / place token"` (tooltip only; no behaviour there).

---

## Feature D — Drag a token  ✅ done

`useSceneInteraction` gained `draggedToken: { id; cell; pixel: {x,y} | null }` +
`droppingTokenId` + `onTokenPointerDown(event, combatantId)`: under
`tool === "move"` and left button only, `stopPropagation` + (non-shift)
`preventDefault`, `suppressNextMapClickRef = true`, `selectCombatantOnBoard(id,
false)`, record the grab offset (cursor px − token top-left px, via a new
`getLocalPoint` in `coords.ts`), capture the pointer on `.battlemap`, and
`setDraggedToken({ id, cell: position, pixel: null })`. **Shift+press** →
`selectCombatantOnBoard(id, true)`, no drag; **right button** bails so
`onContextMenu` still opens.

**Cursor-precise tracking.** `onMapPointerMove` sets `pixel` (cursor local px −
grab offset, grid-clamped) *and* `cell` (`Math.round` of the same, so it snaps to
where the token visually sits) every move. `onMapPointerUp` commits
`placeCombatant(id, cell)` once (no-op-guarded → a press with no move adds no undo
entry and no settle tag), releases capture, clears `draggedToken`, tags
`droppingTokenId` for 180 ms (only if the token actually moved), and clears the
click-suppress flag after 50 ms. `draggedToken` / `droppingTokenId` also clear on
tool change; `draggedToken` clears if its combatant is pruned; the drop timer is
cleared on unmount.

`SceneCanvas` folds the preview into `tokenLayouts` (`draggedToken` +
`droppingTokenId` memo deps): `x`/`y` come from `pixel` while dragging, so the
token **and its HP bar** track the cursor 1:1, then from the committed cell after.
Flags `dragging` / `dropping` drive the CSS:

- `.token` base transition now always eases `opacity` / `transform` / `box-shadow`
  (position still 0 ms outside replay).
- `.token.dragging` — `opacity .55`, `transform: scale(1.08)`, deeper shadow,
  `cursor: grabbing`, `z-index 5`, and **no position transition** (1:1 follow).
- `.token.dropping` — eases `left`/`top` into the snapped cell over 160 ms and
  `opacity` back to full over 200 ms. `.token-hp.dropping` mirrors the slide so
  the bar stays glued to the token.

The token `onClick` is inert under the Move tool; `.battlemap` gets a `tool-move`
class → `.tool-move .token { cursor: grab }`.

Tests: `tests/token-editing.test.tsx` (non-move no-op, drag start + `pixel: null`
+ select, shift-toggle-no-drag, right-button ignore, **cursor-px tracking** +
snapped-cell commit + settle tag, no-move → no undo / no tag, tool-change cancel);
`getCellPoint`/`getLocalPoint` unchanged behaviour in `scene-coords.test.ts`.
Browser-verified: mid-drag the token sits between grid lines at the cursor with
`opacity 0.55` and `scale(1.08)`; on release it eases into a cell-snapped
position, `.dropping` clears and opacity returns to 1; drop lands far past Speed
with no "not reachable" warning; click-to-place, shift-click, right-click still
behave under the Move tool. No console errors.

### Original design

Reuses the template-drag pattern (capture the pointer on `.battlemap`, let its
existing `onPointerMove` / `onPointerUp` run the drag) and the wall-node preview
pattern (render from a transient point, commit once on drop).

### `useSceneInteraction.ts`

```ts
const [draggedToken, setDraggedToken] = useState<{ id: string; cell: GridPoint } | null>(null);
```

- `onTokenPointerDown(event: PointerEvent<HTMLButtonElement>, combatantId: string)`
  — only when `tool === "move"` (otherwise return and let `onClick` select):
  ```ts
  event.preventDefault();
  event.stopPropagation();
  suppressNextMapClickRef.current = true;
  selectCombatantOnBoard(combatantId, false);
  const start = getCellPoint(mapEl, event.clientX, event.clientY, cellSize);
  event.currentTarget.closest<HTMLElement>(".battlemap")?.setPointerCapture(event.pointerId);
  setDraggedToken({ id: combatantId, cell: start });
  ```
- In `onMapPointerMove`, near the top (before the tool chain, alongside the
  `draggingTemplateId` block):
  ```ts
  if (draggedToken) {
    const p = getCellPoint(event.currentTarget, event.clientX, event.clientY, cellSize);
    setDraggedToken((d) => (d ? { ...d, cell: { x: clamp(p.x, 0, grid.width - 1), y: clamp(p.y, 0, grid.height - 1) } } : d));
    return;
  }
  ```
- In `onMapPointerUp`, near the top:
  ```ts
  if (draggedToken) {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    useEncounterStore.getState().placeCombatant(draggedToken.id, draggedToken.cell); // no-op guarded inside → a plain click won't add an undo entry
    setDraggedToken(null);
    window.setTimeout(() => { suppressNextMapClickRef.current = false; }, 50);
    return;
  }
  ```
- Cancel `draggedToken` in the `useEffect([tool])` cleanup and the roster-prune
  effect.
- Export `onTokenPointerDown` and `draggedToken`.

### `SceneCanvas.tsx`

- In the `tokenLayouts` render, override position for the token being dragged:
  ```ts
  const dragging = scene.draggedToken?.id === combatant.id ? scene.draggedToken.cell : null;
  const x = (dragging ? dragging.x : combatant.position.x) * cellSize;
  const y = (dragging ? dragging.y : combatant.position.y) * cellSize;
  ```
  (Compute in the `.map` body rather than the memo, or fold `draggedToken` into
  the memo deps — the memo is cheap.) Add a `dragging` class for a subtle
  `opacity: .85; cursor: grabbing`.
- Token `<button>`:
  `onPointerDown={replaying ? undefined : (e) => scene.onTokenPointerDown(e, combatant.id)}`.
- `app/globals.css` — `.token { cursor: pointer }` stays; add
  `.map-stage.… ` not needed. Add `.token.dragging { opacity: .85; }` and, when
  `tool === "move"`, `.token { cursor: grab }` is a nice-to-have (needs a tool
  class on an ancestor — the stage already gets `panning` / `pan-ready`; skip
  for v1 or add a `tool-move` class to `.battlemap`).

### No-drag click still selects

`onClick` on the token still fires after a press with no movement (pointer
capture + no `pointermove` → `pointerup` → synthetic `click`).
`suppressNextMapClickRef` only guards the **map** click, not the token's own
`onClick`, so a plain click selects as before; a real drag ends in
`placeCombatant` and the `suppress` flag swallows the map click.

---

## Store changes (`src/store/encounter-store.ts`)

| Action | Notes |
|---|---|
| `placeCombatant(id, cell)` | **new** — clamp-to-grid position set, one undo step, no-ops when unchanged (Feature C). |
| `duplicateCombatant(id)` | **new** — the body of `duplicateSelected` parameterised by id; `duplicateSelected` becomes `() => duplicateCombatant(get().selectedCombatantId)`. Places the copy at `findOpenCell`, selects it. |
| `removeCombatants(ids)` | **new** — `combatants.filter(c => !ids.includes(c.id))` in one `commitEncounter`; re-point `selectedCombatantId` to the first survivor (or null). `removeCombatant` becomes `(id) => removeCombatants([id])`. |
| `handleMapClick` move branch | route to `placeCombatant`; drop the engine-move + warning path; remove the now-unused `moveCombatant` import. |

`duplicateCombatant` for the **multi** "Duplicate all" is called in a `forEach`;
each call is its own `commitEncounter` / undo step. Acceptable for v1 (matches
how the wall menu's per-item actions behaved before `updateWalls`). A batched
`duplicateCombatants(ids)` is a possible follow-up if the undo granularity
annoys.

No schema / persistence change — `selectedCombatantIds` is hook-only and
ephemeral; `placeCombatant` writes the same `position` shape the sheet's Token
tab already edits.

---

## Files touched

| File | Change |
|---|---|
| `src/components/ui/ContextMenu.tsx` / `.module.css` | new `stepper` item shape + row styles |
| `src/hooks/useSceneInteraction.ts` | `selectedCombatantIds` + `selectCombatantOnBoard` / `clearCombatantSelection` / `applyBoardSelection` + store `subscribe` sync; `tokenMenu` + `openTokenMenu` / `closeTokenMenu`; `draggedToken` (`pixel`) + `droppingTokenId` + grab-offset ref + drop timer; `onTokenPointerDown`; token-drag branches in `onMapPointerMove` / `onMapPointerUp`; roster-prune effect; tool-change + context-menu + drag cleanup; Escape / empty-click collapses combatant selection; the two wall-menu openers also close `tokenMenu` |
| `src/components/scene/coords.ts` | new `getLocalPoint` (un-snapped battlemap px); `getCellPoint` refactored onto it |
| `src/components/scene/SceneCanvas.tsx` | token `onPointerDown` / `onContextMenu`; `onClick` shift-aware + inert under Move; `selected` class from the id array; `tokenLayouts` pixel-drag + `dragging` / `dropping` flags; `onEditActor` prop; `tokenMenuItems()` (single + multi) + second `<ContextMenu>`; `tool-move` class on `.battlemap` |
| `src/components/scene/TokenHealthBar.tsx` | `dropping` prop → `.dropping` class (slide with the token) |
| `src/store/encounter-store.ts` | `placeCombatant`, `duplicateCombatant`, `removeCombatants` (+ `duplicateSelected` / `removeCombatant` become wrappers); `handleMapClick` move branch → `placeCombatant`; remove engine `moveCombatant` import |
| `src/components/shell/LeftToolRail.tsx` | Move tool label → "Move / place token" |
| `app/page.tsx` | pass `onEditActor={() => setSheetOpen(true)}` to `SceneCanvas` |
| `app/globals.css` | `.token` eases opacity/transform; `.tool-move .token` grab cursor; `.token.dragging` (fade + lift, 1:1 follow); `.token.dropping` + `.token-hp.dropping` (settle) |

No engine change. `moveCombatant` (engine) stays; only the store's editor path
stops calling it.

---

## Implementation order

1. ~~**`ContextMenu` `stepper`**~~ ✅ — item shape + CSS, isolated.
2. ~~**Feature A**~~ ✅ — `tokenMenu` state, `openTokenMenu` / `closeTokenMenu`,
   `tokenMenuItems` (single), `duplicateCombatant` store action + wrapper,
   `onEditActor` prop, `onContextMenu` on the token.
3. ~~**Feature B**~~ ✅ — `selectedCombatantIds` + `selectCombatantOnBoard` /
   `clearCombatantSelection` / `applyBoardSelection`, store `subscribe` sync,
   `[encounter.combatants]` prune, shift-aware `onClick`, `.selected` class,
   `tokenMenuItems` multi branch + `openTokenMenu` keep-vs-replace, store
   `removeCombatants` + `removeCombatant` wrapper.
4. ~~**Feature C**~~ ✅ — store `placeCombatant`; `handleMapClick` move branch
   routes to it; engine `moveCombatant` import + "not reachable" warning removed;
   rail label.
5. ~~**Feature D**~~ ✅ — `draggedToken` + `onTokenPointerDown` (move-tool /
   left-button / shift-toggle / right-button guards), token-drag branches in
   `onMapPointerMove` / `onMapPointerUp`, `tokenLayouts` preview override +
   `dragging` class, inert move-tool `onClick`, `tool-move` cursor class.

---

## Testing

- **Store (`tests/…store` / `tests/combat.test.ts` neighbours)**
  - `placeCombatant` clamps the footprint inside the grid; sets position; a
    same-cell call adds **no** undo entry; a real move is one undo step.
  - `placeCombatant` ignores movement budget — a Speed-30 token lands 40 ft away
    with no throw and no `AutomationWarning` log line (regression vs the old
    `handleMapClick`).
  - `duplicateCombatant(id)` clones faction / visuals / tactics, resets hp/temp/
    initiative/state, places at a free cell, selects the copy; `duplicateSelected`
    still duplicates the store selection.
  - `removeCombatants([a,b])` drops both in one undo step and re-points
    `selectedCombatantId`; `removeCombatant` still removes one.
- **`useSceneInteraction` (happy-dom)**
  - `selectCombatantOnBoard(id, false)` replaces + sets the store id;
    `(id, true)` toggles membership; removing a combatant prunes it from
    `selectedCombatantIds` and closes `tokenMenu` when the set empties.
  - `openTokenMenu` on an unselected token replaces the selection; on a member of
    a 2+ selection keeps it; opening it closes `wallMenu` (and vice versa).
  - pointer sequence: `onTokenPointerDown` (tool `move`) → `onMapPointerMove` →
    `onMapPointerUp` calls `placeCombatant` once with the drop cell; a
    down→up with no move makes no store write; `onTokenPointerDown` under
    `tool: "select"` is a no-op (click still selects).
- **`ContextMenu` (`tests/…ui`)** — a `stepper` item renders a labelled row with
  one button per `steps` entry, each `onStep(delta)` fires **without** `onClose`;
  the row is not a `menuitem`.
- **Browser smoke** — Move tool: drag an enemy across the whole map, drop; it
  stays, no warning toast/log. Right-click a token → *Edit sheet* opens the
  floating sheet for it; the HP `−5/−1/+1/+5` row nudges the bar live and stays
  open; *Set to full* / *Down (0 HP)* work; *Duplicate* spawns an adjacent copy;
  *Delete* removes it and clears the outline. Shift+click three tokens → all
  outlined → right-click → menu shows only *Duplicate all* / *Delete all*;
  *Delete all* clears them (others intact). Click empty canvas → selection
  clears. Right-click empty canvas with a menu open → it closes. No console
  errors; `tsc` + `next build` clean.

---

## Non-goals

- **Multi-token drag** (drag one of several selected tokens and the rest follow).
  v1 drag acts on the single token and collapses the selection to it.
- **Marquee / rubber-band select.** Shift+click additive only.
- **Batched `duplicateCombatants`** for a single-undo "Duplicate all" — per-token
  undo steps for now.
- **Overlap / footprint collision rejection** on free placement — intentionally
  allowed.
- **A "rules-enforced move" mode** on the Move tool — removed, not hidden behind
  a toggle (locked decision). Legal-movement checking still exists for automated
  turns and simulations via the engine.
- **Terrain / template context menus** — the `ContextMenu` primitive is shared,
  but wiring those stays a separate task (as noted in the wall plan).
- **Keyboard nav inside the menu**, arrow-key token nudging, elevation editing
  from the menu.
