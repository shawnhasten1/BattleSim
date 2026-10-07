# Editions Plan: 2014 and 2024 content side by side

**Status:** planned 2026-10-07; the decisions are settled. Every phase (0–11) built 2026-10-07 on branch `editions`
(see [Built so far](#built-so-far)). Not merged into master or pushed.

The DM wants to choose, one thing at a time, whether they use the 2014 or the 2024 version of it: a 2014 Fighter with
2024 spells, a 2024 Wizard with a 2014 race, the 2014 Counterspell on one creature and the 2024 one on another. Edition
is **not** a campaign setting. This replaces the "per-campaign edition" idea noted after the PC builder, and fills in
PC_BUILDER_PLAN.md D1's "the catalog has an `edition` field, so 2014 classes can come later".

## Where things stand

Today each part of the app has one edition, and nothing lets you choose:

| Content | 2014 (SRD 5.1) | 2024 (SRD 5.2) | Where |
|---|---|---|---|
| Spells | Add ability, drag-and-drop, scrolls, wands, monsters: 85 that run, none of the other 234 | Builder only: all 339, 98 that run, the rest reference only | `ability-editor/add.ts:174-179`; `character-builder/srd.ts:28` |
| Classes and subclasses | none | 12 + 12, builder only | `data/srd/2024/index.ts` |
| Species, backgrounds, feats | none | 9, 4, 17, builder only | same |
| Class features in Add ability | 19 (2014 rules) | none; they live inside the class files | `data/srd/features.ts` |
| Weapons | one library; its records carry the 2024 mastery property | the same records | `data/srd/weapons.ts:419-467` |
| Items | all of them | none | `data/srd/items.ts` |
| Monsters | 325 | none (Open5e has 331) | `data/srd/monsters` |

**What already helps:**

- **The engine already reads most edition differences from the record, not from a global rule.**
  - Counterspell's check (2014) or save (2024) is on its trigger, so both versions can already sit in one encounter
    (`types.ts:1420-1442`).
  - Weapon mastery only works for a creature with a `weapon-mastery` effect, so a 2014 character simply doesn't have it.
  - Heroic Inspiration is an effect plus a pool.
  - Potions copy the table rule onto each potion, and any potion can opt out (`followsTableRule`).
- **The builder already stores an `edition`** on every class, subclass, feat, background and species, and on the build
  (`catalog.ts:26`, `build-record.ts:32`). It is written but never read.
- **Spell ids already differ:** 2014 is `srd:spell:<slug>`, 2024 is `srd:spell:<slug>-2024`.

**What's in the way:**

1. **Engine records carry no edition.**
   - `SourceMetadata` has no edition field (`types.ts:2579-2586`).
   - The 5.1 library's records have no `source` until they're attached. Attaching then stamps
     `{ provider: "homebrew", documentName: "SRD" }` on them (`add.ts:187`, `encounter-store.ts:3438-3494`,
     `apply.ts:356`).
   - My library replaces a saved ability's `source`, so its origin is lost (`my-library.ts:61-63`).
2. **Some code matches across editions by name:**
   - Upcast offers find a spell's library "twin" by name and level (`upcasting.ts:38-43`), so a 2024 spell gets its
     2014 twin.
   - Add ability's "on the sheet" check uses `source.slug` (`AddAbility.tsx:89-96`).
   - Scrolls treat a 2024 spell as the creature's own homebrew (`ability-editor/scrolls.ts:12`).
   - Item offers match Open5e items to library items by name (`item-offers.ts:26`).
3. **The builder hard-codes the 2024 rules:**
   - every background gives ability increases and an origin feat (`build.ts:903-912`);
   - every class gets an Epic Boon at 19 (`build.ts:971-973`);
   - species have no field for ability increases (`catalog.ts:369-384`);
   - half casters get slots from 1st level and round their levels up (`slots.ts:27-49`);
   - `prepared` is a fixed 20-level table, which doesn't fit 2014's "modifier + level";
   - spell lists and spell lookups are 2024 only (`srd.ts:12-28`).
4. **Bundled entries show no source** (`homebrew.ts:86-96`), so a 2014 and a 2024 Fighter would look identical.
5. **Conditions and surprise are global, keyed by name, and mostly follow 2014:**
   - Grappled is only speed 0.
   - A stunned creature can't move.
   - A surprised creature loses its first turn.

   See `combat.ts:7870-7909`.

## Decisions (settled 2026-10-07)

| | Decision |
|---|---|
| D1 | **There's no edition setting anywhere.** Not on a campaign, an account or an encounter. Each record says which edition it is, and the engine runs the record. |
| D2 | **Lists show both editions with a badge and a filter** (user). Every row shows **2014** or **2024**. Each list has a **2014 · 2024 · Both** filter that remembers its last choice in this browser. The filter starts on Both. A built character's lists (builder pickers, and its sheet's Add ability) open on that character's own edition, and one click shows both. |
| D3 | **Mixed origins: where ability increases come from is chosen per character** (user). The build gets **"Ability increases from: background / species"**. It defaults to the background when the background gives increases (2024), and otherwise to the species (a 2014 race). Choosing "background" with a background that gives none (the 2014 Acolyte, or a custom background) offers the 2024 rule's three points on any abilities, so a character always gets exactly one set. |
| D4 | **Rules that belong to no record are separate named table rules** (user), in Campaign rules next to the potion rule. These are the rules for Grappled, Stunned and Surprise. Each option's label says which edition it comes from, as the potion rule's labels do. Each defaults to how the app behaves today. There's no "set everything to 2014" button, because that would be an edition switch under another name. |
| D5 | **Scope** (user): 2014 classes and subclasses (12 + 12), races (9 plus 4 subraces), the Acolyte and Grappler, and the full 2014 spell list with class lists. The 2024 spells go into Add ability, and so do **the 2024 class features** (with feats and species traits, which come from the same index). **Not in this plan:** 2024 monsters, 2024 magic items, and a "use the other version" swap on the sheet. |
| D6 | **Existing ids stay as they are.** 2014 spells keep `srd:spell:<slug>` and 2024 classes keep `srd:class:<slug>`, because saved builds, monster chunks and sheets point at them. New entries get the suffix of the edition that arrived second: `srd:class:fighter-2014`, `srd:species:dwarf-2014`, `srd:background:acolyte-2014`, `srd:feat:grappler-2014`, `srd:feature:fighter-second-wind-2024`. **No code reads an edition from an id.** `editionOf()` reads the record. |
| D7 | **Same-named entries are never merged.** The two Fireballs are two rows. Code that matches by name matches within one edition, or says which edition it picked. |

## Design

### Edition on every record

- **`Edition = "2014" | "2024"` moves into the engine's types**, next to `SourceMetadata`, which gains `edition?: Edition`.
  The engine carries it and never reads it. `catalog.ts` re-exports the type.
- **Source stamps.**
  - A new `srd51Source(slug)` returns `{ provider: "srd", documentKey: "srd-2014", documentName: "System Reference Document 5.1", slug: "srd_<slug>", edition: "2014" }`.
    That is the monsters' convention, plus the edition.
  - `srd52Source` gains `edition: "2024"`.
- **The 5.1 library gets its source when it loads.** `data/srd/index.ts` stamps it on every weapon, spell, feature, item and
  scroll before freezing them, so the data files don't change line by line. The attach paths keep the record's own source
  and stop stamping `homebrew`/`"SRD"`.
  - **Not everything in `features.ts` is SRD 5.1:** Great Weapon Master, Sharpshooter, Mobile, and the Bear Totem and
    Zealot rages are 2014 rules from outside the SRD. They get `edition: "2014"` with a non-SRD source, never
    `srd51Source`. Don't call anything SRD that isn't.
- **`editionOf(thing)`** in `src/lib/editions.ts` reads, in order:
  1. the catalog `edition` field;
  2. `source.edition`;
  3. `source.documentKey` (`srd-2014`, `srd-2024`), which covers the monsters already;
  4. one legacy case: a record attached before this plan has `documentName: "SRD"` and an `srd:` slug without `-2024`, so
     it is 2014.

  Anything else (homebrew, other game systems) has no edition, and no badge.
- **Open5e.** The normalizer sets `edition` from the payload's `document.gamesystem.key`: `5e-2014` gives 2014, `5e-2024`
  gives 2024, and anything else gives none.
- **My library** keeps `edition` when it rewrites a saved ability's source.

### Matching within an edition (D7)

- Upcast twins (`srdTwin`) match only a spell of the same edition.
- Add ability's "on the sheet" mark compares library id and edition.
- Scrolls treat a spell of either library as a library spell.
  - Every 2024 spell that runs gets a scroll: `srd:item:scroll-of-<slug>-2024`.
  - The scroll numbers (DC and attack bonus by level) look the same in both SRDs. **Check them against the 5.2 PDF**
    before reusing `scrollNumbers`.
- Item offers keep matching an Open5e 2024 item to the 2014 item that runs, but name the edition: "The 2014 Potion of
  Healing runs in the simulator."

### Badges and the filter (D2)

- **`EditionBadge`** is a small "2014" or "2024" chip. Its tooltip says "SRD 5.1 (2014 rules)" or "SRD 5.2 (2024 rules)".
- **`EditionFilter`** is a segmented 2014 · 2024 · Both control. Each list remembers its own choice in `localStorage`
  (`battlesim.editionFilter.<list>`), with every read and write wrapped in try/catch. If nothing is stored, it shows Both.
  The lists are:
  - Add ability;
  - the builder's class, species, background, feat and spell pickers;
  - the homebrew editor's spell picker.
- **A built character's own edition.** `build.edition` is now read: it is the edition of the character's first class.
  The builder's lists and that character's Add ability open filtered to it, overriding the remembered choice for that
  character only.
- **Native `<select>`s in the builder** use optgroups: *2014 rules*, *2024 rules*, *Homebrew & imported*. The filter hides
  the other edition's group. Homebrew is always shown.
- **Where badges appear:**
  - Add ability rows;
  - the builder's choice rows and selects;
  - the ability editor's Source line (`SpellSections.tsx:129`);
  - the sheet's "from" chip for built features;
  - the SRD Monsters folder (all 2014).

  Badges don't appear on every ability row of a sheet.

### Origins (D3)

- **`BackgroundDefinition`:**
  - `abilities` and `feat` become optional;
  - it gains `grants`, for a background's feature. The 2014 Acolyte's Shelter of the Faithful is informational.
- **`SpeciesDefinition` gains:**
  - `abilities?`: fixed increases (a 2014 Dwarf's +2 Constitution);
  - `abilityChoice?`: the Half-Elf's +1 to two abilities other than Charisma.

  A subrace is a `pick` whose option carries its own `abilities` (Hill Dwarf: +1 Wisdom).
- **These increases are applied in the walk, before the levels.** Then feat prerequisites (2014 Grappler needs
  Strength 13), suggestion priorities and caps all see them. They don't go through `grant.adjust`, which is applied only
  after the walk (`build.ts:1117-1127`).
- **`CharacterBuild.increasesFrom?: "background" | "species"`.**
  - *background*: the background's own increases. A background that gives none gets three points on any abilities
    (+2/+1 or +1/+1/+1, as the 2024 custom background does). The species' increases are skipped, and a note says so.
  - *species*: the species' increases, and the background gives none.
  - Unset: the default from D3.
- **The origin feat** is taken only when the background has one.

### The builder's 2014 rules

- **Epic Boon.** `ClassDefinition.epicBoonLevel?` replaces the hard-coded 19. The 2024 classes set 19. The 2014 classes
  leave it unset and put 19 in `featLevels`.
  - This also fixes imported 2014 classes, which lose their 19th-level ASI today (`open5e-class.ts:37`, `:185`).
- **Prepared spells.** `SpellcastingProgression.prepared` is either the 20-level table, or
  `{ add: "level" | "half-level" }`.
  - The formula counts the spellcasting modifier plus the class level, or half of it rounded down, with a minimum of 1.
  - The walk computes the count at each level. The rise at a level is that level's new picks.
  - A count that falls (a score lowered) drops the last picks, with a warning.
  - 2014's spells-known casters use the table, as now.
- **Half casters.** Two new fields, used in `slots.ts`:
  - `firstSlotsAt?`: 2 for the 2014 Paladin and Ranger, who have no slots at 1st level.
  - `multiclassRounding?: "up" | "down"`: "down" for 2014.
- **Spells.**
  - `BuilderLibrary.spell` finds a spell in either library; the ids already differ.
  - The 2014 class lists are keyed `<class>-2014` (`wizard-2014`), next to 2024's `wizard`.
  - `SRD_SPELL_LISTS` includes both, with labels.
- **Ids on the actor.** `slugOf` strips `-2014`, so a 2014 Fighter's features are still `fighter-second-wind`. A
  build can't hold the same class in both editions: the multiclass picker blocks it and says why.
- **Fighting styles.** The 2014 styles are `fighting-style` feats with edition 2014.
  - The 2014 Great Weapon Fighting rerolls 1s and 2s. Mark it partial unless the engine can reroll damage dice by then.
- **Rebuilding a PC** (`matchClass`, `adoption.ts:16-20`) prefers a class of the build's edition. "Rebuild with the
  builder" asks which edition.
- **Starting equipment** (added 2026-10-07). A 2024 class offers whole packages (option A or B). A 2014 class offers a
  choice on each line ("(a) a greataxe or (b) any martial melee weapon"), and its background adds gear of its own.
  - `ClassDefinition.startingEquipment` keeps the packages for 2024. A 2014 class gets `equipmentChoices`: one entry per
    line, each with its options. An option is a list of library items, or "any simple / martial (melee) weapon", which
    the build then asks for as a weapon kind.
  - The build stores each line's pick under `equipment.lines`, beside today's `classOption`. The suggested pick fills
    every line, so Quick build still takes one click.
  - Only weapons and armor reach the sheet, as now (PC builder D15). Packs, tools and gold are ignored.
  - A 2014 background's own gear is ignored the same way: the Acolyte's is a holy symbol and clothes.
- **Labels follow the edition** (added 2026-10-07). The builder says "Race" and "Subrace" for a 2014 race, and "Species"
  and "Lineage" for a 2024 species. Each label follows the record chosen, or the character's edition when nothing is
  chosen yet. A 2014 background's feature is shown as "Feature", and a 2024 background's feat as "Origin feat".

### 2014 reference data

- **Fetching.** `scripts/fetch-srd-2024.ts` becomes `scripts/fetch-srd.ts --document srd-2014|srd-2024`. The 2014 run
  writes `srd_2014_cache.json`, which is gitignored.
  - Open5e V2 has, for `srd-2014`:
    - 12 classes and 12 subclasses;
    - 13 species (9 races and 4 subraces: High Elf, Hill Dwarf, Lightfoot, Rock Gnome);
    - 1 background (Acolyte) and 1 feat (Grappler);
    - 319 spells (counts checked 2026-10-07).
  - **The record keys start `srd_`, not `srd-2014_`.** `scripts/srd-2024/spells.ts:45,49` assumes `${document}_`.
- **Generating.** `npm run srd:2014` writes:
  - `src/data/srd/2014/generated/{reference.json, spells.json}`;
  - `2014/COVERAGE.md`, the same audit as 2024's, with a verdict and gap codes for every feature and trait.

  `2014/overrides.ts` takes fixes, each with a reason checked against the SRD 5.1 PDF. `--check` and a test keep the
  committed files fresh, as `srd-2024-reference.test.ts` does.
  - **Class traits** come from the 2014 `PROFICIENCIES` lines. The adapter's `traitsOf`/`skillsOf` already read both
    shapes, so reuse them.
  - **Race increases** are only in the trait text ("Your Constitution score increases by 2"). Parse them into
    `abilities`, and a test checks all 13 entries against the PDF.
- **The 2014 spell library.** `SRD_2014_SPELLS` is the 85 authored spells (`SRD_SPELLS`, untouched, so monsters' golden
  logs stay put) plus a reference-only record for each of the other 234, built the same way the 2024 reference spells are
  (`spell-library.ts:58-74`, parameterised).
  - The ids stay `srd:spell:<slug>`.
  - A test checks every authored slug against the index.
- **Authoring.** `2024/authoring.ts` reads `srd-2024_` keys and `srd52Source`. It becomes a factory over an edition's
  reference, so `2014/authoring.ts` is a thin wrapper.
  - A 2014 feature whose rules match the 2024 one reuses its runnable definition with the 2014 text, through a
    `SAME_AS_2024` map, the mirror of the spells' `SAME_AS_2014`.

### 2024 features in Add ability (D5)

- **An index.** `src/data/srd/2024/feature-library.ts` walks `SRD_2024_CATALOG` and lists each grant whose feature runs
  in full or in part:
  - class and subclass levels;
  - feats;
  - species traits;
  - pick options (Hunter's Prey, Metamagic).

  Each entry looks like `{ id: "srd:feature:<owner>-<grant key>-2024", name, owner: "Fighter 2", grant }`.
  - Informational features are left out, as are those the builder must place (Spellcasting).
- **A level when added.** Many 2024 features scale through templates ("1d10+{level}", "{col:rages}").
  - The editor's preview gets a **class level** stepper. It starts at the creature's level if it has one, and otherwise at
    the level the feature is gained.
  - The scale bindings and pool sizes are worked out at that level by a `resolveGrant(grant, owner, level)` that is
    pulled out of `buildCharacter` (`build.ts:1156-1200`). The builder and Add then can't drift apart.
  - It then attaches through the normal feature path, which re-mints ids and seeds pools.
- **Weapon Mastery** arrives with no weapon kinds chosen, and the editor picks them.

### Table rules (D4)

These go in `CAMPAIGN_RULES` and `RuleProfile`. Each rule's default is today's behaviour, so no seeded fixture moves.

| Rule | Options | Engine |
|---|---|---|
| Grappled | *Speed 0 (2014 rules)* / *Speed 0, and disadvantage on attacks against anyone but the grappler (2024 rules)* | the attack's advantage tally; the grappler is the hold's source (`combat.ts:4781-4807`) |
| Stunned | *Can't move (2014 rules)* / *Can still move (2024 rules)* | `defaultConditionModifiers("stunned")` (`combat.ts:7886-7893`) reads the rule |
| Surprise | *A surprised creature loses its first turn (2014 rules)* / *A surprised creature rolls initiative at disadvantage (2024 rules)* | `initiativeOf` (`combat.ts:1294-1307`); under 2024, `setFactionSurprised` (`encounter-store.ts:572-580`) marks the faction for initiative instead of applying `surprised` |

`ruleInForce` shows them in the encounter like the potion rule. The run log records the rule in force, as it does now.

### 2014 Wild Shape

The 2014 Druid's Wild Shape uses the beast's own hit points. At 0 the druid reverts, and any damage left over carries
into the druid's hit points. Today only the 2024 model exists: the druid keeps its own HP and gains temporary HP
(`wild-shape.ts`, `types.ts:2195-2200`).

- The action gets `wildShape: { hp: "temp" | "form" }`, so each record says which model it follows.
- The 2014 limits by druid level go in the class data:
  - the highest CR: 1/4, then 1/2 at 4th level, then 1 at 8th;
  - no swimming speed before 4th level, and no flying speed before 8th.

## Phases

Branch `editions`, one commit per phase, as before.

### Phase 0: Edition on every record

There is no visible change.

- The `Edition` type moves into the engine, and `SourceMetadata.edition` is added.
- Add `srd51Source` and give `srd52Source` its edition.
- Stamp the 5.1 library when it loads. The non-SRD features get a non-SRD source.
- The attach paths keep the record's source.
- `editionOf()`, with its legacy case.
- The Open5e normalizer sets the edition; My library keeps it.
- The same-edition fixes: upcast twins, "on the sheet", scrolls' `fromLibrary`, and the item-offer wording.

**Tests:**

- every bundled record has an edition;
- `editionOf` reads each source shape, including the legacy one;
- a 2024 spell never gets a 2014 upcast twin;
- My library keeps the edition through a save and an add;
- `srd-library.test.ts` stays green.

### Phase 1: Badges, the filter, and 2024 spells in Add ability

- Add `EditionBadge` and `EditionFilter`, with the per-list memory.
- Add ability lists all 339 2024 spells next to the 2014 library.
  - Reference-only spells are marked "ref", as in the builder's picker.
  - `attachSrdSpell` and dropping a spell find a spell in either library.
- Scrolls for the 2024 spells that run.
- Badges on the editor's Source line and on the SRD Monsters folder.
- The Add footnote credits both SRDs through Docs #credits. Check that #credits shows the SRD 5.2 statement too; both
  live in `attribution.ts`, and their wording is never changed.
- The Codex hosts the same Add panel, so `codex-parity.test.tsx` should pass unchanged.

**Tests:**

- both Fireballs are listed, and each filter shows the right ones;
- adding and dropping a 2024 Fireball;
- the filter is remembered, and a `localStorage` that throws falls back to Both.

**Browser check:** add both Fireballs to one creature and cast each in Play.

### Phase 2: 2024 class features in Add ability

- The feature index, and `resolveGrant` pulled out of `buildCharacter` and shared.
- The class-level stepper in the preview.
- The 19 features in `features.ts` show the 2014 badge.

**Tests:**

- Second Wind added at level 5 heals 1d10+5;
- Rage at level 9 has its level-9 damage bonus and number of uses;
- `buildCharacter` gives the same results through `resolveGrant` as before;
- features the builder must place aren't listed.

**Browser check:** give a hand-built ogre the 2024 Rage and Reckless Attack, then auto-run.

### Phase 3: Table rules

- The Grappled, Stunned and Surprise rules in Campaign rules, `RuleProfile` and the engine.

**Tests:**

- each rule's two options;
- the defaults reproduce today's seeded fixtures exactly;
- a grappled attacker is at disadvantage only against someone other than its grappler.

### Phase 4: The 2014 reference data and spell list

- The generalised fetch, the `srd:2014` generator, `2014/COVERAGE.md` and overrides.
- `SRD_2014_SPELLS` (85 that run and 234 reference-only) and the 2014 class lists.
- The 2014 reference spells join Add ability, badged 2014.

**Tests:** the reference matches the cache, and every authored 2014 spell is in the index.

### Phase 5: The builder learns the 2014 rules

This phase is headless, plus the builder UI.

- The model changes from "The builder's 2014 rules" and "Origins": optional background increases and feat, species
  increases, `increasesFrom`, `epicBoonLevel`, the prepared formula, `firstSlotsAt` and `multiclassRounding`, spells
  from both libraries, and the `-2014` id stripping.
- **The UI:**
  - the filter and optgroups in the class, species and background selects (Character Builder, Create Token ›
    Character);
  - the Ability increases from: control;
  - badges on choice rows;
  - the text that assumes 2024, which goes: "built from a 2024 class" (`CreateTokenModal.tsx:222`), and "the features
    will be the 2024 versions" (`CharacterBuilder.tsx:220`, `StatsSections.tsx:291`);
  - labels that follow the edition: Race and Subrace for a 2014 race, Species and Lineage for a 2024 one.
- **Starting equipment by line** (`equipmentChoices`, `equipment.lines`), with a test-only 2014 class that has two
  lines, one of them "any martial weapon".
- The test-only 2014 fixtures:
  - a class with an ASI at 19, a Paladin-style half caster and a modifier-plus-level preparer;
  - a race with a subrace;
  - a background with no increases.

**Tests:**

- each rule above;
- every combination of 2014/2024 race with 2014/2024 background gives exactly one set of increases;
- a 2014 half caster has no slots at 1st level and rounds down when multiclassed;
- prepared counts follow an ASI;
- a 2014 class's starting equipment puts each line's pick on the sheet, "any martial weapon" included.

### Phase 6: The first 2014 characters, end to end

- The 2014 **Fighter (Champion)** and **Rogue (Thief)**, the **Acolyte**, **Grappler**, and the **Human** and **Dwarf
  (Hill Dwarf)**.
- The 2014 fighting styles.
- Coverage verdicts for all of them.

**Browser check:** build a 2014 Fighter 5 with a 2024 background, switch the increases to the species, and level to 6.

### Phase 7: The other 2014 races

Elf (High Elf), Halfling (Lightfoot), Dragonborn, Gnome (Rock Gnome), Half-Elf, Half-Orc and Tiefling. Their traits
reuse the 2024 ones where the rules match (Relentless Endurance, Fey Ancestry, …).

### Phase 8: Barbarian and Monk

- The 2014 **Barbarian (Berserker)**.
  - Its Rage lasts until a turn passes without an attack on a hostile creature or damage taken, unlike 2024's upkeep.
  - Its Frenzy is partial, because exhaustion isn't modelled.
- The 2014 **Monk (Open Hand)**: Ki and the 2014 Stunning Strike.

### Phase 9: The 2014 casters

One commit per step:

- **9a:** the Wizard (Evocation), the Sorcerer (Draconic Bloodline, with the 2014 Metamagic options) and the Cleric
  (Life). The Cleric's domain comes at 1st level, along with Destroy Undead.
- **9b:** the Bard (Lore) and the Druid (Land), plus 2014 Wild Shape in the engine (`hp: "form"`). Built.
- **9c:** the Warlock (Fiend), with Pact Boons at 3rd level and the 2014 invocations; the Paladin (Devotion), with Divine
  Smite as a feature rather than a spell; and the Ranger (Hunter). Built.

**Browser check:** a 2014 Wizard 5 and a 2024 Wizard 5 in one encounter, each casting its own Fireball and
Counterspell.

### Phase 10: The engine for the 2014 features (added 2026-10-07; built, see Built so far)

The 2024 builder needed about 30 engine changes (PC_BUILDER_PLAN.md Phase 7, 7a–7ac). Most 2014 features reuse those.
Some work differently, and the class phases (6–9) mark them partial or manual with a gap code, as the 2024 audit does.
This phase closes those gaps one family at a time, a commit for each, most widespread first, as `2014/COVERAGE.md`
ranks them.

- **What the 2014 rules are expected to need**, to be confirmed against the audit:
  - Brutal Critical's extra weapon dice on a critical hit;
  - Destroy Undead: Turn Undead destroys an undead of a low enough CR outright;
  - Martial Arts' bonus unarmed strike only after the Attack action;
  - the 2014 Rage: ends when a turn passes without an attack on a hostile creature or damage taken;
  - Frenzy's bonus-action attack while raging (its exhaustion stays out: exhaustion isn't modelled);
  - A gap the engine can't close cheaply stays marked partial or manual, and the audit says why. Nothing is approximated
  without saying so.

**Tests:** each family's engine behaviour, and the 2014 class features that use it.

### Phase 11: Loose ends and the guide

- Rebuild with the builder, choosing an edition.
- Quick party with classes from both editions.
- The homebrew editor:
  - a new class's edition (`catalog-edit.ts` hard-codes 2024);
  - both editions in the spell picker and spell lists.
- **Open5e 2014 subclasses.** A 2014 subclass's parent `srd_<slug>` maps to the bundled `srd:class:<slug>-2014`
  (`open5e-class.ts:142-145`).
- Docs: a short "Editions" section in the guide.
- A final from-blank browser pass of every list with its filter.

## Risks

- **Every list doubles.** The remembered filter and a character opening on its own edition keep this down. If lists
  still feel noisy, starting the filter on the last choice made anywhere is a one-line change.
- **2014 casters will have fewer spells that run** (85 of 319, against 98 of 339 in 2024). The coverage tables show
  this. Running more 2014 spells is the existing backlog (`SRD_SPELL_COVERAGE_AUDIT.md`), not this plan.
- **Golden logs.** Phases 0–2 and 4–5 don't change how anything runs. Phase 3 defaults to today's behaviour. The monster
  chunks keep their own frozen copies of the 2014 spells.
- **Attribution.** Every new 2014 record is SRD 5.1, and the existing statement covers it. The non-SRD 2014 features
  must not be labelled SRD.

## Not in this plan

- **The user left these out (2026-10-07):** 2024 monsters (331 on Open5e), 2024 magic items, and a "use the other
  version" swap on the sheet.
- **Not modelled in either edition:** Exhaustion, Invisible.
- **Gaps in both editions found while planning.** These are worth their own fixes; none is a difference between the
  editions:
  - being incapacitated doesn't end concentration;
  - Stunned and Paralyzed don't make Strength and Dexterity saves fail automatically;
  - there's no automatic critical hit within 5 ft of a paralyzed or unconscious creature;
  - `RuleProfile.enemiesDropAtZero` is never read;
  - an off-hand attack keeps its ability modifier and isn't tied to taking the Attack action.
- **Weapons:**
  - the library's Lance and Trident have the 2014 stats, which differ from 2024's;
  - Hand Crossbow, Javelin, Musket and Pistol can be mastered in the builder but have no library record.

## Built so far

Branch `editions`, built in the worktree `.claude/worktrees/editions` (off master at 9a4baae), one commit per phase.
The full suite passes after each one (282 files after Phase 11), and so do `srd:2014:check`, `srd:2024:check` and
`srd:monsters:check`. Each phase's browser check was done on a second dev server on port 3200.

| Phase | Commit | |
|---|---|---|
| 0 | 008fc32 | Edition on every record |
| 1 | 5eceb8e | Badges, the filter, and 2024 spells in Add ability |
| 2 | 6133f81 | 2024 class features in Add ability |
| 3 | 526a67b | Table rules; and a cap on Add's library rows |
| 4 | 0632631 | The SRD 5.1 reference data and the whole 2014 spell list |
| 5 | 0d6df95 | The character builder takes the 2014 rules from its records |
| 6 | 86cd483 | The first 2014 characters, end to end |
| 7 | a65fbb2 | The other 2014 races |
| 8 | ba993aa | The 2014 Barbarian and Monk |
| 9a | 397e217 | The 2014 Wizard, Sorcerer and Cleric |
| 9b | 3879a6a | The 2014 Bard and Druid, and the 2014 Wild Shape |
| 9c | 7736a3e | The 2014 Warlock, Paladin and Ranger |
| 10a | b70d8b4 | A spell cast with a slot, but once a day |
| 10b | 555e274 | A bonus action only after the Attack action |
| 10c | 119695a | More weapon dice on a critical hit |
| 10d | 7c61358 | The 2014 Rage |
| 10e | 35db600 | Destroy Undead |
| 10f | c99393a | Intimidating Presence's 24 hours |
| 10g | 53f74ee | Frenzy |
| 11 | 5e8eead | Loose ends and the guide |

### Where the build differs from the plan

**Phase 0**

- **The 2014 library's source slug is the library id** (`srd:spell:fireball`), not `srd_<slug>`. The sheet's "on the
  sheet" mark, the scroll check and the Mage Armor migration all match on it, as they did before.
- The monster generator drops a copied spell's source, so the generated monster files are unchanged.
- The Open5e class import takes its edition from the game system too.
- Scrolls of either library moved to Phase 1, together with the 2024 scrolls.

**Phase 1**

- **The filter hides only the other edition's version of something both editions have.** It doesn't hide every row of
  the other edition. The weapons and items are 2014 only, so a strict 2024 filter would have emptied them for a built
  2024 character. A row without an edition (homebrew, recipes) is never hidden.
- Reference-only spells are listed only for a search, including under Spells. There are hundreds of them.
- **SRD 5.2 has Spell Scroll only for cantrips and 1st-level spells** (DC 13, +5; checked against Open5e's
  `srd-2024_spell-scroll`). So the bundled 2024 scrolls are those. A higher-level 2024 spell keeps its own scroll, at
  the 2014 table's numbers.
- A library row's Add button names its edition only when its other version is listed beside it ("Add Fireball (2014)").
  A 2024 class feature's button also names what gives it ("Add Rage (2024, Barbarian 1)").
- Each row's statblock line is worked out once per creature, not on every keystroke.

**Phase 2**

- **The class level is one box in the Add panel** ("2024 class features at level"), not a stepper in the editor's
  preview. It applies both to + and to opening a row.
  - It starts at the creature's level when the creature has one.
  - Empty: each feature at the level it's gained.
- **177 features are listed.** Left out:
  - what the builder places (the audit's `builder` verdict): Spellcasting, Pact Magic, Eldritch Invocations, Aura
    Expansion;
  - grants that work through something besides their feature, which would do nothing alone:
    - `onHitOf`, `actionPatch`, `formsOf` (Stunning Strike, Sear Undead, Beast Spells);
    - `spells`, `freeCasts`, `spellChanges` (subclass spells, Favored Enemy, Agonizing Blast);
    - `weapon` (Martial Arts);
    - `adjust` (Draconic Resilience, Disciplined Survivor, Nature's Ward).
- A feature that changes at several levels (Font of Magic) is one entry, and the latest version reached applies.
- `scaledFeature` was pulled out of `buildCharacter`, so the builder and Add work a number out the same way.

**Phase 3**

- **A stun follows the rule in force when it was put on.** The condition's modifiers are copied then
  (`defaultConditionModifiers` now takes the table's rules). A rule change doesn't reach a stun that's already on.
- **Under the 2024 surprise rule, rolling initiative clears a surprised creature's modifiers.** That covers one ticked
  before the rule changed. The condition stays until round 2 as a marker.
- The Combat panel names each rule where it matters: something in the encounter can grapple, something can stun, or
  someone is surprised.
- **Add ability shows at most 80 library rows**, and says how many more a word would find. Both editions plus the 2024
  features had made the list over twice as long before a search, and the tests that open Add were timing out.
- Noticed, unchanged: "can't move" divides speed by 999 rather than setting it to 0. The held-in-place checks read the
  999.

**Phase 4**

- **The 2014 class spell lists come from the 5e SRD API** (dnd5eapi.co), matched to Open5e's spells by name. Open5e's
  2014 lists name no Paladin, and fold in subclass spells from outside the SRD. The fetch caches them in
  `srd_2014_cache.json` beside Open5e's records.
- Races read their increases, size and speed from their traits' text. All 13 were checked against the PDF.
- `SRD_2014_SPELLS` is all 319 spells: the library's 85 authored ones under their existing ids, the other 234
  reference only, each with a scroll.
- The 2024 generator's helpers are shared and take overrides. Its output is unchanged.

**Phase 5**

- **A 2024 background with a 2014 race defaults to the background's increases.** "Ability increases from" switches it to
  the race's. A 2014 background has no increases, so a 2024 species with it gets the 2024 rule's three points.
- An imported Open5e 2014 class keeps its 19th-level ASI and has no Epic Boon.
- The class filter opens on a built character's edition.

**Phase 6**

- **The 2014 Ability Score Improvement is its own feat** (`srd:feat:ability-score-improvement-2014`). A 2014 class
  suggests it at its ASI levels.
- **Survivor runs in full**: the engine's `hp-regen` while bloodied is the 2014 rule. Phase 10 drops it.
- **Partial, with gap codes:** Grappler (no pin: `grapple-pin`), Dueling and Protection (what's wielded isn't checked:
  `equipment-check`). Great Weapon Fighting is manual (`reroll-damage`). Thief's Reflexes is manual (`extra-turn`,
  shared with 2024).
- Remarkable Athlete runs its initiative half. Its checks and jump are informational.
- **The builder's selects name the edition of a same-named SRD entry** ("Fighter (2014)"), so a closed select says which
  one is chosen. A chosen choice option still hides its other edition's twin. Before, choosing the 2014 ASI let the
  2024 ASI back into the list.
- The 2014 Acolyte is built as well, although the browser check used the 2024 one, to mix the editions.

**Phase 7**

- **A free cast can be at a set level** (`FreeCast.castAt`, `SpellDefinition.castAt`). The Tiefling's Hellish Rebuke is
  cast as a 2nd-level spell, once a day and never with a slot. The engine reads that level through `castSlotLevel`
  everywhere it read a slot's: damage dice, beams, a counter's level, and the AI's estimates.
- **A race can give fixed skills and a spellcasting ability** (`SpeciesDefinition.skills`, `spellcastingAbility`): an
  Elf's Perception, a Half-Orc's Intimidation, a High Elf's Intelligence and a Tiefling's Charisma.
- **The 2014 breath weapon is an action of its own**, not one of the Attack action's attacks. It's once a fight (a short
  rest), and its shape and save follow the ancestry table.
- **Savage Attacks is manual**, under the `brutal-critical` gap, which Phase 10 closes for Brutal Critical too.
- "Magic can't put you to sleep" (Fey Ancestry) has nothing to run against: Sleep is reference-only in both editions.
- The builder's note under the scores names the race when the increases come from it.

**Phase 8**

- **The 2014 Rage keeps the 2024 upkeep for now** (an attack keeps it going; being incapacitated ends it). It's partial
  under `rage-2014`, which Phase 10 closes: damage taken keeps it going too, and only falling unconscious ends it.
- **The 2014 Stunning Strike needed no engine work**: it just has no once-a-turn limit, and lasts to the end of the
  monk's next turn. Phase 10 drops it.
- **Small engine and builder additions**, each with a test:
  - `martial-arts-weapons` takes `monkWeapons: "2014"`: shortswords and simple melee weapons that aren't two-handed or
    heavy;
  - the `would-take-damage` trigger takes `rangedOnly` (Deflect Missiles);
  - a grant's `weaponPatch` sets fields on an earlier grant's weapon (Ki-Empowered Strikes: magical).
- Empty Body's invisibility is ±5 on attack rolls, as Reckless Attack's advantage is. It's partial under `stealth`.
- New gap codes: `surprise-rage`, `check-floor`, `extend-with-action`, `immune-after-save`, `catch-missile`,
  `end-own-condition` and `unsimulated-spell`.
- The library gains the javelin: a 2014 Barbarian starts with four.
- The sheet's "from …" names a 2014 subclass without its id's `-2014`.

**Phase 9a**

- **Potent Cantrip needed no new engine family.** `spell-half-on-miss` takes `savesOnly`: a made save's half, never a
  miss's. Phase 10 drops `cantrip-half-on-save`.
- **A known caster's number is its table's Spells Known column**, in `prepared`. A prepared caster's is the formula.
- **The 2014 Metamagic options are `referenceOptions`** (a new 2014 authoring helper): each option's SRD text, with
  the engine's effect where it runs. Heightened costs 3. Careful, Extended and Twinned are partial under
  `metamagic-2014`: the engine's are the 2024 rules.
- **A Draconic sorcerer picks its ancestor at 1st level.** Each option carries its Elemental Affinity as an `atLevel: 6`
  grant. The resistance is a free activation for a sorcery point, partial under `activation-timing`.
- **The AI no longer pairs an action and a bonus action that need more of a resource than it has.** Found by the 2014
  Cleric 17 fight: Spiritual Weapon and Insect Plague both on the last 9th-level slot. The golden logs lose one event:
  a priest's Spiritual Weapon decision whose slot was already spent.
- **Noticed, unchanged:** neither edition's rule that a bonus-action spell allows only a cantrip with the action
  (2014), or no other slot spell (2024), is enforced.
- The suggestions prepare one more spell at 5th level, so a Wizard 5 has Fireball and not Counterspell. The mixed
  wizards test adds each one's Counterspell from the library.
- The Cleric's ASI levels are 4, 8, 12, 16 and 19, as SRD 5.1's text says. The reference's level list leaves out 12th.

**Phase 9b**

- **The 2014 Wild Shape is `wildShape.hp: "form"`**, as planned. The druid's own hit points are kept on the token
  (`activeForm.ownHp`), and `dropAtZero` turns a form's 0 into going back with the overkill carried over. The
  Transformed events carry the hit points, so replays follow it.
- **Going back takes the shift's own action here**: an action for the 2014 druid, where the rules make it a bonus
  action. Partial under `wild-shape-revert`. The AI never goes back on purpose, so only a person in Play pays it.
- **The AI takes a form with its action as well as a bonus action.** Shifting costs the 2014 druid its attack that turn.
- **Magical Secrets is a choice of two spells from every 2014 list** at 10th, 14th and 18th level, and the Spells Known
  column is lowered by the secrets it includes, so the total matches the table.
- Seven lands' circle spells, each pick carrying its 3rd/5th/7th/9th-level grants. Many of those spells are
  reference-only, as in 2024.
- Land's Stride ignores all difficult terrain (`magical-terrain`). Nature's Ward is partial (`immunity-by-type`).
  Nature's Sanctuary is manual (`attack-deterrence`). Countercharm is manual (`activated-aura`).
- Browser check: a 2014 Druid 2 in Play, Wild Shape into a Wolf: 11/11 hit points, AC 13, 40 ft, its action spent.

**Phase 9c**

- **Divine Smite needed no new engine family.** It's an on-hit option of the feature, spending a slot, as the 2024
  Eldritch Smite does. `upcast.maxAbove` caps it at 5d8, and a second damage rider adds 1d8 against fiends and undead.
  Phase 10 drops `smite-feature`.
- **The generator keeps a class's option list** (`CLASS_FEATURE_OPTION_LIST`), as the 2024 one does. SRD 5.1 has one,
  the Warlock's invocations. An override restores Armor of Shadows' lost heading, so there are 32.
- **The Pact Boon is a pick in the invocations' family** (the same pick id at 3rd level), so an invocation's "Pact of
  the Blade feature" is a pick prerequisite. "Eldritch blast cantrip" isn't checked.
- **The 2014 pact weapon is a magical longsword using Strength** (2024's uses Charisma).
- **A subclass's expanded list** is registered beside the class lists (`SRD_2014_EXPANDED_LISTS`), not among the lists
  a homebrew class can name. The Fiend's grant adds it.
- **A feat choice takes `names`**: the 2014 Paladin's and Ranger's four fighting styles, in either edition.
- A favored enemy matters in a fight only to Foe Slayer (20th), a grant in each option, `atLevel: 20`.
- Invocations that cast a spell once a day with a slot are known spells here (`once-a-day-slot`). Hunter's Mark is
  reference-only in the 2014 library, so the Ranger's suggestions lean on what runs.
- Browser checks: a 2014 Paladin 5's hotbar has Divine Smite and "Divine Smite, level 2" on its attacks. A 2014 and a
  2024 Wizard 5 fight each other in tests/editions-casters.test.ts, each countering with its own Counterspell.

**Phase 10**

Seven families, one commit each, the most widespread first and the plan's expected ones. Tests are in
`tests/srd-2014-engine.test.ts`.

| Family | What the engine gained | The 2014 features it runs |
|---|---|---|
| `once-a-day-slot` | `FreeCast.withSlot`: the spell with its slot and an `extraCost` pool of its own | Seven warlock invocations (Mire the Mind, Sign of Ill Omen, …) |
| `after-attack-action` | `afterAttackAction`, `TurnFlags.attackActionTaken`, a weapon's `bonusAfterAttack` | Martial Arts' bonus strike, Flurry of Blows |
| `brutal-critical` | `damage-dice.criticalDice`: more of the weapon's dice on a critical hit | Brutal Critical, Savage Attacks |
| `rage-2014` | upkeep `"damaged"`, a condition's `endsOnUnconscious` | the 2014 Rage |
| `destroy-undead` | an area save's `destroysOnFail` (by challenge rating and type) | Destroy Undead on Turn Undead |
| `immune-after-save` | none: `immuneAfterSave` was there | Intimidating Presence |
| `frenzy-attack` | the `bonus-weapon-attacks` effect, and the AI taking what opens them | Frenzy (its exhaustion left out) |

- **Closed earlier, in the class phases:** `regain-at-turn-start` (Survivor, Phase 6), the Stunning Strike limit
  (Phase 8), `cantrip-half-on-save` (Phase 9a), `wild-shape-hp` (Phase 9b) and `smite-feature` (Phase 9c).
- **Still partial or manual, each with its gap code in `2014/COVERAGE.md`:** activated auras (Countercharm, Draconic
  Presence, Holy Nimbus), the 2014 Careful, Extended and Twinned Spell, stealth (Empty Body, One with Shadows, Vanish),
  one attack against each creature in an area (Volley, Whirlwind Attack), what's wielded (Dueling, Protection), magical
  terrain (Land's Stride), unsimulated spells (Tranquility, Fiendish Vigor), and 23 single-feature gaps. None is
  approximated without the audit saying so.
- **Noticed, unchanged:** a Divine Smite variant shows on a thrown weapon's attack (the javelin is a melee weapon with a
  thrown range), so a thrown javelin could smite.

**Phase 11**

- **Rebuild with the builder** matches classes in the edition the filter shows, and adopts again when the filter changes.
  Under Both it takes the first class of the name, which is 2024.
- **Quick party** switches each member to the filter's edition (`editionTwin`) when the filter changes, and opens on the
  remembered filter's edition. A mixed party (2014 Fighter and Rogue, 2024 Cleric and Wizard) builds and fights cleanly
  (`tests/editions-loose-ends.test.ts`).
- **The homebrew editor** has a Rules field on every entry. Switching a class to 2014 adds the 19th-level ASI, and
  switching back takes it away. The spellcasting fields gained the 2014 prepared formula, first slots at a later level,
  and rounding down. The spell picker lists both editions, each marked.
- An Open5e 2014 subclass (`srd_<class>`) attaches to the bundled `srd:class:<class>-2014`.
- The guide's "Editions (2014 & 2024)" section, and a line in Credits that the builder draws on SRD 5.1 too. The
  attribution statements themselves are unchanged.
- **Final browser pass, from blank (Sandbox, port 3200):**
  - Create Token's class, background and species lists under each filter;
  - Quick party switching to 2014 (all four ids end `-2014`) and creating the party;
  - Add ability's Fireball, two rows under Both and one under each edition;
  - the Homebrew window's Rules field, prepared-spells select and both editions in the spell picker;
  - the Docs section.
