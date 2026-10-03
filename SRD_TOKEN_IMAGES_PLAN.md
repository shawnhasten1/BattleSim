# SRD Token Images Plan

Give every bundled SRD monster a token image, without shipping art we have no licence to distribute.

**Status (2026-10-03):** phases 1–3 committed (d2545c5) and fast-forwarded into master.
Browser-verified: placeholders on the map, sheet and SRD folder; the import → review → save flow;
art surviving a reload; "Remove your art"; credits. Additions beyond the plan: matching ignores
spacing ("Owl Bear" → Owlbear), the two-name creatures (Deep Gnome, Drow) share imported art
(`TWIN_SLUGS`), the Appearance section has "Remove your art", and `/tokens/` is excluded from the
auth proxy (the files are public CC-BY icons).

Two sources, layered:

1. **Placeholder tokens (shipped, everyone):** one SVG per monster, built from a
   [game-icons.net](https://game-icons.net) icon (CC BY 3.0) on a disc tinted by creature type.
2. **Device token pack (local, per browser):** the DM imports token art they're licensed to use
   (a purchased pack, their own art). It's matched to monsters by filename and stored in IndexedDB.
   It is never written into a definition, so it never syncs to the server or reaches another user.

Roll20 compendium art was ruled out: it isn't SRD content (the CC-BY-4.0 SRD covers text only),
the app distributes the SRD library to other accounts, and Roll20's terms forbid scraping.

## Resolution order

A token's image, first hit wins:

| # | Source | Stored in | Synced |
|---|--------|-----------|--------|
| 1 | This token's own image (`combatant.tokenVisuals.imageUrl`) | encounter | yes |
| 2 | Its creature's image (`definition.tokenVisuals.imageUrl`) | definition | yes |
| 3 | Device pack image for its SRD slug | IndexedDB `battle-sim-tokens` | **no** |
| 4 | Placeholder `/tokens/srd/<slug>.svg` | `public/` | static |
| 5 | Initials | none | none |

Steps 3 and 4 key off `definition.source` (`provider: "srd"`, `slug`), not the id, so an adopted or
copied SRD monster (re-minted `def-…` id, same `source`) keeps its art. Library index rows (the SRD
Monsters directory) use the entry's `slug` directly.

All renderers go through one resolver (`resolveTokenVisuals` in `src/lib/token-image.ts`): the
scene canvas, `ActorThumbnail` (sheet header, actors panel, SRD folders), the Token tab preview, the
battle report and summaries. `SceneCanvas`'s private copy of `tokenVisualsFor` goes away.

## Phase 1: placeholder tokens

- `scripts/srd-tokens/icon-map.ts`: `slug → "author/icon-name"` for every index slug, including hidden
  forms. The author folder doubles as the attribution record. A type-level fallback map covers any slug
  left unmapped.
- `scripts/build-srd-tokens.ts` (`npm run build:srd-tokens`): reads icon bodies from
  `@iconify-json/game-icons` (devDependency) and writes `public/tokens/srd/<slug>.svg`. Each SVG is a
  type-coloured disc with a light rim and the icon centred in off-white. It also writes
  `src/data/srd/monsters/generated/token-icons.json` (`slug → icon`, the authors used) for credits and
  tests.
- Credits: a "Token icons" block in Docs `#credits`, reading "Icons made by Lorc, Delapouite, … from
  game-icons.net, CC BY 3.0". The authors are generated, so the list can't drift. The SRD attribution
  statement is untouched.
- Tests: every index slug has a file, every mapped icon exists, and the credits list every author used.

## Phase 2: resolver and rendering

- `src/lib/token-image.ts`: `srdSlugOf(definition)`, `placeholderTokenUrl(slug)`,
  `resolveTokenVisuals(definition, combatant, localImages)` → `TokenVisuals & { imageSource }`.
- `imageSource` grows `"device"` and `"placeholder"`. The Appearance note explains each one, and
  "Clear" only clears what that scope owns.
- Placeholder images render with `image-token` styling (round, no initials).

## Phase 3: device token pack

- `src/lib/tokenPackStore.ts`: IndexedDB DB `battle-sim-tokens`, store `srd-tokens`, `slug → Blob`.
  A separate DB keeps `mapImageStore`'s version untouched. Degrades quietly, like the map store.
- `src/store/token-pack-store.ts` (small Zustand store): hydrates once on the client into
  `slug → objectURL`; `putMany`, `remove`, `clear`. Object URLs are revoked on replace/clear.
- `src/lib/token-pack-match.ts` (pure, tested) does filename → slug matching:
  - normalise: drop the extension, split on `_ - . space ,` and camelCase, lowercase;
  - drop noise words (`token`, `topdown`, `top`, `down`, `scale`, `art`, size names, `a1`, `01`,
    `v2`, …);
  - **exact:** the word set equals a monster name's word set, in any order ("Dragon_Red_Ancient" →
    ancient-red-dragon);
  - **suggested:** best word overlap ≥ 0.6, shown for confirmation;
  - several files for one monster: the first wins and the rest are listed as variants.
- Import modal ("Token images", opened from the SRD Monsters folder next to the credits link):
  - choose files or a folder (`webkitdirectory`);
  - review table: matched, suggested (tick to accept), unmatched (assign with a monster picker), with
    thumbnails;
  - save downscales each image to at most 512 px (WebP) and stores it;
  - shows "N of 325 monsters use your images", plus Remove all;
  - says plainly that the images stay in this browser and aren't uploaded or shared.
- Tests: the matcher (word order, noise, suggestions, variants), the store with fake-indexeddb, and
  the resolver order.

## Out of scope

- Per-monster "set device image" from the Token tab (can come later; uploading there today writes to
  the definition, which syncs).
- Images for non-SRD actors: they keep using the existing upload.
- Our own commissioned art: it will replace the placeholder SVGs in place, with no code change.
