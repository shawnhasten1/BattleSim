# Upcasting and Counterspell Plan: any slot at or above, and counters that scale

**Status:** proposed 2026-10-04, not started. D1, D4 and D7 confirmed 2026-10-04: D4 was reworked to weigh the
spell's actual effect (§3), and D7 became a campaign rule (§7). The other decisions in §8 have recommended defaults.

Three problems, reported from play:

1. **Casters lock themselves out.** When a creature runs out of 4th-level slots it stops casting Blight, even though
   it still has 5th-level slots. In 5e any leveled spell can be cast with any slot of its level or higher.
2. **Upcasting only works when someone authored it.** Blight should gain 1d8 per slot above 4th. That only happens if
   the spell carries `upcast` data, and most homebrew and imported spells don't.
3. **Counterspell never touches a 4th-level or higher spell.** In 5e it can, by casting it with a higher slot (an
   automatic counter) or by winning a spellcasting check (DC 10 + the spell's level).

The plan covers the engine, the AI, the ability builder, and Play mode. Researched in the code 2026-10-04.

## Summary

- **Every leveled spell can use any higher slot (Phase 0).** The compiler already makes a "cast with slot N" copy per
  higher tier, but only for spells with `upcast` data. It will make them for every leveled spell that spends a
  `slot-N`, including reactions (Shield, Counterspell). A copy with no upcast benefit is offered to the AI only once
  every lower slot it could use is spent, so the AI's choices don't grow and batch speed holds.
- **A spell's level is the slot it was cast with.** Counterspell and the log read the slot actually spent, not the
  spell's printed level. An upcast Fireball at 5th is a 5th-level spell.
- **Counterspell works like the rules say (Phase 1).** Its higher-slot copies counter automatically up to their
  level. Below that, a spellcasting check against DC 10 + the spell's level decides it. The check is logged and, in
  Play, can be overruled like any roll.
- **The AI counters what's worth countering.** It weighs what the spell would do to its side if let through: expected
  damage across everyone it catches, who it would drop, and the conditions it would land and for how long. It sets
  that against the slot it would spend and its chance of success, priced the way the AI already prices slots and
  scaled by its resource stance. An upcast Fireball into the whole party gets countered; a Cure Wounds on a
  full-health enemy doesn't.
- **Each campaign decides what counterspellers know (Phase 5).** A toggle on the campaign page: they see the spell and
  its targets (default), or, as the rules are written, only that a spell is being cast.
- **The library fills its gaps (Phase 2).** The 12 SRD spells whose "At Higher Levels" text has no data get it where
  the engine can model it, or an explicit "no combat effect" marker where it can't. A test keeps the library honest
  against the CSV.
- **The builder says what's true (Phase 3).** Any leveled spell already uses a higher slot, so the builder says so and
  stops warning when one exists. A spell whose name matches an SRD spell offers that spell's upcasting in one click
  (offered, never applied silently). The spell's "At Higher Levels" text sits next to the controls as reference.
- **Play mode shows the slot (Phase 4).** Every leveled spell on the hotbar gets slot chips: lowest usable first,
  with what each adds ("5th · +1d8"). A Counterspell prompt shows each slot with its chance ("3rd · check, 45%",
  "5th · certain").

## 1. What's there today

### Upcast variants (`src/engine/combat.ts`)

- `spellUpcastVariants` (combat.ts ~4928) compiles one copy per higher slot tier the creature's `resources` declare,
  with id `<action>:upcast-N` and `resourceCost: slot-N`. Resolvers derive `slotLevel` from that cost, so spending
  and scaling are already correct for whatever copy runs.
- **The gate:** it returns `[]` unless `action.upcast?.perSlotAboveBase` is set. It also skips `activate-feature`
  actions entirely, which covers Shield and Counterspell.
- The necromancer in `necromancer.json` has 14 leveled spells and none carries `upcast`. Its Blight (slot-4, with
  slot-5s on hand) has no copies, so it goes dark once the three 4th-level slots are gone. The warlock template has 5
  leveled spells, also with no `upcast`. Its pact magic is modelled by giving each spell a `slot-3` cost directly,
  which keeps working unchanged.
- The AI (`simulation.ts`) already scores each copy as its own candidate. `resourceCostWeight` prices a slot by its
  level, `resourceStanceMultiplier` scales that, and `averageDamage` and `averageHealing` include the upcast EV. No
  new scoring is needed for damage, healing, beams or Hold Person-style targets.

### Counterspell

- SRD data (`src/data/srd/spells.ts` ~644): an `activate-feature` reaction, trigger `enemy-casts-spell` within 60 ft,
  costing `slot-3`.
- `reactionTriggerPasses` (combat.ts ~6639): the reaction is offered only if the counter slot's level is at least the
  spell's level. No check is ever rolled. With no higher-slot copies, that means never against 4th level or higher.
- `fireReaction` (combat.ts ~6869) always returns `countered: true`.
- `reactionClearsValueBar` (combat.ts ~6683): the AI counters anything 2nd level or higher. It ignores the slot's
  cost and the caster's resource stance.
- `counterspellWindow` (combat.ts ~6912) reports `action.spellLevel`, the printed level. An upcast copy's slot is
  ignored, so an upcast Fireball is countered as a 3rd-level spell.

### Builder

- `Upcasting` in `src/components/sheet/ability-editor/SpellSections.tsx` ~192 edits the per-level damage or healing
  dice, beams and targets. Its copy says "Stronger with a higher slot", which implies higher slots are only for spells
  that get stronger.
- `missingPools` (`src/lib/ability-editor/validate.ts` ~150) excuses a missing base slot only when the spell has
  `upcast` data.
- `normalizeOpen5eSpell` (`src/adapters/open5e-normalize.ts` ~66) folds `higher_level` into `description`. That's
  fine as reference text and must stay out of the engine (AGENTS.md §8).

### Play mode

- `hotbarFor` (`src/lib/play/hotbar.ts` ~285) already folds `:upcast-N` copies into one button with "Level N"
  variant chips, and defaults to the first usable one. Universal copies give every leveled spell a slot picker
  without any new work there.
- The reaction prompt (`src/lib/play/questions.ts` ~152) lists each option on its own row. With Counterspell copies,
  that would be one row per slot with no hint of the odds.

### Library gaps (scripted check of `spells.ts` against `srd_2014_spells_full.csv`'s `higher_level`)

Of 71 leveled library spells, 31 carry `upcast`. These 12 have "At Higher Levels" text and nothing authored:

| Spell | What higher slots do | Modelable now? |
|---|---|---|
| Ice Storm (4) | +1d8 bludgeoning per level | Yes: `damageDice: "1d8"` (bludgeoning is the first component) |
| Flame Strike (5) | +1d6 fire or radiant per level | Yes: `damageDice: "1d6"` |
| Mass Cure Wounds (5) | +1d8 healing per level | Yes: `damageDice: "1d8"` (healing reads it) |
| Bless (1) | +1 target per level | Needs `targets` on `buff` (Phase 2) |
| Counterspell (3) | Auto-counter up to the slot's level | Phase 1 |
| Aid (2) | +5 HP per level | Prep buff, cast before combat. Mark it, don't model it |
| Chain Lightning (6) | +1 bolt per level | No (modelled as an area). Mark it |
| Confusion (4) | +5 ft radius per level | No (`areaSize` was dropped 2026-09-12). Mark it |
| Dominate Beast / Person / Monster, Planar Binding | Longer duration | Outside one fight. Mark it |

## 2. Phase 0: any slot at or above (engine and AI)

**Compile.** `spellUpcastVariants` drops the `upcast` requirement:

- It makes copies for every action with a `slot-N` `resourceCost`. That includes `activate-feature` reactions
  (Shield, Counterspell) as well as attacks, saves, areas, healing, buffs and repositions.
- The base tier is `spellSlotLevel(resourceCost)`, as today. The warlock's `slot-3`-costed spells compile no extra
  copies.
- Each copy carries `upcastAdds: boolean`: whether the higher slot changes anything. That's true if `perSlotAboveBase`
  has a field this action kind reads, or the action is a counter (Phase 1).

**Prune dominated copies (AI only).** In `canPayResource` (simulation.ts ~3053), the one affordability check the AI
uses:

- A copy with `upcastAdds: false` is payable only when no lower tier of the same family (from the base up to N−1) is
  payable.
- The AI then sees, per spell, the cheapest slot it can still use, plus every tier that actually adds something. When
  all base slots are available, its candidate list is exactly today's.
- Reactions go through `reactionOptionsFor`, which uses combat.ts's own `canSpendResource`. Give it the same rule, so
  Shield with no 1st-level slots left uses a 2nd.

**Spell level is the slot.** `counterspellWindow` reports `spellSlotLevel(action.resourceCost?.resourceId) ??
action.spellLevel`. Log events that name a spell's level report the same.

**Sheet pickers hide the copies.** Several pickers list `getExecutableActions` and would show "Blight (upcast to slot
5)": the multiattack step picker, the legendary "uses its …" picker, `LimitPicker` and `FeatureEffectCards`. They
filter `:upcast-N` through `familyKey`, the helper the hotbar already has.

**Tests** (new `tests/spell-slots.test.ts`, alongside `tests/spell-upcasting.test.ts`):
- A Blight with no `upcast`, its `slot-4`s spent and `slot-5`s on hand: the AI casts it with a `slot-5`, and 8d8 is
  rolled with no extra dice.
- Same spell with `slot-4`s on hand: the AI spends a `slot-4`. The dominated `:upcast-5` copy is not among the
  scored candidates (check the debug scoring).
- Shield with `slot-1` empty and `slot-2` on hand fires and spends the `slot-2`.
- A warlock-style spell (spell level 1, cost `slot-3`) compiles no copies.
- `counterspellWindow` sees 5 for a Fireball cast with `slot-5`.
- Regenerate `tests/fixtures/auto-run-golden.json` only if Phase 0 changes it, and say why in the commit. It should
  change only where a sample caster used to run dry.

## 3. Phase 1: Counterspell by the rules

**Data shape.** `enemy-casts-spell` gains an optional counter rule (types.ts ~816):

```ts
| { kind: "enemy-casts-spell"; withinFt: number; maxSpellLevel?: number;
    /** A spell above the counter slot's level: roll a check instead of letting it through (Counterspell). */
    checkAbove?: { dcBase: number; bonus?: number } }
```

- `dcBase` is 10 for Counterspell; DC = `dcBase` + the spell's level.
- `bonus` covers a flat add-on, for an Abjurer's proficiency bonus or a homebrew item.
- The check rolls the reactor's spellcasting ability (`spellcastingAbility(definition)`). An ability check has no
  automatic success on a natural 20.
- Without `checkAbove`, behaviour is today's v1: offered only when the slot's level is high enough.

**Engine.**
- `reactionTriggerPasses`: with `checkAbove`, any counter slot passes. Without it, the slot must be at least the
  spell's level.
- `fireReaction`: when the slot is below the spell's level, roll through the existing roll path
  (`askDecision`'s roll requests), so Play can overrule it. Log a new `CounterspellCheck` event with the d20,
  modifier, DC and result. A failed check still spends the reaction and the slot, and the spell resolves. Return
  `countered` only on success.
- SRD Counterspell gets `checkAbove: { dcBase: 10 }`. Its higher-slot copies count as `upcastAdds: true`, since the
  slot raises the automatic-counter ceiling.

**AI: weigh what the spell would do against what the counter costs (D4).** This replaces the counter branch of
`reactionClearsValueBar`, which today counters anything 2nd level or higher without looking at it. The question the AI
answers is: "If I let this through, how much does it hurt my side? Is stopping it worth this slot?"

*1. What the counterer sees.* The `enemy-casts-spell` event gains `castLevel` (the slot spent) and `declared`, the
creatures the spell will touch as it's being cast. Each of the six resolvers that opens the window already holds
these:
- `resolveBeamAttack`, `resolveAttackCore`, `resolveHealingAction`, `resolveBuffAction`: the target.
- `resolveSaveAction`: the target, plus Hold Person's bonus targets.
- `resolveAreaSaveAction`: everyone inside the template where it was aimed. That's `areaSaveTargets` on the placement
  already resolved, the same call resolution makes a moment later. A zone also passes its placement.
- `resolveHealingBurstAction`: everyone it heals.
- `resolveRepositionAction`: who it moves.

*2. What letting it through costs: `spellThreat`.* It lives in `simulation.ts` next to `areaPlanValue`, and it's that
function seen from the other side. The things that make a Fireball into four PCs score high for its caster are the
reasons it's worth stopping. It works in the units the AI already scores its own spells in (expected HP), using the
copy actually being cast, so upcast dice and extra targets count. For each declared creature:

| Who | What it adds |
|---|---|
| Our side (the reactor and its allies) | **Damage:** `expectedDamageAgainst` covers save odds, half on a save, resistances, damage riders and upcast dice |
| | **Down risk:** a fixed `DOWN_VALUE` if the expected damage would drop it, otherwise in proportion to its HP. Same shape as the AI's `killPressure` |
| | **Each condition:** chance it lands × `conditionSeverity` (paralyzed 1, restrained 0.65, frightened 0.45, …) × the creature's worth (`allyValue`: durability + best attack) × turns it's likely to last (save-ends: 1 ÷ chance to save; fixed: its rounds; capped at 3). Immunities count as 0, as they do for the caster |
| Their side | **Minus** the same damage, downs and conditions. A Fireball that also burns its own front line is worth less to stop, and one that only burns them isn't worth stopping |
| | **Healing:** expected healing capped at missing HP, plus `DOWN_VALUE` for each creature it brings back from 0 HP |
| | **A buff:** the value `selectBuffAction` would give it. Its per-target scoring is pulled out into a helper both use |

- **Zone spells** (Cloudkill, Spirit Guardians) also add `predictedZoneApproachValue` for their placement, mirrored.
- **Spells the estimate can't read** (summons, transforms, partial automation) get a floor by level. The floor is tuned
  so an unreadable 3rd-level spell is worth a 3rd-level slot at `balanced`. The log says "valued by level: its effect
  isn't modelled".
- `combat.ts` can't import `simulation.ts`, because it's imported by it. So `simulation.ts` registers `spellThreat`
  with the reaction window when it loads (`setSpellThreatEstimator`). Without one registered, the level floor is used.

*3. The decision.* For every affordable tier `t` against the spell's cast level `L`:

```
p(t)     = 1                                                     if t ≥ L
         = clamp((21 − (dcBase + L − mod − bonus)) / 20, 0, 1)   otherwise   (no auto-success on a natural 20)
score(t) = p(t) × threat − resourceCostWeight(slot t) × 4 × stanceMultiplier − reactionCost
```

- It counters with the best-scoring tier if that score is above 0, and otherwise lets the spell through.
- The ×4 slot price is the one `selectOffensivePlan` already pays. The AI values a slot the same whether it spends it
  to deal damage or to prevent it.
- `reactionCost` is small (≈2) when the reactor still has another reaction it may need before its next turn (Shield,
  an opportunity attack), and 0 otherwise.
- Every tier's `p` and score, and the threat broken down by creature, go into the log: "Mira counters Fireball (5th)
  with a 5th-level slot: threat ≈118 (4 PCs, ≈112 damage, Cy likely down) against a slot cost of 20". The AI
  inspector can then show why (AGENTS.md §10).

*Worked examples.* Approximate, `balanced` unless stated. Constants are tuned in Phase 1; the tests below lock the
decisions, not the exact numbers.

| Incoming spell | Threat | Best option | Result |
|---|---|---|---|
| Fireball at 5th (10d6, DC 15) into four PCs with DEX +2 | ≈ 4 × 28 damage, plus down risk ≈ 115+ | 5th slot, certain: 115 − 20 | **Counter.** Also at `conservative`: 115 − 60 |
| The same Fireball at one PC | ≈ 28, plus down risk | 5th slot: ≈ 28 − 20 | **Counter** at `balanced`; **let through** at `conservative` (28 − 60) |
| Hold Person on the party's fighter (fails 65%, ≈3 turns held) | ≈ 70 | 3rd slot, certain: 70 − 12 | **Counter**, even at `conservative` (70 − 36) |
| Fireball at 5th, reactor has only 3rd-level slots and INT +4 | ≈ 115 | 3rd slot + check DC 15 (50%): 57 − 12 | **Counter**, rolling the check |
| Cure Wounds on an enemy at full HP | 0 | none | **Let through** |
| Fireball that catches two of its own and one PC | below 0 | none | **Let through** |

- Every stance now looks at the spell, not just its level. So `balanced` won't reproduce today's "counter anything
  2nd level or higher", and batch numbers move for any encounter with Counterspell. Call it out in the commit.
- **What the counterer knows** is a rule, `rules.counterspellReadsSpell`. A missing value means on. Each campaign
  sets it (Phase 5, D7); the engine only ever reads it from the snapshot.
  - **On:** the counterer sees the spell, the slot it's cast with and its targets, as above.
  - **Off** (closer to the rules as written): it sees only that the creature is casting. It doesn't learn the spell,
    its level or its targets until after it decides. It values the cast at the level floor for the highest slot the
    caster's sheet declares (a guess from what the caster could do, not from its remaining slots) and picks its slot
    against that guess. The true level then decides whether the counter is automatic or needs the check.

**Tests** (`tests/counterspell.test.ts`). Each row of the worked examples is a test that asserts the decision and the
slot. In addition:
- A reactor with `slot-3` and `slot-5` facing a 5th-level spell spends the `slot-5` and counters with no roll.
- With only `slot-3`s, the check is rolled against DC 15. A scripted success counters; a scripted failure spends the
  slot and lets the spell resolve.
- An upcast Fireball (`slot-5`) against a counterer with only 3rd-level slots needs the check, not an automatic
  counter.
- A paralysis spell on a creature immune to paralysis is worth nothing, so it's let through.
- An upcast Hold Person (two targets) is valued higher than the same spell at base, so its counter clears a bar the
  base cast doesn't.
- With `counterspellReadsSpell` off, the decision is the same whether the spell is Fireball into the party or Cure
  Wounds on a full-health ally: only the caster's highest declared slot matters. The reaction event the AI and the
  prompt get carries no spell name, level or targets.
- In a Play-mode decider, the counter check can be overruled, and the overrule re-runs the step with the same seed.

## 4. Phase 2: library data

- Ice Storm, Flame Strike and Mass Cure Wounds get the `damageDice` above.
- **Bless:** `targets` grows to `buff` actions with `targeting.target: "chosen"`. Count = `count` + slots above base ×
  `targets`. `selectBuffAction` reads the capacity the way `upcastExtraTargetCapacity` does for saves. Bless gets
  `upcast: { perSlotAboveBase: { targets: 1 } }`.
- **Marker for the rest:** `SpellUpcast` gains `notModelled?: string`, for example "Longer duration; doesn't change a
  fight." It goes on Aid, Chain Lightning, Confusion, the Dominates and Planar Binding. The builder shows it, the
  engine ignores it, and higher-slot casting still works for them through Phase 0.
- **Audit test** (`tests/srd-upcast-audit.test.ts`): every library spell whose CSV row has `higher_level` text carries
  either `perSlotAboveBase` data or `notModelled`. It also covers spells the earlier name match missed ("Melf's Acid
  Arrow" vs "Acid Arrow"), so the first run may find more gaps than these 12.

## 5. Phase 3: ability builder

- **Say what's true.**
  - The section becomes "Casting with a higher slot". Its hint reads: "Any slot of this level or higher can cast it.
    Fill these in if a higher slot makes it stronger."
  - When nothing is filled in, a quiet line says "Higher slots: same effect", so it's clear that's a valid answer and
    not an omission.
  - For a reaction with a counter trigger, the section shows the `checkAbove` toggle ("Above the slot's level: a
    check, DC 10 + the spell's level") instead of dice fields.
- **Stop the false warning.** In `missingPools`, a leveled spell's missing base slot is excused whenever the creature
  has any higher slot, with or without `upcast`. The warning remains if it has no slot of that level or higher.
- **SRD suggestion (offered, never applied).** When a spell's name matches a library spell (case-insensitive, ignoring
  the "Melf's"-style prefixes) whose upcasting differs from this one's, show a one-line offer: "The SRD's Blight adds
  1d8 per level above 4th. Use it." It comes from structured library data, not parsing the description (AGENTS.md
  §8, §19).
- **Sheet-level nudge.** A small note on the Spells section, such as "3 spells could use SRD upcasting · Review",
  lists each with its offer. That covers fixing the necromancer in one pass instead of opening 14 spells.
- **Reference text.** If the spell's description has an "At Higher Levels" paragraph (imported or pasted), show it
  under the controls, read-only.
- Tests: `missingPools` with only higher slots (no warning), the suggestion match (including prefixes and a
  same-named spell from a different source, which is not offered), and applying the suggestion writes `upcast` where
  `withUpcast` puts it.

## 6. Phase 4: Play mode

- **Hotbar slot chips.** Every leveled spell now has its tier copies, so `hotbarFor` shows the chips with no new
  wiring. Changes:
  - Labels become ordinals with what the tier adds: "4th", "5th · +1d8", "3rd · +1 target", "4th · +2 beams". A
    no-benefit tier is just the ordinal.
  - Chips for tiers with no slots left stay visible and disabled, using the existing `problem` text.
  - The default chip stays the first usable one, which is the lowest slot left.
  - At 5 or more tiers, the chips collapse into a compact segmented control (`PlaySegmented`) so a 9th-level caster's
    Magic Missile doesn't push the hotbar wide.
- **Previews follow the chip.** The target hover (`previewAttack` / `previewSave`) already takes the copy's id, so
  damage shown matches the slot chosen. A test asserts the 5th-slot Blight preview's average is 9d8.
- **Counterspell prompt.**
  - The title says what's at stake, from the same `spellThreat` breakdown the AI uses: "Vex is casting Fireball (5th)
    at Ana, Bo, Cy and Dee: ≈28 damage each, may drop Cy." Or "Hold Person on Bo: 65% to paralyze, ≈3 turns."
  - Each tier's row reads "3rd-level slot · check DC 15 (45%) · 2 left" or "5th-level slot · certain · 1 left".
  - With the campaign rule off, the prompt shows what the creature would see: "Vex is casting a spell." Each row reads
    "3rd-level slot · certain up to 3rd level, a check above · 2 left". The log names the spell once the choice is
    made.
  - The AI's pick is the primary button.
  - The "always use" policy is per family ("Counterspell: always, AI picks the slot"), not per tier.
- **Roll strip.** The counter check appears like any other roll and can be overruled (success/failure).
- **Slot pips** (`SlotPips`) are unchanged. They already show every tier.

## 7. Phase 5: a campaign rule for what counterspellers know

Campaigns have no rules today. A campaign row (the `Project` model, still not renamed) holds a name, description and
cover image, and its page offers rename, cover image and delete. The encounter rule profile (`snapshot.rules`) has no
UI at all: it's set from `fixtures.ts`'s defaults. So this is the first campaign-level rule. It's built so later rules
can join it, without moving any existing rule there in this plan.

**Where it lives.** The campaign is the source of truth. The engine never learns what a campaign is; it reads the
rule from the snapshot as it does every other rule (AGENTS.md §2, §7).
- **Prisma:** `Project.rulesJson String?`, an additive column pushed the same way `coverImageUrl` was. Empty means
  every default.
- **`src/lib/campaign-rules.ts`:** a zod `campaignRulesSchema` (`{ counterspellReadsSpell?: boolean }` for now), the
  defaults, and `withCampaignRules(snapshot, rules)`. That function writes the campaign's values into
  `snapshot.rules`.
- **`src/engine/types.ts`:** `RuleProfile.counterspellReadsSpell?: boolean` and the matching optional field in
  `encounterSnapshotSchema`. A missing value means on, so saved encounters load unchanged and need no schema version
  bump.

**How it reaches a fight.**
- `GET /api/encounters/[id]` also returns its campaign's rules. `loadEncounter` (`encounter-store.ts` ~1846) applies
  `withCampaignRules` before the snapshot reaches the store, and `createEncounterInCampaign` does the same.
- The open encounter keeps the campaign's rules in the store. Changing the rule on the campaign page while one of its
  encounters is open applies it there too.
- Every run (Step, Auto Run, Batch, Play) starts from the snapshot, so the rule in force is part of it. A saved
  `SimulationRun` replays with the rule it ran under even if the campaign changes later. An exported encounter keeps
  the value it was saved with, so it reproduces outside its campaign (AGENTS.md §7: same snapshot + seed = same
  result).

**UI.**
- **Campaign page** (`CampaignEncountersPage`): a "Campaign rules" section above the encounter list, with one toggle:
  - **Counterspellers know what's being cast and at whom.**
  - Hint: "On: a creature that can counter a spell sees which spell it is, at what level and at whom, and weighs
    whether it's worth stopping. Off: it only sees that a spell is being cast, as the rules are written."
  - Saved through `PUT /api/projects/[id]`, whose schema gains `rules`.
- **In the encounter:** the Combat panel's run settings show the rule read-only ("Counterspellers know the spell ·
  campaign rule"), linking to the campaign page. The batch report header lists it. That's the visibility AGENTS.md §10
  asks for when the AI is given perfect awareness.
- **Docs page:** a line under "Shield, Parry and Counterspell" on what the rule changes.

**Tests.**
- `withCampaignRules` sets the field, and leaves a snapshot's other rules alone.
- The API rejects a malformed `rules` body, and `GET /api/encounters/[id]` returns the campaign's rules.
- Store: loading an encounter applies its campaign's rule. Changing the rule while that encounter is open updates its
  snapshot. A run started before the change keeps the old value in its saved snapshot.
- Browser: flip the rule on the campaign page, open an encounter in that campaign, and check the Combat panel line and
  a Play Counterspell prompt (spell named when on, "is casting a spell" when off).

## 8. Decisions (recommended defaults)

| | Question | Recommended | Alternative |
|---|---|---|---|
| D1 | Higher-slot casting for spells with no upcast data | **Confirmed:** automatic for every leveled spell, even when a higher slot adds nothing (5e RAW) | A per-spell opt-in |
| D2 | Shield and other slot-costed reactions use a higher slot when the base is gone | Yes (same rule as D1) | Spells only |
| D3 | The level Counterspell sees | The slot actually spent | The printed level (today) |
| D4 | Whether and how the AI counters | **Confirmed:** weigh the spell's actual effect (damage across everyone it catches, downs, conditions and how long they last, minus friendly fire) against the slot's cost × the chance of success × resource stance (§3) | Value by spell level only (today) |
| D5 | Counter check ability | The reactor's spellcasting ability, plus an optional flat `bonus` | A fixed ability per action |
| D6 | SRD upcasting for homebrew spells | Offered by name match; the DM clicks to apply | Applied automatically on save |
| D7 | Does the counterer know the spell and its targets? | **Confirmed:** a campaign rule, toggled on the campaign page (Phase 5). On by default; off means it sees only that a spell is being cast | A per-fight setting |

## 9. Out of scope

- A caster upcasting a spell to get past an enemy's Counterspell. The AI doesn't model enemy reactions when choosing
  its own spell.
- Dispel Magic. It has the same "auto up to the slot, else check" shape and can reuse the Phase 1 helper later.
- Countering summon and transform spells. Their resolvers don't open a counter window today; adding one is a separate
  change.
- A real pact magic model (a single `pact` pool cast at its level). Today's `slot-N`-costed warlock spells keep
  working.
- Upcasting that changes an area's size (Confusion) or bolt count (Chain Lightning). These are marked `notModelled`.
- Parsing "At Higher Levels" text into data. It is only shown, and only offered as an SRD match.

## 10. Risks and order of work

- **Batch numbers move.** Casters that ran dry will now keep casting. Counterspell will fire against devastating
  high-level spells and skip low-impact ones it used to counter. Each phase regenerates the golden fixture only where its change explains the diff, with a note in the
  commit.
- **Performance.** The prune rule keeps the AI's candidate count at today's level until base slots run out. Phase 0
  times a 100-run batch of the necromancer encounter before and after the change.
- **Dirty tree.** The working tree has uncommitted changes, including `auto-run-golden.json` and
  `tests/vanished-summons.test.ts`. Commit or shelve them before branching `spell-slots` from master, so golden diffs
  belong to one change.
- **Order:** Phase 0 → 1 → 2 → 3 → 4 → 5.
  - Phase 0 fixes the lockout.
  - Phase 1 fixes Counterspell. It reads the rule from the snapshot, on by default, so it doesn't wait for Phase 5.
  - Phases 2–5 can ship separately.
  - Browser-verify Phases 3–5 through every path: build from a blank spell, toggle each field, flip the campaign
    rule, and run Step, Auto Run and Play.
