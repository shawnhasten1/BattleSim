# Character Sheet Windows Plan: several sheets at once, popped out, and a styled Codex sheet

**Status:** built (2026-10-06) on branch `sheet-windows`, cut from `pc-builder`, Phases 0 to 7, one commit per
phase; not merged or pushed. The Phase 0 spike is on `sheet-windows-spike`. On 2026-10-06 the user set D2 (a window
belongs to the creature, so its edits reach all of its tokens; token values stay per token), D7 (no new descriptive
fields) and D10 (as proposed). The other decisions took their defaults. "Built so far" at the end has each phase.

## Where the build differs from this plan

- **The body is relocatable** (Phase 4). Switching frames would have remounted it and lost an ability being edited.
  So the body is portalled once into a node that the in-page window and the popup take turns holding.
- **`ActorSheet` stayed one component** rather than splitting into `SheetBody` and `ActorSheetWindow`. The
  relocatable body did the job the split was for.
- **Owner documents** (Phase 3): components that hold a ref to their own element read the document from it. Only
  `ContextMenu`, `InfoTooltip` and the sheet body use the context.
- **Openers:** the Combat panel had no row menu, so a row double-click and a right-click menu with **Open sheet** were
  added. A token's double-click is detected by hand.
- **The Codex was redesigned after it was built** (Phase 8, D12): it now follows Character Codex.html, not the Faerie
  Codex. No ✦ for always-prepared spells (the creature doesn't record which they are).
- **Found while building:** an Export from a popped-out sheet's ⋯ started its download in the main window, which
  browsers ignore. `downloadJson` now takes the document clicked in.
- **Left for the user:** two checks automation can't do. One is typing in a popped-out sheet while the main window is
  really minimized. The other is dragging a compendium entry from the main window onto a popped-out sheet. Both should
  work (Phase 0 note).

The user asked for three things:

1. **Pop-out sheets, like Roll20's:** a sheet can leave the page and become its own browser window, for example on a
   second monitor. It can still be edited there.
2. **Several sheets open at once,** in the page, popped out, or both.
3. **Styled sheets.** The first one is based on `Faerie Codex.html`, a hand-made character sheet in the repo root. It
   gets a new color scheme and is adjusted to fit this project. Here it is called **the Codex**.

## What there is to build on

- **`FloatingWindow`** (`src/components/ui/FloatingWindow.tsx`) is a draggable, minimizable, non-modal window with a
  title bar, a `subheader` and a scrolling body. It is fixed-width (not resizable) and every window shares one z-index
  (`--ui-z-sheet`). `useFloatingWindow`'s comment already says "a manager can layer z-order on top later".
- **There is one `ActorSheet`, and it follows the selection.** `EncounterEditor` holds `sheetOpen: boolean`. The sheet
  shows `useSelectedCombatant()`, so selecting another token changes what the sheet shows. While an ability editor has
  unsaved changes, the sheet pins itself to that token and asks before following (`pinnedId`, `selectionMoved`).
  Five places open it by setting `sheetOpen` and relying on the selection: the canvas's "Edit sheet", the Actors
  panel's Sheet button, Create Token, the builder's `onCreated`, and a compendium creature import.
- **The sheet's edits are all store actions:** `updateCreatureDefinition`, `updateCreatureAbility`, `updateHp`,
  `updateCombatant`, `updateResource` and others. `SheetNumber` and `SheetText` commit as you type, and wrap each focus in
  `mergeEdits(key, fn)` so one focus is one undo step. A styled sheet can reuse all of this unchanged.
- **The encounter store has one copy, persisted to one localStorage key** (`battle-sim-encounter-v1`). Some of its
  actions take callbacks (`mergeEdits(key, fn)`). This matters for how a sheet pops out (D1).
- **`Faerie Codex.html`** is a standalone page with its own data model, local/cloud saving and a hero roster. Its look
  comes from CSS tokens on `:root` with light and dark sets, a gradient "sheen" border, leaf-shaped ability-score cards
  with glowing modifier orbs, orb toggles for proficiency and slots, an HP vial, ruled textareas, coin faces, and a
  mushroom fairy-ring around the hero's initial. Its layout is a 1180px page that uses viewport media queries.

## The idea

A **sheet window** is a small UI record: which creature, which of its tokens is showing, which style, and where it is (in
the page or popped out). A new `sheet-windows-store` holds the open windows. A host renders each one. Every window
renders the same **sheet body** for its creature, inside one of two frames:

- **In the page:** `FloatingWindow`, extended with focus-to-front and resizing.
- **Popped out:** `PopoutWindow`, a browser window opened with `window.open`. The same React tree renders into it
  through a portal, so it uses the same store, the same undo history and the same actions. Nothing needs to be synced.

A **sheet style** is another view over the same data. **Standard** is today's sheet (vitals, Stats | Abilities | Token).
**Codex** is the new one. A style decides only how things look and where they sit. It edits through the same store
actions and shared helpers as Standard, so the two can't disagree. Any edit too big for the Codex (an ability, a spell,
the builder) opens Standard's editor in the same window.

## Decisions

| | Decision | Default |
|---|---|---|
| D1 | How a sheet pops out | **A portal into a `window.open` window**, from the same tab. There is one store, one undo history and no sync, and an edit shows on the canvas the moment it's typed. *Rejected:* a separate `/sheet/[id]` route with its own store, kept in step over `BroadcastChannel`. Two store copies would both write the same localStorage key, `mergeEdits` takes a function that can't be sent between windows, and the two undo stacks would drift apart. *Rejected:* Document Picture-in-Picture. It allows one window per tab and only works in Chromium. |
| D2 | What a window is bound to | **The creature, for as long as the window is open** (user, 2026-10-06), like a Roll20 sheet linked to several tokens. A creature has one window at most. Its edits reach every token of that creature, which is how Stats and Abilities already work (`creatureScope`: "Changes here apply to every Goblin in this scene"). To make one token different, the DM uses the existing ⋯ › **Make it its own creature**. Opening the sheet from any of the creature's tokens brings its window to the front, showing that token. Selecting a token no longer changes an open sheet. This removes the pinning logic and the "You selected X, save first?" prompt. **Values that belong to one token** (current and temp HP, conditions, spent slots, everything on the Token tab) show one token at a time, with a token switcher in the vitals strip. The user confirmed this (2026-10-06): token values stay per token, as on today's sheet. The Token tab's existing "Use these for every Goblin" and "every Goblin's" options stay as they are. |
| D3 | How many | **Up to 8 open at once** (8 creatures), in the page and popped out combined. Opening a 9th closes the one that was focused least recently, with a toast. A window with unsaved ability-editor changes is never closed this way, and the 9th is refused instead. |
| D4 | After a reload | **No windows come back,** the same as today. Each style remembers its last size, and its last popped-out size and screen position, per browser. Popped-out windows close when the main page reloads or closes. They can't outlive it, because their React tree lives there. |
| D5 | Choosing a style | **A Standard \| Codex switch in each window's title bar.** A new window opens in the style last used for that kind of actor (player characters, or everything else), per browser. Both start as Standard until the DM picks Codex once. |
| D6 | The Codex's colors | *Superseded by D12: Dark and Light.* **Three palettes, chosen per browser in the Codex's ⋯ menu:** **Ember** (dark, the default, matches the app), **Parchment** (light, for daylight and printing later) and **Faerie** (the original file's colors, kept because it costs nothing). A palette changes colors only. The ornaments are the same in all three (see "The Codex"). |
| D7 | Fields the engine doesn't have | **None are added** (user, 2026-10-06). The Codex shows only what the model already has. The original's player, XP, inspiration, personality traits, ideals, bonds, flaws, appearance, backstory, notes, coins and free-text gear are left out, and so is any data change for them. |
| D8 | Big edits from the Codex | **The Codex edits what fits on a paper sheet, in place:** scores, saves, skills, HP, temp HP, a typed AC, speed, alignment, languages and slot pips. An attack, spell, feature or item row has an Edit button that switches the window to Standard › Abilities with that ability open, and shows a "← Back to Codex" chip. There is no second ability editor. |
| D9 | Fields the builder owns | **Read-only on the Codex:** class, subclass, level, species and background. Next to them are "Level up…" and "Open in builder…", which open the existing builder windows. A score typed on a built character goes through `updateCreatureAbility`, so it already follows builder D6 and survives a level-up. |
| D10 | Death saves and hit dice | (User, 2026-10-06.) **Death saves are shown as pips from token state, read-only.** The engine owns them, and there's no DM change for them yet. **Hit dice show their total** (for example "5d10 + 2d8" from the build), with nothing to spend, because rests are out of scope (builder D16). |
| D11 | Fonts | *Superseded by D12: Fraunces and Figtree.* **Cormorant Garamond** for headings and numbers, through `next/font` and loaded only with the Codex. Body text uses the app's Signika. Pinyon Script (the script initial) is dropped, because the token's portrait takes its place. |
| D12 | The Codex's design | **Character Codex.html, replacing the Faerie-based one** (user, 2026-10-06): a teal banner with an astrolabe and a level dial, a sidebar with the portrait in an octagonal copper frame and the vitals, ability dials, and Details, Items, Abilities and Spells tabs. Its own Dark and Light colours replace Ember, Parchment and Faerie, and its faces are Fraunces and Figtree. The fields it has that the app doesn't store (XP, Inspiration, coins, carry weight, the Biography tab) stay out, as D7 says (user, 2026-10-06). |

## Part 1: several sheets at once

**`src/store/sheet-windows-store.ts`** (UI only: not undoable and not persisted, except the per-browser preferences in D4
and D5):

```ts
interface SheetWindow {
  id: string;                    // the window's own id (a creature has one window at most: D2)
  definitionId: string;          // the creature it edits; every edit to it reaches all of its tokens
  combatantId: string;           // the token whose own values show (HP, conditions, slots, the Token tab)
  style: "standard" | "codex";
  tab: SheetTabId;               // Standard's tab; the Codex ignores it
  placement: "page" | "popped";
  z: number;                     // focus order: higher is in front, and the lowest closes first (D3)
}
// actions: open(combatantId, opts?) (its creature's window if one is open, showing that token), close(id), focus(id),
//          showToken(id, combatantId), setStyle(id, style), setTab(id, tab), popOut(id), dock(id),
//          reconcile(encounter) (see below)
```

- **`SheetWindowsHost`** takes the place of `{sheetOpen ? <ActorSheet/> : null}` in `EncounterEditor`. It renders each
  window, and runs `reconcile` after any change to `encounter.combatants` or `currentEncounterId`:
  - **The shown token is removed,** and the creature has other tokens: the window shows the next one.
  - **The creature has no tokens left,** or the scene is switched: the window closes.
  - **The shown token changes form** (a werewolf into its hybrid form): the window follows it to the creature it shows
    now (`getDefinition`). If that creature already has a window, the two merge into the one in front.
- **Make it its own creature,** from a window, moves that window to the new creature. The DM split the token off to edit
  it on its own. The original creature's other tokens can open their sheet again as usual.
- **`ActorSheet` is split in two.** `SheetBody({ definitionId, combatantId, style })` holds the vitals, tabs and content.
  `ActorSheetWindow` is the frame. `useSelectedCombatant`, `pinnedId` and `selectionMoved` leave the sheet (D2). The
  unsaved-changes guard stays, but per window: closing a window, switching its tab or switching its style still asks.
  **Switching the token never asks,** because an ability being edited belongs to the creature, which stays the same.
  The compendium drop, toast and ⋯ menu move with the body, so each window has its own.
- **The token switcher** sits in the vitals strip when the creature has more than one token: "Goblin 3 ▾ (1 of 5)". It
  lists the tokens by name, with their HP. Choosing one also selects it on the canvas. When the creature has a single
  token, the switcher is just its name.
- **The title** is the creature's name, with its token count when there's more than one: "Goblin · 5 tokens". With a
  single token it reads as today ("Goblin 1 · Goblin"), or just the name when the token and the creature share it
  ("Mira").
- **Every place that opened the sheet** now calls `open(combatantId)`: the canvas's "Edit sheet", the Actors panel's
  Sheet button, Create Token, the builder's `onCreated`, and the compendium creature import.
- **New ways to open a sheet:** double-clicking a token on the canvas (no component uses double-click today), and an
  "Open sheet" item on a Combat panel initiative row's menu.
- **`FloatingWindow` changes:**
  - **Z-order.** It takes a `z` value and an `onFocus` callback. A pointerdown or focusin anywhere in the window brings it
    to the front. The z-index is `--ui-z-sheet` plus the window's rank, and stays below `--ui-z-modal`.
  - **Resizing.** An optional `resizable` with `minSize` and `maxSize` adds a corner grip that works with pointer events,
    like the title-bar drag. The size is clamped to the viewport.
  - **Cascade.** A new window opens 28px down and right of the window in front, and wraps around before it would leave
    the viewport. Each style's last position is still remembered (`win:sheet-standard`, `win:sheet-codex`).
  - **Minimize** is unchanged, and still hides the content rather than unmounting it.
- **The title bar gains** the style switch (D5), a pop-out button, and the existing automation count, ⋯ menu and info
  button.

## Part 2: popping out

**`PopoutWindow`** (`src/components/ui/PopoutWindow.tsx`) is the second frame:

1. **Opening.** On the Pop out click (a user gesture, so popup blockers allow it), it calls
   `window.open("", "battlesim-sheet-<windowId>", "popup,width=…,height=…,left=…,top=…")`. Size and position come from
   the last popped-out window of that style (D4). If the call returns `null`, the window stays in the page and a toast
   says "Your browser blocked the pop-out. Allow pop-ups for this site and try again."
2. **The document.** It writes a minimal page into the new window: `<html lang class={the main <html>'s classes}>`,
   which carries the `next/font` variables. It copies every `<link rel=stylesheet>` and `<style>` from the main `<head>`.
   A `MutationObserver` on the main `<head>` mirrors stylesheets added later (CSS chunks loaded on demand, and dev HMR).
   It also sets `color-scheme`, a body background in the app's or the Codex's colors, and the favicon.
3. **The content.** `createPortal(<OwnerDocumentProvider doc={popup.document}>…</OwnerDocumentProvider>, popup.document.body)`.
   React 17 and later listen for events on a portal's container, so clicks and typing inside the window reach React.
   The window's own top bar holds the title, the style switch, **Undo** and **Redo** (the main window's top bar
   may be on another monitor), a **Dock** button, and the ⋯ menu.
4. **The title.** `popup.document.title` follows the window's title ("Goblin · 5 tokens — BattleSim"), and changes
   when the creature is renamed or its token count changes.
5. **Closing.**
   - **The DM closes the browser window:** a `pagehide` listener on the popup closes the sheet window. If its editor had
     unsaved changes, it docks the sheet back into the page instead, so nothing is lost.
   - **The main page closes or reloads:** a `pagehide` listener on the main window closes every popup.
   - **Dock** closes the popup and puts the window back in the page, at its last in-page position.

### Code that assumes a single window

Inside a popup, `document` and `window` still mean the **main** window, because the code runs there.
`instanceof Element` also fails for nodes in the popup, because each window has its own `Element` class. Phase 3 adds
`useOwnerDocument()` and `useOwnerWindow()`, which read from `OwnerDocumentContext` and fall back to the globals, and it
fixes every one of these:

| Where | What breaks in a popup | Fix |
|---|---|---|
| `ContextMenu`, `InfoTooltip` | They portal to `document.body`, so they open in the main window. Their click-outside, Escape, scroll and resize listeners never fire. They clamp to the main window's size. | Portal to, listen on and clamp to the owner document and window |
| `AbilitiesList`, `EffectCards`, `FeatureEffectCards`, `FeatureSections` | Click-outside listeners are on `document` or `window`, and roving focus reads `document.activeElement` | Owner document |
| `FloatingWindow` | Focus is restored through `document.activeElement` | Owner document (only the in-page frame uses it, but this keeps it safe) |
| `useFloatingWindow` | `event.target instanceof Element` | `"closest" in target` |
| `AbilityEditor` | Its `requestAnimationFrame` belongs to the main window, which pauses it while that tab is hidden | The owner window's `requestAnimationFrame` |
| `AbilityEditor` `beforeunload` | Fine: the guard belongs on the main page | None |
| `useSceneInteraction`, `Hotbar` keyboard shortcuts | Fine: they belong to the main window | None |

A **guard test** goes with the fixes. It grep-fails on `document.body`, `document.activeElement`,
`document.addEventListener` and `window.addEventListener` in `src/components/sheet/**` and `src/components/ui/**`,
unless the line has a `// main-window only` comment. That stops new code from bringing the problem back.

### Builder windows opened from a popup

"Level up…", "Open in builder…" and the Homebrew window are `FloatingWindow`s in the **main** page. In v1, opening one
from a popped-out sheet shows a toast in the popup: "Opened in the main window." Most browsers ignore a script's
attempt to focus another window. Moving those windows into the popup is out of scope.

## Part 3: the Codex

### The look, adjusted to this project

The original's whimsy (mushrooms, fairy motes, script initials) gives way to an ink-and-ember look that matches the
app's dark Foundry-style shell (`--ui-*` in `app/globals.css`). It keeps what made the original feel crafted: the
gradient sheen border, uneven corner radii, big serif numbers, orb toggles and the HP vial.

| Original | Codex |
|---|---|
| Fairy ring of mushrooms around the hero's initial | **The token's portrait** (`ActorThumbnail`'s image, with its border color) in a gilded ring with 12 tick marks, like an initiative dial. It flares once when the name changes, and the animation is off under `prefers-reduced-motion`. |
| Leaf-shaped ability cards | **Heater-shield crests,** with the same inset score, ± steppers and modifier gem below |
| Teal "wisp" modifier orbs | **Ember gems:** a radial gradient from `--accent` to deep amber |
| Leafy sprigs at the hero's corners | **Filigree corner brackets** (SVG strokes in the sheen) |
| Pink/teal/violet/gold sheen | **Ember, gold, brass, oxblood** (Ember palette) |
| Berry HP vial | **Fills by fraction in the app's HP colors** (`--ui-hp-high`/`mid`/`low`), so it matches the token health bars. Temp HP is a steel-blue hatch. |

**Palettes** (D6) are token sets on the Codex root, `data-palette="ember|parchment|faerie"`. Nothing outside the
`.codex` root is themed. The starting values for Ember and Parchment:

```css
/* Ember (dark, default) */
--bg:#14110E; --panel:#1D1915; --panel-2:#26201A; --ink:#E8DCC4; --muted:#9A8F7D;
--accent:#D98A3D; --accent-soft:rgba(217,138,61,.28); --gild:#C9A227; --gild-glow:rgba(201,162,39,.45);
--good:#C9A227; --bad:#A1423F; --temp:#6F8FB5;
--line:rgba(217,138,61,.34); --line-soft:rgba(232,220,196,.14); --rule:rgba(232,220,196,.10); --field:rgba(232,220,196,.05);
--sheen:linear-gradient(130deg,rgba(217,138,61,.75),rgba(201,162,39,.6) 35%,rgba(138,106,58,.55) 65%,rgba(122,46,42,.6));

/* Parchment (light) */
--bg:#EFE6D2; --panel:#F8F2E4; --panel-2:#F1E8D4; --ink:#2B2118; --muted:#6E6250;
--accent:#8C2F1F; --gild:#9A7417; --good:#9A7417; --bad:#8C2F1F; --temp:#3D6EA6;
--sheen:linear-gradient(130deg,rgba(140,47,31,.55),rgba(154,116,23,.5) 40%,rgba(90,70,40,.4));
```

Faerie takes its dark and light sets straight from the original file. Each palette meets 4.5:1 contrast for text and
3:1 for the orbs and borders. Phase 5 checks this.

**The layout works inside a window, not a page.** The original's `@media (max-width…)` rules become **container
queries** on the Codex root. At 1000px or wider it has three columns, from 700px two, and below that one. So it reflows
the same in a 720px in-page window and in a full-screen popup. A new Codex window opens at 960 × 760 (or the viewport,
if that's smaller), with a 640px minimum.

### What's on it, and where each value comes from

| Section | Shows | Edits through | Notes |
|---|---|---|---|
| Hero | Portrait ring, **name**, "A level 7 Rogue (Thief), Elf by birth, Sage by trade, chaotic good at heart" | `updateCreatureDefinition` (name, alignment) | With several tokens, the token switcher (D2) sits under the name. Class, subclass, level, species and background are read-only (D9). For a hand-made actor, the sentence uses `character.classes`, or the creature type for a monster. |
| Abilities | 6 crests: score, ±, modifier | `updateCreatureAbility` | Same rules as Stats (a built character's typed score becomes a base change) |
| Vitals | AC, Initiative, Speed, Proficiency | AC typed only when nothing works it out (`armorClassOf`), otherwise read-only with its parts in a tooltip; speed through Stats' movement setter | Initiative is the DEX modifier plus any bonus, read-only. Proficiency is read-only (`proficiencyOf`). |
| Hit points | Current / max, ±1 buttons, the vial, temp | The same calls as `VitalsStrip` (`updateHp`, `updateCombatant`) | For the token the switcher shows (D2). Max HP is read-only here (edited on Stats). Conditions show as chips with the vitals strip's "+ Condition" menu. |
| Death saves | Three success and three failure pips | Read-only (D10) | Only for a player character |
| Hit dice | "5d10" | Read-only (D10) | Only for a built character |
| Saving throws | Orb (proficient or not) and value | Stats' `setSave` and `saveKind` logic, moved to `lib/actor-sheet` so both styles import it | A custom number shows an amber orb, as on Stats |
| Skills | 18 skills: orb cycles none → proficient → expertise, and the value | `skills` through `skillBonus`/`skillKind` | A skill of its own keeps its number and shows "its own" |
| Passive Perception | The moon badge | Derived | The same helper as Senses |
| Proficiencies & languages | Languages (editable); armor, weapon and tool proficiencies from the build (read-only) | `languages` | |
| Attacks | Rows with name, to-hit and damage, for weapons and attack actions | Edit → Standard (D8) | Same summary as the Abilities list rows |
| Spellcasting | Ability, save DC, attack bonus; slot pips per level; spells grouped by level, with ✦ for always-prepared | Pips: `updateResource` on the shown token's `slot-N`. Rows: Edit → Standard. | Hidden for a creature with no spells or slots |
| Equipment | Weapons, worn armor and shield, carried items | Edit → Standard | |
| Features & traits | Names with a short description each | Edit → Standard | |

Sections with nothing in them disappear, so a goblin in Codex style reads as a short card rather than an empty character
sheet.

**Dropped from the original:** its hero roster and New/Delete buttons (windows do that job now), its own local/cloud
saving, and every field the model doesn't have (D7): player, XP, true name, inspiration, the hit-dice "spent" box,
coins, free-text equipment, personality traits, ideals, bonds, flaws, appearance, backstory and notes.

### Edits

Every Codex box is a `SheetNumber` or `SheetText` with a Codex class name. They already take `className` and `style`.
So an edit commits as it's typed and one focus is one undo step, exactly as on Standard. Creature values reach every
token of the creature, and token values reach the token the switcher shows (D2), the same as on Standard.

### Adding more styles later

`src/components/sheet/styles/registry.ts` maps a style id to `{ label, Component, defaultSize }`. A new style is one
folder and one registry line. It needs no store changes and no new editing logic.

## Modules

- `src/store/sheet-windows-store.ts`: new
- `src/components/sheet/SheetWindowsHost.tsx`, `ActorSheetWindow.tsx`, `SheetBody.tsx`: from the split of `ActorSheet.tsx`
- `src/components/ui/FloatingWindow.tsx`, `useFloatingWindow.ts`: z-order, `onFocus`, resizing, cascade
- `src/components/ui/PopoutWindow.tsx`, `src/hooks/useOwnerDocument.ts`: new
- `src/components/sheet/styles/registry.ts`: new
- `src/components/sheet/codex/`: `CodexSheet.tsx`, one file per section, `ornaments.tsx` (ring, crest, filigree SVGs),
  `codex.module.css`, `fonts.ts`
- `src/lib/actor-sheet/saves.ts` and `skills.ts`: helpers moved out of the Stats components, so both styles use them
- No engine or schema changes (D7)
- Docs: the actor sheet guide gets "Sheets in windows" and "The Codex" sections

## Phases

Each phase is one commit, and the tests pass before it's committed. Browser verification uses the seeded login
(memory: browser-verify-login) and starts from a blank encounter, testing every new control on its own.

### Phase 0: pop-out spike (throwaway, about half a day)

Before anything else, prove D1 works in this app. On a scratch branch, portal the current `ActorSheet` into a
`window.open` window with copied styles, then check:

- **Typing mid-word** in `SheetText` and `SheetNumber`. React picks an update's priority from the main window's
  `window.event`, which is empty for an event in another window. A controlled box can then update a beat late, and the
  caret can jump to the end.
- Undo after typing, the ⋯ menu, a tooltip, the condition menu, the ability editor's effect-card menus.
- Typing in the popup while the main window is minimized, and while it's behind another window on a second monitor.
- Dragging a compendium entry from the main window onto the popup.
- Chrome, Edge and Firefox.

**Output:** a short note in this plan. If the caret jumps, the fix to adopt is one of: wrapping the boxes' `onChange` in
`flushSync`, or setting the popup's text boxes to commit from an uncontrolled input. If a cross-window drag doesn't
carry the custom data types, the popup's drop zone says "Drag onto a sheet in the main window" instead. If the spike
fails outright, stop and re-plan D1.

**Result (2026-10-06): D1 holds, and no caret fix is needed.** Branch `sheet-windows-spike` (one commit) popped the
current sheet out with `openPopup` + `PopoutWindow` and an `OwnerDocumentContext` in `ContextMenu` and `InfoTooltip`.
A Playwright script passed every check in Chromium (17/17), Edge (17/17) and Firefox (16/16; the minimize check is
Chromium-only):

- Typing mid-word in `SheetText` (Name) and mid-number in `SheetNumber` (Temp HP) keeps the caret where it was. React
  19 sets `ReactDOMSharedInternals.p` to the discrete priority while it dispatches an event through its own listeners,
  and it listens on a portal's container when the portal mounts. So `window.event` being empty in the main window never
  matters.
- Edits reach the main store at once. Undo in the main window updates the popup.
- With the owner-document fix, the ⋯ menu, a tooltip and the condition menu open in the popup and close on an outside
  click there.
- Closing the popup brings the sheet back into the page. Dock works. Reloading the main page closes the popup.
- The copied stylesheets bring the app font (`next/font`'s class on `<html>`) with them.

**Couldn't be automated:**

- **A hidden main window.** Chromium and Edge both reported a CDP-minimized window as still `visible`, with timers
  unthrottled, so automation can't force the hidden state. Typing and re-rendering in the popup don't depend on the main
  window's timers: discrete updates flush in a microtask. The one `requestAnimationFrame` (`AbilityEditor`) moves to the
  owner window in Phase 3. A manual check is left for the user.
- **A drag from the main window's compendium onto a popup.** Playwright can only drag within one page. The popup's drop
  handlers are the same React handlers, so a browser that carries custom drag types between windows will just work.
  This is left as a manual check too.

### Phase 1: several sheets in the page

- `sheet-windows-store`, `SheetWindowsHost`, and the split into `SheetBody` and `ActorSheetWindow`
- Every opener calls `open(combatantId)`. Add double-click on a token and the initiative row's "Open sheet".
- Windows bound to their creature (D2), the token switcher and the title, focus-to-front, the 8-window cap (D3),
  cascade, `reconcile`, and Make it its own creature moving the window
- The unsaved-changes guard per window
- Tests:
  - Two different creatures open two windows. Two tokens of one creature open one window, showing the token opened last.
  - Selecting another token leaves an open sheet alone.
  - With 3 Goblins open in one window, an AC or ability edit reaches all 3, and an HP edit reaches only the token the
    switcher shows.
  - Switching the token while an ability has unsaved changes doesn't ask, and keeps the editor open.
  - Deleting the shown token moves the window to the next one. Deleting the last token closes the window. Switching
    scenes closes all of them.
  - A shapechanger's window follows its token into its new form.
  - Make it its own creature moves the window to the new creature.
  - The cap closes the least recently focused window, and never one with unsaved changes.
  - The existing `actor-sheet*.test.tsx` tests move from selection to `open(id)`.

### Phase 2: resizing

- `FloatingWindow` gets `resizable`, `minSize` and `maxSize`, and remembers a size per style
- The Standard sheet becomes resizable (from a 680px default and 560px minimum)
- Tests: `useFloatingWindow` resize clamping; size remembered per storage key

### Phase 3: code that assumes one window

- `OwnerDocumentContext`, `useOwnerDocument` and `useOwnerWindow`, and every fix in the table above
- The grep guard test
- A component test that renders a sheet into a second `document` (made with `document.implementation.createHTMLDocument`)
  through a portal, opens the ⋯ menu and the condition menu, and checks that they open in that document and close on
  an outside click there

### Phase 4: pop out

- `PopoutWindow`, the Pop out and Dock buttons, the popup's top bar (Undo and Redo), title sync, closing in both
  directions, the blocked-popup toast, remembered popup size and position, and the "Opened in the main window" toast
  for builder windows
- Whatever the Phase 0 spike decided for typing and drops
- Tests: store transitions (`popOut` and `dock` keep the tab and style; `closeMissing` closes popped windows too); the
  `PopoutWindow` lifecycle with a stubbed `window.open` (stylesheets copied, a style added later is mirrored, `pagehide`
  closes, a blocked popup falls back)
- Browser: Playwright's `context.waitForEvent("page")` to drive two popped-out sheets at once. Edit HP in one and see
  the token's health bar change on the canvas. Undo from the popup. Close a popup with the browser's own close button.
  Reload the main page and see the popups close.

### Phase 5: the Codex, frame and top half

- The style registry; the Standard | Codex switch; preferences per actor kind (D5)
- `codex.module.css` with the three palettes and container queries; the fonts (D11); the ornaments
- Hero, abilities, vitals, HP, death saves, saving throws, skills, Passive Perception, proficiencies and languages
- Save and skill helpers moved to `lib/actor-sheet`, and Stats updated to import them
- Tests: each edit calls the same action Standard does, and one focus is one undo step; the skill orb cycles
  none → proficient → expertise → none; a read-only field for a built character can't be typed into; the contrast of
  each palette's tokens is checked in a unit test

### Phase 6: the Codex, bottom half

- Attacks, spellcasting (slot pips and spell rows), equipment, features and traits
- Edit → Standard with "← Back to Codex", reusing Standard's `openFirst`
- Empty sections disappear, so a monster's card stays short
- Tests: spending and restoring a slot pip changes the shown token's `slot-N` and no other token's; Edit on a spell
  opens it in the Standard editor in the same window; Back returns to the Codex at the same scroll position; a
  non-caster has no spellcasting section

### Phase 7: docs, guide screenshots, and a from-blank pass

- Guide sections with screenshots in each palette
- A from-blank pass: a new PC through the builder, opened as a Codex, popped out, every field edited, exported and read
  back; then three goblins in one Codex window, in the page, switching between them
- Decide what happens to `Faerie Codex.html` (keep it under `docs/reference/`, or delete it once the Codex is built)

## Tests to keep

- The `actor-sheet*.test.tsx` suite, with tests that relied on "the selected token" changed to open a window for a token
- A new `sheet-windows.test.ts` (store), `popout-window.test.tsx` (lifecycle, stubbed `window.open`),
  `owner-document.test.tsx` (a second document) and `codex-sheet.test.tsx` (edits and undo, which tokens an edit
  reaches, empty sections, read-only fields)
- The grep guard against window globals in sheet and UI code

## Risks

- **Typing in a popup.** The caret risk is in Phase 0. If neither fix works cleanly, popped-out sheets could open
  read-mostly, with edits done by docking. That's a step down from Roll20, so it goes to the user.
- **The main window throttled while the DM works in a popup.** Browsers slow timers in hidden tabs. The sheet's edits
  are synchronous store updates and don't depend on timers, but toasts and `requestAnimationFrame` do. Phase 0 checks
  this with the main window minimized.
- **Stylesheets that arrive late.** `next/font` and CSS-module chunks load as they're needed, and dev HMR swaps them.
  The `MutationObserver` mirror handles both. A Codex font that hasn't loaded yet can show a fallback font for a moment
  in a new popup.
- **Leaked listeners.** Each `PopoutWindow` removes its observers and `pagehide` listeners when it unmounts.
  `owner-document.test.tsx` checks that closing removes them (memory: component-test-cleanup).
- **Eight sheets re-rendering on every store change.** Each body picks only its token and creature from the store, so
  an unrelated edit doesn't re-render it. Phase 1 measures with 8 open during Auto Run, and a minimized window can stop
  rendering its body if it needs to.
- **Popup blockers and window placement.** Pop out always comes from a click. Browsers may ignore `left` and `top` on
  another monitor unless the site has window-management permission. The popup then opens on the current screen, and
  the DM drags it.

## Out of scope

- Player-owned sheets, sharing a sheet, or multiplayer (AGENTS.md scope boundary)
- Sheets for library actors with no token on the map. Today's sheet is token-based, and that stays.
- Printing or PDF export of the Codex. The Parchment palette makes it a small follow-up with `@media print`.
- User-authored sheet templates (like Roll20's custom sheet sandbox)
- Moving builder and Homebrew windows into a popup
- Rests, spending hit dice, and editing death saves by hand
- Descriptive fields the engine doesn't use: player, XP, inspiration, personality, story, coins (D7)

## Built so far

### Phase 1 (2026-10-06)

- **`src/store/sheet-windows-store.ts`**: as planned, plus `origin` (where the window opens), `popup` (its browser
  window once popped out, for Phase 4), `dirty`, and the per-window `positions` the cascade reads. `notice` carries an
  optional Undo. Each kind's style (D5) and the last tab are remembered per browser.
- **`ActorSheet` stays one component** for now: it takes a `SheetWindow` and its rank. Its token is the window's, or
  (for the moment between a token's deletion and the host's `reconcile`) another token of its creature. The body/frame
  split waits for Phase 4, which is the first phase with a second frame.
- **`SheetWindowsHost`** renders the windows in the order they opened (focusing one never remounts any), passes each
  its rank, and runs `reconcile` on every change to the tokens or creatures. A scene change (`currentEncounterId`, or
  the encounter's id in the sandbox) closes every window.
- **The token switcher** is a select in the vitals strip ("Goblin 1 · 7/7 HP", "1 of 2"). The title reads "Imported
  Goblin Stand-in · 2 tokens".
- **Where the build differs:**
  - **The Combat panel had no row menu.** A row now opens its token's sheet on a double-click, or from a right-click
    menu with **Open sheet**.
  - **A double-click on a token is detected by hand,** as two presses within 400 ms and 6 px. The token's first press
    captures the pointer on the battlemap, so no `dblclick` reaches it.
  - **Duplicate token** (⋯) shows the copy in the same window, as the old selection-following sheet did.
  - **Deleting a creature's last token** from its window closes the window, so its "Deleted Fighter. Undo" toast
    moves to the host, at the bottom of the page.
  - **Compendium messages** show only in the window in front. A drop brings its window to the front first.
  - **Tool windows** (builder, Homebrew, Create Token, report) now sit 10 above `--ui-z-sheet`, so the stacked sheets
    (ranks 0 to 7) never cover them.
  - **Windows are opaque** (the 95% panel colour over `--ui-bg`), so stacked sheets don't show through each other.
    Title bars can't be text-selected while they're dragged.
  - **Not done:** every window still re-renders on any encounter change, as the single sheet did. The Phase 7 pass
    measures it with several windows open during Auto Run.
- **Tests:** `tests/sheet-windows.test.tsx` (18). The 7 sheet test files open windows through `tests/helpers/sheet.tsx`.
  "Stays on the creature being edited when another token is selected" became "stays on its creature… keeping the
  edit". The ability editor's creature-switch test now switches by making the token its own creature. Full suite:
  248 files, 2767 tests. Browser (Playwright, Chromium): 15 checks, among them double-click, the row menu, cascade,
  focus order, switching tokens, per-token HP, and the notice with Undo.

### Phase 2 (2026-10-06)

- **`useWindowResize`** (in `useFloatingWindow.ts`) and `clampSize`. A corner grip resizes within min/max limits and
  the room left to the viewport's edge. The size is remembered per storage key (`winsize:<key>`), and only once the
  window has been resized. Until then a window is its starting width and as tall as its content, as before.
- **`FloatingWindow`** takes `resizable: { minWidth, minHeight, maxWidth?, maxHeight? }`. A resized window keeps its
  height (`max-height` lifted). Minimized, it's still only its title bar.
- **The sheet** is resizable from 680 × its content, down to 560 × 320, up to 1400 wide. The size is remembered per
  style (`winsize:sheet-standard`).
- **Tests:** 4 more in `tests/useFloatingWindow.test.tsx`. Browser: 6 checks (grip, resize, the body scrolls, clamped
  at the minimum, minimized, remembered after a reload).

### Phase 3 (2026-10-06)

- **`src/hooks/useOwnerDocument.ts`** (`OwnerDocumentContext`, `useOwnerDocument`, `useOwnerWindow`) from the spike.
  Both hooks are safe on the server, where there's no `document`: InfoTooltip renders its trigger there.
- **`ContextMenu` and `InfoTooltip`** portal to, listen on and clamp to the owner document and window (from the spike).
- **Where the build differs:** components that hold a ref to their own element read the document from it
  (`menuRef.current.ownerDocument`, `event.currentTarget.ownerDocument`) instead of the context. That covers
  `AbilitiesList`'s row menu, the effect menus in `EffectCards`, `FeatureEffectCards` and `FeatureSections`,
  `FloatingWindow`'s focus restore, `useFloatingWindow`'s drag clamp, and `AbilityEditor`'s `requestAnimationFrame`.
  `Modal` does the same (no sheet uses it, but it's under `ui/`). `useFloatingWindow`'s `instanceof Element` became a
  `closest` check. `AbilityEditor`'s `beforeunload` stays on the main window, marked `// main-window only`.
- **Tests:** `tests/owner-document.test.tsx`. A sheet is portalled into a second happy-dom `Window` (its own `Element`
  class, like a real popup). The ⋯ menu, the condition menu (its choice reaching the token), a tooltip and an ability
  row's ⋯ menu open there and close on a click there. The grep guard fails on `document.body`,
  `document.activeElement`, `document.add/removeEventListener` and `window.add/removeEventListener` in `sheet/**` and
  `ui/**` without `// main-window only`. With the old `ContextMenu` swapped back in, three of them fail. Full suite:
  249 files, 2777 tests.

### Phase 4 (2026-10-06)

- **`PopoutWindow`** (from the spike), plus `popupBounds` and **`PopoutFrame`**. The frame's bar holds the title, the
  sheet's controls (automation count, ⋯, info), Undo, Redo and Dock, and it reports a press inside as focus.
  `openPopup` copies the main page's stylesheets and `<html>` classes. A `MutationObserver` mirrors stylesheets added
  or removed later. The popup's `<html>` and `<body>` get the app's background and a dark `color-scheme`.
- **Where the build differs: a relocatable body.** Switching frames would remount the sheet's body and lose an ability
  being edited, so the "dock back so nothing is lost" rule needed more than the plan said. `src/components/ui/
  Relocatable.tsx` makes a node (`useRelocatable`) that the body is portalled into once. Each frame holds it in a
  `RelocatableSlot`, which moves the node in as it mounts. React listens on a portal's container, so events keep
  arriving after the node moves into the popup's document. The body's `OwnerDocumentContext` is the popup's document
  while popped out, and otherwise whatever it inherits. `FloatingWindow` gained `onPopOut` (a Pop out control in its
  title bar) and `scrollBody={false}` (a column the body fills; the sheet's vitals and tabs stay put and its content
  scrolls below them).
- **Closing:** Dock and every in-page close unmount `PopoutWindow`, which closes the popup a tick later (Strict Mode
  safe) and saves its size and position first (`popup:sheet-<style>`). The DM closing the popup docks the sheet if its
  editor has unsaved changes, and closes it otherwise. The main page's `pagehide` closes every popup.
- **Builder windows:** a popped-out sheet in front that sees a builder or Homebrew window open says "Opened in the main
  window."
- **Tests:** `tests/popout-window.test.tsx` (14). `window.open` is stubbed with a second happy-dom window, which
  covers `openPopup` (features, title, classes, stylesheets, blocked), the stylesheet mirror, both kinds of close, the
  main page going, pop out and Dock keeping the tab, an unsaved ability edit kept through pop out and Dock, closing
  with unsaved changes docking, edits from the popup with its Undo, the builder toast, and a scene change closing the
  popup. Full suite: 250 files, 2791 tests. Browser (Playwright, Chromium and Firefox, 14 checks each): two sheets
  popped out at once and titled, an HP edit in a popup reaching the map's health bar and Undo there taking it back,
  menus and conditions in the popup, an unsaved edit through Dock and a second pop out, closing with unsaved changes
  docking, the next popup opening at the last one's size, and a reload closing the popups.

### Phase 5 (2026-10-06)

- **The style registry** (`src/components/sheet/styles/registry.ts`): each style's label, starting size and limits.
  Standard is 680 wide, as tall as its content, minimum 560 × 320. The Codex is 960 × 760, minimum 640 × 360.
- **The style switch** (`StyleSwitch`, Standard | Codex) is in the title bar of both frames. It asks first when an
  ability has unsaved changes. It's remembered per kind of actor (D5): a PC is a creature with `character`, or a token
  on the party's side. The in-page frame is keyed by style, so each style has its own size, remembered apart
  (`winsize:sheet-standard`, `winsize:sheet-codex`). The relocatable body keeps everything inside through the switch.
  `useWindowResize` and `FloatingWindow` gained a starting height, clamped to the viewport.
- **The Codex** (`src/components/sheet/codex/`): `CodexSheet` with the hero, ability crests, vitals (AC, initiative,
  speed, proficiency, HP with −/+, the vial, temp HP, conditions, death saves, hit dice), saving throws, Passive
  Perception, languages and skills. It also has `ornaments.tsx` (portrait ring, crest, filigree), `codex.module.css`
  (container queries: three columns at 1000px and up, two from 700, one below), and `fonts.ts` (Cormorant Garamond
  through `next/font`, `preload: false`). It's loaded with `React.lazy`, so its code, CSS and font arrive the first
  time a Codex opens.
- **Palettes** are TypeScript (`src/lib/actor-sheet/codex.ts`, `CODEX_PALETTES`) set as custom properties on the
  Codex root, so one source feeds both the CSS and the contrast test. Inside the root the app's `--ui-*` tokens are
  remapped to the palette, so shared pieces (the conditions row, the switcher) take its colours. The palette is per
  browser, in the windows store (`codex-palette`), and picked from ⋯ › Codex colours.
- **Shared with Standard, not copied:** the engine's initiative bonus is now `initiativeOf` (the roll uses it too).
  `withSave`, `toggledSave`, `cycledSkill` and `withSkill` are in `lib/actor-sheet/edits.ts` (Stats' save setter uses
  `withSave`). `ConditionsRow` came out of the vitals strip. `SheetText` takes a `className`.
- **Where the build differs:**
  - **Faerie** is the original's dark set only. The app has no light mode; Parchment is the light palette.
  - **"Proficiencies & languages" is Languages only.** Armor, weapon and tool proficiencies aren't on a creature.
  - **A monster's sentence** reads "A Small humanoid of challenge 1/4, _ at heart."
  - **The hero shows "Level up…" and "Open in the builder…"** for a built character, and the token switcher
    ("Showing Goblin 1 · 7/7 HP of 2 tokens").
- **Tests:** `tests/codex-sheet.test.tsx` (19): numbers, initiative with a feature, scores (one undo step each, and the
  steppers), the save and skill orbs, name and alignment, HP and temp for the token shown, a condition, a built
  fighter (sentence, hit dice, read-only class and level, Level up, worn armor's AC as an output, death saves), no
  death saves for a monster, the style switch remembered per kind, the unsaved-changes prompt, the palette menu, and
  each palette's contrast (text 4.5:1, accent and gild 3:1, on both panel colours). `next/font/google` is aliased to a
  stub under vitest. Full suite: 251 files, 2810 tests. Browser (Chromium and Firefox, 8 checks each): a Standard
  sheet popped out and switched to the Codex in the popup gets the Codex's late-loaded CSS and font there. Edits there
  reach the store and the map. Docked it's the Codex at 960 wide, and Standard is back at 680 with the edit. A
  goblin's Codex edits the token it shows.

### Phase 6 (2026-10-06)

- **The Codex's bottom half reads the Abilities list's own model** (`abilityList(definition, combatant)`), so every
  row says what Standard says: its name, cost, statblock line and chips, with Edit. The panels are **Attacks &
  actions** (actions, bonus actions and reactions, each titled), **Equipment** (the items group, with "worn" on worn
  armor), **Spellcasting**, **Features & traits**, and the legendary, lair and on-death groups when it has them. A
  section with nothing in it isn't drawn, and a lone panel in a row spans it, so a goblin's Codex has no Equipment or
  Spellcasting.
- **Spellcasting:** ability, save DC and attack bonus (the list's `spellcasting` facts), slot orbs per level for the
  token shown (`updateResource` on its `slot-N`: a lit orb spends one, a dark one gives one back), then the spells by
  level with "n of m slots".
- **Edit → Standard** (D8): the window shows Standard's Abilities tab with that ability open (Standard's `openFirst`),
  under a "← Back to the Codex" bar, in the Codex-sized window. The window's style stays Codex, and the switch shows
  Standard while you're there. Back (or the switch's Codex) asks first if the edit is unsaved, and returns to the Codex
  where it was scrolled to.
- **Where the build differs:** no ✦ for always-prepared spells. Which spells are always prepared is only in the
  build's records, not on the creature or the list's rows. The rows show Standard's chips (concentration, costs)
  instead.
- **Tests:** 6 more in `tests/codex-sheet.test.tsx` (25): the rows and their Edit, editing on Standard and Back, the
  prompt on Back with the edit unsaved (Save keeps the new name), a slot spent and given back on the token shown and
  not its copy, a built fighter with no Spellcasting but worn Equipment, a goblin with neither. Full suite: 251 files,
  2816 tests. Browser (Chromium and Firefox, 7 checks each), with a built level 5 wizard put into the scene: the hero
  reads "A level 5 Wizard (Evoker), Sage by trade", the slots read 4/3/2, an orb spends a 2nd-level slot, Edit opens
  Fire Bolt in Standard's editor in the 960-wide window, Back returns to the same scroll position (1336 px), and at
  1000 px and up the top row is three columns.

### Phase 7 (2026-10-06)

- **Guide:** `docs/guides/sheet-windows.md` ("Open several sheets, pop them out, and use the Codex"), with 8
  screenshots in `public/guides/img/sheet-windows/` taken during the from-blank pass. The README's feature list
  mentions sheet windows. The existing guides still read true ("select it and click **Sheet**").
- **The from-blank pass** (Playwright, a new browser profile, Chromium and Firefox, 9 checks each):
  1. Create Token › Character › Quick build makes a level 3 cleric and opens its sheet.
  2. Two windows open side by side.
  3. The cleric's Codex is popped out, and in the popup: name, alignment, a typed score and a stepper, a save orb,
     a skill orb to expertise, languages, −1 HP, temp HP, two conditions added and one removed, and a level 1 slot
     spent. All of it reached the store.
  4. The palettes, then a spell edited on Standard in the popup and back.
  5. ⋯ › Export JSON from the popup was read back with every edit.
  6. Docked.
  7. Three goblins in one Codex window, each given its own HP through the switcher, and a speed edit reaching all three.
- **Found and fixed there:** Export from a popped-out sheet built its download link in the main window, and nothing
  downloaded. `downloadJson(filename, payload, from)` and `exportCombatant(…, from)` take the document clicked in, and
  the ⋯ menu passes its owner document. Test: `popout-window.test.tsx` "exports from its own window".
- **Several windows during a fight** (the Phase 1 note): Auto Run doesn't touch the encounter while it replays, so
  open sheets don't re-render then. With Step (a commit per turn), 20 steps with four sheets open (two Standard, two
  Codex, in the dev build) took a median of 17.1 ms each, against 16.7 ms with none, and 566 ms against 474 ms in
  all. Not stopping minimized windows from rendering, since nothing calls for it.
- **`next build`** compiles with the lazily loaded Codex and its `next/font` face, with no warnings.
- **`Faerie Codex.html`** stays where it is, untracked: it's the user's file. The Codex took what it needed.
- **Full suite:** 251 files, 2817 tests.

### Phase 8 (2026-10-06): the Codex in the design of Character Codex.html

The user asked for the pop-out to be "more like Character Codex.html", a second hand-made sheet. They chose to replace
the Faerie-based Codex with it everywhere (D12), keeping out the fields the app doesn't store (D7).

- **The layout:**
  - A banner (deep teal in both palettes, with an astrolabe drawn as SVG, `Astrolabe` in `ornaments.tsx`) holding the
    name, pills for what it is, species, background and alignment (typed), the token switcher, and the level dial.
    The dial shows a built character's level read-only, a hand-made character's level typed (`withLevel`, as on
    Stats), or a monster's CR.
  - A sidebar with the token's art in the octagonal copper frame, AC, initiative, speed and proficiency tiles, HP with
    temp HP, hit dice and death saves.
  - Ability dials with copper modifier pills.
  - Tabs: **Details** (skills with bonus and passive; saves in two columns; Origin with type, size, species,
    background and languages; Defenses & conditions as tags), **Items** (weapons, armor & shields with a worn box,
    consumables, gear), **Abilities** (Attacks with each weapon's line in view, then actions, bonus actions, reactions
    and features, each row opening on its chevron) and **Spells** (ability, DC and attack tiles, slot boxes, spells by
    level). Items and Spells only show when it has something for them. The tab is remembered per browser
    (`codex-tab`), so Back from Standard returns to it.
- **Container queries** follow the original's breakpoints: the sidebar narrows below 1000 px, the sidebar sits above
  the main column below 880 px (Details stacks), abilities go to three a row below 640 px, and everything is one
  column below 520 px. The Codex window now opens at 1060 × 860.
- **Palettes:** `CODEX_PALETTES` is the original's dark and light sets (`dark`, `light`). A palette stored from before
  carries over (`paletteFrom`: Parchment is Light, the others Dark). `--faint` is a shade lighter than the original
  in each, so its hint text meets 3:1 on both panel colours.
- **Shared, not copied:**
  - `withWorn` (`lib/ability-editor/items.ts`) is Standard's Worn switch, now used by both.
  - `withAdjustment`, `withoutAdjustment` and `withConditionImmunity` are in `lib/actor-sheet/edits.ts` for the tags.
  - `CONDITION_IMMUNITIES` moved there from Stats.
- **Found and fixed:** `ContextMenu` closed on a scroll the browser delivered on the frame it opened in. A click on a
  button that first had to be scrolled into view (the Codex's + Condition, low in Details) opened the menu and closed
  it at once. It now listens for scrolls from the next frame (`tests/context-menu.test.tsx`).
- **Dropped with the old design:** the − and + steppers on scores and HP. The original has neither.
- **Tests:** `tests/codex-sheet.test.tsx` was rewritten (27). It covers the defense tags (adding and removing, a
  qualified one exactly), the worn box changing the AC, the Attacks panel, a hand-made level typed into the dial, a
  monster's CR dial and tabs, the remembered tab, and the palette carry-over. The full suite passes. Browser
  (Chromium and Firefox, 11 checks each), from blank: a level 3 cleric's Codex popped out with Fraunces and Figtree,
  every Details field edited, a resistance tag added and removed, the chain shirt taken off (AC 16 → 13) and put back,
  Attacks with lines, a slot spent, a spell edited on Standard and back to the Spells tab, Light, an export read back,
  and three goblins' HP in one Codex. The guide's Codex section and screenshots were redone.
