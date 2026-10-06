# PC Builder Plan: a character built from its class, and leveled up

**Status:** built (2026-10-05 to 2026-10-06) on branch `pc-builder`, Phases 0 to 9, one commit per phase or step; not
merged or pushed. On 2026-10-05 the user chose the 2024 rules from SRD 5.2 (D1), homebrew and imported classes after
all the SRD classes (D2), and species and backgrounds in scope (D3); the other decisions took the defaults below. "Where
the build differs" (next) sums up what came out differently; "Built so far" at the end has each phase and step.

Today a player character is an actor built by hand, the same way a monster is. `character.classes` (name, level,
subclass) is a label: it sets the level, which sets the proficiency bonus and how cantrips scale, and nothing else reads
it. A level 6 rogue's Sneak Attack is the library's fixed 3d6 until the DM edits it. Rage uses, spell slots, Extra
Attack's count, saves and skills are all set by hand. The templates in the repo root (`barbarian-template.json`,
`warlock-template.json`, `lore-bard.party.json`) show how much of that there is. Leveling a character means doing all of
it again.

The builder makes a PC from a class, a subclass, a species, a background and a few choices. Leveling up adds what the
new level gives: features, bigger numbers, spell slots and hit points. It asks only for what that level needs you to
choose (a subclass, a feat, new spells, weapon masteries), with a suggested pick already filled in.

## Where the build differs from this plan

- **The model** (Phase 0): numbers come from template strings (`"{col:sneak-attack}"`, `"1d10+{level}"`,
  `"{mod:cha|min:1}"`) for both `scale` and pool sizes; a subclass is a `subclass` choice at its level; choices have
  stable ids and the build stores each level's values by them. Feat levels, the Epic Boon at 19, the first class's skills
  and each later Weapon Mastery choice are made by the builder from the class's fields, not written per level. What the
  builder owns is tracked finer than planned: each field, save, skill, sense and pool on its own.
- **Spells** (Phase 5): a spell choice is a list of ids, one per kind (cantrips, prepared, spellbook). Always-prepared
  spells and free casts are grants, so a subclass, a feat or a species gives them the same way. 2024 spells are records
  of their own, copied from the 2014 library where nothing changed and authored where it did.
- **Weapon Mastery** (Phase 3): Nick is an extra swing in a variant of the Attack routine, not a free off-hand attack,
  because the AI didn't take free actions then.
- **Phase 7 grew** from "the gaps class features need most" into some fifty steps, one gap family each, until every
  family a character below 10th level meets in a fight ran. Wild Shape moved there from Phase 5b. Left, each as SRD text
  with its gap code (COVERAGE.md): `stealth`, `grapple-strike` and `summon-stat-blocks`, which need systems of their
  own, and ten one-feature families, mostly 14th level or higher.
- **Homebrew** (Phase 8) is stored per account (a `CatalogEntry` table) and travels as `battlesim-catalog` files. The
  party's non-SRD subclasses (Arcane Trickster, Zealot, Totem Warrior) and the Spiritbound Marksman are test fixtures
  to import (`tests/fixtures/homebrew/party.catalog.json`), not bundled content. Not built: a homebrew class's own new
  spells (classes cast library spells), and a character carrying its homebrew with it to another account.
- **Multiclassing** (Phase 9): the narrower proficiencies of the multiclass rule aren't modeled, because the builder
  never used a class's weapon and armor lists (weapons carry `proficient`, armor isn't checked); the multiclass skill
  is. Rebuilding a hand-built PC keeps its ability scores and hit point maximum, which the plan didn't say.
- **Still open for the user**: the AI counts allies inside a hostile-only area as friendly-fire risk
  (`areaPlanValue`); fixing it moves the golden logs, so it was left for a decision (Land's Aid is special-cased). The
  dev server on :3000 needs a restart to serve `/api/catalog`; its Prisma client predates the table.

## What there is to build on

- **Features.** `FeatureDefinition` with `effects` and `grantedActions` already runs Rage, Reckless Attack, Action Surge,
  Second Wind, Cunning Action, Extra Attack (a `multiattack` of `any: "weapon"`), Sneak Attack, Unarmored Defense, Aura
  of Protection, Evasion and fighting styles. The library (`src/data/srd/features.ts`) has 19 features, all 2014
  versions with fixed numbers.
- **Spells.** 82 SRD 5.1 (2014) spells are authored in `src/data/srd/spells.ts`. None of them says which classes cast
  it. Hunter's Mark, Hex and Divine Smite aren't among them. Spell slots are `slot-N` resources. Upcasting, cantrip
  scaling (by `character.level`) and Counterspell already work.
- **Weapons, armor and items.** The SRD 5.1 weapons and armor are in the library, and weapons have no mastery. Worn armor
  sets the AC (`armorClassOf`), and `unarmored-ac` covers Unarmored Defense and Mage Armor.
- **Riders** already cover several of what 2024 needs: `on-miss` damage, `push`, a condition with a save, and
  `restrictToCreatureTypes`. Buff actions can grant temp HP.
- **The sheet.** Stats › Level & CR edits `character.classes`. Saves and skills that are proficient follow their scores
  (`withProficienciesFollowing`). Resource sizes go through `withResourceSize`, and tokens at full follow a new max.
- **Open5e V2 has all of SRD 5.2** (`document__key=srd-2024`). That's 12 classes and 12 subclasses, each with its hit
  die, saves, `caster_type`, and features with `gained_at` levels and `data_for_class_table` columns ("Sneak Attack 1d6 …
  10d6"). There are also 339 spells with class lists, 75 weapons with their mastery in `properties`, 17 feats, 4
  backgrounds and 9 species. All of it is text. It's where the data comes from, but the features that run are still
  authored by hand.
- The creature schema is `.passthrough()`, so a new `character.build` field loads in old code and old saves still load.

## What the 2024 rules change for the builder

- **Ability score increases come from the background:** +2 and +1, or +1 to all three, among its three abilities. The
  species gives none.
- **Each background gives two skills and an origin feat** (Alert, Magic Initiate, Savage Attacker or Skilled).
- **Every subclass starts at 3rd level.**
- **Feats at 4th, 8th, 12th and 16th level**, plus 6th and 14th for the fighter and 10th for the rogue. The SRD's
  general feats are Ability Score Improvement and Grappler. An Epic Boon comes at 19th. A Fighting Style is a feat
  choice: Archery, Defense, Great Weapon Fighting or Two-Weapon Fighting.
- **Weapon Mastery.** The barbarian, fighter, paladin, ranger and rogue each master a number of weapon kinds (the
  fighter 3, rising to 6). Every SRD 5.2 weapon has one mastery property: Cleave, Graze, Nick, Push, Sap, Slow, Topple
  or Vex. The engine has none of this, and the 2024 martial classes lean on it.
- **Every caster prepares a set number of spells from its class table.** Spells known are gone. The paladin and the
  ranger cast from 1st level. The wizard prepares from a spellbook.
- **Many spells changed** (Cure Wounds heals 2d8, Healing Word 2d4, Divine Smite is now a spell), so the 2024 spells are
  their own records.

## The idea: the build is a recipe, and the actor is what it makes

- `definition.character.build` stores the choices: the ability score method and base scores, the background and its
  increases, the species, how HP is set, and an ordered list of levels. Each level records which class it went to and
  what was chosen at it.
- `buildCharacter(build, catalog)` is a pure function. It works out everything the build makes: features, actions,
  spells, weapons' masteries, resources, saves, skills, scores, HP, speed, senses, proficiency and spellcasting ability.
- `applyBuild(definition, built)` writes that onto the actor. It replaces only what the builder made last time and the
  DM hasn't changed since. It keeps everything else: hand-made abilities, items, and builder records the DM edited. It
  returns a diff to show.
- Level up adds a level to the recipe and rebuilds. Level down, or changing an earlier choice, edits the recipe and
  rebuilds. Each is one undo step.
- The engine doesn't learn what a class is. What the builder makes is ordinary `FeatureDefinition`, `SpellDefinition`,
  `WeaponDefinition` and `ItemDefinition` data. So the golden logs can't move, the DM can read and edit every number,
  and an exported character runs in any copy of the app.

## Decisions

| | Decision | Default |
|---|---|---|
| D1 | Rules edition | **2024, from SRD 5.2** (user, 2026-10-05). Monsters stay SRD 5.1, and a 2024 party fighting them is fine. The 2014 libraries stay for hand-built actors. The Add panel marks each entry's edition, and same-named entries from the two editions are never merged. The catalog has an `edition` field, so 2014 classes can come later. |
| D2 | Content beyond the SRD | **After all the SRD classes** (user, 2026-10-05): Phase 8. Only SRD 5.2 content is bundled: 12 classes with one subclass each. The party's subclasses (Arcane Trickster, Zealot, Totem Warrior) are authored in Phase 8 as homebrew subclasses of the 2024 classes. The Spiritbound Marksman is authored there as a homebrew class. |
| D3 | Species and background | **Both** (user, 2026-10-05). The background comes in Phase 1, because it sets the ability scores. SRD 5.2 has Acolyte, Criminal, Sage and Soldier, and a custom background (three abilities, two skills, an origin feat) is always an option. The 9 species come in Phase 6. Until then, and always as an option, it's "no species, set by hand". |
| D4 | How numbers scale | **Worked out when the character is built.** At 7th level the builder writes 4d6 into Sneak Attack. A feature does not carry a "class level" formula, and the engine is unchanged. |
| D5 | DM edits to things the builder made | **Kept.** Each level-up's diff lists them ("You changed Cunning Action, so it stays as you made it") and offers **Update to this level's version** for each one. The builder knows what it wrote last time from a fingerprint. |
| D6 | Edits to scores and max HP on the sheet | A typed ability score becomes a change to the build's base score. A typed max HP becomes an HP adjustment in the build. Either way the change survives the next level-up. Other fields the builder owns (speed, senses) follow D5. |
| D7 | Choices | Every choice has a suggested pick, so "Quick build: Rogue 9" takes one click. The level-up dialog shows only the choices that level asks for, already filled in. |
| D8 | Hit points | Average by default (the hit die's maximum at 1st level, then half the die + 1 per level). Rolled HP is optional and entered by hand for each level. CON changes are counted for every level. |
| D9 | Where it lives | A **Character Builder** floating window. Open it from Create Token › a new **Character** tab, or from the sheet: Stats › Level & CR becomes **Class & level** for a built character, with Level up, Level down and Open in builder. The sheet menu also gets "Level up…". |
| D10 | Existing hand-built PCs | Left alone. When the class name matches a catalog class, "Rebuild with the builder" starts a 2024 build at that level. The dialog says the features will be the 2024 versions. The old abilities stay as hand-made, and same-named duplicates are flagged for the DM to remove. |
| D11 | Multiclassing | In the model from Phase 1 (an ordered level list) under the 2024 rule: 13 in each class's primary ability, and slots from full-caster levels + half of paladin and ranger levels (rounded up) + a third of third-caster levels (rounded down). The UI for adding a second class comes in Phase 9. Prerequisites are warned about, not enforced. |
| D12 | Spells | 2024 spells are their own records (`srd:spell:<slug>-2024`, source `srd-2024`). Where a spell's mechanics didn't change, the 2014 action is copied. Where they changed, it's re-authored. A spell not authored yet can still be added as reference only (`manual-only`). Every caster prepares the number its class table gives. The wizard's spellbook is kept in the build. The sheet holds what's prepared plus the always-prepared spells. |
| D13 | Weapon Mastery | Chosen in the build: weapon kinds, as many as the class table gives. The library weapons gain their SRD 5.2 `mastery` (their stats didn't change). A mastery works only for a wielder who has mastered that kind of weapon. Until Phase 3 it's recorded and marked as not simulated. |
| D14 | Pact magic | Warlock slots stay `slot-N`, as now. A warlock multiclassed with another caster would share those pools: v1 warns, and a separate `pact-N` pool can come later. |
| D15 | Equipment | Only on the first build: the class's starting equipment (option A or B) and the background's. Only weapons and armor go on the sheet, from the library. Gold and gear are ignored. Leveling up never touches equipment. |
| D16 | Rests | None. A built character starts with full pools, as every actor does. The adventuring day stays out of scope, and a token's pools can still be lowered by hand. |
| D17 | Tactics | The class suggests a default tactics profile and resource stance: fighter or barbarian → brute, rogue → skirmisher, wizard or sorcerer → controller. The DM can change it on the Token tab, as now. |

## Model (Phase 0)

### The catalog (`src/lib/character-builder/catalog.ts`, data in `src/data/srd/classes/`)

```ts
interface ClassDefinition {
  id: string;                    // "srd:class:rogue-2024"
  name: string;
  source: SourceMetadata;        // provider + document key: never merged with a same-named class from another source
  edition: "2014" | "2024";
  hitDie: 6 | 8 | 10 | 12;
  primaryAbilities: Ability[];   // multiclass prerequisites and suggestions
  saves: Ability[];              // proficient only when it's the first class
  skills: { count: number; from: string[] };
  weaponProficiency: Array<"simple" | "martial" | string>;   // sets WeaponDefinition.proficient
  weaponMastery?: number[];      // weapon kinds mastered, by class level (20 entries)
  spellcasting?: SpellcastingProgression;
  subclassLevel: number;         // 3 for every 2024 class
  subclassLabel: string;         // "Rogue Subclass"
  featLevels: number[];          // [4, 8, 10, 12, 16] for the rogue; 19 is the Epic Boon
  table: ClassTableColumn[];     // { id: "sneak-attack", label, values: [20 entries] }
  levels: ClassLevel[];          // { level, grants: FeatureGrant[], choices: ChoiceSpec[] }
  startingEquipment?: EquipmentPackage[];   // option A, option B
  suggested: { abilities: Ability[]; tactics: TacticsProfile; stance?: ResourceStance };
}

interface SubclassDefinition {
  id: string; name: string; source: SourceMetadata; edition: "2014" | "2024";
  classId: string;               // which class it belongs to; a homebrew subclass can attach to an SRD class
  spellcasting?: SpellcastingProgression;   // a third caster (Arcane Trickster, Eldritch Knight)
  levels: ClassLevel[];
  table?: ClassTableColumn[];
}

interface FeatureGrant {
  key: string;                   // stable within its class: "sneak-attack"
  feature: string | FeatureDefinition;      // a library id or inline
  replaces?: string;             // Superior Critical replaces Improved Critical
  scale?: Array<{ path: string; column: string }>;   // "effects.0.damage.0.dice" ← table "sneak-attack"
  pool?: { id: string; column: string };    // rage: its size from the "rages" column
  adjust?: { speed?: number; abilities?: Partial<Record<Ability, number>>; abilityMax?: number; hpPerLevel?: number };
}

type ChoiceSpec =
  | { kind: "subclass" }
  | { kind: "feat"; categories: FeatCategory[] }   // general (with its prerequisites), fighting style, epic boon
  | { kind: "skills"; count: number; from: string[] }
  | { kind: "expertise"; count: number }
  | { kind: "weapon-mastery" }   // the count comes from weaponMastery and the level
  | { kind: "spells" }           // cantrips and prepared counts come from the progression and the level
  | { kind: "pick"; id: string; label: string; count: number; options: FeatureGrant[] };  // invocations, metamagic, divine order, primal order, land, ancestry

interface SpellcastingProgression {
  ability: Ability;
  kind: "full" | "half" | "third" | "pact";
  list: string;                  // the class spell list key ("wizard")
  cantrips?: number[];           // by class level
  prepared: number[];            // by class level (2024: every caster)
  spellbook?: { start: number; perLevel: number };
  alwaysPrepared?: Record<number, string[]>;  // subclass spells, Paladin's Smite, Favored Enemy's Hunter's Mark
  freeCasts?: Array<{ spell: string; column: string }>;  // Favored Enemy: Hunter's Mark without a slot, N times
}

interface FeatDefinition {
  id: string; name: string; source: SourceMetadata; edition: "2014" | "2024";
  category: "origin" | "general" | "fighting-style" | "epic-boon";
  prerequisite?: { level?: number; abilities?: Partial<Record<Ability, number>>; feature?: string };
  abilityIncrease?: { from: Ability[]; amount: 1 | 2; max: 20 | 30 };   // ASI: +2 or +1/+1; an Epic Boon: +1 up to 30
  grants: FeatureGrant[];
  choices?: ChoiceSpec[];        // Magic Initiate's list and spells, Skilled's three skills
  repeatable?: boolean;
}

interface BackgroundDefinition {
  id: string; name: string; source: SourceMetadata; edition: "2024";
  abilities: [Ability, Ability, Ability];
  skills: [string, string];
  feat: string;                  // its origin feat
  equipment?: EquipmentPackage[];
}

interface SpeciesDefinition {
  id: string; name: string; source: SourceMetadata; edition: "2014" | "2024";
  sizes: SizeCategory[];         // a choice for the human and the tiefling
  speed: number; senses?: CreatureSenses; type: CreatureType;
  levels: ClassLevel[];          // traits by character level (Draconic Flight at 5th, a lineage's spells at 3rd and 5th)
  choices?: ChoiceSpec[];        // lineage, legacy, giant or draconic ancestry
}
```

`scale` is declarative on purpose. SRD data and homebrew classes (stored as JSON, Phase 8) scale the same way, so the
SRD data tests the path that homebrew uses. A path that doesn't resolve fails the catalog test, not a build.

### The build record (`definition.character.build`)

```ts
interface CharacterBuild {
  version: 1;
  edition: "2014" | "2024";
  abilities: { method: "standard-array" | "point-buy" | "manual"; base: Record<Ability, number> };
  background: { id?: string; custom?: { abilities: Ability[]; skills: string[]; feat: string };
                increases: Partial<Record<Ability, number>>; choices?: Record<string, unknown> };
  species?: { id: string; choices?: Record<string, unknown> };
  hp: { method: "average" | "rolled"; rolls?: number[]; adjust?: number };
  levels: Array<{ classId: string; subclassId?: string; choices: Record<string, unknown> }>;   // index = level − 1
  equipment?: { classOption?: "A" | "B"; backgroundOption?: "A" | "B"; applied: boolean };
  made: Record<string, { key: string; fingerprint: string }>;   // record id or field name → what the builder last wrote
}
```

The `made` map lives in the build, not on the records, so engine types don't change. A copy of a builder-made record
gets a new id, so the builder doesn't own the copy. That's correct: a duplicate is the DM's own.

### What `buildCharacter` works out

| Part | From |
|---|---|
| Level, proficiency bonus | the number of levels (`proficiencyFromDefinition` already reads `character.level`) |
| Ability scores | base + the background's increases + feats' increases (max 20) + an Epic Boon (max 30) + feature bumps (Primal Champion's and Body and Mind's +4) |
| Max HP | hit dice by D8, CON × level, `hpPerLevel` (Draconic Resilience, a dwarf's Dwarven Toughness), `hp.adjust` |
| Saves | the first class's saves, written as modifier + proficiency |
| Skills, expertise | class, background, species and feat picks |
| AC without armor | 10 + DEX (armor and `unarmored-ac` features do the rest, as now) |
| Speed, size, type, senses | species + `adjust.speed` (Fast Movement, Unarmored Movement) |
| Features and their actions | every grant up to each class's level, plus feats and species traits, after `replaces`, with `scale` applied |
| Resources | `pool` columns (rage, focus points, sorcery points, bardic inspiration, channel divinity, second wind), `slot-1`…`slot-9` from the slot tables, free casts |
| Spells | cantrips, prepared and always-prepared spells; DC and attack bonus follow `spellcasting` |
| Spellcasting ability | the first spellcasting class. A second class's spells name their own ability in their DC formulas |
| Weapons and armor | the starting packages (first build only); `proficient` from the class's weapon proficiencies; masteries on the mastered kinds |
| Default tactics, stance | the class's `suggested` |

The slot tables (`slots.ts`): full, half (2024: from 1st level, rounded up), third, and pact, plus the multiclass rule
from D11.

## The UI (Phases 2, 5 and 9)

- **Create Token › Character.** Name, class, level 1–20, background, then either **Quick build** (every choice takes its
  suggestion) or **Step through** (one screen per level that has a choice). Ability scores: standard array, point buy
  (27) or manual, with the background's increases shown on top. Also skills, weapon masteries, starting equipment, and
  spells for casters. The result opens on the sheet as a party actor, and also goes into the actors library like any
  created actor.
- **Level up dialog.** For example, Rogue 4 → 5:
  - Gains Uncanny Dodge (reference only until Phase 7 makes it run).
  - Changes: Sneak Attack goes from 2d6 to 3d6; proficiency goes from +2 to +3 (attacks, saves and skills follow); HP
    goes from 31 to 38 (average 5 + CON 2); Cunning Strike gets its 5th-level text.
  - Kept as you made it: Cunning Action (you edited it), with **Update to this level's version**.
  - No choices at this level.

  At a level with a choice (a feat, a subclass, spells, another mastery), the choice sits in the same dialog, already
  filled in. Apply is one undo step.
- **The sheet.** For a built character, Stats › Level & CR becomes **Class & level**: "Rogue 5 (Thief) · Soldier ·
  Human", with Level up, Level down, and Open in builder. Builder-made abilities show a small "from Rogue 5" mark in
  the Abilities list. A hand-built actor's section is unchanged.
- **Builder window** (Open in builder): the whole recipe in one place. Scores, background, species, each level's class
  and choices, and HP. Change any of it and the diff is shown before it's applied.

## Content: what SRD 5.2 gives

- **Classes and subclasses:** Barbarian (Path of the Berserker), Bard (College of Lore), Cleric (Life Domain), Druid
  (Circle of the Land), Fighter (Champion), Monk (Warrior of the Open Hand), Paladin (Oath of Devotion), Ranger
  (Hunter), Rogue (Thief), Sorcerer (Draconic Sorcery), Warlock (Fiend Patron), Wizard (Evoker).
- **Species:** Dragonborn, Dwarf, Elf, Gnome, Goliath, Halfling, Human, Orc, Tiefling. Lineages, legacies and
  ancestries are choices within a species.
- **Backgrounds:** Acolyte, Criminal, Sage, Soldier.
- **Feats:** 17. Origin: Alert, Magic Initiate, Savage Attacker, Skilled. General: Ability Score Improvement, Grappler.
  Fighting Style: Archery, Defense, Great Weapon Fighting, Two-Weapon Fighting. Seven Epic Boons.
- **Attribution.** SRD 5.2 is CC-BY-4.0 with its own attribution statement. Add it to `src/data/srd/attribution.ts`
  beside the 5.1 statement, verified character for character against the SRD 5.2 document's legal page (never from
  memory), with its own verbatim test copy. See `srd-attribution` for the rules. No "D&D" branding:
  `tests/no-dnd-branding.test.ts` covers the new data.

## Class features the engine can't run yet (expected; Phase 0 confirms)

The builder adds every feature whatever the engine can do. One the engine can't run goes in as `partial` or
`manual-only` reference with a gap code. That's the same rule the SRD monsters follow: tag it, never drop it, never
invent behavior. These gaps turned up while reading the engine, grouped into families, because one engine change
usually covers a family:

| Gap | Features |
|---|---|
| Weapon Mastery | Graze, Push and Topple fit existing riders (`on-miss` damage, `push`, a save-or-prone condition). Sap, Slow and Vex need a "next attack" or speed-cut condition. Cleave and Nick change the Attack action. Affects five classes from 1st level (Phase 3). |
| Wider critical range | Champion's Improved and Superior Critical |
| Damage dice rules | Savage Attacker (roll twice, keep the higher), Great Weapon Fighting (1s and 2s count as 3) |
| d20 rerolls | Heroic Inspiration (the human's Resourceful, the Champion's Heroic Warrior), the halfling's Luck, Indomitable, Boon of Fate |
| Initiative | Alert (+ proficiency bonus), Feral Instinct (advantage) |
| A bonus-action spell cast on a hit | Divine Smite (Paladin's Smite) and the other smite spells |
| Marking a target | Hunter's Mark (Favored Enemy's free casts, Precise Hunter, Foe Slayer), Hex |
| A reaction that cuts damage | Uncanny Dodge (halve), Deflect Attacks, the goliath's Stone's Endurance |
| Trading attack dice for effects | Cunning Strike and Devious Strikes, Brutal Strike |
| Next-attack advantage | Vex, Studied Attacks, Steady Aim |
| Giving an ally a die | Bardic Inspiration (Cutting Words is approximated today as −4) |
| Healing bonuses | Disciple of Life, Blessed Healer, Supreme Healing |
| Spell school scope, cantrip damage on a save, sparing allies | The Evoker's Potent Cantrip, Empowered Evocation and Sculpt Spells |
| An on-kill trigger | Dark One's Blessing |
| Healing from a pool by any amount | Lay on Hands |
| Spending a resource on a spell | Metamagic |
| Two turns in the first round | Thief's Reflexes |
| Changing size | the goliath's Large Form |

Wild Shape fits the existing `transform` action, with SRD beasts limited by CR at each level and temp HP from a buff.
The monk's focus features (Flurry of Blows, Patient Defense, Step of the Wind, Stunning Strike) likely fit existing
shapes: a bonus-action `multiattack` with a cost, `utility` modes, and an `onHit` condition rider with a save and a
cost. Innate Sorcery and the orc's Adrenaline Rush likely fit an activated condition. Phase 0 confirms each one.

## Phases

### Phase 0: the catalog model, the SRD 5.2 data, and the coverage audit
- Catalog and build types with zod schemas (`src/lib/character-builder/`). Nothing UI, nothing engine.
- `scripts/srd-2024/fetch.ts` pulls SRD 5.2 from Open5e V2 (classes, spells, feats, backgrounds, species, weapons) into
  a local gitignored cache, the way the monster CSV is kept. Generators read the cache. Wrong source data is fixed with
  overrides that each give a reason, as the monsters do.
- `CLASS_FEATURE_COVERAGE.md` covers every SRD 5.2 class and subclass feature at levels 1–20, every feat and every
  species trait. Each one gets a verdict: an existing library feature, a new data-only feature, partial, manual-only,
  or informational (no combat effect). Each gap gets a code, and the gaps are ranked by how many classes and levels
  they affect, like the monsters' `COVERAGE.md`.
- **Done when** the types compile, the schemas round-trip a hand-written Rogue, the cache script runs, and the audit
  covers all 24 classes and subclasses, the 17 feats and the 9 species.

### Phase 1: the builder, headless, with the Fighter (Champion), the Rogue (Thief), backgrounds and feats
- `buildCharacter`, `applyBuild` with fingerprints and the diff, `scale` paths, `replaces`, pools from columns, HP,
  feats and their ability increases, the four backgrounds and a custom one, the slot tables (all of them now, since
  they're small and pure), and suggestions. Weapon masteries are chosen and recorded but not yet simulated.
- 2024 features for these two classes as `srd:feature:<slug>-2024`, using the library's runnable pieces. For example,
  Second Wind is `1d10 + fighter level` with 2 to 4 uses, and Extra Attack's count goes to 3 at Fighter 11 and 4 at 20.
- **Done when** tests pass for: a Fighter built 1→20 matching hand-checked numbers at 1, 5, 11 and 20; a Rogue's Sneak
  Attack at every level; a background's +2/+1 and its origin feat; an edited feature surviving a level-up and updating
  on request; level down removing exactly what it added; the same build giving the same actor twice; and the result
  passing `creatureDefinitionSchema`.

### Phase 2: the builder window and level up (Fighter, Rogue)
- Create Token › Character, Quick build and Step through, the level-up dialog, Class & level on the sheet, "Level up…"
  in the sheet menu. Store actions `createCharacter`, `levelUp`, `levelDown` and `rebuild`, each one undo step through
  `mergeEdits`.
- Export and import keep the build (`parseCombatantPackage` validates it; an invalid build is dropped with a warning,
  and the actor still works as hand-built).
- **Done when** it's browser-verified from a blank actor, testing every choice on its own (see
  `feedback-verify-each-toggle-not-just-parent`): build a Soldier Rogue 1, level it to 5, edit Cunning Action, level to
  6, and check that the edit is kept and Update works. Then place it in a fight and check that Auto Run uses Sneak
  Attack and Cunning Action.

### Phase 3: Weapon Mastery
- The engine runs all eight properties, for a wielder who has mastered the weapon. Graze, Push and Topple compile to
  existing riders. Sap, Slow and Vex add a condition that lasts until its next attack (or a speed cut). Cleave adds a
  follow-up attack once per turn, and Nick folds the light weapon's extra attack into the Attack action.
- The library weapons gain their SRD 5.2 mastery. The AI weighs a mastery's value when it picks a weapon.
- **Done when** each property has scenario tests, the golden logs don't move for creatures without Weapon Mastery, and
  a level 5 Fighter's batch numbers rise by a plausible amount.

### Phase 4: the Barbarian (Berserker) and the Monk (Warrior of the Open Hand)
- Rage uses and damage by level, Fast Movement, Frenzy, and Brutal Strike (reference until Phase 7). Martial Arts as an
  unarmed-strike weapon whose die scales and that uses the better of STR and DEX, plus focus points, Flurry of Blows,
  Unarmored Movement, Stunning Strike, Open Hand Technique and Wholeness of Body.

### Phase 5: spellcasting
- **5a, the 2024 spells.** A spell index generated from the cache and committed: for all 339 spells, the level,
  school, classes, casting time, concentration, a short description, and whether it's in the library. A test fails when
  the index is stale while the cache is present, the way the monster test does. Then the 2024 spell library pass (D12):
  diff the 82 authored spells against their 2024 text, copy what didn't change, and re-author what did. Then author the
  2024 staples the classes' suggestions need first.
- Choices for cantrips, prepared lists and the spellbook, with always-prepared lists and free casts. Suggested spells
  by class and level put the automated combat spells first.
- **5b.** Wizard (Evoker), Sorcerer (Draconic Sorcery, metamagic as reference until Phase 7), Cleric (Life Domain), Bard
  (College of Lore), Druid (Circle of the Land, plus Wild Shape through `transform`).
- **5c.** Warlock (Fiend Patron, invocations, pact slots), Paladin (Oath of Devotion, Lay on Hands; Paladin's Smite as
  reference until Phase 7), Ranger (Hunter; Favored Enemy's Hunter's Mark as reference until Phase 7).
- **Done when** every SRD class builds at every level from 1 to 20 with its suggestions. A test does this for 12 × 20
  builds, checks each against the schema, checks that no builder-made action carries a `note` rider (a `note` rider
  makes the AI stop using the action), and runs a short headless fight in which the AI picks only legal actions.

### Phase 6: species
- The nine SRD 5.2 species and their choices: size, speed, darkvision, and the traits that run. Those include
  Relentless Endurance, Adrenaline Rush, Breath Weapon (replacing one attack), Dwarven Resilience, Fey Ancestry,
  Gnomish Cunning, Brave, Fiendish Legacy's resistance, and the lineage spells. Luck, Resourceful and Large Form are
  reference until Phase 7.

### Phase 7: the engine gaps class features need most
- One small engine change per gap family, in the order the audit ranks them. Each gets tests and a golden-log check,
  and a feature switches from reference to `full` once its gap is closed. A likely order: a bonus-action spell on a hit
  (smites), marking (Hunter's Mark, Hex), a reaction that cuts damage, the critical range, d20 rerolls, trading attack
  dice for effects, initiative, Bardic Inspiration, healing bonuses, school-scoped spell damage. The builder works
  without any of them.

### Phase 8: homebrew and imported classes, subclasses, feats and species
- A class editor with the level table (features by level, table columns, choices). Each level's feature is made in the
  existing ability editor. "This number follows a column" writes a `scale` entry.
- A subclass editor that attaches to any class. For example, the Arcane Trickster on the 2024 Rogue, with a
  third-caster progression. Feat and species editors use the same parts.
- Saved per account like library actors (a new Prisma model), with JSON export and import.
- Open5e import: `/v2/classes/` gives a class or subclass skeleton with its hit die, saves, features by level (as
  reference text) and table columns. Its source document is kept, and a same-named SRD class is never merged with it.
  The DM maps features to runnable ones in the editor.
- **Done when** the party's Arcane Trickster, Zealot and Spiritbound Marksman can be authored and leveled from 1 to 20.

### Phase 9: multiclassing, adopting existing PCs, the party, the guide
- Add a second class at level up (D11), with prerequisites warned about.
- "Rebuild with the builder" for hand-built PCs (D10).
- Quick party: four suggested characters at level N in one go. The MVP asks for "at least four custom player
  characters", and this makes that a one-minute job.
- A guide in `docs/guides/` like the Zealot one, with screenshots taken by following it.
- A batch sanity check: four level-5 SRD builds against an SRD encounter of the right difficulty, 100 seeds. The check
  is a broad range, not a pass mark: a party that loses nearly every fight means a number is wrong.

## Tests

- Unit tests: slot tables (single class and multiclass, half casters rounded up), HP by both methods, point buy, a
  background's increases, feats over the cap, `scale` path resolution, `replaces`, and the `made` fingerprint rules.
- Catalog tests: every grant's library id exists, every `scale` path resolves, every column has 20 entries, and every
  class has a suggestion for every choice.
- Builds: every SRD class at every level (Phase 5), the same build giving the same actor, and an export/import round
  trip.
- Weapon Mastery scenarios, one per property (Phase 3).
- Component tests use RTL `cleanup()` and `localStorage.clear()` (see `component-test-cleanup`).

## Risks

- **Fingerprints and the DM's edits.** Edits made through the store must not quietly re-mint ids, or the builder loses
  track of its own records. Check `makeOwnCreature`, attach and duplicate before Phase 2.
- **Two editions in one library.** 2014 and 2024 Rage, Cure Wounds and Second Wind sit side by side. Ids, the Add
  panel's edition marks and search have to keep them apart, and nothing may merge two of them by name.
- **Weapon Mastery moves balance.** It's the biggest single change to how 2024 martials fight. Until Phase 3 they'll
  look weaker in batch runs than they are, and the builder's reports should say that masteries aren't simulated yet.
- **The audit is big.** About 24 classes and subclasses with roughly 300 feature entries, plus feats and species. It's
  reading and data entry, not engine work, but it's most of Phase 0.
- **Spells outside the library.** Most of the 339 SRD 5.2 spells won't be authored at first. A caster built with a spell
  that's reference only stands there with it unused. Suggestions prefer library spells, and the spell picker marks the
  rest.
- **Open5e's SRD 5.2 text may have errors**, as the monster CSV did. Overrides with reasons, never hand edits to
  generated files.
- **Multiclass spellcasting abilities.** The definition has one `spellcasting.ability`. A cleric/wizard's second-class
  spells must name their own ability in their DC and attack formulas. Phase 1 tests this.

## Out of scope

The 2014 classes (the catalog's `edition` leaves room for them), rests and the adventuring day, encumbrance and gold,
tools and tool proficiencies, magic item attunement limits, non-SRD content in the bundle, and character details for
play at the table (personality, backstory).

## Built so far

### Phase 0 (2026-10-05)

- **Data.** `npm run srd:2024:fetch` (`scripts/fetch-srd-2024.ts`) caches SRD 5.2 from Open5e V2 in the gitignored
  `srd_2024_cache.json`. `npm run srd:2024` (`scripts/build-srd-2024.ts` → `scripts/srd-2024/`) writes
  `src/data/srd/2024/generated/reference.json`: every class and subclass feature with its text and levels, every
  features-table column as 20 values (numbers where they're numbers, dice as text), feats, backgrounds, species,
  weapons with their mastery, and armor. `--check` and `tests/srd-2024-reference.test.ts` catch a stale file.
- **Source errors.** The Core Traits tables are read for saves, skills and weapons, because Open5e's `saving_throws`
  field is wrong for the Fighter and the Monk. Other fixes are overrides with a reason (`src/data/srd/2024/overrides.ts`),
  each checked against SRD_CC_v5.2.pdf: two misspelled names, a renamed feature, two missing levels, a mislabelled
  Wild Shape column, and Circle of the Land's Nature's Ward and Nature's Sanctuary, whose texts the source swaps.
  Open5e's `document__key` filter lets the 2014 weapons through, so the generator filters by document again.
- **The audit** is data, not a hand-written document: `src/data/srd/2024/coverage.ts` gives each feature a verdict
  (`full`, `partial`, `manual`, `builder`, `info`) and gap codes, and the generator renders
  `src/data/srd/2024/COVERAGE.md` (summary, gaps ranked by how many classes need them, then a table per class, feats,
  species and backgrounds). The generator fails on a feature without a verdict. It lives beside the data, not at the
  repo root as `CLASS_FEATURE_COVERAGE.md`.
- **Types.** `src/lib/character-builder/catalog.ts` (classes, subclasses, feats, backgrounds, species, choices, grants,
  zod schemas) and `build-record.ts` (`CharacterBuild`, `parseCharacterBuild`). Differences from the model above:
  numbers come from `Template` strings (`"{col:sneak-attack}"`, `"1d10+{level}"`, `"{mod:cha|min:1}"`) for both
  `scale` and pool sizes; a subclass is a `subclass` choice at its level, not a field on the level; grants can also
  adjust condition immunities; choices have stable ids, and the build stores each level's values by those ids.
- **Attribution.** `SRD_52_ATTRIBUTION`, verbatim from the PDF's Legal Information page (its curly quotes; the PDF's
  "https:/ /" is a kerning gap), is on the Docs credits page, in both READMEs and in the generated files, and
  `tests/srd-attribution.test.tsx` holds an independent copy.

### Phase 1 (2026-10-05)

- **The builder** (`src/lib/character-builder/`): `buildCharacter` (build.ts) walks the background, then each level in
  order, recording every choice as a `ChoiceSlot` (its value, whether it's still pending, a suggestion, and what's wrong
  with a bad value) and gathering grants. `withSuggestions` fills pending choices **one at a time**, rebuilding between
  each, so the second Ability Score Improvement knows what the first raised. `applyBuild` (apply.ts) writes the result
  and returns the change list; `quick.ts` has `startBuild`, `quickBuild`, `withLevelUp`, `withLevelDown`,
  `rebuildActor`, the standard array and point buy. `srd.ts` binds the SRD catalog and library.
- **Ownership** is finer than the plan said: fields one by one (`field:maxHp`), and saves, skills, senses and pools
  entry by entry (`skill:stealth`), so the DM's own skill or pool sits beside the builder's. A deleted builder feature
  stays deleted. Fingerprints ignore key order, `undefined`, the dice sugar and empty lists, so an export and import
  doesn't look like an edit.
- **Ids are deterministic** (`fighter-second-wind`, `feat-ability-score-improvement-l4`, `champion-superior-critical`),
  so the same build always gives the same actor, and a rebuild finds its own records.
- **Numbers use the class's current level**, not the level a feature was gained at (Second Wind is 1d10 + 5 at 5th).
- **The catalog**: `src/data/srd/2024/` has the Fighter (Champion), the Rogue (Thief), all 17 feats and the four
  backgrounds. Feature text comes from the reference data (`authoring.ts`: `runs`, `reference`, `informational`), so only
  what runs is written by hand. Feat choices at the feat levels, the Epic Boon at 19, the class's skills at 1st level and
  each later Weapon Mastery choice are made by the builder from the class's fields, not written per level. Columns the
  SRD table lacks (Action Surge and Indomitable uses) are the class's own.
- **Equipment** goes on once (`equipment.applied`), from the library: the 2014 weapons and armor are the same as the
  2024 ones apart from mastery. The library has no javelins.
- **Kept honest**: Steady Aim is `partial` so the AI won't use it (it can't check the rogue hasn't moved); Sneak Attack
  is `partial` (any weapon, not only finesse or ranged: new gap `weapon-property-scope`); the Epic Boons are `manual`
  apart from their +1. `tests/character-builder-srd-catalog.test.ts` fails if a catalog feature disagrees with its
  verdict, or a class's SRD feature has no grant or choice.
- The engine's `character` gained `build?: unknown`: it never reads it.

### Phase 2 (2026-10-05)

- **Create Token › Character**: name, class, level and background, then **Quick build** (a party character with every
  choice suggested; its token is named after it, not "Vex 1") or **Step through the choices…**, which opens the
  builder window with every choice already suggested.
- **The builder window** (`src/components/builder/CharacterBuilder.tsx`): basics, base scores with the standard array,
  point buy or by hand (checked, with the final score under each), every choice grouped by level with a "Suggest" for
  each open one and "Suggest the rest", hit points by average or typed rolls, and a summary. On a built character it's
  "Open in the builder…", and shows what applying would change, with **Use the build's instead** on each thing the DM
  changed. The level is a dropdown: a typed number box snapped to 1 when cleared.
- **The level-up window** (`LevelUpWindow.tsx`): the next level's choices filled in, a hit die box when HP is rolled,
  and the change list ("Sneak Attack: 2d6 → 3d6", "DEX 17 → 19", "Cunning Action (house rule): you changed it, so it
  stays"). Both windows open beside the sheet.
- **The sheet**: Stats › Level & CR is **Class & level** for a built character ("Rogue 5 (Thief) · Soldier") with
  Level up…, Level down (applied at once; undo brings it back) and Open in the builder…; the ⋯ menu has Level up… and
  Open in the character builder…. Builder-made features carry a "from Rogue" / "from Thief" / "from feat" chip in the
  Abilities list.
- **The store**: `createCharacter` and `rebuildCharacter` (one undo step; tokens at full HP or a full pool follow the
  new maximum, others keep theirs, capped). D6 is in: a typed score moves the build's base score, a typed max HP
  becomes `hp.adjust`. Import checks the build and drops an invalid one with a log message. `useBuilderUiStore` says
  which builder window is open; `BuilderHost` mounts it.
- **Browser check** (the test account's Hallway Ambush, nothing saved): a Soldier Rogue built at 1st level and leveled
  to 5 through the dialog, its Cunning Action renamed, leveled to 6 (the rename kept and said so), then restored with
  Use the build's instead from the builder, then Auto Run, where it moved and shot with its shortbow.

### Phase 3 (2026-10-05)

- **The engine** (`src/engine/mastery.ts`, `combat.ts`): a weapon has `mastery` and `baseWeapon` (its kind: a +1
  longsword is a longsword); a creature masters kinds through a feature effect `{ kind: "weapon-mastery", weapons }`.
  `weaponToAction` stamps `mastery` on the attack and adds riders: Graze (on-miss damage of the ability modifier),
  Push (10 ft, Large or smaller: push riders gained `maxSize`), Topple (Con save DC 8 + mod + proficiency or prone),
  Sap, Slow and Vex (keyed conditions, so two Slow weapons are still 10 ft). New pieces: a rider duration
  `until-source-turn` (start or end of the attacker's next turn), a condition's `nextAttack` (Sap: the bearer's next
  roll at disadvantage; Vex: the attacker's next roll against the bearer at advantage), used up by that roll, and
  `modifiers.speedPenaltyFt`. Cleave is a once-per-turn follow-up in `resolveAttackCore` against the creature with the
  fewest hit points left within 5 ft of the first and in reach, without a positive ability modifier.
- **Nick differs from the plan**: the AI doesn't take free actions, so instead of a free off-hand attack, a creature
  with a Nick light weapon and another light weapon gets a variant of each Attack routine with one more swing of the
  Nick weapon ("Attack (Nick)"), which the AI picks for its damage. Simplified: the first attack needn't be light.
- **Found**: the AI never takes free activations, so Action Surge and Reckless Attack only ever run by hand in Play. They
  stay `full` (they run) with a new gap `ai-free-actions` and a note. That's a Phase 7 item.
- **Library and sheet**: the library weapons carry their SRD 5.2 mastery and kind (checked against the SRD table);
  the weapon editor's More options has Mastery and Kind of weapon, with a hint saying whether this creature has
  mastered it; the Abilities list shows "graze mastery"; the weapon's statblock says what its mastery does.
- **The builder**: the Weapon Mastery feature is now `full` and carries the `weapon-mastery` effect with the kinds
  chosen; mastery suggestions take the weapons the character starts with first.
- **Checked**: a scenario test per property with scripted dice; the golden logs didn't move; a built Fighter 5 wins at
  least as often and in fewer rounds with its masteries than without (its total damage dealt goes *down*, because the
  fights are shorter: rounds, not damage, is the measure). Browser: a Quick-built Fighter's list shows its masteries,
  and its Greatsword's editor has Graze and the mastered hint.
- `tests/items-play.test.ts`'s batch tests got a 20 s timeout: about 1.5 s alone, they crossed the 5 s default under
  full-suite load (with or without this phase's changes).

### Phase 4 (2026-10-05)

- **The Barbarian (Path of the Berserker)**: Rage by the table (uses and damage, on any Strength attack), Unarmored
  Defense, Danger Sense, Reckless Attack, Extra Attack, Fast Movement, Primal Champion, and Intimidating Presence (a
  30-ft area against enemies only, once). **Frenzy** uses a new engine piece, `whileCondition` on a feature effect: its
  extra d6s (as many as Rage's bonus) apply to the first Strength hit each turn with advantage *while the creature has
  the `rage-active` condition*, instead of replacing Rage. Retaliation's verdict became `manual`.
- **The Monk (Warrior of the Open Hand)**: the builder now owns **weapons** as well as features (a grant's `weapon`;
  `weapon.` scale paths; kept, edited and removed by the same rules, as `weapon:<id>` in `made`). The Unarmed Strike
  (`monk-martial-arts`) has the Martial Arts die, the better of Strength and Dexterity, a bonus-action copy and force
  damage from 6th level (a column). Flurry of Blows is a bonus multiattack of that copy for a focus point (three strikes
  from 10th); Patient Defense and Step of the Wind are bonus utilities; Stunning Strike (5th) is an optional on-hit
  rider added to the Unarmed Strike by a grant's new `onHitOf`; Open Hand Technique is `apply-condition-on-hit` (Topple)
  scoped to the Unarmed Strike's bonus copy; Wholeness of Body, Disciplined Survivor, Superior Defense, Body and Mind.
- **Found**: the AI spends focus on Stunning Strike only under Controller tactics (a skirmisher's control weight is too
  low to beat the point's cost, even with a liberal stance): new gap `ai-control-value`. An optional on-hit upgrade's
  variant is named after its pool now ("Unarmed Strike (1 focus point)"), not "(spend charge)". The weapon normalizer
  dropped the new rider fields (`until-source-turn` became 1 round): it keeps them now.
- Stunning Strike's level is an override (the source lists 3 and 5; the PDF says 5).

### Phase 5a (2026-10-05)

- **The spell index** (`src/data/srd/2024/generated/spells.json`, from `npm run srd:2024`): all 339 SRD 5.2 spells with
  their level, school, class lists, casting time, range, components, duration, concentration, save, damage, area and
  text. Checked against the PDF: Open5e rounds long casting times to "1minute"/"1hour" (15 spells), gives Plant Growth
  "1hour", and drops Chain Lightning's and Dissonant Whispers' higher-level text, so those are `SPELL_OVERRIDES` with
  reasons. The PDF disagrees with itself on Phantasmal Force, Mind Spike (missing from class-list tables their own
  entries name) and Flaming Sphere's school; the index keeps each spell's own entry, as Open5e does. Whether a spell is
  in the library isn't in the index: it's worked out at runtime (`spellBasisOf`).
- **The 2024 library** (`SRD_2024_SPELLS`, `srd:spell:<slug>-2024`, source `srd-2024`), all 339: 65 copied from the
  2014 library (`SAME_AS_2014`, each checked against the 2024 text), 14 re-authored where 2024 changed them (Cure Wounds
  2d8, Healing Word 2d4, Mass Cure Wounds 5d8 + mod, Inflict Wounds a Con save, Poison Spray an attack, Chill Touch a
  touch for 1d10, Vicious Mockery 1d6 and disadvantage on the next attack (the Sap condition), Acid Splash a 5-ft
  sphere, Produce Flame's 60-ft hurl, Spiritual Weapon concentration, Ice Storm 2d10, Stoneskin by touch against all
  B/P/S, Flame Strike 5d6 + 5d6, Circle of Death 8d8), 6 new staples (Sorcerous Burst, Starry Wisp, Chromatic Orb,
  Dissonant Whispers, Mass Healing Word, Heal), and the rest reference only with their SRD text. A copy can carry one
  `COPY_FIXES` change: Banishment 30 ft and Blindness/Deafness 120 ft (changed in 2024); Cloudkill 120 ft and Sunburst
  on a point 150 ft away (the 2014 copies were wrong; the 2014 library itself is left alone so monsters' golden logs
  don't move); Moonbeam, Cloudkill, Insect Plague and Spirit Guardians strike on entering or ending a turn there, and
  the first three as they appear. Counterspell and Planar Binding aren't copied: the 2024 Counterspell is a Con save by
  the caster (new gap `counterspell-save`), and Planar Binding takes an hour. Toll the Dead isn't in SRD 5.2. A
  "partial" spell runs (its action is `full`), and its description says what isn't simulated.
- **The audit**: COVERAGE.md has a Spells section (how many of each class's list run, by level; every simulated spell
  with where it came from; reference-only spells waiting on a gap: smites, marks, `weapon-cantrip`, Counterspell). The
  generator fails if a spell is both copied and authored, or a 2014 library spell is neither copied nor explained.
- **Differs from the plan**: a spell choice is a list of ids, one choice per kind (`cantrips`, `prepared`,
  `spellbook`), not one object, so it reuses the list controls. Always-prepared spells and free casts are **grants**
  (`FeatureGrant.spells`, `freeCasts`), not progression fields, so a subclass, a feat or a species gives them the same
  way. A choice's options are the class list up to the highest level that class alone can cast (`maxSpellLevel`); a
  Wizard prepares from its book. The builder walks a build twice when a grant makes a spell always prepared, so an
  earlier pick of it (Bless at 1st, before Life Domain's 3rd) is asked again, and `withSuggestions` retries a slot a
  later choice reopened. The level-up window shows an earlier choice it re-made.
- **On the actor**: spells are builder-owned like features and weapons (`spell:<id>` in `made`; one ownership helper
  now serves weapons and spells), with ids `<class>-<spell>` (`wizard-fireball`, `feat-magic-initiate-bless`). They're
  cast with the class's ability (formulas say "spellcasting"); a second class's or a feat's spells name their own
  ability. A free cast is a copy (`… (free)`) spending its own pool, labelled "Bless without a slot"; the slotted copy
  is left off when the character has no slot for it (a Fighter's Magic Initiate spell).
- **Suggestions** put spells that run first, then the highest level the choice allows, then the class's `suggested`
  cantrips and spells (then every class's), then the name. A pick of abilities (Magic Initiate's) suggests the best
  score.
- **Magic Initiate** now gives its two cantrips and its 1st-level spell (always prepared, once free), from the list the
  background fixes (Acolyte: Cleric; Sage: Wizard) or the player picks.
- **The builder window** has a spell picker: grouped by level, filtered when long, reference-only spells dashed and
  marked "ref".

### Phase 5b (2026-10-05)

- **Five casters**: the Wizard (Evoker), Sorcerer (Draconic Sorcery), Cleric (Life Domain), Bard (College of Lore) and
  Druid (Circle of the Land), each with its table's cantrips and prepared spells, suggestions (a priority list of
  spells that run, read level by level), starting packages and every feature at its level.
- **What runs**: Innate Sorcery (+1 save DC and advantage on spell attacks for 10 rounds, twice; the engine's
  `resolveSaveDc` now counts the caster's active conditions), Draconic Resilience (AC 10 + Dex + Cha, +1 HP a level),
  Channel Divinity (Divine Spark as a heal and a harm, a d8 more at 7, 13, 18; Turn Undead as a 30-ft Wisdom save whose
  conditions only land on undead), Sear Undead (a damage rider added to Turn Undead), Divine Strike and Primal Strike
  (once-a-turn damage, 2d8 later), Cutting Words (two reactions the engine already runs: disadvantage on an attack
  against an ally; for the bard itself, a would-be-hit AC bump of the die's average), Land's Aid (spends a Wild Shape
  use), Nature's Ward, Elemental Affinity's resistance. Metamagic is a pick of reference options (two at 2nd, 10th and
  17th: Open5e lists only 2 and 10, an override with the PDF adds 17; Dragon Companion moves from 19 to 18).
- **Spell machinery** added for these: a spell choice can filter by school (Evocation Savant), level range (Magical
  Discoveries includes cantrips), casting with an action (Spell Mastery), come from the spellbook (Spell Mastery,
  Signature Spells) or from spells the character holds (Natural Recovery: a circle spell), and give at-will casts (a
  copy without a cost). A grant can add spell lists to the class's prepared spells (Magical Secrets; not cantrips), take
  effect at a later class level (`atLevel`: a land's 5th-, 7th- and 9th-level spells and its Nature's Ward resistance,
  chosen at 3rd), and add riders to an earlier grant's feature action (`onHitOf.action`, dice may be templates). A pick
  made again at a later level can't repeat an option (Metamagic). A spell choice prefers the suggestions of the class
  whose list it chooses from (Magic Initiate's Cleric spells read the Cleric's).
- **Differs from the plan**: **Wild Shape is reference** (its uses are counted, Land's Aid spends them). Shifting needs
  beast forms loaded into the encounter (the SRD beasts load asynchronously), temporary hit points on shifting and AI
  choices of form: moved to Phase 7 (gap `wild-shape`). Protector and Warden (armor and weapon training) are
  informational. Divine Order and Primal Order picks give an extra cantrip.
- **Found**: the builder gave a feature's granted-action riders no ids, so an action with two condition riders (Turn
  Undead) applied one: they get stable ids now. Quick build of a 20th-level wizard rebuilds ~70 times; spell facts are
  cached per library and full choices skip ranking (≈270 ms, from ≈600).
- **Checked**: every class at every level builds with its suggestions, without warnings, open choices or a `note`
  rider on any feature or spell; every spell id the catalog names exists; in AI-run fights each caster casts its
  spells (Divine Spark, Cutting Words, Land's Aid and Innate Sorcery included).

### Phase 5c (2026-10-05)

- **The last three classes**: the Warlock (Fiend Patron), Paladin (Oath of Devotion) and Ranger (Hunter). All twelve
  SRD 5.2 classes are in the catalog.
- **Warlock**: pact slots (all of the table's slot level; prepared spells up to it), Eldritch Invocations as picks at
  each level the table's count rises, each with its prerequisite read from its SRD text (a warlock level, another
  invocation) and checked. Agonizing Blast, Repelling Blast and Eldritch Spear change Eldritch Blast (Charisma on its
  damage, a 10-ft push on a hit, 300 ft); Armor of Shadows is Mage Armor at will; Pact of the Blade is a builder-owned
  longsword using Charisma (Thirsting and Devouring Blade attack with it 2 and 3 times, Lifedrinker adds 1d6 necrotic);
  Pact of the Tome picks three cantrips from any list; Lessons of the First Ones picks an origin feat (repeatable at a
  later level). Mystic Arcanum is a 6th- to 9th-level spell cast once without a slot. Fiend spells always prepared,
  Fiendish Resilience a resistance; Dark One's Blessing, Dark One's Own Luck and Hurl Through Hell are reference.
- **Paladin**: half caster from 1st level, Lay On Hands' pool (5 × level; reference), Paladin's Smite (Divine Smite
  always prepared, once free; reference until smites run), Fighting Style or **Blessed Warrior** (two Cleric cantrips,
  Charisma), Extra Attack, Aura of Protection (10 ft, 30 from 18th), Abjure Foes, Radiant Strikes, Sacred Weapon (a free
  activation: the AI doesn't take those yet, gap `ai-free-actions`), Oath of Devotion spells.
- **Ranger**: Favored Enemy (Hunter's Mark always prepared with its free casts by the table; the mark is reference until
  Phase 7), Deft Explorer, Fighting Style or **Druidic Warrior**, Roving, Tireless (temporary hit points), Feral Senses,
  Colossus Slayer; Horde Breaker, Defensive Tactics and the rest reference.
- **Builder pieces**: a pick option can have a prerequisite (a class level, earlier options) and be repeatable at a later
  level (not twice in one pick); a class can give a preferred order for a pick (`suggested.picks`); a grant can change a
  spell the character has (`spellChanges`: an ability on its damage, a range, riders) on every copy; a feat choice's
  `extraOptions` work now (an option in place of a feat, with its own choices). A free cast's pool is named after its
  spell (`magic-missile-free-casts`), so the sheet reads "Magic missile free casts".
- **Phase 5's done-when** is a test: every class leveled 1 → 20 through level-ups, each level's actor checked against
  `creatureDefinitionSchema`, with a short AI fight at every fourth level and at 20th that may raise no automation
  warning (an illegal pick); plus every class quick-built at every level without warnings, open choices or a `note`
  rider on a feature or spell.
- **Browser check** (the test account's Sandbox, nothing saved): a 5th-level Sage wizard stepped through the builder
  (the spell groups by level, the filter, "ref" marks, the count going to "1 still to choose" when a prepared spell is
  unchecked), created, its spells on the sheet; leveled to 6 (a spellbook choice of 2 and a prepared choice of 1, filled
  in; "Gains Hypnotic Pattern", the 3rd-level slots 2 → 3); a Quick-built 2nd-level cleric leveled to 3, where the window
  says an earlier choice is made again (Bless and Cure Wounds became Life Domain's); Auto Run, where the cleric cast
  Bless and the wizard Fireball.

### Phase 6 (2026-10-05)

- **The nine species** (`src/data/srd/2024/species.ts`): Dragonborn, Dwarf, Elf, Gnome, Goliath, Halfling, Human, Orc
  and Tiefling, each with its size (a choice for the human and the tiefling), speed, darkvision and every trait with its
  SRD text. The builder walks the species after the background and before the class levels, so a class's skill choice
  knows what the species gave; traits come at their character level.
- **What runs**: Breath Weapon (a cone and a line action, DC 8 + Con + proficiency, 1d10 of the ancestor's type growing
  at 5th, 11th and 17th, proficiency-bonus uses; partial: it's its own action, not one of the Attack action's attacks)
  and the ancestor's resistance; Dwarven Resilience and Dwarven Toughness; Fey Ancestry, Gnomish Cunning, Brave;
  Relentless Endurance (once); Adrenaline Rush's bonus-action Dash (not its temporary hit points); Cloud's Jaunt; Storm's
  Thunder (a reaction when hit, 1d8 thunder without a roll: the engine's reaction attacks can now auto-hit); the
  tiefling's legacy resistance. The elven lineages, gnomish lineages and fiendish legacies give their cantrips and their
  3rd- and 5th-level spells (always prepared, once free), cast with the ability the player picks for them (a species'
  `spellcastingAbilityChoice`); a high elf's cantrip is any Wizard cantrip; a wood elf is faster, a drow sees 120 ft.
  Keen Senses and Skillful are skill choices; Versatile is an origin feat choice.
- **Reference**: Draconic Flight, Large Form, Luck, Resourceful, Halfling Nimbleness, and Fire's Burn, Frost's Chill,
  Hill's Tumble and Stone's Endurance (Phase 7's `smite`, `damage-reaction`, `size-change`, `d20-reroll` families).
- **The UI**: a Species select (None, or one of the nine) on Create Token › Character and in the builder window, with a
  Size select when the species has two sizes.
- **Checked**: every species, its traits covered and marked as the audit says; every species at 1st, 3rd, 5th, 11th and
  20th level built with its suggestions; Relentless Endurance and Storm's Thunder in the engine; the UI's species and size.

### Phase 7 (2026-10-05, in steps)

Gap families closed one engine change at a time, each committed on its own with its tests and, where fights change on
purpose, regenerated golden logs.

- **7a, the AI's free actions** (`ai-free-actions`, now gone): the AI takes free activations. One that boosts attacks
  (Reckless Attack, Sacred Weapon) is taken when the turn's plan swings with an attack it covers (Reckless Attack: a
  Strength melee attack), and one that exposes the creature (Reckless Attack's +5 against it) only while it has half
  its hit points; a purely defensive one (Superior Defense) once it's below half with an enemy within 10 ft; costs are
  weighed by the resource stance. Action Surge (a free activation whose feature gives back the action) is taken after
  the turn's action when there's still something to attack, and the turn is played again; a conservative stance waits
  for a bloodied target. Golden logs: only the sample fight moved (its fighter has Action Surge), regenerated; a lair
  test's goblins got sturdier so the fighter can't drop the lair's goblin before initiative 20.
- **7b, smites** (`smite`, now only Smite of Protection and Hurl Through Hell): an **on-hit option** (`OnHitOption`:
  a spell's `onHit`, or a feature effect `on-hit-option`) compiles into a variant of each attack it can follow
  ("Longsword (Divine Smite)", "…(Divine Smite, level 2)"), its upgrade as on-hit riders that land together (`group`),
  the first carrying the cost (paid only on a hit), the bonus action for a smite spell (`economy: "bonus"`) and the once
  a turn (`onceKey`, shared across weapons). A slot-spending option gets a variant per slot level the creature has, its
  first damage growing by the upcast dice; a free cast's copy spends its own pool. The AI weighs a variant's damage
  against its cost like any attack. Authored: Divine Smite (2d8, +1d8 against fiends and undead), Searing Smite (the
  first 1d6), Shining Smite (2d6, attacks against it +5 while concentrating), Ensnaring Strike (Strength save or
  restrained while concentrating), Eldritch Smite (a pact slot on a pact weapon hit: 1d8 and 1d8 a slot level, prone),
  a goliath's Fire's Burn, Frost's Chill and Hill's Tumble. Paladin's Smite is `full`.
- **Found and fixed**: an optional on-hit upgrade (a weapon's charge, Stunning Strike's focus point) was paid twice, once
  when the attack was made and again when its rider landed. The attack now carries `costPaidOnHit` and only the rider
  pays. The golden logs didn't move.
- **7c, marks** (`mark`, now gone): a **mark** is a buff that goes on a foe (`BuffActionDefinition.mark`): its
  condition's `incoming-hit-damage` counts only its caster's hits (`onlyFromSource`) and stays on. Each mark compiles a
  `Move …` action (`<id>:move-mark`: a bonus action, no slot, not a spell) usable once the marked creature has dropped
  while the caster still concentrates; it moves the same condition, with the time it had left. The AI weighs a mark
  like a bonus-action attack (twice its damage on the hits its attacks can expect over three rounds, less a cast's
  cost), casts it on the turn's target before attack rolls (after the move when the move brings the target into
  sight; never in place of a spell like Fireball), moves it free when its creature drops, and counts its own marks in
  each attack's expected damage. Authored: Hunter's Mark (1d6 force) and Hex (1d6 necrotic; its disadvantage on one
  ability's checks isn't simulated), Hex now suggested first for warlocks. The ranger's mark features change the spell
  through the builder (`SpellChange.mark`): Foe Slayer's d10, Superior Hunter's Prey's spill (`spillWithinFt`: once on
  each of its turns, the same damage to the foe with the fewest hit points within 30 ft of the one hit), Relentless
  Hunter's concentration that damage can't break (`keptOnDamage`); Precise Hunter is advantage against its own mark (a
  new effect condition, `targetMarked`). Favored Enemy and all four are `full`. The ability editor has an "A mark on a
  foe" tick on a buff. The golden logs didn't move.
- **7d, reactions to damage** (`damage-reaction`, now gone): a new reaction trigger, `would-take-damage` (optionally
  attack rolls only, or only some damage types), opened once damage is rolled and its resistances counted, before it
  lands, on both damage paths (hits and areas). An activation's `damageCut` halves it (Uncanny Dodge), takes off a roll
  (Deflect Attacks: 1d10 + Dexterity + monk level; Stone's Endurance: 1d12 + Constitution, a use) or gives resistance
  to its types until the end of the turn (Superior Hunter's Defense). The AI takes one for a cut of 5 or more, or one
  that keeps it standing. Deflect Energy is a second reaction for the other ten damage types. Play asks "about to take
  N damage" with what each option would leave; the ability editor has the trigger and a "What it does to the damage"
  control. Damage a hit's riders deal (a smite) lands apart and isn't cut. Deflect Attacks' Focus Point redirect is
  left (`reaction-attack`). The golden logs didn't move.
- **Found and fixed** (in the new editor control, by its test): the dice box snapped back to "1d10" when cleared.
- **7e, the critical range** (`crit-range`, now gone): a feature effect, `critical-range` (`minimum`, scoped like any
  attack effect), makes a natural roll from `minimum` up a critical hit, and so a hit; the lowest of several wins, and
  the attack log names what lowered it. The attack preview's critical (and hit) chance follows it; the AI's estimates
  leave critical hits out, as before. Improved Critical (19) and Superior Critical (18, replacing it) are `full`, on
  melee and ranged attacks. The ability editor has a "Critical hits on a lower roll" card. The golden logs didn't move.
- **7f, initiative** (`initiative`, now only Alert's swap): a feature effect, `initiative` (`advantage`, a `bonus`
  formula), counted wherever initiative is rolled: the start of the fight and a creature joining it (a summon, a token
  added mid-fight). The log names the features. Feral Instinct is `full`; Remarkable Athlete runs its advantage (its
  move after a critical hit is `free-move`); Alert adds the proficiency bonus (its swap with an ally doesn't run). The
  ability editor has an "Initiative" card. The golden logs didn't move.
- **7g, changing a failed d20** (`d20-reroll`, now only another creature's roll: Countercharm, Boon of Fate): a feature
  effect, `d20-change`, on a failed save or a missed attack roll (or only a natural 1): reroll and keep the new roll,
  with a bonus; add a die; make the d20 a 20; or hit instead. It may spend a pool, or be once until the creature's next
  turn. Changes come one at a time while the roll still fails, each feature once a roll, logged as `RollChanged`; a
  person playing the creature is asked (a new Play question, `d20-change`), the AI takes the free ones that could help,
  then the likeliest, spending a resource on a save, or on a miss unless it's conservative. A DM's ruling on a roll
  isn't changed. Runs: Luck, Indomitable (+ fighter level), Disciplined Survivor (a Focus Point), Stroke of Luck (a 20,
  so a critical hit), Dark One's Own Luck (1d10), Boon of Combat Prowess, and Heroic Inspiration (a one-use pool:
  Resourceful's, and Heroic Warrior's, which comes back at the start of each turn without it). The ability editor has a
  "Change a failed roll" card. The golden logs didn't move.
- **7h, spells in scope** (`spell-scope`, now gone; Improved Blessed Strikes' temporary hit points are the new
  `damage-vitality`): a compiled spell carries its school and the class it's cast as (`SpellDefinition.spellClass`: the
  builder sets the class for a class's or subclass's spell, and a feat's single list for Magic Initiate's). Effect
  scopes gain `spellSchools`, `spellClasses` and `cantripsOnly` (Innate Sorcery is now Sorcerer spells only). Three
  effects shape a creature's spells as they compile: `spell-damage-ability` (an ability on one damage roll: Potent
  Spellcasting, Empowered Evocation, Elemental Affinity; not on spells of several beams, where it'd land on each),
  `spell-half-on-miss` (Potent Cantrip: an attack's `halfDamageOnMiss`, a save's half on a success) and `spell-range`
  (Improved Elemental Fury's 300 ft, an `atLevel` grant in the Potent Spellcasting option). Editor cards for each. The
  golden logs didn't move.
- **7i, a move with something else** (`free-move`, now only Fleet Step and Boon of Dimensional Travel): a feature
  effect, `free-move`, adds half the creature's speed (or some feet) to its turn's movement when it spends a use of a
  pool (Rage: Instinctive Pounce; Second Wind: Tactical Shift) or scores a critical hit on its own turn (Remarkable
  Athlete). Provoking no opportunity attacks is approximated as none for the rest of the turn, and said so. The AI
  spends the extra budget like any other. An editor card. The golden logs didn't move.
- **7j, Bardic Inspiration** (`ally-die`, now only Cutting Words' rolled die and damage): Bardic Inspiration is a
  bonus-action buff on another creature within 60 ft, its condition a `d20-change` that adds the bard's die (a d6, the
  table's die as it grows) to a failed save or missed attack roll it could turn, `usedUp` once rolled. Peerless Skill
  adds the die to the bard's own miss, the use given back if it still misses (`refundOnFailure`). The AI gives it to
  an ally without one, as any buff.
- **Found and fixed**: the AI's single-target buff ignored `targeting.notSelf` and picked the caster, so the cast failed
  quietly. The golden logs didn't move.
- **7k, healing by any amount** (`pool-heal`, now gone): a healing action `fromPool` heals what the target is missing
  from what's left in a pool, spending it point for point, and can't be used with the pool empty (Lay on Hands, a bonus
  action; ending Poisoned with 5 points is `condition-removal`). One `divided` shares a total among the creatures
  chosen, the most hurt first, optionally none past half and only the bloodied (Preserve Life, five times the cleric
  level for a Channel Divinity). The AI weighs Lay on Hands like any heal for what it would restore, and Preserve Life
  for its shares, only when they're worth a heal. The ability editor's Healing section chooses a roll, a pool, or a
  total shared out. The golden logs didn't move.
- **7l, bigger healing** (`healing-bonus`, now gone): a feature effect, `healing-bonus`: a slot-cast healing spell
  restores 2 + the slot's level more to each creature (Disciple of Life; not a free cast), heals the healer as much when
  it heals someone else (Blessed Healer), and healing dice of spells and Channel Divinity give their highest (Supreme
  Healing). The AI's healing estimate counts them. An editor card. The golden logs didn't move.
- **7m, weapon properties and damage dice** (`weapon-property-scope` and `damage-dice`, both gone): a weapon's attack
  carries its properties (`weaponProperties`; finesse for a finesse weapon), and effect scopes can ask for some
  (`"ranged"` takes any ranged weapon) or a weapon held in two hands (`twoHanded`). A feature effect, `damage-dice`,
  keeps a weapon's damage dice above a minimum (Great Weapon Fighting: 1s and 2s as 3s, the weapon's own dice) or rolls
  them twice for the higher (Savage Attacker, once a turn). Sneak Attack now needs a finesse or ranged weapon, and an
  ally's help counts only without disadvantage. The AI's estimates leave the dice changes out. Editor: a "Better damage
  dice" card, and weapon properties / two hands under any attack effect's More options.
- **Found and fixed**: a weapon with no `grip` of its own (every builder weapon) compiled as one-handed even with the
  Two-Handed property; its properties now say. Two older tests scripted their dice without the Soldier's Savage
  Attacker and were given its second roll. The golden logs didn't move.
- **7n, last-ditch defenses** (`deny-advantage`, `concentration-saves`, `roll-floor`, `relentless`, `death-saves`,
  `gated-regen`, all gone): new effects `no-advantage-against` (Elusive, unless incapacitated), `save-floor` (Indomitable
  Might), `death-saves` (Defy Death: advantage, 18–20 as 20); `save-advantage` can be for concentration saves only
  (Eldritch Mind); `hp-regen` can work only while bloodied (Heroic Rally, 5 + Constitution); `survive-lethal` can need a
  condition held, step its DC each time it's tried this fight, and leave more than 1 hit point (Relentless Rage: DC 10,
  +5, twice the level, while raging). Editor cards and toggles for each. The golden logs didn't move.
- **7o, the next attack roll** (`next-attack`, now gone): the "next attack roll" conditions weapon mastery's Sap and Vex
  use now come from features too. `apply-condition-on-hit` can fire on a miss (`onMiss`) and give such a condition
  (Studied Attacks: advantage on the fighter's next attack against that creature before the end of its next turn). An
  activation can give one to its user (Steady Aim: its next attack this turn), can be `stillOnly` (before it moves;
  the AI takes Steady Aim only with an attack in reach from where it stands), and a duration of 0 rounds ends with the
  turn. A rider's save can give a lesser condition `instead` on a success (Stunning Strike: speed halved and advantage
  on the monk's next attack against it; the rules say anyone's). Editor: on a miss and the next attack roll on the
  condition card, and both activation options; the rider's `instead` is JSON-only.
- **Found and fixed**: Steady Aim's "speed 0" was a movement multiplier of 0, which the engine ignores (it now uses 999,
  as other stops do); the weapon normalizer was taught the new rider-save field. The golden logs didn't move.
- **7p, conditions that come and go** (`on-kill`, `ends-on-damage`, `conditional-immunity`, all gone; a turned undead
  fleeing is the new `flee`): a condition rider can end when its bearer takes damage (`endsOnDamage`), though not from
  the action that gave it (Turn Undead and Sear Undead's radiant damage; Abjure Foes). A feature effect,
  `condition-immunity`, works while a condition is held (Mindless Rage) and passes to allies on an aura (Aura of Courage,
  Aura of Devotion); a condition it's now immune to ends when the immunity starts or at the start of its turn (the rules:
  it has no effect while it's there). A feature effect, `on-kill`, gives temporary hit points when the creature drops an
  enemy, or one drops near it (Dark One's Blessing). Editor: both cards, and "ends early if it takes damage" on a
  condition effect. The golden logs didn't move.
- **7q, the 2024 Counterspell** (`counterspell-save`, now gone): the counter trigger can have the caster make a save
  against the counterer's spell save DC instead (`casterSave`), stopping the spell whatever its level and the counter's
  slot; a spell stopped that way gets its slot back. The AI weighs it by the chance the save fails (squared when the
  caster has advantage against spells), and Play shows "CON save DC 15: 70% it fails". The 2024 Counterspell is authored
  (it was reference only), so builders now suggest it; the editor has the option on the counter trigger. The golden
  logs didn't move.
- **Browser check** (after 7q): with a 5th-level human rogue and paladin built in the sandbox, Play asked about Uncanny
  Dodge ("Vex is about to take 3 damage from Goblin 2. Cut it before it lands? Uncanny Dodge: 1 taken instead of 3")
  and about Heroic Inspiration on a miss ("Vex missed with Shortbow: 13 against AC 17. Change the roll? Reroll"). The
  editor opened Uncanny Dodge, Sneak Attack, Resourceful (the d20-change card), Steady Aim, Lay On Hands (nested, healing
  from a pool) and the smites. **Found and fixed**: opening any smite spell (Divine Smite, Searing Smite…) crashed the
  editor, because its warnings read a spell's on-hit option as a weapon's rider list; the option's slot is now checked like
  the spell's own action. The pool picker read "lay on hand (25)": the pool's name now stays whole.
- **7r, Cunning Strike** (`dice-trade`, now only Brutal Strike and two effects at once): an on-hit option can be paid in
  dice of a damage bonus (`tradesDice`, naming the feature: the builder's `rogue-sneak-attack`). It compiles into a
  variant of each attack that bonus adds to ("Shortsword (Cunning Strike: Trip)"), whose riders and move land only with
  the bonus's damage, which gives up the dice before rolling (`onHitTerms`; logged "gives up 1d6 of Sneak Attack for
  Cunning Strike: Trip"). An on-hit option can give a move after the hit (`move`: Withdraw). A condition rider can be
  capped by size (`maxSize`: Trip, Large or smaller, no save for a bigger one), and a condition can last until the end
  of its bearer's next turn (`until-end-of-next-turn`: Obscure). Authored: Poison, Trip, Withdraw; Devious Strikes'
  Knock Out (unconscious, ending on damage) and Obscure. Daze waits for `action-limits`; Improved Cunning Strike (two at
  once) stays reference. The AI weighs a trade only when the bonus looks set to land (read from the same rules as the hit,
  `damageBonusExpected`), as the condition's control value and the move's worth (a skirmisher with a foe beside it) less
  the dice's average at the chance to hit; one swing of a routine plans it, and the swing-time choice moves it onto the
  first swing that can pay. The ability editor has a card for on-hit options at last (they showed a bare kind before): the
  name, the attacks it follows, its effects as a weapon's cards, a move, and its cost (a use and the bonus action, or
  dice). The golden logs didn't move.
- **Found and fixed**: the AI's bonus-action activation (Steady Aim, Rage) didn't check the bonus action was still free,
  so a turn played again with it spent (after Action Surge) threw.
- **7s, Brutal Strike** (`dice-trade`, now only Improved Cunning Strike's two at once): an on-hit option can be paid
  with the attack roll's advantage (`forgoesAdvantage`, while a condition is on: Reckless Attack's), on attacks of some
  abilities (`abilities`: Strength), once a turn shared across options (`onceKey`); a roll with disadvantage can't take
  it, and choosing it spends the once, hit or miss. A rider's "same as the attack" damage now takes the attack's type
  (it was always slashing). Blows: Hamstring (speed −15 ft, one at a time), Forceful (pushed 15 ft, then half its speed
  without opportunity attacks, not held to a straight line), Staggering (disadvantage on its next save, `nextSave`, used
  up by it; no opportunity attacks, `deniesOpportunityAttacks`), Sundering (+5 to the next attack roll against it by
  another creature: `nextAttack` can carry a `bonus` and be `byOthers`). Improved Brutal Strike replaces Brutal Strike
  with all four; at 17th level every Brutal Strike is one of the six pairs at 2d10 (a second blow costs nothing more).
  The AI's swing choice weighs the extra die at the plain chance to hit against the weapon's plain swing at advantage
  (low AC: the die; high AC: the advantage); Play shows "needs Reckless Attack first" on the variant. Editor: the
  on-hit card's "paid with the roll's advantage" and "only attacks using"; a custom condition's short text now says
  what it does ("Hamstrung (speed −15 ft)"). The golden logs didn't move.
- **7t, one thing a turn** (`action-limits`, now gone; Abjure Foes's Charisma-modifier many targets is a new small gap,
  `target-count`): a condition modifier, `oneThingPerTurn`, lets its bearer do only one of moving, taking an action and
  taking a bonus action on its turns. Once it moves, `canAct` closes the action and bonus action; once it takes either,
  the other closes and its movement budget is 0; reactions are untouched. Play says "can do only one of moving, an
  action and a bonus action this turn". The AI chooses at the start of its turn (`TurnFlags.limitedTo`): its action alone
  from where it stands if it has something to hit from there, otherwise a move toward its target. Authored: Cunning
  Strike's Daze (Devious Strikes is `full`), and Abjure Foes's frightened (keeping frightened's −2 to hit). The editor
  lists the new modifiers (one thing a turn, no opportunity attacks, slower) on a condition. The golden logs didn't move.
- **7u, reaction attacks** (`reaction-attack`, now only damage that isn't a hit): a feature effect, `reaction-attack`,
  gives each of the creature's plain attacks of some types a reaction copy ("Greataxe (Retaliation)", the most damaging
  first), made against the attacker on a `hit-by-attack` trigger that can now ask for an attacker within some feet
  (`withinFt`) and a hit that hurt (`damaged`): Retaliation. A damage cut that takes off a roll can redirect
  (`DamageCut.redirect`): when the damage drops to 0 it pays its cost and a creature within 5 ft (after a melee attack)
  or 60 ft (a ranged one), the attacker if it's there, makes the save or takes the damage, of the attack's type (the
  damage event now carries the attack's type). Deflect Attacks and Deflect Energy each get a "(redirect)" copy beside
  the plain one, offered only with a Focus Point left; the AI takes it when its cut is likely to stop it all and its
  damage averages 4 or more, unless it's conservative. Editor: the "An attack back when hit" card, the hit trigger's
  "within" and "only when it hurts", and the redirect's cost, damage, save and ranges. The golden logs didn't move.
- Test-side: a Berserker from 10th level retaliates, so a Relentless Rage test spends its reaction first.
- **7v, Metamagic, first part** (`metamagic`, now Careful, Empowered, Extended and Heightened Spell, and two options at
  once or one free): a feature effect, `metamagic`, makes a copy of each spell its option changes, at the spell's own
  level ("Fireball (Quickened)", `<id>:meta-<option>`), paying sorcery points beside the slot. Actions can now carry a
  second cost (`extraCost`), checked and paid with the first and weighed by the AI like a pool's points. Quickened
  (an action's spell with the bonus action; not after a level 1+ spell that turn, and no level 1+ spell after it:
  `spellTurnProblem`, `TurnFlags.leveledSpellCast`/`quickenedSpell`), Distant (twice the range, touch to 30 ft), Twinned
  (an effective level higher for a spell that gains targets by slot), Transmuted (acid, cold, fire, lightning, poison or
  thunder as the best of them: per target for a single target, and for an area one type for the blast, the most against
  the foes in it), Subtle (no counterspell window); Seeking Spell is a d20 change for spell attacks only
  (`spellAttacksOnly`). The hotbar folds the copies into the spell's button ("3rd · Quickened"); Play says why one can't
  be used. The AI casts subtly when a foe within 60 ft could counter it. **Found and fixed**: Subtle Spell was never
  offered, because Open5e's text lost its heading (an override `replace` puts it back). The golden logs didn't move.
- **7w, Metamagic, second part, and Sculpt Spells** (`metamagic`, now only two options on one spell or one for free;
  `spare-allies`, now gone): Heightened (a single target's save at disadvantage, or an area's foe with the most hit
  points; its repeat saves against the spell too: `SaveContext.disadvantage`, `repeatSave.disadvantage`), Careful (the
  caster's allies in an area, Charisma-modifier many, the fewest hit points first, succeed without rolling and take no
  damage: `spares`), Empowered (the lowest damage dice below average rolled again, Charisma-modifier many, on the first
  damage line: `rerollDamageDice`), Extended (advantage on the Concentration saves for it, found from what the caster
  concentrates on, and a minute or more of it doubled). A feature effect, `spare-allies`, gives an area spell in scope
  `spares` too: Sculpt Spells (1 + the spell's level, evocations). The AI's area weighing gives Heightened's target
  disadvantage and leaves spared allies out of its friendly fire, adds Empowered's expected gain, and values Extended a
  little for higher-level concentration spells. Editor: "A Metamagic option" and "Allies spared by its area spells"
  cards. Saves had no disadvantage path; they do now. The golden logs didn't move.
- **7x, turning one resource into another** (`slot-conversion`, now only Wild Resurgence's once a turn): an activation
  can give a resource back for what it spends (`gains`: an amount, or as many as the spent slot's level, never past a
  `max`; slot-spending ones get a copy per slot level as spells do), and can be offered only with none of a resource
  left (`onlyWhenEmpty`). Font of Magic is a free "slot to sorcery points" (the table's points at most) and a bonus-action
  "create a slot" per level its Creating Spell Slots table allows, the feature's grant replaced at 3rd, 5th, 7th and 9th
  level with one more; Sorcery Incarnate's Innate Sorcery for 2 points once its uses are gone; Font of Inspiration (a
  slot for a Bardic Inspiration use); Wild Resurgence (a Wild Shape use for a slot once, a slot for a use with none
  left). A feature effect, `slot-recall`, keeps a slot when a die comes up its level: Boon of Spell Recall. The AI makes
  a slot (the highest it can afford) once it has none, and refills a dry pool something it does spends with its lowest
  slot unless it's conservative; it no longer casts an activation whose condition is already on it from another feature.
  Editor: "gives a resource back" and "only with none left" on an activation, and a card for the slot recall. The
  golden logs didn't move.
- **7y, two standard actions in one** (`combined-utility`, now only Step of the Wind carrying an ally): a utility action
  can take more modes with it (`also`) and give temporary hit points (`tempHp`). Patient Defense for a Focus Point is
  Disengage and Dodge, Step of the Wind for one is Dash and Disengage; Heightened Focus adds two Martial Arts dice of
  temporary hit points to Patient Defense's, through a new builder grant field, `actionPatch` (fields set on an earlier
  grant's action, templates evaluated); Adrenaline Rush gives the proficiency bonus in temporary hit points. The AI's
  Dash/Disengage/Dodge pick now takes one it can pay for, a free one first. Editor: "and also takes" and "gives
  temporary hit points" on a standard action. The golden logs didn't move.
- **7z, ending conditions** (`condition-removal`, now gone): a pool heal can end conditions (`cures`: which, and the
  pool's cost each), the worst first as far as the pool goes, then heal with what's left: Lay On Hands' Poisoned, and
  Restoring Touch adding Blinded, Charmed, Deafened, Frightened, Paralyzed and Stunned through `actionPatch`. A feature
  effect, `shed-conditions`, ends one of some conditions (the worst) on its bearer at the start or end of its turn:
  Self-Restoration. The AI's healing pick also considers an ally with a condition it can end, a paralyzed or stunned
  one worth the most. Editor: "can end conditions, from the pool" on a pool heal, and an "ends a condition on itself
  each turn" card. The golden logs didn't move.
- **7aa, a choice of effect on each hit** (`rider-choice`, now gone): an on-hit option can be one a routine's strikes
  take only (`routineOnly`, the attack refused on its own in Play and left out of the AI's single attacks), and can name a
  bonus action's attack (`actionIds`). A push rider can allow a save. Open Hand Technique is Addle (no opportunity
  attacks), Push (a Strength save or 15 ft) and Topple (a Dexterity save or prone) on Flurry of Blows' strikes, chosen
  swing by swing; the plain bonus Unarmed Strike no longer gets Topple, as the rules have it. The AI's swing choice now
  counts an on-hit option's condition (half its control value), so it topples. Editor: "only on a routine's strikes" on
  the on-hit card. Test-side: the Phase 4 Open Hand test now swings Flurry's Topple strike. The golden logs didn't move.
- **7ab, Horde Breaker** (`follow-up-attack`, now gone): a feature effect, `follow-up-attack`, gives once on each of
  its turns, after an attack with a weapon (hit or miss), another with the same weapon at a different creature within
  some feet of the first target, in reach or range, that it hasn't attacked this turn (the likeliest to drop). The
  follow-up doesn't chain, and a reaction attack on another's turn doesn't set it off. Editor: its card. The golden
  logs didn't move.
- **7ac, changing another creature's roll** (`d20-reroll`, now only Boon of Fate's penalty on a success): a d20 change
  can help an ally within some feet (`forOthers`, its own roll too with `includeSelf`), take its reaction (`reaction`),
  apply only to a save against some conditions (`againstConditions`, read from the save's context), and reroll with
  advantage (`advantage`). Once a roll's own changes are spent and it still fails, each ally who could help is asked
  in turn, the nearest first (the AI decides for its own; Play asks whoever plays the helper: "Archer failed a DC 15
  save against Fear. Change Archer's roll?"). Countercharm and Boon of Fate (2d4 on an ally's failed attack or save,
  once a fight) run. Editor: the d20-change card's new parts. The golden logs didn't move.
- **7ad, damage tweaks** (`ignore-resistance` and `damage-vitality` now gone; `max-damage` now only Overchannel's
  later uses; a new `nat20-damage` for Overwhelming Strike): a feature effect, `ignore-resistance`, carries its types on
  the damage's origin, so the target's resistance to them doesn't count (immunity still does), in a hit's damage, a
  save's and an area's, and in the AI's estimates. Boon of Irresistible Offense runs (bludgeoning, piercing and
  slashing). `max-damage` compiles a copy of each spell in scope cast with a slot up to its level that deals damage
  (`<id>:overchannel`, upcast copies too, never a free cast), at its dice's highest, paying its cost beside the slot:
  Overchannel's harmless first use, once a fight (a pool of 1). The hotbar labels it "3rd · Overchannel".
  `damage-vitality` gives temporary hit points when a spell in scope deals damage, to the caster or the ally with the
  least of its hit points left within some feet: Improved Blessed Strikes' Potent Spellcasting (twice the Wisdom
  modifier, within 60 ft), granted at 14th level inside the Potent Spellcasting choice, as the Druid's Improved
  Elemental Fury is. Editor: three cards. The golden logs didn't move.
- **7ae, Rage's limits** (`rage-limits`, now gone): an activation's condition can carry an upkeep (`upkeep.by`: at the
  end of each of the bearer's turns after the round it began, it ends unless that turn the bearer made an attack roll
  against an enemy or forced one to make a save, or has a bonus action left, which is then spent on it), end when the
  bearer is incapacitated (`endsOnIncapacitated`, checked as the condition lands), and forbid spells (the
  `noSpellcasting` modifier: `spellTurnProblem` refuses a spell, so Play, the AI and validation all do; taking the
  condition breaks concentration). A feature effect, `condition-persists`, lifts the upkeep and the incapacitation (only
  unconscious still ends it) and can lengthen the condition: Persistent Rage (10 minutes). Effects can require several
  conditions at once (`whileConditions`): Frenzy now needs Reckless Attack, not just advantage, as the 2024 text has it.
  The upkeep runs in `runTurnEnd`, the one turn-end path Step, Auto Run and Play share. Editor: a "keeps going on its
  own" card and a "No spells" modifier chip; the sheet says what keeps Rage up and what ends it. Test-side: the Phase 4
  Frenzy test activates Reckless Attack, and a 7ad test's `resourceCost` read needed narrowing for tsc. The golden logs
  didn't move.
- **7af, cantrips that attack with a weapon** (`weapon-cantrip`, now gone): a `WeaponCantrip` (which weapon kinds,
  melee only, the ability, a new damage die, a damage type it can deal instead, more damage) on a spell's attack
  (`withWeapon`) or buff (`imbuesWeapon`). `getExecutableActions` compiles a copy of each fitting weapon's attack (one the
  character carries, never an Unarmed Strike) with the spellcasting ability for the attack and damage rolls. True
  Strike's copies are the spell itself (`<spell>:with-<weapon>`, "True Strike (Dagger)"), in place of its own action, and
  never a swing of the Attack action; radiant or the weapon's type (the better against the target), and 1d6 radiant
  more from 5th level. Shillelagh's are the weapon's own attacks (`<weapon>:imbued`), usable only while its buff lasts
  (`whileCondition`, checked in `canPayFor`, Play's `actionProblem`, the AI and validation), so Extra Attack can swing
  them; a d8 growing to 2d6, force or the weapon's type. Without a club or quarterstaff, Shillelagh isn't offered.
  `castWith` gives the imbue the casting ability. The hotbar groups the copies ("Dagger", "Shillelagh"). Quick-built
  bards, warlocks and druids now take these cantrips. Test-side: the Phase 5c warlock test accepts True Strike once foes
  close in (Eldritch Blast has disadvantage in melee). The golden logs didn't move.
- **Browser check after 7af**: built a 14th-level wizard, a 15th-level barbarian and a 5th-level bard in the app. The
  Overchannel, Persistent Rage and Rage editors show their cards (Rage's "No spells" a read-only card, its sheet text
  saying what keeps it going); the bard's hotbar has a True Strike button on its Spells tab. Fixed: a family with no
  plain member (True Strike's copies) was named after its first copy, "True Strike (Dagger)". Added from-blank editor
  tests for the four new cards (7ad, 7ae) and Rage's no-spells card.
- **7ag, Breath Weapon in place of an attack** (`attack-replacement`, now gone): Extra Attack's routines (every
  class's, the pact weapon's too) are marked as the Attack action (`attackAction`), and an ability can take the place of
  one of its attacks (`replacesAttack`). `getExecutableActions` compiles a copy of the Attack action with the ability
  as its first step and one attack fewer ("Attack with Breath Weapon (cone)", `<id>:with-<ability>`), which the
  multiattack loop already runs (an area step aimed at the first target); the ability is then only used that way
  (`routineOnly`, now on any action: Play refuses it alone, the AI skips it, the hotbar shows it as a variant of the
  Attack button, "With Breath Weapon (cone)"). Without Extra Attack the breath stays an action of its own, the same
  thing for a single attack. The AI weighs the breath's use as the routine's cost. The golden logs didn't move.
- **7ah, Overwhelming Strike** (`nat20-damage`, now gone): a feature effect, `natural-twenty-damage`, adds extra damage
  of the attack's type equal to the score of the ability the attack uses when the attack roll's d20 shows 20 (not on a
  lower critical, and not doubled). Boon of Irresistible Offense now runs in full: the boon's +1 can go to any score in
  the builder, so the score the attack uses stands for the one a player raises. Alert's initiative swap (`initiative`)
  stays a gap: it needs a new Play question. Grappler's strike (`grapple-strike`) needs PC grappling first (no class
  but the Monk has an Unarmed Strike yet). Editor: a "nothing to set" card. The golden logs didn't move.
- **7ai, Land's Aid** (`mixed-area`, now gone): an area save can heal one of the caster's side in it
  (`healsOneAlly`): after the blast, the one with the least of its hit points left (the caster too, a creature at 0
  first, back on its feet). Land's Aid's healing grows with its damage column. The AI adds what the most hurt ally in
  the area would get back, and for an area that heals and harms only foes it no longer counts its allies in it as a risk.
  The sheet says so ("One creature of its choice in the area regains 7 (2d6) hit points."). Found, not changed: the AI
  counts allies in any `affects: "hostile"` area as friendly-fire risk (Spirit Guardians and the like); fixing it moves
  the golden logs, so it waits for a decision. The golden logs didn't move.
- **7aj, Turn Undead's flight** (`flee`, now gone; a new, narrower `source-ends`): a condition modifier,
  `fleesFromSource`, sends its bearer away from the creature that gave it: on its turns the AI moves it to the
  reachable cell farthest from that creature (the cheapest of those), and it does nothing else; once that creature is
  out of the fight it no longer runs. Turn Undead's Frightened carries it. Left: the turning ending when the cleric is
  incapacitated or dies (`source-ends`). The sheet and the editor show it ("Flees"). The golden logs didn't move.
- **7ak, a condition that ends with its source** (`source-ends`, now gone): a condition rider can end when the
  creature that gave it is incapacitated (as that condition lands on it), dies on its death saves, or is defeated
  (`endsWithSource`). Turn Undead's two conditions carry it, so Channel Divinity runs in full. The sheet says so ("It ends
  early if it takes damage or this creature is incapacitated or dies."). The golden logs didn't move.
- **7al, Abjure Foes' count** (`target-count`, now gone): an area save can take only so many of the creatures in it
  (`maxTargets`), the caster's choice being its foes with the most hit points left (`chosenAreaTargets`, read by
  `areaSaveTargets`, so resolution and previews agree, and by the AI's weighing of the area). Abjure Foes takes its
  Charisma modifier (at least one), set by the builder ("{mod:cha|min:1}"). The sheet says "Up to 3 enemies of its
  choice within 60 feet…". The golden logs didn't move.
- **7am, a foe's success made to fail** (`d20-reroll` now gone; `ally-die` now only Cutting Words on damage rolls): a
  d20 change can be `"subtract"`, taking its dice off a foe's success by a creature within some feet of the owner
  (`againstFoes`): an attack roll that hit (never a critical hit, a DM's ruling or Boon of Combat Prowess's hit) or a
  save that succeeded, after the roller's own changes. The roller's foes who could, the nearest first, each once; the AI
  uses it when its dice more likely than not make the roll fail (three in four when conservative); Play asks whoever
  plays the owner ("Goblin 1 hit with Scimitar: 16 against AC 14. Change Goblin 1's roll?"). Cutting Words is now its
  reaction, the Bardic Inspiration die off a foe's hit within 60 ft (the old disadvantage and the die's average as AC
  are gone); Boon of Fate takes 2d4 off a foe's hit or made save within 60 ft and runs in full. Editor: "Take a die off a
  foe's roll" on the d20-change card. Test-side: the Phase 5b Cutting Words test checks the new effect. The golden logs
  didn't move.
- **7an, what taking a foe's turn is worth** (`ai-control-value`, now gone; a narrower `monk-weapons`): a paid on-hit
  upgrade (`costPaidOnHit`) whose rider takes the target's turn (stunned, paralyzed, incapacitated, unconscious,
  petrified) is worth, to the AI, what the target would deal in that turn (its best action's average damage at a typical
  chance to land) at the chance it lands, less when the hit itself likely drops the target, and nothing once it's out of
  its turn already. Counted per swing (`bestSwingAttack`) and in a plan's score, under any tactics; a monster's own
  riders keep their tactics' control weights, so the golden logs didn't move. A basic-melee monk now stuns an ogre or a
  troll and spends nothing on a goblin. Stunning Strike's note was stale (a made save's effects run); what it lacks is
  Monk weapons (`monk-weapons`).
- **7ao, Defensive Tactics** (`oa-defense`, now gone): a feature effect, `attack-defense`, puts attack rolls against its
  bearer at disadvantage: opportunity attacks (`"opportunity"`; an "any melee attack" opportunity attack now carries the
  leave-reach reaction meta, so it's known as one), or the other attack rolls this turn of a creature that has hit it
  (`"after-hit"`, read from this turn's log). Hunter's Defensive Tactics is now a pick between Escape the Horde and
  Multiattack Defense. Editor: its card. The golden logs didn't move.
- **7ap, Tactical Master** (`weapon-mastery`, now gone): a feature effect, `mastery-swap`, compiles a copy of each
  mastered weapon attack for each mastery it can use instead ("Greatsword (Sap)", `<id>:mastery-sap`), the weapon's own
  mastery riders swapped for the other's; they're variants of the weapon, so the Attack action's swings and the hotbar
  ("Push", "Sap", "Slow") take them. The AI weighs a swap by what it adds over the weapon's own mastery (Sap a fifth of
  the target's threat, Topple a prone target's worth when its save fails, Vex an easier next swing, Push and Slow a
  little), so a creature without Tactical Master chooses as before; a fighter now saps an ogre with its greatsword.
  Editor: its card. The golden logs didn't move.
- **7aq, Improved Cunning Strike** (`dice-trade`, now gone): a feature effect, `paired-on-hit-options`, pairs the on-hit
  options that trade dice of the same damage bonus: each pair compiles as one more option ("Cunning Strike: Poison +
  Trip"), its dice the two together, its riders both, its move either's, so the existing variants, terms and AI weighing
  take it; only pairs the dice cover (no Knock Out with anything at 11th level). Editor: its card. The golden logs didn't
  move.
- **7ar, once a turn for an activation** (`slot-conversion`, now gone): an activation can be once on each of its
  bearer's turns (`oncePerTurn`, kept in the turn's flags and checked with `onlyWhenEmpty`, so Play, the AI and
  validation all refuse a second). Wild Resurgence's slot for a Wild Shape use runs in full. The sheet says so. The
  golden logs didn't move.
- **7as, a creature its conditions change** (`size-change` now gone; `gain-speed` now only Dragon Wings again for
  sorcery points): condition modifiers can give a fly speed (`flySpeed`, its walking speed or so many feet), a size
  (`sizeTo`) and more speed (`speedBonusFt`). `getDefinition` returns the definition as they change it, one object per
  base definition and change (so compiled actions and every movement, pathing and footprint rule see it with no other
  change), and the base one without them. Growing needs room (`growthProblem`: Play, the engine and the AI). The AI's
  activation choice counts mobility, so it takes flight or Large Form with a spare bonus action. Draconic Flight,
  Dragon Wings and Large Form run, each once a fight. The golden logs didn't move.
- **7at, Halfling Nimbleness** (`move-through`, now gone): no engine change. The pathfinder already lets any creature
  move through another's space at double the cost (a simplification of the 2024 rule, which allows it only through an
  ally's, an incapacitated creature's, or one two sizes apart), so moving through a larger creature's space needs nothing
  more; the trait now runs.
- **7au, a spell's own stat block** (`summon-stat-blocks` now only familiars; a new `concentration-optional` for Dragon
  Companion's casting without concentration): a summon option can name a template (`SummonOption.template`) rather than
  a creature in the encounter: the Otherworldly Steed (Find Steed: celestial, fey or fiend) and the Draconic Spirit
  (Summon Dragon: its breath's type), their numbers taken from the SRD 5.2 PDF's stat blocks (Open5e's spell text leaves
  them out). When summoned, the stat block is made from the caster's spell attack bonus, save DC and proficiency bonus
  and the slot's level (the spell's own for a free cast), once per caster and level, and added to the encounter's
  definitions; the spawn event carries it, so replay adds it too, and nothing needs embedding beforehand. A summon can
  share its summoner's initiative (`sharesInitiative`), its turn right after the summoner's, kept there when the order
  is sorted again (`compareInitiative` treats it as its summoner's follower). Summon Dragon's Shared Resistances gives the
  caster the breath's resistance while concentration lasts. The AI weighs a templated summon by the stat block it would
  make, so a paladin opens with its free Find Steed. Faithful Steed runs in full; Dragon Companion all but casting
  without concentration. Not simulated: riding the steed, Life Bond. Test-side: the catalog's leveling fight lets a Large
  steed boxed in by the sample's cramped room say so. The golden logs didn't move.
- **7av, Wild Shape** (`wild-shape`, now gone): Wild Shape is a transform with a `wildShape` block (temporary hit points,
  scaled to the druid's level) and a cost (a use; going back is free). Its forms are Beasts of the bundled library,
  picked by the builder like invocations (`wild-shape-forms`: four at 2nd level up to CR 1/4 with no fly speed, two more
  at 4th up to 1/2, two more at 8th up to 1 and flyers), each pick adding a form to the transform (`formsOf`, a new
  grant field); quick builds take fighters (wolf, boar, giant badger, panther, black bear, ape, brown bear, dire wolf).
  The library's beasts come into the encounter with the druid (creating or rebuilding a character now loads what it
  names, as placing a monster does). Shifting makes the form (`wildShapeForm`, once per druid and beast, into the
  encounter's definitions; the event carries it for replay): the beast's body with the druid's hit points, mental
  scores, class features, feats and save proficiencies (its own bonus, the beast's where higher), and no spells or
  species traits; being incapacitated ends it. Beast Spells keeps the spells (patched onto the transform at 18th). The
  AI shifts at the start of its turn when its best form's attacks beat what it can do without spending by a third and
  it has no slot spell left to cast (or is concentrating already, or has Beast Spells). Test-side: the Phase 5b druid
  test now expects Wild Shape to run. The golden logs didn't move.
- **Browser check after 7av**: a 4th-level druid and a 5th-level paladin built in the app. The druid's builder shows its
  Wild Shape forms pick; creating it brings its beasts into the scene (Wolf, Black Bear in the actor list). In Play the
  druid's Wild Shape is on the hotbar's Features tab, asks "which?" with its six forms, and picking Wolf shifts it
  (AC 13, 40 ft, +4 temporary hit points, the Spells tab shut). The AI paladin opens with its free Find Steed and the
  steed joins the fight. No fixes needed.
- **7aw, Monk weapons** (`monk-weapons`, now gone): a feature effect, `martial-arts-weapons`, names the monk's Unarmed
  Strike; while it wears no armor and holds no shield, its Monk weapons (simple melee, and martial melee with the Light
  property) compile with the better of Dexterity and Strength, the Martial Arts die when that's bigger, and the Unarmed
  Strike's optional on-hit riders (Stunning Strike). Martial Arts and Stunning Strike run in full. Editor: its card. The
  golden logs didn't move.
- **7ax, Divine Intervention** (`free-cast-any`, now gone): a free cast can share a pool with others (`FreeCast.pool`,
  sized by `uses`, made once), carry its own name (`label`: "Flame Strike (Divine Intervention)") and be cast with an
  action whatever its casting time (`asAction`). Divine Intervention grants every Cleric spell of levels 1-5 that runs
  and isn't a reaction (17 today) that way, from one use; the AI casts the best of them like any spell. The golden logs
  didn't move.
- **7ay, Retaliation against any damage** (`reaction-attack`, now gone): a `hit-by-attack` trigger can take damage that
  isn't an attack's hit (`anyDamage`): a creature's save or area damage now opens the same window, marked
  `notAttack`, which only such triggers answer (Hellish Rebuke's stays with attacks, so monsters behave as before).
  Retaliation runs in full. The golden logs didn't move.
- **7az, Cutting Words on a damage roll** (`ally-die`, now gone): a would-take-damage trigger can take its side's
  damage (`forAllies`: the reactor or an ally about to take damage from a creature within reach of the reactor); the
  damage step opens the window when such a reactor is about (`alliesCutDamage`), and the AI's bar reads the damaged
  creature's hit points. Cutting Words is now both: the die off a foe's hit (7am), or a reaction cutting a foe's damage
  roll by the die ("Cutting Words (damage)"); it runs in full. The golden logs didn't move.
- **7ba, more Metamagic** (`metamagic`, now gone): a feature effect, `metamagic-boost`, works while a condition lasts
  (Innate Sorcery's): with `pairs`, a copy of each spell with two of its options, paying both ("Fireball (Quickened +
  Heightened)", `<id>:meta-a+b`); with `freeOncePerTurn`, a free copy of each Metamagic spell, once on each of its
  turns (`freeMetamagicUsed`). Both are gated like Shillelagh's copies (`whileCondition`). Readers of an option now ask
  `usesMetamagic`, so a pair's second option counts too. Sorcery Incarnate and Arcane Apotheosis run in full. The
  golden logs didn't move.
- **7bb, two small variants** (`concentration-optional` and `gain-speed`, now gone): a summon can also be cast without
  concentration for a shorter time (`concentrationOptional`, set by a builder spell change; a copy `<id>:no-concentration`,
  its Shared Resistances lasting as long): Dragon Companion runs in full. Dragon Wings has a second activation for 3
  sorcery points once its use is gone. Overchannel's later uses (necrotic damage to the wizard, growing each time) stay
  a gap: the AI would hardly ever take them. The golden logs didn't move.
- **Phase 7 closed (after 7bb).** Every family the plan's likely order named, and every one a character below 10th
  level meets in a fight, runs, except three that need a system of their own: `stealth` (hiding and invisibility you
  give yourself), `grapple-strike` (a PC's grapple with an Unarmed Strike, which PCs don't have yet) and
  `summon-stat-blocks` (familiars, which can't attack but help). Also left, all one feature each and mostly 14th level
  or higher: `initiative` (Alert's swap: a new Play question), `free-move` (Fleet Step, Boon of Dimensional Travel),
  `combined-utility` (Step of the Wind carrying an ally), `smite` (Smite of Protection's cover, Hurl Through Hell),
  `max-damage` (Overchannel's later uses), `zone-cover` (Nature's Sanctuary), `delayed-damage` (Quivering Palm),
  `extra-turn` (Thief's Reflexes), `activated-aura` (Holy Nimbus) and `extra-target` (Words of Creation). Each stays on
  the actor as its SRD text with its gap code, as the plan intends. COVERAGE.md lists them.


### Phase 8 (2026-10-06, in steps)

What's there: the catalog types and their zod schemas (written for this phase in Phase 0, but behind: `formsOf`, a
free cast's `pool`/`label`/`asAction` and a spell change's `concentrationOptional` came later and a plain `z.object`
strips them). Every builder call site reads `SRD_BUILD_SOURCES`. Library actors are saved per account
(`CreatureDefinition` rows, `/api/definitions`). The ability editor saves only into an actor in the scene, or hands a
granted ability back to its parent (`nested`). Open5e's `/v2/classes/` gives a class or subclass with its hit die,
saves, `subclass_of`, features with the levels they come at (`gained_at`) and table columns (`CLASS_TABLE_DATA`); the
proficiencies are in a markdown table (`CORE_TRAITS_TABLE`).

The steps, each a commit:

- **8a, homebrew entries, stored and merged.** A Prisma `CatalogEntry` (owner, `entryId`, kind, name, source, data;
  unique per owner and `entryId`, so two accounts can import the same file) and `/api/catalog`. Entries are checked by
  their kind's schema on the way in. The schemas catch up, and a test parses every SRD entry through its schema and
  expects the same object back, so a field can't be stripped again. A homebrew class can name its own spells
  (`spellcasting.spells`) instead of an SRD list. `mergeCatalog(srd, homebrew)` keeps every entry apart (a same-named
  class from another source stays its own, shown with its source); a homebrew id can't start `srd:`. A small store
  loads the account's entries, and every builder call site reads the merged sources. A character whose class has
  gone from the catalog says so on level up, and its actor is left as it is. A JSON file format
  (`battlesim-catalog`, versioned) with export and import, which reports each entry it couldn't take and why.
- **8b, the class editor.** A **Homebrew** window: entries by kind; new, copy of an SRD entry, import, export,
  delete. The class editor: basics (hit die, abilities, saves, skills, weapons and armor, subclass level, feat
  levels), spellcasting (none, full, half, third, pact; ability; list or its own spells; cantrips and prepared by
  level), the table (columns by 20 levels), and levels 1 to 20 with their grants and choices. A grant's feature opens
  in the ability editor, in a new mode that hands the feature back instead of saving it to a token. It is previewed on
  a stand-in character: the class quick-built at that level. "This number follows a column" writes a `scale` entry
  from a field of the feature and a column or template. A grant also takes a pool, adjustments, spells and free casts.
  Choices: skills, expertise, picks (options with grants), spells, abilities, feats. The catalog test's checks
  (scale paths resolve, `replaces` and `onHitOf` keys exist) become `catalogProblems(entry)`, shown in the editor.
- **8c, subclass, feat, species and background editors**, made from the same parts. A subclass picks its class (an
  SRD class or a homebrew one) and can bring a spellcasting progression (a third caster).
- **8d, Open5e import.** Search `/v2/classes/` through the adapter. A class or subclass comes in as a skeleton: hit
  die, saves, primary abilities, skills, proficiencies, table columns, feat levels (its Ability Score Improvement
  levels), the subclass level, a caster type to fill in, and each feature at its levels as a reference-only feature
  with its source text. Its source document is kept, its id is `open5e:<key>`, and it's never merged with the SRD
  class of the same name. A subclass attaches to its class when that class is in the catalog, and the DM picks it
  otherwise.
- **8e, the party, authored.** The Arcane Trickster (a third caster on the 2024 Rogue), the Path of the Zealot and the
  Totem Warrior (on the 2024 Barbarian) and the Spiritbound Marksman (a homebrew class with its three paths) as
  homebrew files in `tests/fixtures/homebrew/`. They're written in the engine's terms with short descriptions of our
  own: they aren't SRD, so they don't ship in `src/`, and the DM imports them. Tests level each from 1 to 20. A
  browser check imports them, builds each at 20, levels one up through the window from 1, and runs a fight.

Not in this phase: a homebrew class's own new spells (the class's spells are library spells), and a character that
carries its homebrew class inside itself so it can be leveled on another account.

- **8a, homebrew entries, stored and merged** (7afbf8a): a `CatalogEntry` table (owner, `entryId`, kind; unique per
  owner and entry id) holds the account's entries, and `/api/catalog` saves a batch, checking each by its kind's schema
  (and again on the way out, reporting any an older version saved that no longer passes). The schemas had fallen
  behind (`formsOf`, a free cast's `pool`/`label`/`asAction`, a spell change's `concentrationOptional`), and a plain
  `z.object` dropped them; the catalog test now parses every SRD entry back to exactly itself. `mergeCatalog` adds the
  entries after the SRD's and never replaces one; `entryLabel` shows a non-SRD entry's source ("Rogue (Homebrew)").
  A class's or subclass's own spells (`spellcasting.spells`) make its `list` a list the library knows. A catalog
  store loads the entries beside the library; Create Token, the builder, Level up, the sheet's Class & level and the
  store's create and rebuild all read its merged sources. `missingFromCatalog` names what a build needs that the
  catalog hasn't got (its classes, background and species, and any `homebrew:`/`open5e:` id its choices name), and
  the builder and Level up windows say so instead of opening. `battlesim-catalog` files (versioned) carry entries
  out and in, each one that fails reported by number and name. The database got the table with `prisma db push`
  (additive).
- **8b, the class editor** (1096e40): a Homebrew window (Create Token's Character tab, or the builder's "Your own
  classes…") with the account's entries on the left and the open one's editor on the right, edited as a draft: new, a
  copy of an SRD class (`copyAsHomebrew`), import and export, delete, discard, save, and Check (`entryProblems` builds
  it at all 20 levels and lists what building says, by level). The class editor covers basics, proficiencies,
  spellcasting (slots, ability, an SRD list or its own spells, cantrips and prepared by level, a spellbook), the table,
  and levels 1 to 20 (a feat level's feat and the Epic Boon are shown as the builder's own). A grant's feature opens in
  the ability editor, which gains a `commit` mode: it hands the feature back with the new pools it spends (they become
  the grant's `pool`), previewed on the class quick-built to that level; the entry editor stays mounted (hidden)
  underneath so its open level survives. A grant takes "numbers that follow the table" (a path from
  `scalablePaths(feature)`, the feature's numbers and dice, and a template with a button per column, the class level
  and the proficiency bonus), a pool, `replaces`, `atLevel` inside an option, adjustments (speed, max HP, darkvision,
  saves), always-prepared spells and free casts. Choices: picks (options with grants, a level, repeatable), skills,
  expertise, spells, ability points, feats, Weapon Mastery, subclass.
- **8c, subclass, feat, background and species editors** (4382c0c), from the same parts: a subclass picks its class
  (SRD or homebrew) and can bring a third-caster progression and columns of its own; a feat its category, level,
  shown prerequisite, grants and choices; a background its abilities, skills and origin feat (a homebrew one too); a
  species its sizes, speed, type, darkvision and traits by character level. Tests author each in the window and build
  a character from it.
- **8d, Open5e import** (31b05e6): the client searches `/v2/classes/` (key, name, document, `subclass_of`) and imports
  one record; `normalizeOpen5eClass` (src/adapters/open5e-class.ts) makes the skeleton: saves and proficiencies from
  2024's Core Traits table or 2014's Proficiencies list (the record's own `saving_throws` comes last: it's wrong for
  some classes), skills ("Choose 4: …", "Choose four from …", "Choose any three"), table columns from
  `CLASS_TABLE_DATA` and from a level feature carrying table data (2014's Sneak Attack), a skipped level keeping the
  last value; feat levels from Ability Score Improvement (19 left to the Epic Boon); the subclass level from its
  subclass feature (2014's names: Roguish Archetype, Divine Domain …), where the subclass choice goes; a caster type
  as a progression to fill in; and each feature at each level it comes (a repeat keyed `<name>-<level>`), reference
  text. The id is `open5e:class:<key>`, even for an SRD 5.2 record, so nothing merges with the bundle; a subclass of
  an SRD 5.2 class attaches to the bundled class. The window's panel leaves out the bundled SRD 5.2 classes, and a
  record already imported opens as the account has it rather than being imported over the DM's edits. Checked live:
  all 151 records import and pass, and every class builds at all 20 levels (2014 casters come without a progression:
  Open5e gives no caster type for them).
- **8e, the party, authored** (18e6ec7): `tests/fixtures/homebrew/party.ts` has the Arcane Trickster (a third caster
  on the SRD Rogue, Mage Hand always known; its 9th-17th level features reference text), the Path of the Zealot
  (Divine Fury, Warrior of the Gods' d12 pool from a column of its own, Fanatical Focus, Zealous Presence as a
  ten-ally buff, Rage of the Gods as a second Rage costing its own use and a Rage use), the Path of the Totem Warrior
  (picks at 3, 6 and 14; Bear's resistances run, the rest is reference), and the Spiritbound Marksman (a Wisdom half
  caster from 1st level with its own list of SRD spells; a Spiritfire Gun feature granting the attack and a volley
  whose count follows a shots column; Agonizing Echo always on; Avatar of the Forgotten; Echoforged Apex's crit
  range) with its three paths, each patching the gun's range with `actionPatch` (Deadeye's Death's Brand and Mark of
  the Last Breath as on-hit conditions, Silent Veil's free Invisibility, Bayou Blight's Swampburst Shards). Effects
  name the gun's attack by the id the builder gives it (`spiritbound-marksman-spiritfire-gun-granted-1`). They're
  not SRD, so they stay out of `src/`; `party.catalog.json` (written by `scripts/write-party-homebrew.ts`, checked by
  the test) is the file to import. The test levels each from 1 to 20 through the Level up path without a warning
  and fights the sample encounter at 1st, 6th and 20th level with only legal actions; a peek showed the AI using the
  volley, the brand, Rage and Divine Fury.
- **Browser check after 8e** (d9676c2): the party file imports in the Homebrew window, each entry checks out, the
  Marksman quick builds at 20 (AC 17, 143 HP), and a Barbarian leveled 1 to 20 in the Level up window takes the
  Zealot at 3rd and opens a fight with Rage of the Gods and Divine Fury. Fixed: the non-class editors' Name field
  stretched into a gap, and the subclass and feat dropdowns now name a non-SRD option's source.
- **Phase 8 closed.** The done-when holds: the party's Arcane Trickster, Zealot and Spiritbound Marksman (and the
  Totem Warrior) are authored and level from 1 to 20. Left for later: a homebrew class's own new spells (classes cast
  library spells), and a character carrying its homebrew with it to level on another account. The dev server on
  :3000 needs a restart to serve `/api/catalog` (its Prisma client predates the table).

### Phase 9 (2026-10-06, in steps)

What's there: the build is an ordered level list, and the walk already handles several classes (each class's own
level, the first class's saves and skills, hit dice by class, slots by the multiclass rule, spells prepared per
class). `withLevelUp(build, classId)` takes a class, but the Level up window always continues the last one. The builder
doesn't use a class's weapon and armor lists (weapons carry `proficient`, and armor isn't checked), so the 2024
multiclass rule's narrower proficiencies change nothing it writes; its one skill (Bard, Ranger, Rogue) does. A
hand-built PC's sheet shows Level & CR, with nothing to adopt it. Create Token makes one character at a time. The
guides live in `docs/guides/` and are served at `/docs/guides/<slug>`.

The steps, each a commit:

- **9a, a second class at level up (D11).** The Level up window gets a class to level: one of the character's classes
  or a new one. A new class says what its prerequisite needs (13 in the primary ability of the new class and of
  every current class; the Fighter's is Strength *or* Dexterity, `primaryAbilityAny`) and warns, without stopping
  it, when the scores fall short. Its first level asks for the one skill the multiclass rule gives (`multiclass:
  { skills: 1 }` on the Bard, Ranger and Rogue). The label reads "Rogue 3 (Thief) / Fighter 1".
- **9b, "Rebuild with the builder" (D10).** A hand-built PC whose class name matches a catalog class (or a level
  given by hand) gets "Rebuild with the builder…" on Stats › Level & CR. The builder opens on a 2024 build at that
  level that keeps the actor's ability scores (the base is worked back from them) and its typed max HP (as the
  build's adjustment), and says the features will be the 2024 versions. Applying keeps the hand-made abilities and
  flags each one that has the same name as something the builder adds, for the DM to remove.
- **9c, Quick party.** Create Token › Character gets "Quick party": four classes (Fighter, Cleric, Rogue, Wizard by
  default, each changeable) at one level, quick built and placed in one step, one undo.
- **9d, the batch sanity check.** A test builds the quick party at 5th level, puts it against an SRD encounter of
  about the right difficulty on an open map, and runs 100 seeds. It checks a broad range (the party wins often but
  not always), not a pass mark: a party that loses nearly every fight means a number is wrong.
- **9e, the guide.** `docs/guides/build-a-character.md`: make a character (Quick build and step through), level it
  up, add a second class, rebuild a hand-built PC, a quick party, and homebrew (import a class file, copy an SRD
  class, a subclass on an SRD class). Screenshots taken by following it in the browser.
- **9a, a second class at level up** (55c7e49): the Level up window's "Class to level" offers the character's classes
  ("Rogue (3 → 4)") and, under "A new class (multiclass)", every other catalog class. A new class's prerequisite
  (`multiclassProblems`: 13 in the primary ability of it and of each current class; `primaryAbilityAny` for the
  Fighter's either-or) is warned about in a note and doesn't stop it. A Bard, Ranger or Rogue taken later asks for
  its one multiclass skill (`multiclass.skills`). The builder never used a class's weapon and armor lists, so the
  narrower multiclass proficiencies change nothing it writes. The class editor sets both new fields.
- **9b, Rebuild with the builder** (c38bb67): a hand-built PC's Level & CR has "Rebuild with the builder…"; the
  builder opens in an `adopt` mode on `adoptionBuild`: classes and subclasses matched by name (homebrew ones too),
  scores kept by working the base back from the build's increases (two passes; a score the increases overshoot is
  said), the typed max HP kept as `hp.adjust`, and `equipment.applied` so nothing is added. Changing the class there
  keeps the scores and HP. Its own abilities stay; `sameNamedAbilities` lists the hand-made ones named like the
  builder's (features, a feature's granted actions, weapons, spells), with a box to remove them on rebuilding. Tested
  on the party's own Barbarian (Rage, Reckless Attack, Danger Sense, Extra Attack, Unarmored Defense, Fast Movement
  and its Attack multiattack were the look-alikes) and Arcane Trickster (the homebrew subclass matched).
- **9c, Quick party** (b946845): Create Token › Character has a Quick party box: four classes (Fighter, Cleric, Rogue,
  Wizard to start, each changeable) at the Level chosen above, named after their classes, each on a free square,
  one undo step (`createParty`, `quickParty`).
- **9d, the batch sanity check** (1ae6523): the Quick party at 5th level against a Hill Giant and two Ogres (Moderate:
  2,700 of 3,000 XP) on an open floor, 100 seeds: it wins every seed in about four rounds (the report says Easy), the
  Wizard drawing the giant and the Cleric healing it; the test asks for a broad range (over 60% wins, under 25% TPK,
  2 to 10 rounds, every member dealing damage). A Troll instead was a coin flip with long fights: it regenerates
  unless fire or acid hits it, and only the Wizard has fire; that's the encounter, not the builds.
- **9e, the guide** (71ec6b9): `docs/guides/build-a-character.md`, its 16 screenshots taken by following it in the
  browser (a production build on a spare port, since the :3000 dev server's Prisma client predates the catalog table):
  making a character, leveling it, a second class, rebuilding a hand-built PC, a Quick party, and the Homebrew window.
  The docs' Actor Sheets section points to it. Following it found that Open5e's `/v2/classes/` ignores
  `name__icontains` (every search listed every class): the adapter now filters the short list itself (7e2ab4a).
- **Phase 9 closed, and the plan with it.**
