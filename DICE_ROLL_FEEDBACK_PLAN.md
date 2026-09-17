# Dice Roll Feedback Plan

BG3-style on-board readability for the numbers that actually decide a fight:
"17 + 5 = 22 vs AC 15 — HIT", "11 vs DC 14 — FAIL", with the physical d20 (and
d4/d6/d8/d10/d12, later d100) shown, not just the log line. The battle log
stays as the power-user/audit trail; this is the always-visible layer so a
running sim reads without opening it.

Builds directly on `SCENE_FEEDBACK_PLAN.md` (Phases A–C, all shipped): the
`.feedback-layer`/floatie mechanism, `useSceneFeedback`'s forward-by-one /
Step-batch spawn rules, and the replay dwell timer are all reused as-is. This
plan only adds new cue *content* and one new visual (dice), not a new
sequencing model.

---

## Scope decisions

- **Two new cue kinds, not a redesign.** `AttackRolled` and `SaveRolled`
  already carry everything needed (`attackRoll`/`saveRoll` as a full
  `DiceRollResult`, `total`, `dc`/`targetAc`, `hit`/`success`, `critical`).
  No engine schema changes are required for the core feature.
- **Anchor at the target, stacked above the damage number.** The engine
  already logs `AttackRolled`/`SaveRolled` immediately before the matching
  `DamageApplied`, and existing damage/heal floaties already anchor at the
  target. Anchoring the roll cue at the target too means, during replay, the
  sequence reads top-to-bottom in place: roll badge → HIT/MISS or
  SUCCESS/FAIL tag → `-N` a beat later. No new anchor-resolution logic needed.
- **Real die silhouettes, not just a number.** A generic `<DieBadge sides
  value />` renders any of d4/d6/d8/d10/d12/d20 (d100 later, see Phase F) as a
  CSS `clip-path` polygon shaped like that die, colored, with the pip value
  centered — no image assets, matching how this codebase already does all its
  other visuals (plain CSS, no library). One component handles every sides
  value off the same `DiceRollResult.rolls[]` the engine already produces, so
  damage-dice breakdowns (`2d6+3`) reuse it too.
- **Advantage/disadvantage shows both d20s.** `rollD20` already rolls two
  dice and keeps both in `rolls[]` when adv/disadv applies; the discarded one
  renders struck-through/dim next to the kept one, exactly like a VTT.
- **Log stays untouched.** This is purely an additive on-map layer (new
  floatie kind + new small dice component). `ReplayBar`'s raw log list,
  `CombatLogEvent` schema, and the store are not changed beyond the two
  cosmetic, backward-compatible `data` additions in Phase D's table.

---

## Where it renders

Same `.battlemap` stack as `SCENE_FEEDBACK_PLAN.md`, one more layer:

| Layer | Element | Driven by | Lifetime |
|---|---|---|---|
| Tokens | `.token` buttons | `useDisplayEncounter()` | persistent |
| HP bars | `.token-overlay-layer` (z 6) | `useDisplayEncounter()` | persistent |
| **Dice/roll cue** | `.dice-layer` (z 7, new) → `<SceneDiceLayer>` | `useSceneFeedback` (new `diceCues`) | ~1.6 s, self-pruning |
| Floating text | `.feedback-layer` (z 7) → `<SceneFeedbackLayer>` | `useSceneFeedback` | ~1.3 s, self-pruning |
| AoE flash | `<rect>`s in `SceneOverlays` SVG | `useSceneFeedback` | ~1.5 s, self-pruning |

The dice cue and the existing damage/heal floatie both anchor at the same
cell; the dice cue sits ~1 grid cell higher (`cell.y - 0.9` vs the floaty's
`cell.y + 0.12`) so they don't overlap, and its longer TTL means it's already
fading as the damage number rises through where it was.

---

## Phase D — Attack/save roll cues (text-first slice)  ✅ done

Landed as designed, with one addition found during browser verification:
- `src/lib/combatFeedback.ts` — `FeedbackKind` gained `attack-hit`/`attack-miss`/
  `attack-crit`/`save-pass`/`save-fail`; `combatTextForEvent` gained the
  `AttackRolled`/`SaveRolled` cases described below, plus two small pure
  helpers: `rollNatural(roll)` (`total - modifier`, which recovers the chosen
  d20 face whether the roll's own `modifier` is 0 — attack rolls, whose flat
  bonus lands in the event's `total` instead — or the full bonus, as
  `rollD20WithBonus` bakes in for saves) and `rollLine(natural, total)`
  (`"17"` when unmodified, else `"17 + 5 = 22"`).
- `src/hooks/useSceneFeedback.ts` — `AttackRolled`/`SaveRolled` added to
  `CUE_TYPES` (Step-mode batch path); the replay forward-by-one path needed
  no change since it already runs every event through `combatTextForEvent`.
- **Addition beyond the original design:** `src/components/scene/SceneFeedbackLayer.tsx`
  now floats roll cues from *above* the token (`cell.y - 0.55`) instead of the
  damage/heal/action cues' spot at the token's top edge (`cell.y + 0.12`).
  Browser verification showed the roll line and the `-N` damage number that
  follows it a beat later landing in the same spot and overlapping/colliding
  at typical cell sizes — the vertical split keeps the "roll → outcome" read
  order legible instead of stacking illegibly.
- `app/globals.css` — `.feedback-attack-hit`/`.feedback-save-pass` (green,
  `--ui-hp-high`), `.feedback-attack-miss`/`.feedback-save-fail` (neutral
  gray `#8a8578` — miss/fail isn't damage, so it doesn't get damage-red),
  `.feedback-attack-crit` (gold `--ui-accent-soft`, bolder/larger).
- `src/lib/replay.ts` — `dwellForEvent` for `AttackRolled`/`SaveRolled` bumped
  650ms → 950ms to give the longer roll line time to read during watch-mode
  playback.
- Tests: `tests/combat-feedback.test.tsx` extended — hit/crit/miss/natural-1
  formatting, unmodified-roll text (no redundant `"17 + 0 = 17"`), auto-hit
  and malformed-event skip, save pass/fail. Browser-verified end to end
  (Playwright): Step mode, Auto Run, and replay watch-mode all show e.g.
  `13 + 4 = 17 vs AC 14 — HIT` landing above the target a beat before the
  matching `-8` damage number; zero console errors; scrubbing still spawns
  nothing.

**Follow-up fix — declare → roll → result ordering.** User feedback after
Phase D landed: for a multi-target action, the on-screen text should read
"actor declares the spell, then saves are rolled, then the result" — text
sequencing only, no simulation changes. The log already carries the right
order (`ActionDeclared` fires before any `SaveRolled`/`AttackRolled`/
`DamageApplied` for that action), and replay/watch-mode already surfaces
cues one event at a time, so it already reads correctly there. The real bug
was in **Step mode**: `useSceneFeedback`'s batch path capped a busy turn to
its last `STEP_BATCH_CAP` (6) cue-worthy events via a flat `.slice(-6)` —
for any 3+-target spell (1 declare + a save and a damage number per target
easily exceeds 6), the declare is chronologically the *oldest* event and was
the one silently trimmed, so the "casts Fireball" label would never show —
just rolls and numbers with no announcement.

Fixed by extracting the selection logic into a new pure, unit-tested helper:
- `src/lib/combatFeedback.ts` — `selectStepBatchCues(events, cap)`: filters
  to cue-worthy types, then caps only the *non*-`ActionDeclared` events to
  `cap`, keeping every `ActionDeclared` regardless. Order is preserved
  (declare(s) first, then whichever recent rolls/damage survived the cap).
  `CUE_TYPES` moved here from the hook, now private to this module.
- `src/hooks/useSceneFeedback.ts` — the Step-mode effect now just calls
  `selectStepBatchCues(log.slice(prevLen), STEP_BATCH_CAP)` instead of
  inlining the (buggy) filter/slice.
- `src/lib/replay.ts` — `dwellForEvent` gained an explicit `ActionDeclared`
  case (500ms, up from the 160ms default) so watch-mode playback gives the
  announcement its own beat before the first roll fires, rather than nearly
  overlapping it.
- Tests: three new `selectStepBatchCues` cases in
  `tests/combat-feedback.test.tsx`, including the exact reported scenario (a
  4-target spell: 1 declare + 8 roll/damage events against a cap of 6) —
  asserts the declare survives and only the oldest surplus pair is trimmed.
  Browser-verified: Step mode on the existing melee sandbox still shows
  action labels correctly with no regressions or console errors (no
  AoE-capable caster was on hand to click through the 3+-target case live,
  but the unit test exercises the real engine-shaped event data for it).

### Original design

Smallest useful increment: ship the *numbers* first (no polyhedral art yet),
reusing `SceneFeedbackLayer` verbatim with new `FeedbackKind`s. This alone
answers the user's actual complaint ("what did they roll, what did they
need") without touching rendering infrastructure.

**`src/lib/combatFeedback.ts`**
- Extend `FeedbackKind` with `"attack-hit" | "attack-miss" | "attack-crit" |
  "save-pass" | "save-fail"`.
- Extend `combatTextForEvent`:
  - `AttackRolled` (skip when `data.autoHit`) → text =
    `` `${natural(data.attackRoll)}${modSuffix(data.attackRoll)} = ${data.total} vs AC ${data.targetAc}` ``,
    anchor `data.targetId`, kind `data.critical ? "attack-crit" : data.hit ? "attack-hit" : "attack-miss"`.
  - `SaveRolled` → text =
    `` `${natural(data.saveRoll)}${modSuffix(data.saveRoll)} = ${data.total} vs DC ${data.dc}` ``,
    anchor `data.targetId`, kind `data.success ? "save-pass" : "save-fail"`.
  - `natural()` reads `rolls[0].value` (or, for adv/disadv, whichever roll's
    total matches the selected `total`) — the shown d20 face, not the
    modified total.
- New unit tests mirroring the existing damage/heal cases: hit/miss/crit,
  save pass/fail, auto-hit beam is skipped, natural-1 auto-miss still labeled
  `attack-miss` (not just "low roll").

**`src/hooks/useSceneFeedback.ts`**
- Add `"AttackRolled"` and `"SaveRolled"` to `CUE_TYPES` (Step-mode batch
  path). The replay forward-by-one path already processes every event type
  via `combatTextForEvent`, so no change needed there beyond the helper
  itself returning non-null now.

**`app/globals.css`**
- `.feedback-attack-hit`, `.feedback-save-pass` → `--ui-hp-high` (green),
  matches the existing "good for the attacker/bad for defender" damage-red
  convention loosely — see open question below on hit-color semantics.
- `.feedback-attack-miss`, `.feedback-save-fail` → neutral gray, not red
  (red is reserved for damage numbers; a miss isn't damage).
- `.feedback-attack-crit` → `--ui-accent-soft` (gold) + a slightly larger
  `font-size` / bold, no new keyframe (reuse `feedback-float`).

**`src/lib/replay.ts`**
- Bump `dwellForEvent` for `AttackRolled`/`SaveRolled` from 650ms toward
  ~900–1000ms — there's now a full "17 = 22 vs AC 15" line to read, not just
  a flash.

**Tests** — extend `tests/combat-feedback.test.tsx`.
**Browser-verify** — Step and Auto Run/watch: roll line appears above the
target, followed by the damage number; scrubbing still sprays nothing;
auto-hit beams and repeat-saves-on-condition (`repeatSave: true`, no
`targetAc`) don't crash the formatter.

---

## Phase E — Real dice visuals

Replace/augment Phase D's plain text with an actual die badge component,
shared by attack/save rolls **and** damage-dice breakdowns.

**New: `src/components/scene/DieBadge.tsx`**
```tsx
interface DieBadgeProps {
  sides: 4 | 6 | 8 | 10 | 12 | 20 | 100;
  value: number;
  tone?: "normal" | "crit" | "fumble" | "discarded";
}
```
- Pure presentational `<span className={`die die-d${sides} tone-${tone}`}>`
  with the value centered. Shape comes from `clip-path` per `sides` (d4
  triangle, d6 rounded square, d8 diamond/rotated square, d10 kite, d12
  pentagon, d20 hexagon) — no assets, themeable via CSS custom properties
  like the rest of the app.
- `tone="discarded"` (the dropped adv/disadv roll) renders dim + line-through.
- `tone="crit"` (natural 20) / `"fumble"` (natural 1) get a glow/shake accent.

**New: `src/lib/combatFeedback.ts` addition**
- `diceCueForEvent(event): DiceCue | null` — a richer sibling to
  `combatTextForEvent`, returns
  `{ anchorId, dice: {sides, value, tone}[], modifier, total, target, targetLabel, outcome }`
  for `AttackRolled`/`SaveRolled`. `dice[]` comes straight from
  `DiceRollResult.rolls` (already `{sides, value, sign}[]`); adv/disadv
  produces two entries, one tagged `"discarded"`.
- Damage breakdown (stretch within this phase, see below) reuses the exact
  same `dice[]` shape off `DamageApplied.data.components[].roll.rolls`.

**New: `src/components/scene/SceneDiceLayer.tsx`** + `useSceneFeedback`
gains `diceCues: ActiveDiceCue[]` on the same spawn/TTL machinery as
`floaties` (own TTL, ~1600ms — needs to outlast the text cue slightly since
it's denser to read). Rendered as its own `.dice-layer` sibling, positioned
like `SceneFeedbackLayer` but drawing a small horizontal cluster: `[d20: 14]
+5  = 19  vs AC 15  HIT`.

**When this replaces Phase D's text**: once the badge cluster lands, the
Phase D plain-text cue becomes redundant for `AttackRolled`/`SaveRolled` —
drop those two cases back out of `combatTextForEvent` (keep
`diceCueForEvent` as the sole source) rather than showing both.

**Damage-dice breakdown (optional within Phase E)** — today `DamageApplied`
just floats `-13`. A secondary, smaller/fainter dice cluster (`2d6+3 → [4,
6] +3`) beneath it, using the same `DieBadge`, is a natural extension once
the component exists — gate it behind checking `components[].roll.rolls`
isn't empty (some damage is flat/auto, e.g. `autoHit` beams) and cap to the
first damage component so multi-damage-type hits (rare) don't overflow the
cell.

**CSS** — `.die` base (fixed small square footprint, `display:flex;
align-items:center; justify-content:center`), one `clip-path` rule per
`.die-dN`, `.tone-crit`/`.tone-fumble`/`.tone-discarded` overlays,
`prefers-reduced-motion` fallback (no scale/rotate-in, fade only) matching
the existing `.feedback`/`.area-flash` pattern.

**Tests** — `diceCueForEvent`: normal roll, advantage (2 dice, correct one
marked kept), disadvantage, crit, fumble, save (no adv/disadv → 1 die), a
render test for `DieBadge` per `sides` value snapshotting the class name.
**Browser-verify** — same battery as Phase D, plus: advantage/disadvantage
attacks show both d20s with the discarded one struck through; crit visibly
distinct from a normal hit.

---

## Phase F — Stretch / deferred

- **d100 (percentile)** — `DiceRollResult` for a d100 roll is actually two
  d10s (tens + ones) per how 5e percentile dice work; `DieBadge` would need a
  `sides={100}` variant that renders as a paired d10 cluster. No current
  content in `spells.ts`/`combat.ts` rolls d100, so this is groundwork only —
  defer until something (e.g. a wild-magic-surge table) actually needs it.
- **Tumble-in roll animation** — a brief (~250ms) CSS `steps()` animation
  cycling the badge through random faces before landing on the real value,
  for extra juice. Purely cosmetic, additive, no data changes; skip if it
  reads as gimmicky at sim speed (Auto Run can resolve dozens of rolls in
  seconds — a tumble that's still fun at 1x may be noise at higher watch
  speeds, so gate it to only play when `speed <= 1`).
- **Multiattack fan-out check** — confirm during Phase D implementation that
  each swing of a multiattack still emits its own `AttackRolled` (expected,
  since the loop calls the same single-attack resolver per swing) so dice
  cues fire once per hit, not once for the whole `MultiattackResolved`
  summary event.
- **Sound** — out of scope entirely unless requested; no audio anywhere in
  this codebase today.

---

## Data / engine changes (all backward-compatible, optional)

| Change | File | Needed by | Status |
|---|---|---|---|
| None required — `attackRoll`/`saveRoll`/`total`/`dc`/`targetAc`/`hit`/`success`/`critical` already on `AttackRolled`/`SaveRolled` | — | Phase D & E | already present |
| *(optional)* stamp `actionName` onto `AttackRolled`/`SaveRolled` data (mirrors the Phase C `area`/`damageType` precedent) | `src/engine/combat.ts` | labeling which attack/save this roll belongs to, if the adjacent `ActionDeclared` name floaty isn't enough context | deferred, decide during Phase D |

No `EncounterSnapshot`/schema/store-shape changes. No new persisted state.

---

## Implementation order

1. **Phase D — text-first roll cues.** New `FeedbackKind`s, reuses all
   existing plumbing. Ships the actual user ask (readable rolls/DCs) fastest.
2. **Phase E — real dice visuals.** `DieBadge` + `SceneDiceLayer`, generic
   over all d4–d20, replaces Phase D's plain text for attack/save rolls, and
   optionally extends to damage-dice breakdowns.
3. **Phase F — stretch items**, picked up only if the above lands well and
   there's appetite for more (d100 groundwork, tumble animation).

---

## Non-goals (this pass)

- Replacing or altering the battle log (`ReplayBar`) — this is additive only.
- 3D/physics dice, sound effects.
- Redesigning the sequencing model — everything rides the existing
  forward-by-one replay / Step-batch spawn rules from `SCENE_FEEDBACK_PLAN.md`.
- Showing dice for every intermediate engine roll (e.g. initiative,
  concentration checks, death saves) — scoped to attack rolls and saving
  throws first since those are what the user specifically asked about; other
  roll types can reuse the same `DieBadge`/`diceCueForEvent` pattern later if
  wanted.
