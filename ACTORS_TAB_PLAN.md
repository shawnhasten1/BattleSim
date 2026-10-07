# Actors Tab Plan: open, edit and delete actors from the directory

**Status:** built 2026-10-06 on branch `actors-tab`, one commit per phase (Phases 0–4). See "Built so far" at the end.

The Actors tab should be where a DM manages their creatures. Today it mostly adds tokens to the map. The user named
three problems:

1. **An actor can't be deleted.** Deleting must never be offered for SRD monsters.
2. **An actor's sheet can't be opened without putting a token on the board.**
3. **The Compendium tab is pointless now.** It should go.

The user also wants the tab cleaner and easier to use. The audit below is what that means in practice.

## What's wrong today

| # | Problem | Where |
|---|---|---|
| 1 | **Clicking an actor's name adds a token to the map.** Nothing shows a sheet or a preview, and clicking an SRD row adds an enemy. Party and enemy icon buttons sit beside the name too. | `ActorsPanel.renderActorRow`, `SrdMonsterFolders` |
| 2 | **Delete is effectively hidden.** A saved actor shows a trash icon in the same slot where a scene actor shows a Save icon. The trash deletes at once, with no confirmation and no undo. | `ActorsPanel.tsx:163-169` |
| 3 | **A scene-only actor (never saved) can't be deleted at all.** | same |
| 4 | **Deleting a saved actor that has tokens on the map looks like it failed.** The scene keeps its own copy, so the row stays and is now labelled "scene actor". | directory = library ∪ `encounter.definitions` |
| 5 | **The only way into a sheet is through a token.** Sheet windows are keyed by `combatantId`, and every sheet edit is a store action on `encounter.definitions`. | `sheet-windows-store.open`, ~30 actions in `encounter-store.ts` |
| 6 | **A token sheet's edits don't reach the library.** The scene copy drifts from the library copy until the DM chooses ⋯ → Update library copy. | `LIBRARY_NOTES` in `lib/actor-sheet/scope.ts` |
| 7 | **The "selected token" card repeats other menus.** Its Sheet / Duplicate / Export / Save / Delete buttons are already on the token's right-click menu and the sheet's ⋯ menu. Its **Delete** removes the *token*, which is easy to confuse with deleting the actor. | `ActorsPanel.tsx:243-276` |
| 8 | **There's no search over your own actors.** Only the SRD folder has search and filters. | `SrdMonsterFolders` |
| 9 | **The quantity stepper only applies to SRD monsters.** | same |
| 10 | **Your actors' rows only show a source** ("homebrew", "scene actor"), while SRD rows show CR · HP · AC. Neither shows whether the actor is on the map. | `renderActorRow` |
| 11 | **The status line is never empty.** It reads "12 saved definitions" after every load and shows Compendium messages. | `loadDefinitionsLibrary`, `ActorsPanel.tsx:302` |
| 12 | **"Refresh library" uses a folder-open icon.** | `ActorsPanel.tsx:290-299` |
| 13 | **The SRD Monsters folder is listed above your own actors.** | `ActorsPanel.tsx:324` |

## Decisions (settled 2026-10-06)

| | Decision |
|---|---|
| D1 | **Double-click (or Enter) on a row opens the actor's sheet.** A single click only selects the row. Tokens come **only from dragging the row onto the map or from its + button**. Both use the default faction (party for a PC, enemy otherwise); the DM changes it afterwards on the token (sheet → Token → Faction). The row's party/enemy buttons go away. |
| D2 | **A sheet opened from the library saves automatically** to the library, about a second after each change. The window shows *Saving… / Saved to your library / Couldn't save – Retry*. Undo works as usual. |
| D3 | **Library actors are linked.** Editing an actor you own changes its library copy *and* every token of it in the scene. This applies whether you edit from a token's sheet or from the directory with no token. ⋯ → Update library copy goes away for these actors because there's nothing to update. To make a one-off variant, use **⋯ → Make it its own creature**, which splits the token into a new creature that exists only in this scene. |
| D4 | **SRD monsters and shared templates opened from the directory are read-only.** A banner reads "SRD monster: read-only. **Copy to my library** to edit". The copy then opens, editable, in the same window. On the map nothing changes from today: their scene copy can be edited, the changes stay in that scene, and ⋯ → Save to my library still makes a linked copy. |
| D5 | **Deleting asks no questions when it's cheap to undo.** The actor goes at once, and a toast offers "Deleted Goblin Boss. **Undo**", the same pattern as deleting an ability. A prompt appears only when tokens on the map are involved (D6). |
| D6 | **Deleting a library actor that has tokens on this map asks first:** "Goblin Boss has 2 tokens on this map." **[Delete, keep tokens] [Delete with its tokens] [Cancel]**. If the tokens stay, the scene keeps its copy, unlinked, and the row moves to *This scene only*. |
| D7 | **The "selected token" card is removed.** |
| D8 | **The Compendium tab goes, and its losses are accepted.** Open5e creatures stay in Create Token → Open5e. Open5e spells and items stay in a sheet's Add ability. Conditions stay on the sheet's vitals. What's lost is browsing Open5e *Features* (which were only attached as manual-only notes) and the source-document filter. |
| D9 | **Other scenes pick up library changes when they open.** This follows from D3. Every scene stores its own copy of its creatures. If scene B kept an old copy, the first edit made there would save that old copy, plus the edit, over the newer library version. So when a scene loads, and again when the library loads, the scene's copies of your library actors are replaced by the library's, and tokens at full HP follow a new maximum. A creature that should stay different in one scene is split off with Make it its own creature (D3). *Chosen during planning as the consequence of D3; reverse it if scenes should stay frozen.* |

## Phase 0: Remove the Compendium tab

This phase is small and independent of the rest, so it goes first.

- Delete `CompendiumPanel.tsx` and `CompendiumPanel.module.css`, and remove `compendium` from `SIDEBAR_TABS` in
  `EncounterEditor.tsx`. A browser whose saved sidebar tab is `"compendium"` falls back to Combat through the existing
  `SIDEBAR_TABS.some` guard.
- Nothing produces `application/x-battle-sim-compendium` drags any more; only the panel did. Remove its drop handling:
  - the selection card's drop zone,
  - the canvas drop in `EncounterEditor.onCanvasDrop`,
  - the compendium branch of `ActorSheet.onDrop`. **Keep the `SRD_DRAG_MIME` branch.**
- Prune from `useCompendium` what only the panel used. Grep each item first:
  - `tab` and `setTab`,
  - `documentKey`,
  - `onDragStart`,
  - the creature, condition and generic-feature branches of `attach`.

  These stay, because the Create Token modal and Add ability use them: `search`, `importCreature`, `importSpell`,
  item/weapon `attach` and `status`. `/api/open5e/compendium` stays too.
- Tests: update `tests/panels.test.tsx`, plus any test that renders the Compendium tab or drops a compendium payload.

## Phase 1: Linked library actors (D3, D9)

- **Saving from the commit path.** `commitEncounter` already sees each edit, as do undo, redo and Play's undo. Each of
  them queues the definitions that changed (a reference check, since actions `.map()` untouched definitions to the same
  object) and that are **library actors you own**: in `definitionsLibrary` and not in `templateDefinitionIds`.
  - The queue is debounced, about a second per actor. Each save is a `PUT /api/definitions/[id]`; the route exists.
  - On success the entry in `definitionsLibrary` is replaced locally, without reloading the whole library.
  - Loading and syncing write with `set()` and never queue a save, so they can't echo.
  - SRD monsters, templates and scene-only actors are never queued.
- **A save store** (`library-sync`) holds, per actor, *saving / saved / failed*, plus Retry.
  - The sheet's title bar shows it.
  - Leaving the page while saves are pending triggers a `beforeunload` warning.
  - Closing a window flushes that actor's pending save.
- **Sync on open (D9).** One function, `syncLibraryActors(encounter, library)`, replaces the scene's copy of each owned
  library actor that differs from the library's.
  - It runs after `loadEncounter` and `loadProject`, after the persisted state rehydrates, and after
    `loadDefinitionsLibrary`.
  - It writes with `set()`, as one step with no undo, through `withHitPointsFollowing` so that tokens at full HP follow
    a new maximum. Sizes are clamped onto the grid as `updateCreatureDefinition` does; pull that into a shared helper.
- **Text on the sheet.**
  - `LIBRARY_NOTES.saved` becomes "Changes save to your library and reach every token of it, here and in your other
    scenes."
  - `SAVE_LABELS` drops "Update library copy" for owned actors.
  - The ⋯ menu keeps "Save to my library" for scene-only actors and "Copy to my library" for SRD monsters and
    templates.
- **Existing comments** about the scene copy deliberately not being replaced, in `addLibraryDefinitionToEncounter` and
  `addSrdMonster`, are reread and corrected. For SRD monsters the comment still holds.

### Tests

- An edit on a token sheet saves to the library, debounced.
- Undo saves the earlier version.
- Loading a scene and loading the library never save anything.
- A scene with a stale copy picks up the library's version on load. Its tokens at full HP follow; the others are capped.
- SRD monsters, templates and scene-only actors are never saved.
- A failed save shows Retry, and the `beforeunload` warning appears while a save is pending.
- Make it its own creature stops the link.

## Phase 2: Sheets without a token

The sheet is built around a token: HP, conditions, the Token tab, and edits that go to `encounter.definitions`.

### The bench

The sheet's edit actions only work on creatures in the scene. So a tokenless sheet puts its creature **on the bench**:
into `encounter.definitions`, with no token, the way a summon's creature already rides along. The sheet then edits it
with the same actions, undo included. Saving to the library comes from Phase 1, unchanged.

- **`benchIds`** lives in the encounter store. It is not persisted and not undoable.
- **Opening.** If the creature isn't in the scene, it is added *without an undo step* and joins `benchIds`. If it is
  already in the scene, with or without tokens, the sheet opens on that copy and nothing is benched.
- **Closing.** A benched creature that still has no token, and that nothing in the scene names (summon, transform,
  forms), leaves the scene without an undo step. Switching scenes closes every window, as it does now, so it clears the
  bench.
- **Undo and redo keep the bench in step.** One normalizer, used by undo, redo and Play's undo, adjusts every restored
  snapshot:
  - It **gets back** any open benched creature it lacks, so undoing a token move doesn't close an open sheet.
  - It **loses** any creature that was benched, then closed, and has no token in it. Otherwise undo would bring back a
    stale copy, and Phase 1 would save that copy to the library.
- **The bench is never saved with the scene.** Every path that writes the scene goes through one `forSaving()` helper
  that drops tokenless bench creatures. Those paths are:
  - `saveCurrentEncounter`,
  - the `POST /api/encounters` paths,
  - the `persist` middleware's stored state,
  - exports.
- **Placing a benched creature on the map**, by drag or +, takes it off the bench; it's a scene creature now. Its window
  becomes that token's sheet through `reconcile`, which already moves windows onto a token of their creature.
- **The read-only bench (D4).** SRD monsters and shared templates are locked while benched.
  - A `SheetReadOnly` context makes the shared field components read-only (`SheetText`, `SheetNumber`, `Segmented`,
    `SheetColor`, …).
  - The ability editor and Add ability are hidden.
  - As a safety net, `commitEncounter` refuses any change to a locked creature and shows the banner's message.
  - **Copy to my library** uses the existing `saveSrdMonsterCopy` / `copyLibraryDefinition`, then opens the copy in the
    same window, editable.

### The window and the sheet

- **The window.**
  - `SheetWindow.combatantId` becomes `string | null`.
  - A new `openCreature(definitionId)` opens the token sheet when the creature has tokens on this map, and otherwise
    benches it and opens a tokenless window.
  - `reconcile` keeps a tokenless window open while its creature is in `encounter.definitions`. When a token of that
    creature appears, the window becomes that token's sheet.
- **The preview token.** With no token, the sheet gets a preview made by the same pure function the store uses for a
  new token; pull that function out of `addCreatureDefinition` into a lib module. The preview is never added to the
  encounter.
- **Hidden** in a tokenless sheet, in Standard and Codex alike:
  - current HP, temp HP, conditions, concentration and death saves (the vitals show max HP, AC and speed instead),
  - the Resources column "left for this token",
  - the Token tab's per-token sections: name, faction, This fight, border/scale/glow/nameplate, and status & position,
  - the ⋯ items Duplicate token, Make it its own creature and Delete token, and the token switcher.
- **Kept:**
  - Stats,
  - Abilities: the editors, Add ability, My library and SRD drops,
  - resource pool sizes,
  - Level up and the character builder (`rebuildCharacter` works because the creature is in the scene),
  - Export JSON, using the preview token,
  - Save to my library and Copy to my library.
- **The Token tab** shows only its creature-wide parts:
  - the token image for every token (`updateDefinitionVisuals`),
  - default tactics and spending (`setCreatureBehavior` → `defaultTactics` / `defaultResourceStance`).
- **The caption** that today reads "2 tokens in this scene" (`creatureScope`) gains these variants:
  - *In your library, no tokens here*,
  - *SRD monster: read-only*,
  - *Shared template: read-only*,
  - *This scene only, no tokens yet*.
- `tests/codex-parity.test.tsx` must still pass. The token-only parts are hidden in the shared frame, not in each sheet
  separately.

### Tests

- The bench:
  - open, edit (which saves to the library), undo, close;
  - undo past the moment the sheet opened;
  - undo after it closed (the creature doesn't come back and nothing is saved);
  - a reload drops it (`forSaving`);
  - placing a token takes it off the bench.
- SRD monster and template sheets refuse every edit, and Copy to my library opens an editable copy.
- A tokenless window survives `reconcile` and becomes a token sheet when a token appears.
- A tokenless sheet hides the token-only parts in both styles.

## Phase 3: Rows, menus and delete

### A row

```
[img] Goblin Boss                       [+] [⋯]
      CR 1 · HP 21 · AC 17 · ×2 on map
```

- **Single click** selects the row. **Double-click or Enter** opens the sheet (D1).
- **Drag** places a token on the map or files the actor into a folder. Both work as now.
- **+** appears on hover or focus. It adds tokens with the default faction (`defaultFactionForDefinition`), as many as
  the quantity set in Phase 4.
- **⋯ and right-click** open the same menu:

| Item | Your library actor | Scene-only actor | SRD monster | Shared template |
|---|---|---|---|---|
| Open sheet | ✓ | ✓ | ✓ (read-only) | ✓ (read-only) |
| Save to my library | — | ✓ | — | — |
| Copy to my library | — | — | ✓ | ✓ |
| Duplicate (a copy "… (copy)" in the same folder) | ✓ | — | — | — |
| Export JSON | ✓ | ✓ | ✓ | ✓ |
| **Delete…** | ✓ | ✓ | **never** | **never** (not yours) |

- The row's party/enemy buttons and its trash/save slot are removed.
- **Folders** keep their menu. **Delete folder** now asks first: "Delete Undead? Its 3 actors and 1 subfolder move up a
  level." The API already moves a folder's contents up rather than deleting them.

### Delete (D5, D6)

- **A library actor you own, with no tokens on this map.** It is deleted at once, with a toast: "Deleted Goblin Boss.
  **Undo**". Undo saves the same definition back, with the same id and folder. Other scenes that hold it keep their copy
  as scene-only, since Phase 1's sync only touches actors still in the library.
- **A library actor with tokens here** shows the D6 prompt.
  - *Keep tokens:* the library copy goes, and the scene copy stays as *This scene only*, unlinked.
  - *With its tokens:* the tokens and the scene copy go too, in one scene undo step. The toast's Undo restores both.
- **A scene-only actor.** It and any tokens of it are removed in one scene undo step, with a toast: "Removed Goblin Boss
  from this scene. **Undo**".
- **Blocked** when another creature in the scene summons it or changes into it, such as a Balor's Summon Demon. The
  menu item is disabled, and its tooltip says why. Reuse the naming check from `ownCreatureBlock`, extracted as
  `namedBy(encounter, definitionId)`.
- Any open sheet window of a deleted creature closes.
- **Store actions:**
  - `deleteActor(definitionId, { withTokens })` composes `removeCombatants`, removing the definition and
    `deleteLibraryDefinition`.
  - `restoreLibraryDefinition(definition)` backs Undo.
  - `duplicateLibraryDefinition(id)` backs Duplicate.

### Tests

- A single click selects without adding a token; a double-click or Enter opens the sheet; + and drag add tokens with
  the default faction.
- Each kind of actor gets exactly the menu items in the table. SRD monsters and templates never show Delete.
- Delete in every case:
  - Undo,
  - both D6 choices,
  - the blocked case,
  - another scene's copy staying behind as scene-only.
- Folder delete asks first, and its contents move up.

## Phase 4: Tidy the panel

- **Remove the selected-token card (D7).**
- **Order the directory:**
  1. **My actors:** your folders, then unfiled actors.
  2. **This scene only:** actors in this scene that aren't in your library, each with a Save action. This makes it
     obvious what is and isn't saved.
  3. **SRD Monsters**, collapsed by default.
- **One search box** at the top filters all three groups by name, type and source. The SRD folder keeps its filter
  panel. While a search is active, groups with matches open by themselves, as the SRD folder does now.
- **The quantity** moves from inside the SRD folder to the top bar, as "Add ×[1]". It applies to every row's **+** and
  to drags.
- **Row subtitles** show:
  - CR · HP · AC for monsters,
  - "Level 5 Fighter · HP 44 · AC 18" for PCs,
  - "×2 on map" when the actor has tokens here.

  AC comes from `armorClassOf`.
- **The status line** shows errors only. Successes appear as a short toast, and "12 saved definitions" goes away.
- **Refresh** gets a refresh icon.
- **Docs.** In `docs/guides/sheet-windows.md:11`, change "**Sheet** in the Actors panel" to "double-click the actor in
  the Actors tab". Also add a short section on sheets without a token, on linked library actors, and on Make it its own
  creature for one-off variants.

### Tests

Update `srd-monster-directory`, `srd-quantity`, `srd-monster-search-ui`, `actor-folders` and `panels`. Add tests for
search across groups, the *This scene only* group, and quantity on your own actors.

## Out of scope

- **Creating an actor without placing a token.** Create Token still places one. Afterwards the actor can be found,
  opened and edited in the directory with no token.
- **Bulk actions.** Selecting several actors at once to delete or move them is not covered.
- **Editing an SRD monster in place.** It stays permanent; editing means making a copy.
- **Two browser tabs editing the same actor.** The last save wins.

## Built so far

All five phases, one commit each on `actors-tab`:

- **Phase 0** (9905343): the Compendium tab and its drag type are gone; `useCompendium` keeps Open5e search and imports
  for Create Token and Add ability.
- **Phase 1** (f4f18fa): linked library actors. `queueLibrarySaves` in `commitEncounter`, `undo` and `redo` hands
  changed actors you own to `library-sync-store` (debounced `PUT`, Saving… / Saved / Not saved · Retry in the title
  bar, a `beforeunload` warning). `withLibraryActors` syncs a scene as it loads, and the scene and its undo history when
  the library loads, skipping actors whose save is still on its way.
- **Phase 2** (47612e6): sheets with no token. The bench (`benchIds`, `benchCreature`, `unbenchCreature`,
  `withBenchKept`, `withoutBench` in `boardToSave` and `partialize`), `openActorSheet` / `openCreature`, a preview
  token, and `SheetModeContext` (`tokenless`, `readOnly`) read by the vitals, tabs, Token tab, resources, the Codex and
  the shared inputs. `commitEncounter` refuses edits to a locked bench creature and `onLockedEdit` says why.
- **Phase 3** (c6a036a): `ActorRow` (click selects, double-click or Enter opens, + adds, ⋯ or a right-click opens the
  menu), `deleteActor` / `restoreLibraryDefinition` / `duplicateLibraryDefinition`, `ConfirmDialog`, and `namedBy`
  (self-naming only counts for Make it its own creature).
- **Phase 4**: the selected-token card is gone. The panel has one search (`matchesActorQuery`, folders pruned and
  opened while searching), "Add ×" for every row and drag, the My actors / This scene only / SRD Monsters groups,
  `directoryLine` subtitles, and an errors-only status line. The guide and Docs page say how sheets open now.

Two choices were made while building:

- **SRD monsters on the map aren't listed under This scene only.** Their sheets open from the SRD folder (or the
  token), and SRD monsters never offer a delete.
- **A tokenless sheet's Add ability explains itself when read-only.** Instead of hiding, it says the monster is
  read-only and to copy it to your library.
