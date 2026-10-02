# Map Import Plan: the grid comes from the image

**Status:** On branch `map-import`: Phase 1 committed 2026-10-02 (c979451), Phase 2 committed
2026-10-02. Phase 3 (Align grid) is next. Decided 2026-10-02:

- D1: assume 100 px per square, then remember the last size you confirm.
- D2: when an image's size fits more than one grid, apply the best guess and show the others
  as one-click alternatives.
- D3: padding stays in whole squares and plays no part in alignment.
- D4: the usual size is remembered per browser, for now.
- D5: a map made before this changes only when you click Pin image to grid.
- D6: replacing the image of a map made before this runs detection on the new image, like any
  other upload.

Uploading a battlemap should work the way it does in Foundry. Maps are built in Inkarnate and
exported with its VTT (Grid) option at 100 px per square; such an export should land with the
right columns and rows, with the grid on the art at every zoom, and nothing to type. Covers the
three upload paths (New Encounter modal, Scene Config, Scene panel), how `deriveSceneMetrics`
and `SceneCanvas` place the image, and Scene Config's grid and image fields.

## Summary

- **Keep the size that encodes the grid.** Inkarnate's VTT export is exactly columns × grid px:
  30 squares at 100 px is 3000 × 2000. Today the upload is shrunk to 2048 px before anything
  measures it, so that is lost. Record the original size first.
- **Pin the image to the grid.** Work out the image's box in squares (original size ÷ px per
  square), not in screen pixels. Image and grid then scale together, and nothing can knock
  them out of line: not the square size, not re-exporting at 2K or 4K, not the downscale.
- **Uploading sets the grid.** Picking an image shows *30 × 20 squares · 150 × 100 ft ·
  100 px per square*, with the other readings one click away. Blank maps keep the presets.
- **Replacing the image keeps the grid** when the new one fits the same columns × rows. That
  covers editing the art in Inkarnate and re-exporting it.
- **Align grid** (Phase 3) handles images that aren't VTT exports: purchased maps, plain 2K/4K
  exports, and maps with borders.
- Walls, terrain, elevation, tokens and the engine are untouched. They're in grid squares
  already.

---

## 1. What's wrong today

**What Foundry does.** It detects nothing. A scene takes the image's own pixel size, and the
grid defaults to 100 px per square ([Foundry: Scenes](https://foundryvtt.com/article/scenes/)).
A 100 px Inkarnate export lines up because the two numbers agree.

Inkarnate's export is only an image, with no grid data and no walls. Its export dialog sets grid
px, columns and rows, and the image size follows from them
([Inkarnate changelog](https://feedback.inkarnate.com/changelog/new-features-and-beta-expansion)).
Guides say to turn Inkarnate's visible grid off before exporting
([Loreteller](https://loreteller.com/learn/inkarnate-roll20-grid/)). So the image's size is the
only signal, and it's a reliable one.

**What BattleSim does** with a 3000 × 2000 export (30 × 20 squares at 100 px), from the New
Encounter modal:

1. **The original size is thrown away.** `prepareMapImage` and `setMapImage`
   (`src/store/encounter-store.ts`, ~L664 and ~L2054) downscale to 2048 px and *then* measure.
   The map is recorded as 2048 × 1365, a square is 68.27 px, and 30 × 20 can't be recovered.
2. **Columns and rows ignore the image.** They come from the Landscape 40 × 30 preset
   (`CreateEncounterFields.tsx`), so a 40 × 30 grid of 44 px squares (1760 × 1320) is drawn over
   a 2048 × 1365 image.
3. **Image and grid are sized separately.**
   - The image's box is `map.canvas`, in screen pixels.
   - The grid is squares × `squareSizePx` (`SceneCanvas.tsx` ~L526–551, `metrics.ts`).
   - "Grid px" moves the grid but not the image.
   - Lining them up means typing columns 30, rows 20 and Grid px 68.27, which the box's arrows
     (steps of 1) can't reach. The other way is setting Scene W/H to 2040 × 1360 to squeeze the
     image under a 68 px grid.
4. **Replacing the image undoes it.** `setMapImage` resets `map.canvas` to the new image's stored
   size on every upload (~L2028).
5. **Image X/Y and scale are in screen pixels**, so a manual fit breaks again whenever the square
   size changes.

## 2. Goals

- A 100 px Inkarnate export needs no typing. It gets the right columns and rows, and the grid sits
  on the art at any zoom and square size.
- An export at another size is one click to correct, and the correction is remembered.
- An image that isn't a VTT export can be aligned on the map itself, not by trial and error in
  number boxes.
- Re-exporting a map (new art, or a new resolution) keeps its walls and tokens aligned.
- Existing maps look exactly as they do now until you choose to pin them (D5).

---

## 3. Design

### 3.1 The model

New optional fields on `MapImageSettings` (`src/engine/types.ts`):

```ts
export interface MapImageSettings {
  // ...existing: offsetX, offsetY, scale, opacity, naturalWidthPx, naturalHeightPx
  /** The pixel size `pxPerSquare` is measured against: the original file when known (before
   * any downscale), otherwise the stored image. */
  sourceWidthPx?: number;
  sourceHeightPx?: number;
  /** Pixels per grid square at that size. Set means the image is pinned to the grid. */
  pxPerSquare?: number;
  /** Phase 3: where the grid's top-left corner sits in the image, in source px. */
  originX?: number;
  originY?: number;
}
```

- They're optional, so there's no schema version bump. `naturalWidthPx` and `paddingSquares` set
  the precedent.
- They must also go into `encounterSnapshotSchema`'s `image` object. Zod strips unknown keys, so
  leaving them out would make every save quietly drop them.
- **Pinned** means `pxPerSquare`, `sourceWidthPx` and `sourceHeightPx` are all set.
- Pinned maps ignore `canvas`, `offsetX/offsetY` and `scale`. Unpinned maps (every map made before
  this) use them exactly as today.
- Nothing in `src/engine` reads these fields. Walls, terrain, elevation, templates and tokens stay
  in grid units.

### 3.2 Rendering

`deriveSceneMetrics` (`src/components/scene/metrics.ts`) gains one field:

```ts
imageBox: { left: number; top: number; width: number; height: number; pinned: boolean };
```

- **Pinned:**
  - `width = sourceWidthPx / pxPerSquare × cellSize`, and height likewise.
  - `left = −originX / pxPerSquare × cellSize`, and top likewise.
  - The scene is the larger of the grid box and the image box.
- **Unpinned:** `canvas.widthPx × canvas.heightPx` at 0, 0, with today's offset/scale transform.
  The scene stays `max(canvas, grid)`.
- `SceneCanvas`'s `<img>` reads `imageBox`.
  - Pinned images use `object-fit: fill`. The box has the image's exact proportions, so nothing
    is cropped or stretched.
  - Unpinned images keep `cover` and the transform.
- Padding is unchanged (`paddingSquares × cellSize`). So is the frame/content split from the
  padding work: pointer maths still reads the unpadded inner div, so `coords.ts` needs nothing.

### 3.3 Detecting the grid

`src/lib/gridInference.ts`, next to `imageResize.ts`. Detection is pure; only the remembered
usual size touches storage.

```ts
export interface GridFit { columns: number; rows: number; pxPerSquare: number }
export interface GridGuess extends GridFit { reason: "current" | "filename" | "usual" | "common" }
export interface GridDetection { best: GridGuess | null; alternatives: GridGuess[] }

export function detectGrid(input: {
  widthPx: number;
  heightPx: number;
  fileName?: string;
  usualPxPerSquare?: number;                     // D1: 100 until you confirm another
  current?: { columns: number; rows: number };   // see rule 1
}): GridDetection;

export function gridForPxPerSquare(size: ImagePixelSize, pxPerSquare: number): GridFit;
export function gridForColumns(size: ImagePixelSize, columns: number): GridFit;
export function pinInPlace(image: MapImageSettings, canvas: MapCanvasSettings, cellSize: number); // Pin image to grid
export function readUsualPxPerSquare(): { pxPerSquare: number; remembered: boolean };
export function rememberUsualPxPerSquare(pxPerSquare: number): void;
```

The first rule that matches gives `best`. Every other exact fit becomes an alternative (up to 3):

| # | Source | Accepted when |
|---|---|---|
| 1 | **Current grid**: only when replacing a background, or when walls, terrain or tokens are placed | The new image fits the map's columns × rows with square cells (within 1%) |
| 2 | **File name**: `Crypt [30x20].png`, `crypt_30x20.jpg`, `30 x 20`, `100px`, `100ppi` | The counts give square cells (within 1%), or the px value divides the image |
| 3 | **Usual px per square**: 100, or the last one you confirmed | It divides both edges exactly (±1 px) |
| 4 | **Common VTT sizes**: 100, 140, 70, 200, 50, 150, 300, less the usual one | It divides both edges exactly (±1 px) |
| — | Nothing fits | `best` is `null`, and the UI asks one question |

- **100 stays a common size.** Once another size is remembered, 100 is still tried right after
  it, so a 100 px export is read right even after you picked 70 px for a one-off map.
- **Bounds.** 4–120 squares a side, Scene Config's limits.
- **Rounding.** Counts worked out from a typed value round to the nearest whole square when
  they're within 2% of one. Otherwise they round up, so the grid covers the whole image.
- **Left out on purpose.** 256, 128 and 64 px are left off the common sizes. Power-of-two images
  (2048 × 1536, 4096 × 3072) divide by them and would come out as nonsense like 8 × 6 squares.
- **Remembering the usual size.**
  - It's stored per browser with `readJson`/`writeJson` (`src/lib/persist.ts`), key
    `map-import:px-per-square` (D4).
  - It's written when you pick an alternative or type a px per square.
  - It isn't written when you type squares across: 51.2 px from a plain 2K export isn't anyone's
    usual size.

### 3.4 Measuring the upload

- New `readMapImageFile(file)` in `src/lib/imageResize.ts` returns
  `{ dataUrl, fileName, size }` (`size` is `{ widthPx, heightPx }`, or null if the file can't be
  decoded), measured before any downscale.
- The three file inputs use it instead of their bare `FileReader`s: `CreateEncounterFields`,
  `SceneConfigModal` and `ScenePanel`.
- The downscaled copy is still what gets stored. Pinning makes its resolution irrelevant to
  alignment.

### 3.5 Where it shows up

**New Encounter modal** (`CreateEncounterFields`):

- Background moves above Grid, so the form reads top-down: pick the image, then see its grid.
- With an image, the presets give way to one line:
  - **30 × 20 squares** · 150 × 100 ft · 100 px per square, then where the guess came from: *the
    usual VTT size* (or *the size you used last*, once one is remembered), *from the file name*,
    *a common VTT size*, or *set by you*.
  - The alternatives sit beside it as chips: `15 × 10 · 200 px`, `60 × 40 · 50 px`. Picking one
    applies it (D2).
  - **Other…** opens two linked boxes, *Squares across* and *Image px per square*. Editing either
    updates the other and the rows. A count outside 4–120 a side says so and isn't applied.
- With no fit (`best` is null), it asks: "This image's size doesn't match a VTT export. How many
  squares across is it?" The same two boxes follow, empty. Left blank, the map is made with the
  preset grid, unpinned, as before.
- Feet per square gets its own box under the reading (default 5); blank maps keep it in Custom.
  Removing the image brings the presets back.
- `NewMapOptions` (`encounter-store.ts`) carries the source size and `pxPerSquare` alongside
  `grid`, and `prepareMapImage` writes them into the new snapshot.

**Replacing the image** (Scene Config's upload, the Scene panel's Replace):

| Case | What happens |
|---|---|
| The new image fits the current columns × rows (rule 1) | Swap silently. It stays pinned and the walls stay aligned, at any resolution. |
| Something else detected, nothing placed | Apply the detected grid silently |
| Something else detected, walls/terrain/tokens placed | The `shouldWarnBeforeReplacingImage` confirm, now saying what changes: "The new image is 32 × 20 squares; this map is 30 × 20. Walls and tokens keep their squares." Proceeding applies 32 × 20. |
| Nothing detected | The image goes in unpinned, and Scene Config asks how many squares across it is, showing the current columns as a hint. From the Scene panel, Scene Config opens. |

Both say what happened in a status line ("Kept the grid: 30 × 20 squares, 200 px per square in
the image."). `replaceEncounter` (Import JSON) still goes through `setMapImage`, which keeps the
imported map's own fields.

**Scene Config** (`SceneConfigModal`):

- **Grid:** columns, rows, feet per square, and line width, colour and opacity.
  - "Grid px" becomes **Square size on screen**. It's a display scale, and the old name collides
    with Inkarnate's "grid size in pixels", which is something else.
- **Image, pinned:** "Image · 3000 × 2000 px, pinned to the grid", then the same reading,
  chips and Other… as the modal.
  - A chip or a typed value refits columns and rows to the whole image. Like the Columns and
    Rows boxes, it applies at once with no confirm; Undo puts it back.
  - **Fit grid to image** shows when columns and rows no longer match the image (it keeps the
    px per square and origin).
  - **Align grid…** (Phase 3) and Opacity.
  - Scene W/H and Image X/Y/scale are hidden.
- **Image, unpinned:** "Not pinned to the grid", the readings (or the question), then **Pin image
  to grid, where it is now**, then today's fields.
  - Pin converts today's Scene W/H, X/Y and scale into px per square and an origin. The image
    stays exactly where it is, and later square-size changes can't move it.
  - The conversion is one pure function with tests. If Scene W/H had cropped the image
    (`object-fit: cover`), the cropped edge becomes visible.

---

## 4. Phases

Each phase ships on its own and keeps the tests green.

### Phase 1 — Pin the image to the grid (no visible change)

> **✅ Implemented 2026-10-02**, committed (c979451).
>
> Built:
>
> - **The §3.1 fields**, in `MapImageSettings` and `encounterSnapshotSchema`.
> - **`ImageBox`/`imageBox` in `deriveSceneMetrics`.** The scene covers the grid and the image
>   box's far edge. For an unpinned map that's still `max(canvas, grid)`.
> - **`SceneCanvas`.**
>   - A pinned image is drawn from `imageBox`, with `object-fit: fill` and `max-width: none`.
>     The global `img { max-width: 100% }` would otherwise shrink a box that runs past the
>     scene's edge.
>   - An unpinned image is drawn exactly as before.
> - **`readMapImageFile`** (`src/lib/imageResize.ts`), used by the New Encounter modal, Scene
>   Config and the Scene panel.
> - **`setMapImage(dataUrl, source?)`.**
>   - A newly picked file records its own size and drops any pin.
>   - Import JSON passes no `source`, so the snapshot keeps its own fields.
>   - `NewMapOptions.image` (it was `imageDataUrl`) and `prepareMapImage` carry the size into
>     new encounters.
>
> Tests:
>
> - `tests/scene-metrics.test.ts`, 9 new:
>   - an unpinned box unchanged.
>   - 30 × 20 squares at square sizes 44, 60 and 68.27.
>   - canvas, offset and scale ignored once pinned.
>   - the origin shift.
>   - an image wider than the grid.
>   - both fields needed.
>   - padding.
> - `tests/map-image-pinning.test.ts`, 8:
>   - the schema keeping the fields, parsing without them, and rejecting 0 px per square.
>   - `setMapImage` with a size, over a pinned image, with a null size, and from Import JSON.
>   - `createEncounterInCampaign` baking the size into the snapshot.
>
> The full suite passes: 139 files, 1,676 tests.
>
> Browser (Playwright with the seeded login, test images drawn with a grid every 100 px):
>
> - **New Encounter modal, 3000 × 2000.** It recorded the source size and the stored size
>   (2048 × 1365). The server's saved snapshot kept the source size, and the image drew exactly
>   as before.
> - **Scene Config upload (4200 × 2800) and Scene panel Replace (2100 × 1750).** Each recorded its
>   file's own size.
> - **Import JSON of a map pinned at 100 px per square over 30 × 20.** The image's box on screen
>   matched the grid's exactly at square sizes 44, 60 and 68.27.
> - **The only console errors** were the map-image Blob sync's 500s ("No blob credentials found").
>   `BLOB_READ_WRITE_TOKEN` isn't set locally, which predates this change.

- The §3.1 fields, in the type and the schema.
- `imageBox` in `deriveSceneMetrics`, and `SceneCanvas` drawing from it (§3.2).
- `readMapImageFile` (§3.4). Every upload records its source size. Nothing sets `pxPerSquare`
  yet, so every map still renders as it does today.
- Tests (`tests/scene-metrics.test.ts`, plus a schema test):
  - a pinned 3000 × 2000 source at 100 px per square fills exactly 30 × 20 squares at square
    sizes 44, 60 and 68.27.
  - an origin of (50, 0) source px shifts the box half a square left.
  - every existing test passes unchanged (unpinned is today's path).
  - a snapshot round-trips through `encounterSnapshotSchema` with and without the new fields.

### Phase 2 — Uploading sets the grid

> **✅ Implemented 2026-10-02**, committed.
>
> Built:
>
> - **`src/lib/gridInference.ts`** (§3.3): `detectGrid`, the typed-value helpers, `pinInPlace`
>   and the remembered usual size.
> - **`GridFitPicker`** (`src/components/modals/GridFitPicker.tsx`), shared by the New Encounter
>   modal and Scene Config: the reading, the chips, Other…, and the bounds message. It remembers
>   a chip's size or a typed px per square, not squares across.
> - **New Encounter** (§3.5): Background above Grid; a measured image gets the reading, its chips
>   and a Feet / sq box; a blank or unmeasurable one gets the presets. `GridChoice.pxPerSquare`
>   carries the reading to `prepareMapImage`, which pins the new map's image.
> - **The store.**
>   - `planImageReplacement` (pure, exported) and `replaceMapImage`, which asks first when the
>     grid would change under placed content.
>   - `applyImageFit`, `fitGridToImage` and `pinMapImageInPlace`.
>   - `setMapImage` and `replaceMapImage` share one upload helper, so a reading lands in the
>     same commit as the image: one undo step.
> - **Scene Config and the Scene panel** upload through `replaceMapImage` and say what it did.
>   The Scene panel opens Scene Config when it has to ask.
> - **Scene Config's** Grid px is now Square size on screen, and Padding moved into Grid. The
>   image section depends on pinning, as §3.5 says.
>
> Found and fixed on the way:
>
> - **100 stays a common size** after another size is remembered. Without that, remembering 70
>   would have read the next 100 px export (3000 × 2000) as 15 × 10 at 200 px.
> - **The typed boxes stay open** once a typed reading applies. When the question was all there
>   was, applying the first valid count used to collapse them mid-typing.
> - **Order of the unpinned section.** It showed Pin image to grid before the question. Answering
>   the question is the path for a new image, so it comes first; Pin, for maps lined up by hand,
>   now says so.
>
> Tests:
>
> - `tests/grid-inference.test.ts`, 30:
>   - every §5 case.
>   - eight file-name forms, and names that shouldn't count.
>   - rule 1.
>   - the remembered size, and 100 after another is remembered.
>   - ±1 px, the bounds and the rounding rule.
>   - `pinInPlace` against the unpinned drawing maths for three placements.
> - `tests/map-image-replace-warning.test.ts`, 7 new: `planImageReplacement` for a re-export, a
>   blank map, placed walls, nothing detected, a file name, and an unmeasured file.
> - `tests/map-image-pinning.test.ts`, 9 new:
>   - `replaceMapImage`: one undo step, a blank map, declining, and asking.
>   - `applyImageFit`, `fitGridToImage` and `pinMapImageInPlace`.
>   - a new map pinned from its reading.
> - `tests/create-encounter-fields.test.tsx`, 7 (happy-dom): the reading with nothing typed, a
>   chip, Other… both ways, the bounds message, the question, removing the image, and an
>   unmeasurable image.
>
> The full suite passes: 141 files, 1,729 tests. One run in between failed 3 tests elsewhere (two
> ability-editor weapon tests and the SRD monster run). They passed alone and on the next full
> run, most likely timeouts under load.
>
> Browser (Playwright with the seeded login, 28 checks, all passed), each path from a blank map:
>
> - **Campaign New Encounter, 3000 × 2000 test export.**
>   - It read 30 × 20 at 100 px with nothing typed, offered 15 × 10 and 60 × 40, and hid the
>     presets.
>   - The map and its saved copy were pinned.
>   - Image and grid were the same box on screen at zoom 1, 3 and 0.3, and at square size 60.
> - **Scene dropdown → Start fresh, 4200 × 2800.**
>   - It read 42 × 28 first; one chip made it 30 × 20 at 140 px, and 140 was remembered.
>   - The new scene was pinned and aligned.
> - **Scene Config, with a wall drawn.**
>   - A 6000 × 4000 re-export kept 30 × 20 silently, at 200 px, and said so.
>   - A 3200 × 2000 image asked "The new image is 32 × 20 squares; this map is 30 × 20.", and
>     declining changed nothing.
> - **Scene panel Replace, 2048 × 1536.**
>   - Scene Config opened and asked ("This map has 30.").
>   - Typing 40 made it 40 × 30 at 51.2 px, aligned, and 51.2 wasn't remembered.
> - **Pin image to grid on an imported old-style map** (Image X 22). The image didn't move, and
>   it then scaled with the grid from square size 44 to 88.
>
> No page errors, apart from the map-image Blob sync's 500s (no `BLOB_READ_WRITE_TOKEN` locally).
> A real Inkarnate export is still to try.

- `gridInference.ts` and the remembered usual size (§3.3).
- The New Encounter, replace and Scene Config changes (§3.5), including Pin image to grid.
- Tests:
  - `tests/grid-inference.test.ts`:
    - the §5 cases.
    - each file-name form.
    - rule 1 only applying when replacing or with content placed.
    - the 4–120 bounds.
    - `null` for 2048 × 1536 and 3840 × 2160.
    - the rounding rule.
  - `tests/map-image-replace-warning.test.ts` grows the same-grid, nothing-placed and
    different-grid cases.
  - A happy-dom test of `CreateEncounterFields`: the detection line, picking a chip, Other… in
    both directions, the no-fit question, and removing the image.
  - The Pin image to grid conversion: a hand-aligned map draws in the same place after pinning.
- Browser (Playwright with the seeded login). Run each path from a blank map:
  - campaign New Encounter.
  - scene dropdown → Start fresh.
  - Scene Config's upload.
  - the Scene panel's Replace.

  Use a real 100 px Inkarnate export, a 3000 × 2000 test image and a 2048 × 1536 one.
- **Done when** a 100 px Inkarnate export gets the columns and rows it was exported with, with
  nothing typed. Its grid sits on the art at zoom 0.3, 1 and 3, before and after changing the
  square size.

### Phase 3 — Align grid

For images that aren't VTT exports: purchased maps, plain 2K/4K exports, maps with a border. It's
also AGENTS.md §4's "matching two known grid points".

- **Align grid…** in Scene Config closes the modal. The map goes into an alignment mode, with a
  live grid over the image and a small floating panel.
- There are two ways to set it, with the same result:
  - **Box:** drag a rectangle over a known span, one square or several (say how many).
  - **Two points:** click two grid corners and say how many squares across and down they are.
- **Nudging.** Arrow keys nudge the origin by 1 source px (Shift: 10). `+` and `−` change px per
  square by 0.1.
- **Apply** writes `pxPerSquare` and `originX/originY`.
  - With nothing placed, it also fits columns and rows to the image.
  - With content placed, it asks whether to keep the current columns and rows.
  - Content never moves. The image moves under the grid, which is what aligning means.
- **Cancel** restores the previous values.
- Unpinned maps can now always be pinned, so Image X/Y/scale go away for good.
- Tests: the box and two-point maths as pure functions, and the panel's apply and cancel.
- Stretch, not needed for Inkarnate (its exports have no drawn grid): pre-fill the tool for images
  with a visible grid. Find the repeat distance of strong edges along each axis, deterministically
  and with no ML.

### Phase 4 — Optional extras

- **Sharper big maps.** Store by squares instead of a flat 2048 px: keep up to about 100 px per
  square, capped at a 4096 px edge and about 16.7 MP.
  - The 16.7 MP cap is iOS Safari's canvas limit, and `downscaleDataUrl` draws into a canvas.
  - Today a 30 × 20 map is stored at 68 px per square and a 60 × 40 map at 34 px, and both go
    soft at zoom 3.
  - Watch the Blob sync. It posts the data URL as JSON to `/api/encounters/[id]/map-image`, and
    Vercel functions cap request bodies at 4.5 MB. Keep the JPEG under about 3 MB, or move to
    client-side Blob uploads.
- **Fit to view.** When a new map opens, and on the viewport reset button, centre the map and zoom
  (0.3–1) so all of it fits. Today reset goes to a fixed spot at 100% (`INITIAL_VIEWPORT`,
  `src/components/scene/coords.ts`).
- **Foundry-style padding** (D3): a "25% (Foundry)" choice next to the padding box, rounded up to
  whole squares.
- **Universal VTT import** (`.dd2vtt` / `.uvtt`). These files carry px per square, the map size,
  and walls and doors in grid units, so Dungeondraft maps would arrive with their walls drawn.
  Inkarnate doesn't export it, so it's low priority here.

---

## 5. Prototype check

A quick prototype of §3.3's order (a scratch script, not committed), with the usual size at 100,
no current grid and no file name:

| Export | Pixel size | First guess | Alternatives |
|---|---|---|---|
| 30 × 20 @ 100 px | 3000 × 2000 | **30 × 20** ✓ | 15 × 10 @ 200, 60 × 40 @ 50 |
| 30 × 25 @ 70 px (Roll20) | 2100 × 1750 | **30 × 25** ✓ | 42 × 35 @ 50 |
| 40 × 40 @ 100 px | 4000 × 4000 | **40 × 40** ✓ | 20 × 20 @ 200, 80 × 80 @ 50 |
| 60 × 40 @ 100 px | 6000 × 4000 | **60 × 40** ✓ | 30 × 20 @ 200, 120 × 80 @ 50 |
| 33 × 17 @ 100 px | 3300 × 1700 | **33 × 17** ✓ | 66 × 34 @ 50 |
| 30 × 20 @ 140 px | 4200 × 2800 | 42 × 28 ✗ | **30 × 20 @ 140** is the first chip |
| 24 × 18 @ 200 px | 4800 × 3600 | 48 × 36 ✗ | **24 × 18 @ 200** is the first chip |
| Plain 2K export (40 × 30) | 2048 × 1536 | Asks | — |
| Plain 4K export | 3840 × 2160 | Asks | — |

- Every 100 px export is right first time.
- The two misses are other sizes that 100 also divides evenly. Each is one click away, and after
  that click the remembered size gets the next export right.
- With 256 px on the common-size list, the 2K export guessed 8 × 6. That's why it's left out
  (§3.3).

---

## 6. Testing

- **Lossless.** An unpinned map renders exactly as before, and every existing test in
  `scene-metrics.test.ts` passes unchanged.
- **Pure tests** for `gridInference.ts`, the Pin image to grid conversion, and the Phase 3 maths.
- **Store tests** for `NewMapOptions` and every replace case.
- **Component tests** (happy-dom) for the modal's detection line, chips, Other… and the no-fit
  question.
- **Browser:** every upload path, each from a blank map, with one real Inkarnate export.

---

## 7. Decisions

### Decided (2026-10-02)

| # | Question | Decision |
|---|---|---|
| D1 | The size assumed when nothing else says | 100 px per square, what the Inkarnate exports use and Foundry's default. Then the last size you confirmed. |
| D2 | An image whose size fits more than one grid | Apply the best guess. The others are one-click chips beside it, with no confirm step. |
| D3 | Padding | Stays in whole squares and no longer plays a part in alignment. Foundry's 25% is an optional extra (Phase 4). |
| D4 | Where the usual size is remembered | This browser (localStorage), for now. Your account, so it follows you between devices, can come later. |
| D5 | Pinning maps made before this | Only when you click Pin image to grid. Never automatically on load. |
| D6 | Replacing the image of a map made before this | The new image goes through detection like any other upload: it's a new picture, and the old map's offsets don't apply to it. The rest of the map is unchanged. (The default, applied in Phase 2 with no objection.) |

---

## 8. Out of scope, and related

- Engine changes. There are none, and the 4–120 squares a side limit stays as it is.
- Hex grids (AGENTS.md §18).
- Machine-learning grid detection, which is Owlbear Rodeo's approach
  ([source](https://raw.githubusercontent.com/owlbear-rodeo/owlbear-rodeo-legacy/main/src/helpers/grid.ts)).
- **Related, worth its own small plan if it comes up:** replacing the image with a bigger one keeps
  content on its squares. Art added on the left or top edge would therefore need a "shift
  everything by N squares" tool.
