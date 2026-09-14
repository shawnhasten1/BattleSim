# Accounts & Campaigns Plan

Turn BattleSim from a single-tenant, open backend (anyone who hits the API sees
everyone's projects, actors, and folders) into a real multi-user platform:
Google / email+password login, per-user **Campaigns** that own their own
encounters and maps, and a personal **actor library** that can include
shared, read-only system content ("SRD" imports) copyable into a user's own
private version.

The good news: the hard part — a server-backed Postgres schema with
`Project` → `Encounter`/`BattleMap`/`SimulationRun` and a global
`CreatureDefinition`/`ActorFolder` library — already exists (`prisma/schema.prisma`,
`app/api/**`). Nothing here is unauthenticated-to-authenticated data-model
surgery from scratch; it's adding a `User` model, an `ownerId` column in a
few places, and an auth check in every route that doesn't have one today.

## Status: 🚧 Phases 0-4 done, Phase 5 in progress (nav + thumbnails shipped, rename still deferred)

**Phase 0 landed 2026-09-13:**
- `User`/`Account`/`Session`/`VerificationToken` models added; `Project`,
  `CreatureDefinition`, `ActorFolder` each got a nullable `ownerId` (+
  `copiedFromId` on `CreatureDefinition`). Pushed to Neon via `prisma db
  push` — additive only, no data loss, confirmed by Prisma's own diff.
- `next-auth@beta` (Auth.js v5), `@auth/prisma-adapter`, `bcryptjs` installed.
- `src/server/auth.ts`: Google + Credentials providers, JWT session
  strategy (required once Credentials is present), `PrismaAdapter` wired for
  the Google side, `session.user.id` populated via callbacks.
- `app/api/auth/[...nextauth]/route.ts` exports the handlers.
- `.env`/`.env.example` got `AUTH_SECRET` (a real generated value is already
  in your local `.env`), `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET` placeholders.
- `npm run typecheck`, `npm run test` (521 passed), and `npm run build` all
  pass unchanged.

**Deviation from the plan as written:** the `Project` → `Campaign` rename
is **deferred to Phase 5**, not done in Phase 0. It touches
`encounter-store.ts` (`currentProjectId`, `loadProject`, `saveProject`,
`ProjectSummary`, …), `SceneDropdown.tsx` + its CSS module, and the
`app/api/projects/**` routes — real UI/store surface, not just schema. Doing
it once, at the point Phase 5 already rewrites those files for the
campaign-picker screen, avoids touching them twice. The Prisma model stays
named `Project` (with the new `ownerId` column) until then.

**Still manual / outside this session:** create the Google OAuth client at
Google Cloud Console (redirect URI `http://localhost:3000/api/auth/callback/google`
for dev, your prod domain equivalent for Vercel) and fill in
`AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` in `.env` and in Vercel's project env
vars; also set a separate `AUTH_SECRET` in Vercel (don't reuse the local one).
✅ Google credentials are now in local `.env` (still need the Vercel-side env
vars for prod, plus the prod redirect URI added to the same Google OAuth client).

**Phase 1 landed 2026-09-13:**
- Split the Auth.js config: `src/server/auth.config.ts` (edge-safe —
  `authorized` callback only, no Prisma/bcryptjs) + `src/server/auth.ts`
  (full config — Google/Credentials providers, the Prisma adapter, the
  invite-gate `signIn` callback). `proxy.ts` (Next.js 16 renamed the
  `middleware.ts` convention to `proxy.ts` mid-build — same API) at the repo
  root builds its `NextAuth(...)` instance from the edge-safe config only,
  so Prisma/bcrypt never get bundled into the Edge runtime.
- `ALLOWED_SIGNUP_EMAILS` invite gate (see "Suggested addition" above) is
  live: checked in `POST /api/auth/register` and in the Google `signIn`
  callback, but only for *new* accounts — an existing user can always log
  back in even if later removed from the list.
- `app/api/auth/register/route.ts` (zod-validated, bcrypt-hashed, invite-gated).
- `app/login` / `app/signup` pages, sharing `src/components/auth/AuthForm.tsx`
  (email+password form, Google button, inline error messages for bad
  credentials / invite-denied / duplicate email).
- `proxy.ts` gates every route except `/login`, `/signup`, and `/api/auth/*`
  behind a session — unauthenticated requests redirect to `/login?callbackUrl=...`.
- `SessionProviderWrapper` wraps the app in `app/layout.tsx`; `TopBar` grew
  a sign-out button.
- **Verified end-to-end via curl** (no headless browser available in this
  environment): unauthenticated `/` → 307 to `/login`; `/login`/`/signup`
  render their forms; registration rejects a non-allowlisted email (403),
  accepts the allowlisted one (201), and rejects a duplicate (409); the full
  Auth.js credentials handshake (csrf → callback/credentials → session
  cookie) logs in and unlocks `/` (200); sign-out revokes the cookie and `/`
  redirects again. No server errors in the dev log during any of this. The
  test account created during verification was deleted afterward — sign up
  again through the UI with your real password.
- `npm run typecheck`, `npm run test` (521 passing), `npm run build` all green.

**Known interim gap, not yet fixed:** visiting `/login` or `/signup` while
already authenticated doesn't redirect you away — `authorized()` allows
those two paths unconditionally regardless of session state. Minor polish,
deferred rather than adding complexity to the edge-safe callback; revisit
in Phase 5 alongside the rest of the nav work.

**Phases 2 and 3 landed together 2026-09-13.** They turned out to be
inseparable in practice: enforcing ownership without first backfilling
existing rows would have locked your own account out of your own data (see
below), so both shipped in the same pass rather than as separate turns.

**Phase 3 (backfill) ran first:** `scripts/backfill-owners.mjs <email>`
assigned every then-unowned `Project` and `ActorFolder` row to your account,
and split `CreatureDefinition` rows — source-imported ones (all 6 that
existed) stay `ownerId: null` (shared templates), homebrew ones (none yet)
would have been assigned to you. `Project.ownerId` was then promoted from
nullable to required in the schema (safe — every row had an owner by then),
simplifying the Prisma types for every route that touches it.

**Phase 2 (route enforcement) landed on top:** `src/server/require-user.ts`
exports `requireUserId()` (returns the session's user id, or a 401
`NextResponse` for the route to return as-is). Applied to every existing
route:
- `/api/projects`, `/api/projects/[id]`: filtered/checked by `ownerId`; a
  mismatched or missing project 404s (never 403 — don't confirm existence).
- `/api/encounters`, `/api/encounters/[id]`, `/api/simulation-runs`: no
  direct `ownerId` column, so authorized by loading the parent project's
  `ownerId` first.
- `/api/definitions`, `/api/definitions/[id]`: list returns own rows +
  shared templates (`ownerId: null`); mutating routes (`POST` upsert, `PUT`,
  `DELETE`) reject with 403 unless you own the row — this blocks editing
  someone else's actor *and* editing a template, by the same check, since
  both have `ownerId !== you`. Newly created definitions now get
  `ownerId` set to the creator automatically.
- `/api/folders`, `/api/folders/[id]`: same pattern as definitions. The
  cycle-check and the delete-time "reassign child definitions" query in the
  `[id]` route were also scoped to `ownerId` — they previously scanned every
  user's folders/definitions, which was harmless while single-tenant but
  wrong once other accounts exist.

**Verified with two disposable test accounts** (`test1@example.com`,
`test2@example.com`, created directly via script — never tested against
your real account or a guessed password): confirmed empty-by-default
project/folder/definition lists for a fresh account with only the 6 shared
templates visible; created a project+encounter+folder+definition as test1;
confirmed test2 gets an empty list (no leakage) and a 404 on every direct
id-based GET/PUT/DELETE attempt against test1's project, encounter, and
simulation-run creation; confirmed *neither* test account can edit or
delete a shared template (403 on PUT/DELETE/upsert-POST) while both can
still read it; confirmed test1's own create → own delete flow still works
normally, and test2 gets 403 trying to delete test1's own actor. No
unexpected server errors during any of this. Both test accounts (and their
cascade-deleted data) were removed afterward.
`npm run typecheck`, `npm run test` (521 passing), `npm run build` all green.

**Minor pre-existing rough edge, noticed not fixed:** several routes call
`someSchema.parse(...)` directly with no try/catch, so a malformed request
body throws an uncaught `ZodError` and surfaces as a raw 500 instead of a
clean 400. Not introduced by Phase 2 (same pattern predates this plan) and
not a security issue, just unpolished error handling — worth a pass
whenever the API routes get touched for something else.

**Big caveat now resolved:** two different accounts no longer see each
other's data. What's *still* outstanding after Phase 2/3: the
`Project` → `Campaign` rename/UI, still Phase 5.

**Phase 4 landed 2026-09-13:** `POST /api/definitions/[id]/copy` clones a
template (`ownerId: null`) — or your own actor, as an explicit duplicate —
into your library under a fresh id (`crypto.randomUUID()`), stamped with
`copiedFromId` for provenance and `" (Copy)"` appended to the name when
cloning a template. `GET /api/definitions` now also returns `templateIds:
string[]` alongside `definitions`, so the client can tell templates apart
without adding a field to the `CreatureDefinition` type or letting a
derived flag leak into the persisted JSON blob.

Client side: `encounter-store.ts` gained `templateDefinitionIds: string[]`
(not persisted to localStorage — refetched with the rest of the library) and
a `copyLibraryDefinition(id)` action. `ActorsPanel.tsx`: library rows for a
template show a "· Template" suffix and a Copy-icon "Copy to my library"
button instead of the normal Save/Delete toggle; the selected-combatant
toolbar swaps its "Save" button for "Copy to My Library" when the selection
traces back to a template id, since attempting the normal save would now
403. `ActorSheet.tsx` needed no changes — it has no save/delete controls of
its own (those live in `ActorsPanel`'s selection toolbar, which is handled).
Copying does **not** retarget any combatant already placed on the board —
it only adds an editable copy to your library, matching the literal "copy to
library" framing rather than silently swapping out a live token.

**Verified with two disposable test accounts** (created directly via
script, deleted after — same pattern as Phase 2's verification, never
touching the real account): `GET /api/definitions` returns `templateIds`
correctly; copying a template succeeds (201), appends "(Copy)", and the
result is *not* itself listed as a template; the copy is fully editable/
deletable by its new owner; a second account can independently copy the
same template into their own library without collision; copying someone
else's *private* (non-template) actor 404s. No unexpected server errors.
`npm run typecheck`, `npm run test` (521 passing), `npm run build` all green.

---

## Phase 5 — campaign-first navigation + thumbnails (2026-09-13)

Confirmed UX: **campaign list → that campaign's encounter list (with a map
thumbnail per encounter) → click to load into the editor.**

**Architecture prerequisite, resolved first:** map backgrounds lived only in
the browser's IndexedDB (`src/lib/mapImageStore.ts`), keyed per-device. An
encounter list rendered from a different browser/device than the one that
uploaded the image would have no way to show a thumbnail — the bytes simply
weren't anywhere the server could reach. Fixed by adding **Vercel Blob**
(CDN-backed out of the box — no separate CDN needed, confirmed with the user
before building) as server-side storage for map images, additive to the
existing IndexedDB cache rather than replacing it:
- `Encounter.mapImageUrl String?` — new nullable column. Deliberately on
  `Encounter`, not `BattleMap`: each encounter's `snapshotJson` is already
  the sole source of truth for its own map (grid/walls/terrain), and
  `BattleMap` rows turned out to be vestigial — created once per project in
  `POST /api/projects` but never linked via `Encounter.mapId` or read back
  by any route. Left `BattleMap` alone rather than cleaning it up now
  (out of scope for this pass; noted here so it isn't mistaken for load-bearing).
- `POST /api/encounters/[id]/map-image` — uploads a base64 data URL to Blob
  (`access: "public"`, stable pathname `map-images/{encounterId}.{ext}`,
  `allowOverwrite: true`), stores the returned URL on the Encounter row,
  deletes the previous Blob object if the URL changed. `DELETE` clears both.
  Both ownership-checked via a new shared `src/server/encounter-access.ts`
  (`isOwnEncounter`) — deduped out of `encounters/[id]/route.ts` and
  `simulation-runs/route.ts`, which had each carried their own copy of the
  same check.
- Client (`encounter-store.ts`): new `mapImageUrl` state field (the CDN URL,
  separate from `mapImageDataUrl` which is whatever's actually rendered —
  local data: URL or the remote URL, `<img src>` doesn't care which).
  `setMapImage` now also fires a best-effort `syncMapImageToServer` POST/DELETE
  whenever there's a `currentEncounterId`; the three "first save" paths
  (`saveProject`, `createEncounter`, `duplicateEncounter`) each push a
  carried-over draft image to the server once it's assigned a real id, mirroring
  the existing local `migrateMapImageKey`/`copyMapImage` IndexedDB steps.
  `hydrateMapImage` falls back to `mapImageUrl` when IndexedDB has nothing
  for the current key (cross-device case) and opportunistically caches that
  URL string into IndexedDB for next time. All of this is wrapped in
  `.catch(() => undefined)` — a missing/misconfigured Blob token degrades to
  "no server sync," never a crash (verified below).
- `GET /api/projects/[id]/encounters` — new lean endpoint
  (`{campaign: {id,name}, encounters: [{id,name,updatedAt,mapImageUrl}]}`),
  deliberately separate from the existing `GET /api/projects/[id]` (which
  still returns full `snapshotJson` per encounter for the editor's own
  load path) so the thumbnail grid isn't shipping every encounter's full
  multi-KB snapshot just to render a card.

**New pages** (both client components, dark-theme-matched,
`src/components/campaigns/`):
- `/campaigns` (`CampaignsListPage`) — lists the account's campaigns
  (`GET /api/projects`), create (name → `POST /api/projects` with a blank
  starter encounter → navigate into its encounter list), delete. Sign-out
  and a "Sandbox" link (to `/`, the pre-existing freeplay default) live in
  its own top bar, since this page sits outside the main editor shell.
- `/campaigns/[id]` (`CampaignEncountersPage`) — the campaign's encounters
  as a card grid, each showing its `mapImageUrl` thumbnail (a map-icon
  placeholder when unset), name, updated date; create (jumps straight into
  the new encounter) and delete. Clicking a card calls the existing
  `loadEncounter(id)` action, then navigates to `/`.
- Post-login now lands on `/campaigns` by default (`AuthForm`'s
  `callbackUrl` fallback changed from `/` to `/campaigns`); a direct deep
  link still round-trips correctly through login as before.
- `TopBar` (the main editor's) gained a small "back to campaigns" icon link.

**Deliberately out of scope for this pass — kept the diff focused:**
- **The `Project` → `Campaign` rename is still deferred.** The new pages
  use "Campaign" in their own UI copy/component names only; the underlying
  Prisma model, API routes (`/api/projects/**`), and store fields
  (`currentProjectId`, `loadProject`, `ProjectSummary`, …) are still
  `Project`-named under the hood. They now have real UI-level competition
  from the new pages, which strengthens the case for finally doing the
  rename, but it's still a separate, mechanical follow-up whenever it's
  wanted — not required for this feature to work correctly.
- **The old in-editor project/scene switcher** (`SceneDropdown.tsx` in the
  top bar, `ScenePanel.tsx`'s project section in the sidebar) was left
  completely untouched — still fully functional. The new pages are an
  additional, better entry point layered on top, not a replacement; removing
  the old UI is an easy follow-up if it ends up redundant in practice.
- Campaign rename/description editing and encounter renaming aren't in the
  new pages (both already exist elsewhere in the editor via
  `SceneConfigModal`/`SceneDropdown`).

**Verified with two disposable test accounts** (created/deleted via script,
real account never touched, same pattern as prior phases): `/campaigns`
renders when authenticated; creating a campaign via the API returns the
expected shape and an initial blank encounter; the new lean
`.../encounters` thumbnail endpoint returns exactly `{campaign, encounters}`
with `mapImageUrl: null` for a freshly created encounter; cross-account
access to both the thumbnail-list endpoint and the map-image upload
endpoint 404s correctly; uploading a map image *without* `BLOB_READ_WRITE_TOKEN`
configured yet fails with a clean, expected "No blob credentials found"
error (confirmed in the server log) rather than corrupting anything or
crashing the app — the client-side sync swallows it and the local
IndexedDB-backed editing experience is unaffected. `npm run typecheck`,
`npm run test` (521 passing), `npm run build` all green.

**Blocked on a manual step:** actual end-to-end image upload/thumbnail
rendering needs `BLOB_READ_WRITE_TOKEN` — create a Blob store at
vercel.com dashboard → your project → Storage → Create Database → Blob,
then add the token to `.env` (and to Vercel's project env vars for prod).
Not yet done as of this writing — the upload code path is written and
confirmed to fail gracefully in its absence, but hasn't been exercised with
a real successful upload.

---

**Follow-up (2026-09-14): campaign rename + cover thumbnail.** Requested
after the initial Phase 5 ship — `/campaigns` cards can now be renamed
inline and given their own thumbnail image, independent of any encounter's
map background:
- `Project.coverImageUrl String?` (new nullable column).
- `POST`/`DELETE /api/projects/[id]/cover-image` — same upload/replace/
  delete pattern as the encounter map-image route. Extracted the shared
  logic both now use into `src/server/blob-image.ts`
  (`parseDataUrl`/`replaceBlobImage`/`deleteBlobImage`), and refactored
  `encounters/[id]/map-image/route.ts` to use it too rather than duplicating.
  Rename reuses the *existing* `PUT /api/projects/[id]` (it already
  supported a bare `{name}` update — no backend change needed there).
- `GET /api/projects` now also selects `coverImageUrl`.
- `CampaignsListPage.tsx`: each card grew a small action row (top-right,
  outside the card's main clickable button to avoid nesting interactive
  elements) with rename (reuses the existing `RenameInput` from
  `ActorFolderNode.tsx`), a hidden-file-input cover-image upload
  (downscaled client-side via the existing `downscaleDataUrl`), and delete.
  `campaigns.module.css`'s old single-purpose `.cardDelete` became a
  general `.cardActions`/`.cardAction`/`.cardActionDanger` set, also
  adopted by `CampaignEncountersPage.tsx`'s delete button for consistency.
- Verified with disposable test accounts: rename persists and is
  reflected immediately; cross-account rename/cover-image attempts 404;
  cover-image upload fails with the same clean, expected "no Blob
  credentials" error as the encounter map-image path (still blocked on the
  same `BLOB_READ_WRITE_TOKEN` manual step — once that's set, both upload
  paths become live at the same time). `npm run typecheck`, `npm run test`
  (521 passing), `npm run build` all green.

**Follow-up (2026-09-14): every encounter gets its own URL.** Previously
the whole editor lived at `/` regardless of which encounter was loaded —
the campaign picker would `loadEncounter()` into the store and then
navigate to `/`, so a saved encounter had no bookmarkable/shareable URL and
two browser tabs would fight over the same client state. Now:
- `app/campaigns/[id]/encounters/[encounterId]/page.tsx` — loads the
  encounter named in the URL (skipping the fetch if the store already has
  it, e.g. on a back/forward navigation), shows a loading state while
  fetching and a clean error state (with a link back to the campaign) if it
  fails to load — deleted, or not yours.
- The actual editor UI was extracted from `app/page.tsx` into
  `src/components/editor/EncounterEditor.tsx` (verbatim move, no logic
  changes) so both the sandbox page and the new per-encounter route render
  the same component.
- `app/page.tsx` is now just the **sandbox** — freeplay against
  whatever's already in the store/localStorage, no campaign attached, kept
  exactly as it worked before.
- New `src/hooks/useSyncEncounterRoute.ts`, mounted unconditionally inside
  `EncounterEditor`: watches the store's `currentProjectId`/
  `currentEncounterId` and pushes the URL to match whenever they change —
  regardless of *how* they changed. This means the **old in-editor
  SceneDropdown/ScenePanel needed zero changes**: loading a different
  encounter through them now transparently updates the address bar too,
  since both paths (a fresh URL navigation, or the old dropdown) funnel
  through the same store fields the hook watches. It also handles the
  sandbox → real-encounter promotion (saving from `/` jumps you to the new
  canonical URL) and the delete-out-from-under-you case (both ids go null
  → bounced back to `/campaigns`).
- `CampaignEncountersPage`'s `enterEncounter` now does a plain
  `router.push` to the encounter's URL instead of loading into the store
  and pushing to `/` — the destination route page owns its own loading now,
  so there's no double-fetch.
- `TopBar`'s "back to campaigns" icon is now context-aware: links to the
  current campaign's encounter list (`/campaigns/{currentProjectId}`) when
  one is loaded, `/campaigns` otherwise.
- **Verified**: the new route resolves and renders (200, no server errors)
  for a real owned encounter and for a bogus encounter id under a real
  campaign; unauthenticated access still redirects to `/login` with the
  full deep link preserved as `callbackUrl`. The client-side loading/error/
  redirect logic (React effects) couldn't be exercised by clicking through
  in a real browser — no headless browser available in this environment,
  same limitation as every prior phase — so treat that half as
  code-reviewed/reasoned-through rather than click-tested.
  `npm run typecheck`, `npm run test` (521 passing), `npm run build` all green.

**Unrelated but notable, found mid-task:** `CampaignsListPage.tsx`,
`CampaignEncountersPage.tsx`, the map-image/cover-image routes, and
`blob-image.ts` had already been modified on disk (outside this session)
before this change started — Vercel Blob storage switched from `access:
"public"` to `"private"`, with new authenticated `GET` handlers on both
image routes that stream the bytes through our own API instead of exposing
a public CDN URL. That's a real security improvement (previously anyone
with a URL could view an image forever, logged in or not) and was kept —
verified it still typechecks/tests/builds clean. If you didn't make that
change yourself, it's worth knowing something else touched this repo.

Remaining phases (5 cont'd, 6): the `Project` → `Campaign` rename (see
above — now optional/cosmetic rather than blocking), optional hardening
(password reset, rate limiting, account settings, the pre-existing
raw-500-on-bad-zod-input rough edge from Phase 2).

---

## Decisions (locked)

- **Auth: Auth.js v5 (`next-auth@beta`)**, self-hosted, Prisma adapter.
  Providers: Google OAuth + Credentials (email/password). Session strategy
  must be **JWT** — Auth.js's Credentials provider is incompatible with
  database sessions, so mixing it with Google means the whole app runs JWT
  sessions, not adapter-persisted `Session` rows.
- **Campaigns are solo-owned.** One `ownerId` per campaign, no membership/
  sharing table. Co-DM sharing is an explicit non-goal for this pass (noted
  as a fast-follow, not designed against yet).
- **Hosting is unchanged**: Vercel + Neon Postgres. No infra migration.
- **Actor library is account-wide, not per-campaign.** A user's homebrew
  monsters/PCs live in one library reused across all their campaigns,
  mirroring how the app already treats `CreatureDefinition`/`ActorFolder` as
  a single flat pool today. *(Assumption — flagged below; cheap to flip to
  per-campaign later if that's wrong.)*
- **`Project` → `Campaign` rename.** Client-side references to the type are
  minimal (2 hits in `encounter-store.ts`), so renaming the Prisma model
  (and the API routes' vocabulary) now avoids a permanent naming mismatch
  between what users see ("Campaigns") and what the schema says
  (`Project`). Low risk, doing it in Phase 0.
- **Invite-only signup for now.** Confirmed 2026-09-13 — build the
  allowlist/invite-code gate (see "Suggested addition" below) as part of
  Phase 1's registration flow rather than skipping it. Public signup and
  monetization are a real future direction but explicitly out of scope for
  this pass — don't design the schema around billing/plans yet.
- **Shared/system content model**: template rows have `ownerId = null`.
  Users never edit or delete a template directly — they hit a `POST
  .../:id/copy` endpoint that clones it into a new row under their own
  `ownerId`, with `copiedFromId` pointing back at the template for
  provenance ("based on Goblin (SRD)").

---

## Data model changes

New standard Auth.js models, plus `ownerId`/template columns on the
existing tables:

```prisma
model User {
  id            String    @id @default(cuid())
  name          String?
  email         String?   @unique
  emailVerified DateTime?
  image         String?
  passwordHash  String?   // null for Google-only accounts
  createdAt     DateTime  @default(now())
  accounts      Account[]
  campaigns     Campaign[]
  definitions   CreatureDefinition[]
  folders       ActorFolder[]
}

model Account {
  // standard Auth.js Prisma adapter shape (provider, providerAccountId, tokens...)
}

model VerificationToken {
  // standard Auth.js shape — needed even without email verification enabled yet,
  // some flows (password reset, later) reuse it
}

model Campaign {              // renamed from Project
  id          String   @id @default(cuid())
  ownerId     String
  owner       User     @relation(fields: [ownerId], references: [id], onDelete: Cascade)
  name        String
  description String?
  ...          // maps, encounters relations unchanged
}

model CreatureDefinition {
  id            String   @id @default(cuid())
  ownerId       String?  // null = shared system template
  copiedFromId  String?  // provenance when cloned from a template
  ...           // existing fields unchanged
}

model ActorFolder {
  id       String  @id @default(cuid())
  ownerId  String? // null = would only apply to system folders, if we ever add any
  ...
}
```

`BattleMap`, `Encounter`, `SimulationRun` need **no schema change** — they're
already reached only through a `Campaign`/`Encounter` chain, so scoping
happens by checking the parent's `ownerId`, not by adding a column.

---

## Authorization rules (every route needs one of these)

- **Campaigns** (`/api/projects*` → `/api/campaigns*`): all reads/writes
  filtered by `WHERE ownerId = session.user.id`. A campaign id that exists
  but belongs to someone else returns 404 (not 403 — don't confirm it
  exists).
- **Encounters / BattleMaps / SimulationRuns**: no direct `ownerId` column,
  so authorize by loading the parent campaign's `ownerId` first (one extra
  `select`), then 404 if it doesn't match the session user.
- **CreatureDefinition list** (`GET /api/definitions`): `WHERE ownerId =
  session.user.id OR ownerId IS NULL` — own actors + shared templates,
  visually distinguished client-side (a "Template" badge, read-only affordances).
- **CreatureDefinition mutate** (`PUT`/`DELETE /api/definitions/:id`): reject
  if `ownerId !== session.user.id` (covers both "someone else's" and
  "nobody's, i.e. a template" — templates are immutable via this route).
- **CreatureDefinition copy** (new `POST /api/definitions/:id/copy`): only
  allowed source is a template (`ownerId IS NULL`) or your own row; creates
  a new row with a fresh id, `ownerId = session.user.id`, `copiedFromId =
  source.id`.
- **ActorFolder**: same pattern as CreatureDefinition (own + null-owner
  system folders, if any are ever seeded).

All of the above lives behind one helper, e.g. `requireUser()` in
`src/server/auth.ts`, called at the top of every route handler — throw a
typed response early rather than repeating the session lookup.

---

## Migration plan for existing data

The current Neon DB has real rows (your dev campaigns, homebrew actors,
open5e imports) with no owner. One-time backfill script, run after the
schema migration lands but before enforcement goes live:

1. Add `ownerId`/`passwordHash`/etc. as **nullable** columns first (safe,
   non-breaking migration).
2. Create your own `User` row (sign up for real, or seed it directly).
3. Backfill `CreatureDefinition`/`ActorFolder`:
   - Rows with `sourceKey`/`importedJson` populated (open5e-sourced) →
     `ownerId = null` (become system templates — this is exactly the
     "pre-built, shared, read-only" content you described).
   - Rows without a source (hand-built homebrew) → `ownerId = <your user id>`.
4. Backfill `Campaign`/`Encounter` chains → `ownerId = <your user id>` on
   every existing `Campaign`.
5. Flip `ownerId` to `NOT NULL` on `Campaign` (definitions/folders keep it
   nullable — that nullability *is* the template marker, not a migration
   leftover).
6. Ship the auth-enforcing route changes only after step 5, so there's no
   window where scoped queries silently return empty results against
   still-null owner columns.

---

## Phased rollout

**Phase 0 — Schema & plumbing.** Add `User`/`Account`/`VerificationToken`,
`ownerId` columns (nullable), rename `Project` → `Campaign`. Install
`next-auth@beta`, `bcrypt` (or `@node-rs/argon2`). Configure Google OAuth
client + `AUTH_SECRET` in Vercel env vars. `src/server/auth.ts` with the
Auth.js config (Google + Credentials providers, JWT strategy, Prisma
adapter for the Account side).

**Phase 1 — Registration & login.** `POST /api/auth/register` (zod-validated
email/password, hash, create `User`) since Auth.js itself has no signup
flow for Credentials. Custom `/login` and `/signup` pages (Auth.js's default
pages don't support a Google-button + password-form combo well). `middleware.ts`
protecting everything except `/login`, `/signup`, and the NextAuth routes.
Wrap the app in `SessionProvider`.

**Phase 2 — Enforce ownership.** Add `requireUser()` and rewrite every
existing route under `app/api/**` to scope by `ownerId` per the rules above.
This is the bulk of the work but almost entirely mechanical given the
routes already exist.

**Phase 3 — Data backfill.** Run the migration script above against the
live Neon DB.

**Phase 4 — Copy-on-write for templates.** `POST /api/definitions/:id/copy`,
plus the client affordance: templates render with a "Template" badge and a
"Copy to My Library" action instead of Edit/Delete in `ActorsPanel`/`ActorSheet`.

**Phase 5 — Campaign-first navigation.** A "My Campaigns" landing screen
(list/create/delete, matches the existing `ScenePanel`/`SceneDropdown`
patterns) that gates entry into the encounter workspace — you pick or
create a campaign before you ever see the battle map. Rename
"Project"-flavored UI copy to "Campaign" throughout.

**Phase 6 — Hardening (stretch, not required for MVP).** Password reset +
optional email verification (needs a transactional email provider — Resend
pairs naturally with Vercel); rate limiting on `/api/auth/register` and the
Credentials sign-in path (Upstash Redis is the standard low-effort choice on
Vercel); an account settings page (change password, delete account/export
data).

---

## Suggested addition: gate signup

You didn't ask for this, but worth flagging: once `/signup` is live and
public, anyone on the internet can create an account and start writing
rows to your Neon DB. If this is meant to stay within a friend group /
your table rather than go fully public, a cheap guard is worth building
into Phase 1 rather than bolting on later:

- Simplest: an `ALLOWED_SIGNUP_EMAILS` env var (comma-separated allowlist)
  checked in `POST /api/auth/register` and in the Google OAuth `signIn`
  callback.
- Slightly more flexible: a single-use invite-code column, generated by you,
  required at signup.

Either is a few lines; skip entirely if open public signup is actually fine.

---

## Open questions / assumptions worth confirming before Phase 0

- **Actor library scope** — assumed account-wide (reused across all your
  campaigns), not per-campaign. Flag if you actually want a monster you
  build for one campaign to *not* show up while working on another.
- **`Project` → `Campaign` rename** — assumed yes since it's cheap now.
  Flag if you'd rather keep the Prisma model name `Project` and only rename
  it in UI copy (avoids touching the schema/migration at all, purely
  cosmetic difference).
- **Signup gating** — see above; default plan ships with open signup unless
  you want the allowlist/invite-code guard from day one.

---

## Files/areas touched (estimate)

`prisma/schema.prisma` (new models + columns), `src/server/auth.ts` (new),
`app/api/auth/**` (new), `app/api/{campaigns,encounters,definitions,folders,
simulation-runs}/**` (ownership checks added throughout — renamed from
`projects` where applicable), `middleware.ts` (new), `app/login`, `app/signup`
(new pages), `src/store/encounter-store.ts` (2 `Project` type references →
`Campaign`, plus wiring for the new campaign-list/create flow),
`src/components/sidebar/ActorsPanel.tsx` + `src/components/sheet/ActorSheet.tsx`
(template badge + copy action), a new campaign-picker component analogous to
`ScenePanel`/`SceneDropdown`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
