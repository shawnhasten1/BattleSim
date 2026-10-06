# Effects Plan: easier to find, and the missing ones added

**Status:** built, Phases 0–6, on branch `effects` (2026-10-06); not merged. The user confirmed D4–D7 (D5 as "nothing
prebuilt that isn't SRD, but the means to build it by hand") and asked for the whole plan once Phase 0 went well. The
other decisions in §9 took their recommended defaults. "Built so far" says where the build differs from the plan.

## Built so far: where it differs from the plan

**Phase 0 (the picker).**
- `EffectPicker.tsx` is a `dialog` ("Add effect") holding a `searchbox` ("Search effects") and plain buttons, not a
  `menu`: a menu can't hold a search field. Tests pick through `pickEffect(scope, query, row)` in
  `tests/helpers/abilities-tab.ts`.
- Eight groups for now. "Scores & proficiencies" arrives with its first kind (Phase 3); until then Initiative sits in
  Actions & turn. "Ends a condition on itself each turn" went to AC & defenses (beside condition immunity), and "Hits
  against it deal more" (a mark) to Attacks & damage.
- Examples show as "Start from:" chips under their kind, in the folds as well as in search results. `onAdd` takes an
  array, so an example of several effects (B/P/S resistance) lands as one card.
- `COMMON` in `effects.ts` holds the Common row per owner (`feature`, `item`, `buff`). `FeatureEffectCards` takes
  `owner`; without it a group list that's all conditions is a buff, one with a weapon is an item, anything else a
  feature. `ItemSections` passes `owner="item"`.
- "smite" finds the on-hit upgrade, not extra damage: smites are on-hit options in this engine.

**Phase 1 (speed).**
- `src/engine/stats.ts` holds it: `effectiveDefinition` (replacing `withConditionForm`, which it absorbs: the old
  `speedBonusFt` / `flySpeed` / `sizeTo` modifiers read as speed effects), `speedWith`, `speedParts`, `selfGateHolds`,
  `wornArmor`. A definition's own stat effects are kept per definition object; the derived definition per key.
- **`baseDefinition(snapshot, combatant)`** is new, and `getDefinition` is `effectiveDefinition(baseDefinition(…))`.
  Found in the browser: the sheet edited what `getDefinition` returned, so a creature with boots gained the boots' 10 ft
  of base speed on every save (and this was already latent for Large Form while active). The sheet (`ActorSheet`),
  `useSelectedCombatant` (export, the compendium) and "make its own creature" now take the base. Test:
  `effect-sheet-base.test.tsx`. Rule: anything that edits, saves, exports or copies a creature takes `baseDefinition`.
- `SelfGate` (armor, shield, `whileCondition`) and its "While" control came now, since Fast Movement needs it; only
  speed reads it until Phase 4. The effect has `allModes` (Haste) beside the planned fields; it and `noArmorSlowdown`
  sit under the card's More options.
- A buff's `speedBonusFt` / `flySpeed` modifier cards are Speed cards that show only that modifier's field.
- The sheet: Stats and the Codex show "With its effects: 40 ft: 30 base, Boots of Striding +10" under the base field;
  the header's speed is the actual one.
- Not done: the move log doesn't carry speed parts (it would move the golden logs; the sheet readout says it).
  `combatantsInArea` still sizes creatures from raw definitions, so a condition's size change doesn't reach area hits
  (as before). The character builder's summary shows its own speed until Phase 5.

**Phase 2 (hit points).**
- `hit-point-maximum` takes a `NumericFormula`; `perLevel` / `levelClass` are on the formula (D10), resolved by the new
  `levelOf` (a class matched by id, the end of its id, or name; a class it doesn't have is 0, no level at all is 1).
- `stats.ts` imports `resolveNumericFormula` from `combat.ts`: a cycle, but only used inside functions. `actualMaxHp`,
  `hitPointParts`, `hitPointsWith` are new.
- A condition that raises the maximum raises current HP in `applyCondition` (`raiseHitPointMaximum`; from 0 it gets the
  creature up through `healTo`), logged as the new `HitPointMaximumChanged`, which replay applies. Conditions end in
  about 26 places, so rather than each, `capHitPoints` runs at the end of `expireConditions` (each turn's start and
  end). A concentration buff that ends mid-turn is capped at the next boundary.
- The store applies "full stays full" to **every** commit that changes definitions (`withHitPointsFollowing` in
  `commitEncounter`), so adding Tough, attuning an item or a rebuild all take full tokens with them; a token whose HP the
  edit set itself is left alone. Typed Max HP and rebuilds measure on the actual maximum. Tokens are placed and restarted
  at `actualMaxHp`.
- Aid is real (D7), with a new `perSlotAboveBase.hitPoints` (5) applied by `buffEffectsAsCast` in `resolveBuffAction`
  and the store's prep-buff toggle; switching the prep buff off caps HP again. Aid is prep-only, so no AI fight casts it
  and the golden logs didn't move. Draconic Resilience has its per-sorcerer-level bonus.
- `hp-regen.temporary` (Heroism) logs `TempHpChanged`. Its amount is a number, not the caster's modifier: the example
  says to set it.
- The Codex shows the actual maximum after the slash once effects change it, with the base on its own "Base maximum"
  line (it read "34 / 32" otherwise).
- Search: the substring bonus ("…, like Fast Movement") counts only in example labels, and "hit points" is a keyword of
  the hit point maximum alone; otherwise "Temporary hit points on a kill" outranked it.

**Phase 3 (ability scores).**
- `effectiveDefinition` works out scores first (`scoresWith`, `withScores`), then speed and hit points on the scored
  creature: Strength 19 lifts heavy armor's slowdown, and Constitution changes a levelled creature's maximum (D4).
  Listed saves and skills (by an 18-skill map in stats.ts) move by the modifier's change; a fixed `attackBonus` doesn't,
  and the card warns when the creature has one. `scoreParts` and `scoresReadout` feed the sheet; the hit point readout
  names the item that raised Constitution ("Amulet of Health (Constitution) +10").
- The group is "Ability scores & initiative" (Initiative moved in from Actions & turn, which kept two kinds).
- Item names (gauntlets, amulet, belt…) are keywords of the examples, not the kind: as kind keywords they outranked the
  example that names the item.
- Library: Gauntlets of Ogre Power and Amulet of Health are simulated worn items now; Potion of Giant Strength is a buff
  potion (a hill giant's 21, which the DM can change); Headband of Intellect and the six Belts of Giant Strength are new.
  Descriptions are the library's own short wording; the scores are SRD 5.1's.

**Phase 4 (the smaller gaps).**
- `FeatureEffect` is now `(…union…) & SelfGate`: every kind can carry armor / shield / `whileCondition`. One filter in
  `featureSources` (`gatedSources`, `effectGateHolds`) applies it for every reader: armor and shield always, an
  activation's condition once the combatant is known (without one, as at compile time, it's left for the kind's own
  check; Metamagic boost's `whileCondition` keeps its own meaning). The AI's own source list (`featureEffectSources` in
  simulation.ts) applies the same gate.
- The editor shows "While" on the card for Speed and AC bonus, under More options for most other kinds, and not at all
  for kinds compiled into actions or fired on activation (`NO_WHILE` in effects.ts). Drops to 1 HP already had a More
  options, so "While" goes inside it (two folds on one card were confusing). The AC card's old "no armor and no shield"
  checkbox is gone: `unarmoredOnly` reads as that "While" and becomes it on the first change (the engine still honours
  it).
- The sentence wrapper adds the "While" to any effect's sentence ("…while it wears armor"); the short list form too
  ("+1 AC (in armor)"). That also adds "while it rages" to existing whileCondition effects' text.
- Defense (both copies) is armor-only now; the builder test that pinned the old effect was updated. No golden log moved.
  Bracers of Defense already had `unarmoredOnly`, so it needed no fix.
- `damage-reduction` comes off the damage **before** resistance (the rules' order), in `resolvePendingDamage`
  (`reducedDamage`). The AI's damage estimates don't count it yet.
- `ignore-difficult-terrain` sets `movement.ignoresDifficultTerrain` on the derived creature, which `movementCostForCell`
  reads, so pathfinding and the AI use it. All difficult terrain counts (no magical/nonmagical split).
- `targetTypes` gates attack effects in `featureConditionsMet` and the AI's `averageAttackFeatureDamage`; the chips are
  under More options as "Only against".
- A `size` effect (`to` or `steps`) joins the derived creature. Areas still size creatures from raw definitions (as
  before with Large Form). The group is now "Scores, size & initiative".
- A buff's `movementMultiplier`, `speedPenaltyFt` and `sizeTo` modifiers edit as Speed / Size cards. The deny-an-action
  modifiers stay removable only: there's no effect kind for them.
- Fixed a Phase 1 gap: `speedWith` ignored multipliers below 1, so the Speed card's "Halved" did nothing. It now applies
  the largest multiplier above 1, then the smallest below it (0: it can't move).

**Phase 5 (library, recipes, builder).**
- Items: Potion of Flying is simulated; Boots of Speed (a bonus-action buff: ×2 walking speed, opportunity attacks at
  disadvantage), Boots of Striding and Springing, Winged Boots, Ring of Swimming (no attunement) and Ring of Free Action
  are new. A part that doesn't run is in `notSimulated`.
- Spells: Longstrider (prep-only), Fly and Haste, in the 2014 library and copied for 2024. Library spells are `full`
  with what isn't modelled in their description (the editor can't round-trip `partial`), so Haste says it lacks the extra
  action and the lost turn. Aid's action now carries its slot cost, as Mage Armor's does, so its prep toggle spends a
  slot and its upcast copies exist.
- **Enlarge/Reduce is left out**: nothing checks there's room for a bigger token, so a size buff can overlap creatures.
  The Size card can still make one; that's a known limit.
- Golden logs moved on purpose (casters runs 1 and 4, same outcomes): the SRD Mage's Fly is now a spell it can cast, and
  the AI casts it on itself. The monster library was regenerated for the same reason (Fly resolves for five creatures).
- Recipes: "More hit points per level" (found by "tough"), "Faster without heavy armor", "Faster without armor or a
  shield", "Proficiency in a save" ("resilient"), "A bonus while wearing armor". Mobile has its +10 ft.
- Builder (D6): Fast Movement, Unarmored Movement (scaled by the monk's table into the effect) and Roving are runtime
  speed effects with their armor checks; the base speed stays the species'. COVERAGE.md says so. The builder's summary
  shows the actual speed and hit points.

**Phase 6 (guide and browser check).**
- New guide `docs/guides/add-an-effect.md` (boots that add speed, Tough by recipe and by hand, the Stats readouts,
  Fast Movement's "While", and what to do when nothing matches), with screenshots in
  `public/guides/img/add-an-effect/`. The Docs page's While active paragraph and the Zealot guide's Add effect step
  describe the picker now.
- Browser-checked with a fighter carrying Boots of Speed and Tough: Step, Restart, Auto Run (to the end), Batch 100 and
  Play all ran without page errors; the token read 34/34; in Play, clicking the boots took its movement from 30 to 60
  ft. Each phase's cards were checked from blank in a feature, an item and (Phase 1, 4) a buff condition.

The user tried two everyday things and couldn't do either:

- **Boots that make a barbarian faster.** No effect changes speed, on an item, a feature or a buff.
- **A Tough feat** (+2 hit points per level). No effect changes the hit point maximum.

The user also said the Add effect menu is "a massive list that is categorized but still isn't very user friendly". This
plan does two things. It makes effects easy to find: a search box, examples you can pick that come already filled in,
groups named after what the DM wants to change, and the rare class mechanics put away in a fold. It also adds the
missing effects (speed, hit point maximum, ability scores and a few smaller ones), so common magic items and feats can
be built in the editor and actually change the fight.

## Summary

- **Phase 0, a search box in Add effect.** It searches names and hints, and also keywords and named examples. Typing
  "boots", "fast" or "speed" finds Speed; "tough" or "hp" finds Hit point maximum; "gauntlets" finds Ability score.
  Each kind has a few examples you can pick, already filled in, such as "+2 per level, like the Tough feat" or "double,
  like Boots of Speed". A search shows those examples directly.
- **New groups, named for what changes:** Movement, Hit points, Scores & proficiencies, AC & defenses, Attacks &
  damage, Spells, Saves & d20 rolls, Actions & turn. Above them is a short **Common** row chosen for where the effect is
  going (a worn item, a buff, a trait). The 12 or so class and monster mechanics (Metamagic boost, Monk weapons, a
  second Cunning Strike option, Tactical Master, swarm damage…) move into a closed **Class & monster mechanics** fold.
- **Phase 1, Speed.** A new `speed` effect adds feet (+10), multiplies (×2), sets a minimum (at least 30 ft) or gives
  a mode (fly speed equal to walking speed, swim 40 ft). It works on a trait, a worn item or a buff. It can be limited to
  "while it wears no heavy armor" and the like. The engine reads it through one function for the creature's actual
  stats, so movement, pathfinding and the AI all see it. The Stats tab shows the result: "Speed 40 = 30 + Boots 10".
- **Phase 2, hit points.** A new `hit-point-maximum` effect: a flat bonus (Aid's +5) or an amount per level (Tough's
  +2, Draconic Resilience's +1 per sorcerer level). Aid stops being approximated as temporary hit points. A token is
  placed at its full maximum, and a buff's extra maximum comes with the same amount of current hit points. Also
  temporary hit points at the start of each turn (Heroism).
- **Phase 3, ability scores.** A new `ability-score` effect: "Strength 19 unless already higher" (Gauntlets of Ogre
  Power, Amulet of Health, Belt of Giant Strength, Potion of Giant Strength) or "+2, to a maximum of 20". The ability
  modifier then changes attacks, damage, saves, AC, DCs and, for Constitution, hit points.
- **Phase 4, the smaller gaps.** "While" limits for effects that check only the creature: armor worn, no armor, no
  heavy armor, a shield, raging. These fix the Defense fighting style, Fast Movement and Unarmored Movement. Also: flat
  damage reduction, ignoring difficult terrain, a "the target is a dragon/undead/…" condition for attack effects, and
  editable speed/size/"can't react" changes on buffs (today they're shown but can't be edited).
- **Phase 5, the library catches up.** SRD items that are reference-only today become simulated (Potion of Flying,
  Gauntlets of Ogre Power, Amulet of Health, Potion of Giant Strength), and boots, belts and headbands are added.
  Feature recipes are added, such as "More hit points per level (Tough-style)". The builder's Fast Movement, Unarmored
  Movement and Roving become runtime effects, so heavy armor is checked at last.

How it should feel:

> The DM opens the barbarian's Boots of Striding, clicks **Add effect** and types "speed". The first row is
> **Speed: at least 30 ft — like Boots of Striding and Springing**. One click adds it, already filled in. The card says
> "Its walking speed is at least 30 ft." The Stats tab now shows "Speed 40 ft (30 base + 10 Fast Movement)", because
> the boots' minimum doesn't raise it. The DM changes the card to "+10 ft" instead. The token moves 50 ft in the next
> Auto Run.

## 1. What's there today

### The Add effect menu

- The engine has **56 effect kinds** (`FeatureEffect` in `src/engine/types.ts`). The editor offers **55** of them
  (`EFFECT_KINDS` in `src/lib/ability-editor/effects.ts`). Only `weapon-mastery` is left out, because the builder owns
  it.
- They sit under 5 themes. **"Its attacks" holds 24**, and 8 of those are about spells (spell range, half damage on a
  miss, Sculpt Spells, Overchannel, Metamagic, Metamagic boost, Spell Recall, spell damage ability). "Staying alive"
  holds 10 and "Its defense" 13.
- There's **no search.** The menu is one long list of grouped buttons with a hint line under each (`FeatureEffectCards`,
  `src/components/sheet/ability-editor/FeatureEffectCards.tsx:240-271`).
- Labels describe the effect ("A save no lower than the score"). Hints name the class feature it came from
  ("Indomitable Might…"). That's useful once you know the name, but a DM thinking "my item makes them faster" has no
  word to look for, and there is nothing to find anyway.
- Rare class mechanics (Monk weapons as Unarmed Strike, two on-hit options on one hit, Tactical Master's mastery swap,
  More Metamagic while a condition lasts) sit beside everyday ones (AC bonus, resistance), with the same weight.
- The only per-place filtering: "hits against it deal more" needs a condition, and "an extra action" needs a feature
  that activates (`offered()`).

### What the editor can't make at all

| A DM wants | Examples | Today |
|---|---|---|
| More speed | Boots of Striding and Springing, Fast Movement, Mobile, Longstrider | No effect. The builder adds speed when it builds a PC (`GrantAdjust.speed`), straight into the stat block |
| Double speed | Boots of Speed, Haste | No |
| A fly, swim or climb speed | Winged Boots, Potion of Flying, Ring of Swimming, Fly | A buff's `flySpeed` modifier exists (Draconic Flight) but the editor shows it **read-only** |
| A higher hit point maximum | Tough, Draconic Resilience, Aid, Heroes' Feast | No. The builder bakes `hpBonus` in. Aid is **approximated as 5 temp HP** (`src/data/srd/spells.ts:363`). Draconic Resilience's text says "set it in Max HP" |
| A set or raised ability score | Gauntlets of Ogre Power, Amulet of Health, Belt of Giant Strength, Potion of Giant Strength | No. The library keeps these as reference items: "Not simulated yet: set the score by hand" |
| Temporary HP each turn | Heroism | No. A buff gives temp HP once |
| Less damage from every hit | Heavy Armor Master–style reduction | No. `DamageAdjustment` is resistance, immunity, vulnerability or absorb |
| Ignoring difficult terrain | Freedom of Movement, Land's Stride, Mobile (2014) | No |
| A bonus only while armored or unarmored | Defense (armored), Fast Movement (no heavy armor), Unarmored Movement | Only `unarmored-ac` and `armor-class-bonus.unarmoredOnly`. Both Defense fighting styles (`srd:feature:defense` and the 2024 feat) give +1 AC **with no armor check**, though the text says "while wearing armor". COVERAGE.md says "heavy armor isn't checked" for Fast Movement and Roving |
| Extra damage against one creature type | Favored-enemy features, slayer features | Weapon **riders** can (`restrictToCreatureTypes`). Feature `damage-bonus` effects can't |
| Save proficiency | Resilient | Possible today (Save bonus with the proficiency bonus as its formula), but nothing points you there |

### How speed, hit points and scores are read

- `getDefinition(snapshot, combatant)` already returns a derived definition while a condition changes speed, fly
  speed or size (`withConditionForm`, `src/engine/combat.ts:244`). It's cached per base definition and change. This is
  the pattern the new effects reuse.
- `movementProfileOf` (`src/engine/geometry.ts:28`) takes off heavy armor's 10 ft. `turnMovementBudget` applies
  conditions that slow a creature (`movementMultiplier`, `speedPenaltyFt`) and Dash.
- About 20 engine sites read `definition.maxHp` (healing caps, bloodied, the massive damage rule, AI threat and healing
  thresholds). The store places a token at `definition.maxHp` (`encounter-store.ts` ~1253, 2828, 2869, 2998, 3397).
  When Max HP is edited, it keeps a token at full HP full (~3135–3151).
- A save reads `definition.saves[ability]` as the total when one is listed, otherwise the ability modifier
  (`combat.ts:8783`). Attack bonuses come from formulas over `definition.abilities`, unless a monster has a fixed
  `attackBonus`.
- The Stats tab already shows a worked-out AC with its parts (`StatsCore.tsx:104-111`, from `armorClassOf`). Speed and
  Max HP are plain numbers.
- Persistence: `effects` is `z.array(z.any())` in the encounter schema (`types.ts:3059`), so new kinds are additive. No
  schema version bump or migration is needed.
- Adding a kind touches five files: `types.ts` (the type), `combat.ts` (the engine), `effects.ts` (the spec),
  `FeatureEffectCards.tsx` (its fields) and `statblock.ts` (its sentence).

## 2. Phase 0: finding effects

UI and metadata only. No engine change. The aim is that someone who has never seen the list finds the right effect in
one search, or in two clicks without one.

### The picker

```
┌ Add effect ──────────────────────────────────────────┐
│ [ Search: speed, hit points, resistance, Tough…  ]  │
├──────────────────────────────────────────────────────┤
│ COMMON ON A WORN ITEM                                │
│  AC bonus · Bonus to saves · Speed · Resistance      │
│  Ability score · Hit point maximum · Bonus to hit    │
├──────────────────────────────────────────────────────┤
│ ▸ Movement                                       5   │
│ ▸ Hit points                                     8   │
│ ▸ Scores & proficiencies                         3   │
│ ▸ AC & defenses                                 10   │
│ ▸ Attacks & damage                              11   │
│ ▸ Spells                                         9   │
│ ▸ Saves & d20 rolls                              5   │
│ ▸ Actions & turn                                 3   │
│ ▸ Class & monster mechanics                     12   │
└──────────────────────────────────────────────────────┘
```

Typing "tough":

```
│ [ tough                                          ]  │
│  Hit point maximum                                  │
│    +2 per level, like the Tough feat            ⏎   │
│    +1 per level, like Dwarven Toughness             │
│  Drops to 1 HP instead of 0                         │
│    Once a fight, like Relentless Endurance          │
```

- **Search first.** The field has focus when the picker opens. Results are a flat list, best first: an example whose
  name matches, then a kind's label, then keywords, then hint words. Arrow keys move through the results and Enter
  adds. Escape clears the search, then closes. Keep today's keyboard handling and stop Space from reaching the map.
- **Examples are rows.** Under a matching kind, its examples come first. Picking one adds the effect **already filled
  in**, then opens its card the way a new card opens today.
- **Common** is a short row of chips (6–8) for the place the effect is going. A worn item: AC, saves, speed,
  resistance, ability score, max HP, to hit, damage. A buff's condition: to hit, advantage on attacks, AC, saves,
  speed, resistance, temp HP. A trait or feature: resistance, advantage on saves, extra damage, AC, speed, max HP,
  regenerates. On-activate: extra action, regain a resource.
- **Groups are folds.** One opens at a time. Counts show how much each holds. A search ignores the folds.
- **When nothing matches**, the picker says so and offers the fallback that already exists: "Not something the
  simulator runs? Mark the ability as resolved by hand" sets it reference-only with the DM's note. The simulator never
  approximates without saying so.
- The picker lives in `FeatureEffectCards`, so it reaches every place that adds effects: traits and features, items,
  conditions (buffs, activations, marks), and the Codex, which embeds the same `AbilityEditor`.

### The metadata (`effects.ts`)

Each `EffectKindSpec` gains:

- `group`: one of the nine groups above. This replaces `theme` (the five themes go).
- `keywords`: words a DM might type ("speed", "movement", "faster", "fly", "swim", "boots" for Speed; "hp", "hit
  points", "max", "tough", "health" for Hit point maximum).
- `examples`: `Array<{ label, effect, keywords? }>`, a few named presets ("Double, like Boots of Speed or Haste").
- `common`: the places where it's in the Common row.
- `advanced: true` puts it in the Class & monster mechanics fold.

A pure `searchEffects(query, place)` returns ranked results so it can be tested without the DOM, in the same way as
`searchAdd` in `add.ts`.

### The new groups

| Group | Kinds (new ones in **bold**) |
|---|---|
| Movement | **Speed**, **Ignores difficult terrain**, Never provokes opportunity attacks, A move with something else, Disadvantage on some attacks against it (opportunity) |
| Hit points | **Hit point maximum**, **Temporary HP each turn**, Regenerates, Drops to 1 HP instead of 0, Temp HP on a kill, Temp HP when a spell deals damage, Bigger healing, Better death saves |
| Scores & proficiencies | **Ability score**, Initiative, (Save proficiency is an example under Bonus to its saves) |
| AC & defenses | AC bonus, AC without armor, Resistance/immunity/vulnerability, **Damage reduction**, Immune to a condition, Attacks against it, No advantage against it, No critical hits against it, Evasion, Hurts what hits it in melee |
| Attacks & damage | Bonus to hit, Advantage on its attacks, Extra damage on its hits, Damage on its hits with a save, A condition on its hits, Better damage dice, Critical hits on a lower roll, Extra damage on a 20, Damage that ignores resistance, An attack back when hit, Another attack beside the target |
| Spells | Bonus to its save DCs, An ability on spell damage, Half damage when a spell misses, Longer spell range, Allies spared by its area spells, Spells at their maximum damage, A Metamagic option, A spell slot kept on a lucky roll, Hits against it deal more (a mark) |
| Saves & d20 rolls | Bonus to its saves, Advantage on its saves, A save no lower than the score, Turns a failed save into a success, Change a failed roll |
| Actions & turn | An extra action, Regains a resource, Ends a condition on itself each turn |
| Class & monster mechanics (closed) | An upgrade it can add to a hit, Two on-hit options on one hit, Another mastery for an attack, Monk weapons as its Unarmed Strike, More Metamagic while a condition lasts, An activation that keeps going on its own, Swarm damage, Splits when damaged |

Group sizes will move a little as Phases 1–4 add kinds. The test below checks every kind is in exactly one group.

### Done when

- Every kind has a group, at least one keyword, and an example where one makes sense. A unit test enforces the first
  two.
- `searchEffects` tests: "speed", "boots", "fast", "tough", "hp", "resist", "fire", "advantage", "crit", "regen",
  "legendary" each give the expected first result. Before Phases 1–3, "speed", "tough" and "gauntlets" show the "Not
  something the simulator runs?" fallback.
- Component tests through `tests/helpers/abilities-tab.ts`: open Add effect, search, pick an example, and the card opens
  already filled in. Folds open and close. Escape clears the search, then closes.
- Browser check in the item editor, a feature, a buff spell's condition and the Codex.

## 3. Phase 1: Speed, and the creature's actual stats

### The effect

```ts
| {
  /**
   * Its speed while this works: `bonusFt` feet more (or less), `multiplier` times it (2: Boots of Speed, Haste), at least
   * `minimumFt` (Boots of Striding and Springing), and the movement modes in `modes` (a fly speed equal to its walking
   * speed: Winged Boots). `noArmorSlowdown`: heavy armor doesn't slow it.
   */
  kind: "speed";
  bonusFt?: number;
  multiplier?: number;
  minimumFt?: number;
  modes?: Partial<Record<"fly" | "swim" | "climb" | "burrow", number | "walk">>;
  hover?: boolean;
  noArmorSlowdown?: boolean;
} & SelfGate
```

`SelfGate` is the shared "While" from Phase 4: armor state, a shield, an activation's condition. Phase 1 brings only
the armor part, because Fast Movement needs it.

Order (D8): base walking speed, then heavy armor's −10 (unless `noArmorSlowdown`), then every `bonusFt` added, then
the largest `multiplier` (multipliers don't stack), then the largest `minimumFt`. A mode set to `"walk"` takes the
result. A number keeps the larger of the mode's own speed and that number.

### One function for the creature's actual stats

- `effectiveDefinition(definition, combatant?)` in the engine: the definition with every simulated effect folded in
  (features and traits, worn and attuned items, a weapon's effects, the combatant's conditions, and the old `flySpeed`
  / `speedBonusFt` / `sizeTo` modifiers). `getDefinition` returns it, so every engine path that already goes through
  `getDefinition` sees the change: movement budget, pathfinding, the AI's reach and threat estimates, reactions.
- Two caches. A definition's own effects (features, items) depend only on the definition, so that result is cached in a
  `WeakMap` per definition object. A combatant's conditions are layered on top and keyed the way `withConditionForm`
  keys them today. `withConditionForm` becomes the second layer. It doesn't stay a separate path.
- **Audit**: anything that reads `snapshot.definitions` or a raw definition's `speed` or `movement` directly. Those
  already miss Large Form's and Draconic Flight's changes (PC_BUILDER_PLAN.md, step 7as). Route them through
  `getDefinition`, or through `effectiveDefinition(def)` for UI with no token.
- The log says why a creature moved as far as it did: `CombatantMoved` already carries the path. Add the speed parts
  when they differ from the base (AGENTS.md §9's "why was this modified").

### The editor and the sheet

- The Speed card: "+10 ft", "×2", "at least 30 ft", and mode chips (fly, swim, climb, burrow: a number or "= walking
  speed"), plus "While" (armor). Sentence: "Its walking speed increases by 10 ft while it isn't wearing heavy armor."
- A buff's `speedBonusFt` and `flySpeed` modifiers show as Speed cards and **can be edited**. They write back to the
  modifier when that can hold the change, and become a `speed` effect when it can't, following the existing
  `withModifierCard` pattern (D9).
- Stats tab: the Speed field still edits the **base**. Beside it, when effects change it: "→ 40 ft (30 + Boots of
  Striding 10)", in the same form as the worked-out AC (`armorClassOf().parts`). This also needs a place in the Codex's
  Details tab, or `tests/codex-parity.test.tsx` fails.
- The other places that show a speed (`CreateTokenModal`, the Codex, the character builder's summary) show the actual
  speed. The builder's own speed math stays as it is until Phase 5.

### Done when

- Engine tests: each field alone and combined, the order of operations, the armor gate (it switches off when heavy
  armor is equipped), a buff that adds and then expires, the derived definition's identity is stable (cache), and old
  `speedBonusFt` / `flySpeed` data still works (Large Form, Draconic Flight).
- Scenario test: a creature with +10 ft reaches a target that's 40 ft away and one without doesn't. The AI picks the
  longer path when it's now in reach.
- Every turn path: Step, Auto Run, Batch and Play. They now share `takeAutomatedTurn` and `closeTurn`, but check
  each one in the browser anyway.
- Golden logs and batch fixtures **don't move**. No fixture carries a speed effect, and the old modifiers must give the
  same numbers through the new function.

## 4. Phase 2: Hit points

### The effects

```ts
| {
  /** Its hit point maximum increases by `bonus` (Aid: 5; Tough: 2 per level; Draconic Resilience: 1 per sorcerer level). */
  kind: "hit-point-maximum";
  bonus: NumericFormula;
}
```

`NumericFormula` gains `perLevel?: number` and `levelClass?: string` ("+ perLevel × its level", the character level, or
that class's level from `character.classes`). Tough is `{ perLevel: 2 }`. This also lets any other formula scale by
level (D10).

A creature with no character level counts as level 1. The card warns "needs a level: Stats › Class & level" when the
formula uses one.

`hp-regen` gains `temporary?: boolean`: temporary hit points at the start of its turn, replacing any lower amount
(Heroism: the spellcasting modifier). Temporary hit points never stack, per the rules.

### The engine

- The effective definition's `maxHp` includes the bonus (it's computed after scores, see Phase 3).
- **Placing a token**: every store site that sets `currentHp: definition.maxHp` uses the actual maximum. Same for
  import (`import-normalize.ts:267`) and Restart.
- **Editing the definition** (adding Tough, attuning the item): today's rule that a token at full HP stays full applies
  to the actual maximum before and after the edit, not just to edits of the Max HP field. The builder's
  `build.hp.adjust` path (`encounter-store.ts:3126`) stays as it is: it edits the base.
- **A condition that raises the maximum** (Aid, Heroes' Feast): when it lands, current HP rises by the same amount. When
  it ends, current HP is capped to the new maximum. Log both as `HitPointMaximumChanged`.
- **Readers**: the ~20 `definition.maxHp` reads in combat.ts and simulation.ts become actual through `getDefinition`.
  Audit the ones that aren't (the report's `emptyActor(combatant, maxHp)`, the store, `SceneCanvas` already uses
  `getDefinition`).

### The library

- **Aid** (2014 and 2024 copies): +5 maximum and current HP per target, +5 per slot level above 2nd. This stops being
  approximated as temp HP (D7). It's `prepOnly`, so test-fight logs that cast it before the fight will change: update
  them in the same commit, on purpose.
- **Draconic Resilience** (`srd:feature:draconic-resilience`): add `{ perLevel: 1, levelClass: "sorcerer" }` and drop
  "set it in Max HP" from its text.
- **Heroism**: temp HP each turn, if it's authored.

### Done when

- Engine tests: a flat bonus, per level, per class level, no level, placing a token, a buff landing and ending
  (current HP rises, then is capped), healing capped at the actual maximum, bloodied measured from the actual maximum,
  temporary HP each turn not stacking.
- Store tests: adding the effect keeps a full token full. A wounded token keeps its current HP.
- The Stats tab shows "Max HP 65 → 77 (Tough +12)". The Codex too.

## 5. Phase 3: Ability scores

```ts
| {
  /**
   * Its `ability` score: at least `setTo` (Gauntlets of Ogre Power: Strength 19; no effect if it's already higher), or
   * `bonus` more up to `max` (an Ioun Stone's +2, to a maximum of 20). Several: the highest `setTo`, then every `bonus`.
   */
  kind: "ability-score";
  ability: Ability;
  setTo?: number;
  bonus?: number;
  max?: number;
}
```

- The effective definition's `abilities` change. Everything computed from scores follows: attack and damage formulas,
  DCs, unarmored AC, initiative, saves without a listed total.
- **Listed save totals move with the score**: `saves[ability]` shifts by the modifier's change, so a proficient
  Constitution save gains the Amulet of Health's +2 as well.
- **Constitution and hit points** (D4): for a creature with a character level, the maximum changes by the modifier's
  change × its level, as the rules say. A monster's statblock hit points don't change.
- **Fixed numbers don't move**: a monster's fixed `attackBonus`, damage written as "1d8+4" with no `abilityModifier`.
  The card warns when the creature has any: "Its attacks with fixed bonuses won't change: give them a formula".
- The card has no "While" bloodied: a score that depends on hit points would go round in a circle.
- Library: Gauntlets of Ogre Power and Amulet of Health become simulated. Add Headband of Intellect, Belt of Giant
  Strength (one per giant kind, or one item with the kind in its name) and Potion of Giant Strength (a 1-hour buff).
  Check every number against the SRD 5.1 text, not memory.

Done when: tests for setting a score, raising it with a cap, the highest set winning, saves moving, Constitution hit
points for a levelled creature (and not for a monster), a formula attack changing and a fixed one not, and the Stats
tab showing "STR 19 (18 base, Gauntlets of Ogre Power)".

## 6. Phase 4: The smaller gaps

### "While" for effects that check only the creature

Today only "it's bloodied" works on effects checked on the creature alone (`SELF_WHEN_CONDITIONS`). Add a shared
`SelfGate`, read by one engine helper (`selfGateHolds(definition, combatant, gate)`) for every self-checked kind (AC,
saves, speed, resistances, regeneration, initiative…):

- `armor`: `"worn"` | `"none"` | `"not-heavy"`, read from worn items (`workingItems`). Without armor items, "none"
  holds.
- `shield`: `true` (holding one) | `false` (no shield).
- `whileCondition`: an activation's condition id (Rage). The field exists today on attack effects and two others, and
  this generalizes it.
- bloodied, as today.

`armor-class-bonus.unarmoredOnly` and `unarmored-ac.noShield` keep working and read as the same gate in the editor.

Data fixes that come with it:

- The Defense feat and fighting style: armor worn.
- Bracers of Defense: no armor, no shield.
- Fast Movement and Roving: not heavy armor.
- Unarmored Movement: no armor, no shield.

The last two land with Phase 5's builder change.

### More

- **`damage-reduction`**: `{ amount: NumericFormula; damageTypes?: DamageType[]; nonMagicalOnly?: boolean }`. Damage of
  those types from each hit is reduced by the amount (to 0), after resistance. Heavy Armor Master–style features.
- **`ignore-difficult-terrain`**: `{ magicalToo?: boolean }`. Difficult terrain costs it normal movement, which needs an
  `ignoreDifficultTerrain` option in `OccupancyMovementOptions` (`geometry.ts:336`). Hazards still trigger. Freedom of
  Movement and Land's Stride–style features.
- **"The target is a …"** for attack effects: a `targetTypes?: CreatureType[]` on `FeatureEffectConditions`, the way
  riders already use `restrictToCreatureTypes`. The AI's attack scoring must respect it, as it does for riders.
- **Editable buff modifiers**: today's read-only modifier cards become editable: slowed (`movementMultiplier`,
  `speedPenaltyFt`), can't take actions / bonus actions / reactions, size. Speed, from Phase 1, is already editable.
  Add the matching entries to the picker's Common row for a buff or debuff condition, so the DM can author Slow,
  Enlarge/Reduce or Longstrider.

Done when: each has engine tests and an editor card, the picker finds it, and the Defense / Bracers data fixes have
tests with and without armor.

## 7. Phase 5: The library, the recipes and the builder

- **SRD items** become simulated: Potion of Flying, Gauntlets of Ogre Power, Amulet of Health, Potion of Giant
  Strength. Add Boots of Speed, Boots of Striding and Springing, Winged Boots, Ring of Swimming, Headband of Intellect,
  Belt of Giant Strength and Ring of Free Action (condition immunity + ignore difficult terrain), each checked against
  the SRD 5.1 text. A part that doesn't run goes in `notSimulated`, as items do today.
- **SRD spells**: Longstrider, Haste (speed ×2, +2 AC, advantage on Dexterity saves; the extra action stays
  `notModelled`, so the spell is partial), Enlarge/Reduce (size + 1d4, if Phase 4's size card lands), Fly, Aid (Phase 2).
  This means both the 2014 library and the 2024 copies, keeping golden logs in mind.
- **Feature recipes** in Add ability (`FEATURE_TEMPLATES`):
  - "More hit points per level", findable by "tough" (D5).
  - "Faster while unarmored".
  - "Proficiency in a save", findable by "resilient".
  - "A bonus while wearing armor".

  Mobile (`srd:feature:mobile`) gains its speed and terrain parts or says why not.
- **Builder speed grants** (D6): Fast Movement, Unarmored Movement and Roving stop adding `adjust.speed` and grant a
  `speed` effect with the right armor gate. `applyBuild` must replace the base speed it made earlier in the same step,
  so a rebuilt character doesn't count the bonus twice. The builder's plain hit point bonuses (Dwarven Toughness) stay
  baked in: they have no condition to check. Update COVERAGE.md's "heavy armor isn't checked" notes.

Done when: every new library entry has a test that it attaches and works, the coverage report regenerates cleanly, and
a rebuilt Monk at level 6 has 30 + 15 ft, which drops to 30 when it puts on armor.

## 8. Phase 6: The guide and a full browser check

- A short "Adding an effect" guide page: search, pick an example, read the sentence, and see it on Stats. Use the
  barbarian's boots and a Tough feat as the walkthrough.
- Browser check, starting from a blank ability, every new card and every field in it one by one (not just that
  prefilled data displays), in a feature, an item, a buff condition and the Codex. Go through Step, Auto Run, Batch and Play.

## 9. Decisions (recommended defaults)

| | Question | Recommended | Alternative |
|---|---|---|---|
| D1 | The Add effect picker | Search first, a Common row for the place, nine groups as folds, class and monster mechanics in a closed fold | A two-step "What does it change? → How?" wizard; or today's menu with a search added |
| D2 | How speed, hit points and scores change | Effects folded in at runtime into the creature's actual stats, so they can be switched on and off (armor, attunement, buffs) | Write them into the base stats when the ability is saved, as the builder does. That loses the "while" checks and counts twice on a re-edit |
| D3 | What Stats shows | The base stays editable, with the actual value and its parts beside it, like AC | Only the actual value |
| D4 | Constitution raised by an item | **Confirmed:** changes the hit point maximum by Δmodifier × level for a creature with a character level, as the rules say; monsters unchanged | Hit points never follow the score |
| D5 | Feats outside the SRD (Tough) | **Confirmed:** nothing prebuilt; the means to build it by hand: a generic recipe ("More hit points per level"), found by searching "tough", and examples that name the feat only as "like Tough" | A bundled "Tough" library feat |
| D6 | The builder's speed grants | **Confirmed:** become runtime `speed` effects with armor checks (fixes "heavy armor isn't checked") | Stay baked into the base speed |
| D7 | Aid | **Confirmed:** a real +5 maximum and current HP | Keep the temp HP approximation |
| D8 | Combining speed changes | Bonuses add; the largest multiplier; the largest minimum; in that order | Multipliers multiply each other |
| D9 | Old buff speed modifiers (`speedBonusFt`, `flySpeed`) | Kept and read as before; shown and edited as Speed cards, written back to the modifier when it can hold the change | Migrate saved data to `speed` effects |
| D10 | Scaling by level | `perLevel` / `levelClass` on `NumericFormula`, so any bonus can use it | A per-level field only on the hit point effect |

## 10. Out of scope

- **Senses and vision** (darkvision, truesight). The simulator has no vision, so they stay informational.
- **Skills and ability checks** outside what the engine already rolls (grapples, shoves). Encumbrance, carrying
  capacity and jumping.
- **Long-term changes** (a Manual of Bodily Health's permanent +2). Edit the score.
- **Rests, recharging at dawn, the attunement limit**: as ITEMS_PLAN.md leaves them.
- **Haste's extra action** (one Attack, Dash, Disengage, Hide or Use an Object). The engine has no restricted extra
  action. The spell is marked partial.
- **Natural-language or AI-assisted effect authoring.** AGENTS.md §21 lists it as a future enhancement. Phase 0's
  search with examples is the deterministic version.

## 11. Risks and order of work

- **`getDefinition` is a hot path.** The static layer must be computed once per definition object (`WeakMap`) and the
  condition layer cached by key. Time a 100-run batch of the Hallway Ambush before and after Phase 1. Results must be
  identical and time within noise.
- **Code that reads raw definitions** misses every change. The Phase 1 audit (grep `snapshot.definitions`,
  `definition.speed`, `.movement`, `.maxHp`, `.abilities` across `src/engine`, `src/store`, `src/components`) is
  part of the phase, not a follow-up.
- **Golden logs and the shared testbed.** Don't add effects to `fixtures.ts`'s def-fighter, def-archer or def-goblin:
  about 30 test files use them as a blank slate. Tests build their own creatures. Golden logs should only move from deliberate data
  changes: Aid (Phase 2), the Defense armor gate (Phase 4), and the builder speed grants (Phase 5). Each one moves in
  its own commit with the reason in the message.
- **Counting twice.** The builder's baked-in bonuses and the new effects must never both apply (Phase 5's
  `applyBuild` change). A test rebuilds a level 6 Monk twice and checks its speed.
- **Hit points after an edit.** The "full stays full" rule must use the actual maximum before and after any definition
  edit, or attuning an Amulet of Health would leave the token's current HP below its new maximum.
- **The Codex** embeds the same editor, so the picker reaches it. But Stats' new speed and HP readouts need places in
  Details, or `codex-parity.test.tsx` fails.
- **Homebrew catalog schemas**: check that a feature's `effects` aren't stripped by a plain `z.object` on save
  (PC_BUILDER_PLAN.md, Phase 8, found that a new catalog field needs a schema entry). Add a round-trip test with a `speed` effect.
- **Order:** Phase 0 → 1 → 2 → 3 → 4 → 5 → 6, on a branch `effects` from master, one commit per phase.
  - Phase 0 ships alone and fixes the "can't find it" half straight away.
  - Phases 1 and 2 cover the two things the user tried (boots, Tough).
  - Phases 3 and 4 can swap. Phase 5 needs 1–3, and 4 for the armor gates.
