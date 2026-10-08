# Character Builder UX Plan: a builder that explains itself, in Standard or the Codex's look

**Status:** built 2026-10-07 and 2026-10-08, every phase 0–9, on the branch `builder-ux` (one commit a phase; not yet
merged into master). D1–D4 are the user's decisions (2026-10-07), D5–D16 defaults that followed from the ask. "Built so
far" at the end is the build log.

The user's ask (2026-10-07):

1. The character builder isn't intuitive.
2. Hovering over a spell or a feature explains nothing. Nothing says what a background or a race/species gives, and
   that depends on the edition.
3. It should look like the Codex sheet, so it's more approachable. The goal is "the best user experience imaginable".

The user's answers to the first draft (2026-10-07):

- **D1:** switch between the looks, as the sheet does, rather than always using the Codex.
- **D2:** steps beside a live preview.
- **D3:** yes to rules cards on hover.
- **D4:** keep a spell grid per choice rather than pooling them, but reimagine it so it's easier to use.

**Mockup, approved by the user 2026-10-07:** https://claude.ai/artifact/KoS2knVZQJ6U5oZkJVNcN4 (a private Design canvas).
Build to it. It has interactive builder frames for Class, Origin, Abilities and Spells in both looks, Level up, and a
rules-card gallery in Codex Dark, Codex Light and Standard. Its data is the real quick-built 2024 Wizard 5 (Sage,
Dwarf), exported from `quickBuild` + `buildCharacter`. Things the mockup settled beyond the text below:

- Level up's class cards check multiclass requirements against the character's scores ("Needs WIS 13: you have 12"),
  and the other edition's twin of an owned class is a disabled card that says why.
- A Codex panel heading is the copper diamond glyph, the display-face title, and a rule to the panel's edge.
- Spell tiles mark the element with a small colour square, not a coloured border.

Nothing in this plan changes the rules. The build record (`CharacterBuild`), `buildCharacter`, `rebuildActor` and the
engine stay as they are, so there is no schema migration. The plan changes how the builder shows, groups and explains
what it already does.

## What's wrong today

The evidence comes from screenshots of the live builder (2026-10-07) and a headless count from `buildCharacter` +
`quickBuild`.

| # | Problem | Where |
|---|---|---|
| 1 | **It's one long form.** A 600 px window that scrolls about 6,000 px for a 5th-level wizard: Basics, Ability scores, Choices, Hit points and Summary in one column. Apart from "N still to choose", nothing says where you are or what's left. | `CharacterBuilder.tsx` |
| 2 | **Nothing explains itself.** Class, subclass, background, species, feat and Fighting Style are native `<select>`s, and a select's options can't show anything on hover. Spell, skill, mastery and pick chips have at most a native `title`, which mostly holds "taken" reasons. The full SRD text of every feature and spell is already in the repo, but the builder never shows it. | `ChoiceControl.tsx`, `CatalogSelect.tsx` |
| 3 | **The origin is a black box.** Picking Sage or Dwarf doesn't say what it gives. Whether increases come from the background (2024) or the race (2014) is a select plus a sentence. A 2014 Hill Dwarf's +2 CON +1 WIS shows up only as changed numbers under the scores. The background's +2/+1 picker sits in Choices › Background, far below the scores it changes. | `CharacterBuilder.tsx:294-322` |
| 4 | **The features you gain are invisible.** The builder lists only choices. A 2024 Fighter 5 gains 11 features (Second Wind, Action Surge, Extra Attack, …), and they appear only as names in the Summary at the bottom. A level with nothing to choose doesn't appear at all. You can't see what a subclass or the next level gives before you choose. | `groups()`, `Summary` |
| 5 | **Spells repeat.** Each level's spellbook and prepared choice is a full grid of its own. A 2024 Wizard 5 has 23 choices: 16 spell grids holding 442 spell chips. A Wizard 9 has 26 grids and 1,054 chips. Nothing shows "my spells" in one list. | `SpellPicker`, one per slot |
| 6 | **Jargon.** "ref" with a dashed outline means "the simulator doesn't cast this", and only a native title says so. Also "Typed by hand", and "Ability increases from: The background (any three)". | `ChoiceControl.tsx:75-86` |
| 7 | **You type ability scores.** For the standard array you type 15, 14, 13… into six boxes and read an error sentence if they're wrong. Point buy shows neither the cost of each step nor the points left. | `CharacterBuilder.tsx:340-381` |
| 8 | **It doesn't look like the sheet it makes.** Grey app chrome, all-caps labels and plain selects. The Codex sheet it opens next is teal and copper, with dials. | `builder.module.css` |
| 9 | **Two forms ask the same thing.** Create Token › Character asks for name, class, level, background and species. "Step through the choices…" then opens a window that asks again. It doesn't carry over the Create Token edition filter, and the target folder is lost. | `CreateTokenModal.tsx:232-340` |
| 10 | **Level up is a form.** A class select, the choices, and a list of change sentences. There's no "you gained" moment and no feature text. | `LevelUpWindow.tsx` |
| 11 | **It's easy to lose work.** Closing the window drops the draft, and there's no undo inside it. Changing a new character's class resets its scores and every choice. | `CharacterBuilder.tsx:182-191` |

## What there is to build on

- **Rules text, already in the repo (both editions):**
  - Every class, subclass, feat and species feature carries its full SRD text, as markdown, in
    `FeatureGrant.feature.description`. A feature only partly simulated has "Not simulated: …" appended.
  - Every spell has its full entry (casting time as printed, range, components, duration, concentration, ritual,
    save, damage, area, text, higher levels) through `srd2024SpellEntry(id)` and `srd2014SpellEntry(id)`.
  - The generated reference JSON (`src/data/srd/{2024,2014}/generated/reference.json`) holds the class features'
    text, the feats, the backgrounds (including the 2024 background's tool) and the species' or races' traits.
  - All 24 classes and all 18 species and races have a one-line `description`.
  - `react-markdown` and `remark-gfm` are dependencies already.
- **Text that's missing:**
  - Subclass summaries, feat summaries and 2024 background summaries. These can be derived from the records.
  - Descriptions for some pick options: Elemental Affinity, Giant Ancestry, Draconic Ancestry, Fiendish Resilience,
    Favored Enemy, Dragon Ancestor. Invocations carry only their prerequisite. Each has a feature with text behind
    it, which the card can read.
  - Skills have no text.
  - Weapon mastery properties have only creature-bound sentences (`masterySentence` in `src/lib/statblock.ts`).
  - The 2024 background's tool is in the reference JSON only.
- **Statblock text:** `spellStatblock`, `featureStatblock` and `weaponStatblock` in `src/lib/statblock.ts` return
  `{title, text, short, support, notSimulated}` for a definition. The builder's preview definition will do.
- **The Codex:**
  - In `src/lib/actor-sheet/codex.ts`: `CODEX_PALETTES` (Dark and Light) and `contrastRatio`, already covered by a
    contrast test.
  - Fonts (Fraunces and Figtree) in `sheet/codex/fonts.ts`.
  - `Astrolabe` and `Portrait`, exported from `ornaments.tsx`.
  - The palette choice, in `useSheetWindowsStore` (`battlesim:codex-palette`).
  - The `--ui-*` remap on `.codex`, which re-colours any Standard component hosted inside it.
  - Everything else (the banner, level dial, ability dials, panel heading with its copper glyph, tabs, pips, tiles
    and rows) is private to `CodexSheet.tsx`.
- **The style switch:** the sheet's `StyleSwitch` (Standard | Codex) sits in its window's title bar. Each actor kind
  remembers its style (`storedStyle("pc")`, `battlesim:sheet-style`). The builder isn't skinned today, and its CSS
  reads only `--ui-*` tokens, so under the Codex's remap it would take the Codex's colours without other changes.
- **Spell colours and marks:** the hotbar already colours a spell by its element (or its school, when it deals no
  damage) and marks its cost: ● action, ▲ bonus action, ◆ reaction (HOTBAR_REDESIGN_PLAN.md D3).
- **Hover:** `InfoTooltip` portals to the owner document, keeps itself on screen, and opens on hover, focus or tap.
  But it is 260 px wide, uses the app's colours and has `pointer-events: none`, so it can't hold a spell card you
  scroll or click in.
- **Icons:** `@iconify-json/game-icons` (CC BY 3.0, already credited in Docs) makes the monster tokens through
  `npm run srd:tokens`. It has `barbarian`, `wizard-staff`, `holy-symbol`, `rogue`, `bow-arrow`, `mailed-fist`,
  `warlock-eye`, `dwarf-helmet`, `elf-ear`, `dragon-head`, `orc-head` and more.
- **Facts found while planning** (each is fixed in the phase named):
  - Step through drops Create Token's target folder (Phase 8).
  - Quick party files only its last member into the target folder (Phase 8).
  - Create Token's edition filter doesn't reach the builder (Phase 8).
  - The species select's accessible name is "Species" even when it reads "Race" (Phase 3).
  - Changing a new character's class resets the scores and every choice (Phase 4).
  - Level up has no edition filter (Phase 8).
  - The guide, its screenshots and DocsPage still say "2024 rules" only (Phase 9).
  - `SpellDefinition.description` is blank for most spells that run, so the cards read the reference entries
    (Phase 1).

## Decisions

| | Decision |
|---|---|
| D1 | **Standard or the Codex, switched like the sheet.** *(User.)* The builder and Level up have the sheet's Standard \| Codex switch in their title bars. They share the remembered style for player characters (`storedStyle("pc")`), so the builder opens in the look your PC sheets use, and the sheet it opens matches. Standard uses the app's colours and font. The Codex uses its palette (Dark or Light, the sheet's setting), fonts, banner, dials and panels. Both looks are one component tree: only colours, fonts and a few ornaments differ (the banner's art, the dials' rings, the heading glyphs), and none of those holds a control (§1.1). |
| D2 | **Steps, beside a live preview.** *(User.)* The window gets bigger. A step rail on the left (Class · Origin · Abilities · Spells · Equipment · Review), the step in the middle, and a live preview of the sheet on the right that changes as you choose. Steps aren't locked: you can jump anywhere, and each step shows what's left to choose there. |
| D3 | **Hover anything to read its rules.** *(User.)* Classes, subclasses, species, backgrounds, feats, picks, skills, masteries, spells and features all show a rules card in the current look. It opens on hover after a short pause, on keyboard focus, and on tap. Moving the pointer into the card keeps it open, so long text can be scrolled. Pinning a card (its ⓘ, or `i`) puts the full text in the step's detail pane. |
| D4 | **A spell grid per choice, reimagined.** *(User.)* Each spell choice keeps its own grid, as today, and is stored the same way. What changes (§3.4): a finished grid folds to one line of its picks; your picks sit at the top of an open grid; spells are tiles with their school, cost mark, element colour, concentration and ritual tags, and support dot; spells you already have are tucked away rather than greyed in place; one set of filters serves every grid; finishing a grid opens the next open one; and "Your spells" at the top lists every pick by spell level, each linking to its grid. |
| D5 | **What a background or species gives is worked out from its data, per edition.** The card reads the same fields the builder applies, so it can't disagree with the result. Text is written by hand only where the data has none. |
| D6 | **Catalog choices stop being native selects.** Class, species, background, subclass, feat and pick choices become card grids or listbox pickers, with radio semantics and arrow keys. Selects stay for short fixed lists (the HP method, size). |
| D7 | **The Class step is a timeline.** Under the chosen class it lists every level up to the character's. For each level it shows what it gives on its own, with text and numbers ("Sneak Attack 3d6"), the hit points it adds, proficiency and new spell slots, with that level's choices inline. Later levels up to 20 are shown dimmed, names only ("6: Sculpt Spells"), so you can see what's ahead. |
| D8 | **"Runs in the simulator" is said in words and with the Codex's dot.** A filled dot means it runs, a half dot that it partly runs, and a hollow dot that the DM runs it. "ref" goes. The card says what isn't simulated. The spell grids get an "Only spells that run" filter. |
| D9 | **Ability scores are placed, not typed.** Each score is a dial in the Codex and a score box in Standard. Standard array: click or drag the six values onto the scores, and dropping onto a filled score swaps the two values. Point buy: − and + under each score, a 27-point meter, and each step's cost on its button. Manual: type into the score. A "Roll 4d6, drop lowest" helper fills six values to place, with no new method in the build record. The class's primary abilities are starred, and the background's or species' increases are picked right there. Hovering a score gives its breakdown. |
| D10 | **Mixed editions are explained where they're chosen.** "Ability increases from" becomes two cards, each saying exactly what it gives: "Sage (2024): +2 and +1, or +1 to all three, among CON, INT, WIS" against "Dwarf (2014): +2 CON, Hill Dwarf +1 WIS". A short note appears when the class, background and species aren't all from one edition. Labels stay true to the edition: Race and Subrace, Species and Lineage, Feature and Origin feat. |
| D11 | **Your draft is kept.** The draft is saved in this browser, per window kind and character, until it's applied or cancelled. Reopening offers "Continue where you left off" or "Start over". Ctrl+Z and Ctrl+Shift+Z undo and redo inside the builder. Changing a new character's class keeps its scores, background, species and origin choices. |
| D12 | **Level up is a moment, in either look.** The level turns from N to N+1 (in the Codex, on the banner's dial). "You gain" lists the new features with their text, and what got bigger. Hit points show the average, or a typed roll with a Roll button. Then this level's choices, and "What changes", folded. |
| D13 | **Create Token › Character becomes the fast path.** Quick build and Quick party stay there, because a DM testing encounters wants speed. Its selects get ⓘ cards. "Step through the choices…" becomes "Open the builder…", and carries the edition filter and target folder over. |
| D14 | **Classes, species and spell schools get icons** from game-icons, made by the token script. |
| D15 | **Homebrew and imported entries get the same cards.** The card uses their description, and falls back to derived lines (features by level). |
| D16 | **The Codex's pieces are shared, never copied** (as in CODEX_PARITY_PLAN.md). The banner, dials, panels and tabs move out of `CodexSheet.tsx` into shared components that the sheet and the builder both use. The builder's two looks never drift apart: a parity test checks that both looks offer the same controls, with no exceptions. |

## 1. The window

The Codex look is drawn below. Standard has the same layout and controls in the app's look (§1.1).

```
┌ New character ───────────────────────────────────────── [Standard|Codex]  ↶ ↷  – × ┐
│▓ Name your hero ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  Rules [2014|2024|Both]   ╭───╮ │
│▓ (Wizard · Evoker) (Sage) (Dwarf)                              3 choices left ›  │ 5 │ │
│▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ ╰───╯ │
│┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊┊│
│ ① Class       ✓ │                                                  │    ⬡ portrait      │
│ ② Origin      2 │                                                  │ AC 12    Init +2   │
│ ③ Abilities   ✓ │          the step                                │ Speed 30 Prof +3   │
│ ④ Spells      1 │                                                  │ HP 32              │
│ ⑤ Equipment   ✓ │                                                  │ ◎ ◎ ◎ ◎ ◎ ◎        │
│ ⑥ Review        │                                                  │ Saves  ▪ INT ▪ WIS │
│                 │                                                  │ Skills ▪ Arcana +6 │
│ ✦ Suggest the   │                                                  │ Features ● ● ◌     │
│   rest          │                                                  │                    │
├─────────────────┴──────────────────────────────────────────────────┴────────────────────┤
│ ‹ Back                                  3 choices left       Next: Origin ›  [Create character] │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Size.** It opens at 1180 × 820, clamped to the screen. It can be resized and remembers its size
  (`storageKey` "character-builder"). Container queries, like the Codex's, handle narrow windows:
  - under about 1000 px, the preview folds into a strip under the banner (the tiles and dials) that opens as a
    drawer;
  - under about 720 px, the step rail becomes a row of numbered chips.
- **Title bar.** The sheet's `StyleSwitch` (D1), then undo and redo (D11).
- **Banner.** In the Codex, the teal banner with its astrolabe.
  - The name is the big display-face field, with the placeholder "Name your hero".
  - The class, background and species pills each jump to their step.
  - The level dial sets the level. A click opens 1–20, and the arrow keys step it.
  - The edition filter sits in the banner.
  - "N choices left" is a button that goes to the first open choice.
- **Step rail.**
  - Each step shows a count of its open choices, a ✓ when it's done, and a warning mark when something's wrong
    (scores that don't fit the method).
  - Spells is hidden for a character with no spell choices.
  - The rail is a `nav`, with `aria-current="step"`.
  - "Suggest the rest" fills every open choice (`withSuggestions`).
- **Footer.** Back and Next, the open-choice count, and the primary button (Create character, Apply or Rebuild). The
  button is enabled whenever the scores are valid, as it is today: open choices are left out, and Review says which
  ones.
- **Live preview.** The sheet the character will have, at a smaller size, in the current look. In the Codex that's
  its sidebar and dials:
  - the portrait (token art or initials) in the octagon;
  - AC, initiative, speed, proficiency and hit points;
  - the six dials;
  - saves and skills, with proficiency pips;
  - senses;
  - features, as names with support dots, each with its card on hover;
  - attacks and spell slots.

  A value that just changed flashes in the accent colour (copper in the Codex, from its `codexFlash`). Picking a 2014
  Dwarf visibly turns the speed to 25 and adds darkvision. Hovering a number gives its breakdown:
  - AC from `armorClassOf().parts`;
  - hit points from a new `hpBreakdown`: "Level 1: d6 max 6 + CON 2; levels 2–5: 4 average + CON 2 each";
  - each score from its base plus its increases and feats.
- **Edit mode** uses the same window, opened on Review with "What applying changes" first. Rebuild (adopt) keeps its
  note and "Named twice" on Review.

### 1.1 The two looks

| Piece | Standard | Codex |
|---|---|---|
| Colours and font | The app's (`--ui-*`, Signika, the orange accent) | The Codex palette (Dark or Light) through the `--ui-*` remap; Fraunces and Figtree |
| Header | A plain header: the name field, the class, background and species pills, a Level select, the edition filter, "N choices left" | The teal banner with its astrolabe and the level dial, holding the same controls |
| Ability scores | The Standard sheet's score boxes | The Codex's dials |
| Panels and headings | Standard's sections, with their fold heads | Codex panels, with copper-glyph headings |
| Live preview | A compact Standard sheet: the HP, AC and speed line, the score boxes, saves and skills, features, attacks | The Codex's sidebar and dials, as above |
| Rules cards, step rail, pickers, spell grids | The app's colours | The Codex palette |

- **One component tree.** Every step, picker, card and behaviour is written once. The window's root sets
  `data-look`; under the Codex it also wraps the body in `CodexRoot` (§5), which supplies the palette, the remap and
  the fonts. The builder's own CSS reads only `--ui-*` tokens, plus a few `[data-look="codex"]` rules for the display
  face.
- **Look-specific rendering is limited to ornaments:** the banner's art, the dials' rings and the heading glyphs. Those
  hold no controls, so a parity test can require both looks to offer exactly the same controls (§7).
- **The switch is shared with PC sheets.** Switching in the builder updates `storedStyle("pc")`, which new PC sheet
  windows open in, and switching a PC sheet changes the builder's next look. Sheet windows already open keep theirs.
  The store gains an exported setter for a kind's style (today `rememberStyle` is private).
- **The window frame** (title bar and border) stays in the app's colours in both looks, as the sheet's does.

## 2. The rules card

```
┌───────────────────────────────────────────┐
│ ✸ Fireball                       2024 SRD │
│ 3rd-level evocation                       │
│ ───────────────────────────────────────── │
│ Action · 150 ft · V, S, M · Instantaneous │
│ DEX save · 8d6 fire · 20-ft sphere        │
│                                           │
│ A bright streak flashes from you to a     │
│ point you choose within range and then    │
│ blossoms with a low roar into a fiery     │
│ explosion. …                       more › │
│ Higher levels: +1d6 per slot above 3rd.   │
│ ● Runs in the simulator                   │
│ Already in your spellbook (Evoker 3)      │  ← why it's greyed out, when it is
└───────────────────────────────────────────┘
```

What a background gives, by edition:

```
┌ Sage ──────────────────────────── 2024 ┐   ┌ Acolyte ───────────────────────── 2014 ┐
│ Ability scores: CON, INT, WIS          │   │ Skills: Insight, Religion              │
│   +2 and +1, or +1 to all three        │   │ Feature: Shelter of the Faithful       │
│ Origin feat: Magic Initiate (Wizard)   │   │   As an acolyte, you command the …     │
│   2 cantrips and a 1st-level spell     │   │ No ability increases: under the 2014   │
│ Skills: Arcana, History                │   │   rules they come from your race.      │
│ Tool: Calligrapher's Supplies          │   │                                        │
│ Equipment: A quarterstaff, a robe … and│   │                                        │
│   8 GP, or 50 GP                       │   │                                        │
└────────────────────────────────────────┘   └────────────────────────────────────────┘
```

And a species or race:

```
┌ Dwarf ─────────────────────────── 2024 ┐   ┌ Dwarf ─────────────────────────── 2014 ┐
│ Humanoid · Medium · 30 ft              │   │ +2 CON · Medium · 25 ft                │
│ Darkvision 120 ft                      │   │ Darkvision 60 ft                       │
│ Dwarven Resilience · Dwarven Toughness │   │ Dwarven Resilience · Dwarven Combat    │
│   · Stonecunning                       │   │   Training · Tool Proficiency ·        │
│ Ability increases come from your       │   │   Stonecunning                         │
│   background (2024 rules).             │   │ Subrace: Hill Dwarf (+1 WIS)           │
└────────────────────────────────────────┘   └────────────────────────────────────────┘
```

- **What a card holds:**
  - a header: icon, name, edition badge, and the source for a homebrew or Open5e entry;
  - a meta line, per kind (table below);
  - "Gives" lines (D5);
  - the text, as markdown: the first few lines in the hover card, all of it in the pinned pane;
  - the support dot, with "Not simulated: …" when it applies;
  - when it can't be chosen, why: already taken, a prerequisite, the pick is full, or the other edition's version is
    owned.

  | Kind | Meta line | Body |
  |---|---|---|
  | Class | Hit die, primary ability, saves, armor and weapon training, kind of caster | The one-line description. The pinned pane adds the class table: level, proficiency, features, the class's columns and slots. |
  | Subclass | Its class, and the level it comes at | Features by level, with text |
  | Species or race | Type, size, speed, senses, and (2014) increases | Traits by level; lineage or subrace options |
  | Background | (none) | By edition, as above |
  | Feat | Category, prerequisite, repeatable | Text, and what it grants (+1 to an ability, spells) |
  | Pick (Fighting Style, Invocation, Metamagic, Lineage…) | Prerequisite, cost | The text of its feature or its description |
  | Skill | Its ability, and your bonus with it | The SRD's line |
  | Weapon mastery | The weapon's damage and properties | The property's SRD text |
  | Spell | Level and school, casting time, range, components, duration, concentration or ritual, save or attack, damage, area | Text, then higher levels |
  | Feature (timeline, preview) | Level, owner, action type, uses | Text, and its scaled numbers |

- **How it behaves:**
  - It opens after a 300 ms hover, or at once if another card is already open, so you can scan a grid quickly.
  - It stays open while the pointer is on it. It closes 150 ms after the pointer leaves it, or on Esc.
  - Keyboard focus shows it. `i` or the ⓘ button pins it into the detail pane.
  - On touch, a tap shows the card, and a second tap (or the card's Choose button) selects the option.
  - It is portalled to the owner document, kept on screen, at most 380 px wide, and scrolls past 60% of the window's
    height. It carries the current look's colours itself (`codexRootStyle(palette)` in the Codex), since
    `InfoTooltip` loses the Codex palette once portalled outside `.codex`.
  - It never covers the option under the pointer.
- **Accessibility.** Each option's `aria-describedby` points to its card's summary line. The pinned pane is a labelled
  region. With reduced motion, cards don't fade.
- **One component:** `RulesCard`, with a `useRulesCard` hook. The content comes from `describe*` (§5), so the card is
  the same in the builder, Level up, Create Token and, later, the sheet.

## 3. The steps

### 3.1 Class

- **Before a class is chosen** (and after "Change class"): a grid of class cards, each with its icon, name, edition
  badge, one-line description, hit die and primary ability. The banner's edition filter applies. Homebrew and
  imported classes have their own group.
- **Once one is chosen:** a header card with the icon, name and one-liner; hit die, primary ability, saves and
  training; and "Change class". The class table sits below it, folded.
- **Below that, the timeline (D7).** For a 2024 wizard:

```
HIT POINTS  (Average | Rolled)                                              Max HP 32
LEVEL 1 ── Wizard 1 ───────────────────────────────────── HP 8 (d6: 6 + CON 2)
  ● Spellcasting      Cantrips 3 · 4 prepared · two 1st-level slots         ⓘ
  ● Arcane Recovery                                                          ⓘ
  ◌ Ritual Adept      the DM runs it                                         ⓘ
  ┌ Class skills · choose 2 ──────────────────────────────────────── 2 of 2 ┐
  │ [✓ Arcana INT +5] [ History INT +5] [✓ Investigation INT +5] [ Insight…]│
  └──────────────────────────────────────────────────────────────────────────┘
  Cantrips and spellbook: chosen in Spells ›                       ✓ 3 of 3, 6 of 6
LEVEL 2 ── Wizard 2 ──────────────────────────────── +6 HP (4 average + CON 2)
  ┌ Scholar · Expertise · choose 1 ──────────────────────────────── 1 of 1 ┐
LEVEL 3 ── Wizard 3 ────────────────────────────────────────── 2nd-level slots
  ┌ Wizard subclass ─────────────────────────────────────────────────────────┐
  │ [ ✓ Evoker  2024 ]   [ Diviner  Homebrew ]                               │
  └──────────────────────────────────────────────────────────────────────────┘
  ● Potent Cantrip                                                           ⓘ
  Evocation Savant: chosen in Spells ›                                ✓ 2 of 2
LEVEL 4 ── Wizard 4 ───────────────────────────────────────────────────────────
  ┌ Ability Score Improvement or another feat ───────── ✦ suggested ────────┐
  │ [ ✓ Ability Score Improvement: +2 INT ]  [ Alert ]  [ War Caster ] …    │
  └──────────────────────────────────────────────────────────────────────────┘
LEVEL 5 ── Wizard 5 ──────────── Proficiency +3 · 3rd-level slots · cantrips 2 dice
  ● Memorize Spell                                                           ⓘ
┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄
AHEAD  6 Sculpt Spells · 8 a feat · 10 Empowered Evocation · 14 Overchannel · …
```

- **Choices sit inline,** each in the picker that fits it:
  - subclass: cards;
  - feat: cards with their prerequisites, and an Ability Score Improvement's points inline;
  - Fighting Style, invocations, Metamagic: chips or cards;
  - skills and expertise: chips showing the ability and your bonus;
  - weapon mastery: a table, not 38 chips. Weapons you carry come first (from Equipment), then the rest grouped by
    mastery property. A row reads "Longsword · 1d8 slashing · Versatile · Sap", and hovering the property gives its
    text.

  A spell choice is a line that links to Spells, with its count.
- **Hit points.** The method toggle heads the timeline. When the method is Rolled, each level's HP line takes the
  roll, with a Roll button for people without dice.
- **Multiclass.** The timeline runs by character level, and each level names its class ("Level 4 · Fighter 1").
  Adding a level in another class stays in Level up, as today, but the timeline shows it.
- **Suggestions.** "Choose for me" sits on each open choice, and a ✦ marks the builder's suggestions so a newcomer
  can tell they're sensible defaults.

### 3.2 Origin

- **Species or race.** A card grid in groups: 2024, 2014, and homebrew. "None (size, speed and senses by hand)" is the
  last card. Once one is chosen: its header card, its traits (text on hover or expand), and its picks inline
  (Lineage or Subrace, Draconic Ancestry, Giant Ancestry, size).
- **Background.** A card grid. Once one is chosen: its header card, what it gives, and its choices. Those include its
  origin feat's own choices, such as Magic Initiate's list and ability. The feat's spells link to Spells.
- **Ability increases** are picked in Abilities. Origin links there: "+2 and +1 among CON, INT, WIS: set in
  Abilities ›".

### 3.3 Abilities

The scores are the Codex's dials, drawn here as `( 15 )`, or Standard's score boxes. Everything else is the same in
both looks.

```
METHOD  (Standard array) (Point buy) (Manual)                      ✦ Suggested for a wizard
  Values to place:  [15] [14] [13] [12] [10] [8]      drag or click a value, then a score

     STR        DEX        CON        INT ★       WIS        CHA
    (  8 )     ( 13 )     ( 14 )     ( 15 )     ( 12 )     ( 10 )      base
                           +1         +2                               Sage
                                      +2                               Ability Score Improvement (4)
     8 −1      13 +1      15 +2      19 +4      12 +1      10 +0       final

INCREASES FROM
  [● Sage (2024)                         ]  [○ Dwarf (2014)                       ]
  [  +2 and +1, or +1 to all three,      ]  [  +2 CON, and Hill Dwarf +1 WIS     ]
  [  among CON, INT, WIS                 ]  [  (the 2014 rule)                    ]
  Sage's increases:  [+2 INT] [+1 CON] [  WIS]                                 3 of 3
Later increases are set where they're chosen: Ability Score Improvement, level 4 (Class ›).
```

- **Point buy** puts − and + under each score, a meter reading "27 points: 23 spent, 4 left", and each + button says
  what its step costs ("14 → 15 costs 2").
- **Manual** types into the score. "Roll 4d6, drop lowest" fills the six values to place. It uses the browser's
  random numbers, which is fine here: it's the UI, not the simulation.
- "Increases from" shows both cards only when there's a real choice: a species that gives increases next to a
  background that does, or a mixed-edition origin.

### 3.4 Spells

Each spell choice keeps its own grid and is stored as today (D4). The grids are reimagined so they're quicker to read
and much shorter. For a 2024 Wizard 5 (Codex look shown):

```
YOUR SPELLS                                                              P = prepared
  Cantrips   Fire Bolt ● · Mage Hand ◌ · Ray of Frost ● · Light ◌ (Magic Initiate) · …
  1st        Magic Missile ● P · Shield ● P · Sleep ◌ · Charm Person ● · Grease ● P · …
  2nd        Misty Step ● P · Scorching Ray ●
  3rd        Fireball ● P
  Search…     School [All ▾]   Cost [All ▾]   ☐ Only spells that run   ☐ Concentration   ☐ Ritual

BACKGROUND · SAGE · MAGIC INITIATE
  ✓ Two cantrips · 2 of 2          Fire Bolt · Light                                       Change
  ✓ A 1st-level spell · 1 of 1     Magic Missile                                           Change
LEVEL 1 · WIZARD 1
  ✓ Cantrips · 3 of 3              Mage Hand · Ray of Frost · Prestidigitation             Change
  ✓ Spellbook · 6 of 6             Magic Missile · Shield · Sleep · Charm Person · …       Change
  ✓ Prepared · 4 of 4              Magic Missile · Shield · Sleep · Grease                 Change
LEVEL 2 … LEVEL 4                  (folded, all done)
LEVEL 5 · WIZARD 5
  ▾ Spellbook · 1 of 2 · up to 3rd level                                     ✦ Suggest
    CHOSEN   ┃ Fireball            ┃
             ┃ 3rd · evocation  ●  ┃
    3RD      ┌───────────────────┐ ┌───────────────────┐ ┌───────────────────┐
             │ Lightning Bolt    │ │ Counterspell      │ │ Tiny Hut        R │
             │ evocation · ● · ● │ │ abjuration · ◆ · ●│ │ evocation · ● · ◌ │
             └───────────────────┘ └───────────────────┘ └───────────────────┘
    2ND      [Acid Arrow] [Gust of Wind] [Web  C] …
    1ST      [Alarm  R] [Color Spray] [Detect Magic  C R] …
    Tucked away: 14 already in your spellbook · Show
  ▸ Evocation Savant · 0 of 1                                                 opens next
  ▸ Prepared · 0 of 3                                                         opens next
```

- **A finished grid folds to one line** listing its picks, with "Change" to open it again. Only open grids are
  expanded, so a finished Wizard 9 is a column of short lines, not 26 grids.
- **Finishing a grid opens the next open one** and scrolls to it. "Next open choice" in the step's header does the
  same at any time.
- **Your picks come first.** An open grid starts with a "Chosen" row, so nothing you've picked is lost in the list.
- **The newest spell level comes first.** A grid's levels run from the highest it allows down (3rd, then 2nd, then
  1st), since a new level's spells are usually the new level's. The header says the limit: "up to 3rd level".
- **Tiles, not chips.** A tile shows the name, the school, the cost mark (● action, ▲ bonus action, ◆ reaction, from
  the hotbar), C and R for concentration and ritual, the support dot (D8), and an edge in the spell's element colour
  (the hotbar's: fire orange, radiant yellow, and the school's colour for a spell with no damage). Hovering a tile
  shows its rules card (D3).
- **What you already have is tucked away, not greyed in place.** Spells already in your spellbook, always prepared,
  or chosen in another grid fold into one line: "Tucked away: 14 already in your spellbook · Show". Shown, each says
  why it can't be picked again.
- **One set of filters serves every grid**: search, school, cost, "Only spells that run", concentration and ritual.
  It sits under "Your spells", and a grid with everything filtered out says "No spells match the filters" with a
  "Clear filters" button.
- **"Your spells"** at the top is a read-only list of every pick and granted spell, by spell level. Prepared ones are
  marked P, and always-prepared and free-cast spells say where they're from. Clicking a spell opens the grid that
  holds it.
- **A full grid.** When a grid takes one spell, clicking another tile swaps it. When it takes more and is full, the
  other tiles dim, and their card says "Spellbook full at this level: remove one to swap".
- **Prepared grids** list only the spells you can prepare (for a wizard, the spellbook's), as today, under the same
  tiles.
- **Reference-only spells** show the hollow dot and can be chosen, as today.
- **Keyboard.** The arrow keys move between tiles, Space picks or unpicks, and Enter on a folded line opens it.
- **Everywhere spells are chosen:** the Spells step, Level up (§4), and a feat's or subclass's own spell choices use
  the same grid.

### 3.5 Equipment

- **2024:** the class's packages (A, B and any C) as radio cards listing their items, and the background's packages
  the same way. Each weapon and armor has a card (damage, properties, mastery, AC). The preview shows the AC and
  attacks they give.
- **2014:** each line's options as cards, and "any martial weapon" pickers as weapon tables.
- A line says that only weapons and armor reach the sheet (PC builder D15).
- In edit mode the step reads "Equipment was set when the character was made", as today: equipment is applied once,
  at creation.

### 3.6 Review

- The preview at full size, in the current look: scores, features, attacks and spells.
- A checklist:
  - open choices, each a link to where it's made;
  - score problems;
  - what the simulator won't run ("Ritual Adept, Tiny Hut: the DM runs these");
  - the mixed-edition note.
- In edit and adopt mode, "What applying changes": today's `ChangeList`, restyled, with "Use the build's instead".

## 4. Level up

```
┌ Level up · Tamsin ─────────────────────────────────────────── [Standard|Codex]  – × ┐
│▓ Tamsin ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓  Rules [2014|2024]  ( 4 ) → ( 5 ) │
│▓ Wizard 4 (Evoker) · Sage · Dwarf  →  Wizard 5                                             │
│ CLASS    [✓ Wizard 4 → 5]   [ Fighter: multiclass needs STR or DEX 13 ]   [ Cleric … ]     │
│ YOU GAIN                                                                                    │
│   ● Memorize Spell                        ⓘ     ▲ Proficiency +2 → +3                       │
│   ▲ Two 3rd-level spell slots                   ▲ Fire Bolt 1d10 → 2d10                     │
│ HIT POINTS   +6  (4 average + CON 2)       (Average | Rolled: [ 5 ] Roll)                  │
│ CHOOSE                                                                                      │
│   ▾ Spellbook · 1 of 2 · up to 3rd level           CHOSEN ┃ Fireball ┃   (the §3.4 grid)   │
│   ▸ Prepared · 0 of 1                                                       opens next      │
│ ▸ What changes (7)                                                                          │
│                                                           [Cancel]   [Level up to 5]       │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

- It is about 760 px wide, built from the same parts as the builder, in either look (D1). Its spell choices use the
  §3.4 grids, for the new level's choices only.
- **Class to level** is a row of cards: the classes it has first, then multiclass options with their prerequisites.
  The other edition's version of an owned class is disabled, with the reason.
- The edition filter sits in the banner (it's missing today).
- The level animates from N to N+1 (the dial, in the Codex), unless reduced motion is on.

## 5. Architecture

- **`src/components/codex-ui/`** (new, Phase 0). The Codex's pieces, shared:
  - `CodexRoot`: the palette tokens, the `--ui-*` remap and the fonts, as one class the sheet and the builder share.
    Portalled pieces use `codexRootStyle(palette)`.
  - `Banner`, `LevelDial`, `AbilityDial`.
  - `Panel` and `Heading`, with the glyphs.
  - `Tabs`, with a roving tabindex.
  - `Tile`, `Pips`, `Pill`, `SupportDot`.

  `CodexSheet.tsx` uses them, with no visual change.
- **The builder's look** (D1). A `BuilderLook` context ("standard" or "codex") is set by the window from
  `storedStyle("pc")` and changed by its `StyleSwitch`. The window's root sets `data-look` and, in the Codex, wraps the
  body in `CodexRoot`. A few components render per look: the header (the Codex `Banner` or a plain header row), the
  score widget (`AbilityDial` or Standard's score box), the panel heading, and the preview's frame. Each takes the same
  props and holds the same controls. `useSheetWindowsStore` exports a setter for a kind's remembered style.
- **`src/lib/character-builder/describe.ts`** (new, pure). A `RulesEntry` is `{ kind, id, title, edition?, source?,
  meta: string[], gives: Array<{ label, value, text? }>, summary, text, higherLevels?, support?, notSimulated?,
  blocked? }`. The `text` is markdown. Functions:
  - `describeClass`, `describeSubclass`, `describeSpecies`, `describeBackground`, `describeFeat`;
  - `describeOption(slot, option, sources)`, `describeSpell(id)`, `describeSkill(id, edition)`,
    `describeMastery(name)`, `describeFeature(feature)`;
  - `hpBreakdown(build, sources)` and `scoreBreakdown(build, built)`.
- **`src/data/srd/rules-text.ts`** (new). The 18 skills (SRD 5.2 and 5.1 wording) and the 8 weapon mastery properties
  (SRD 5.2), checked word for word against the PDFs. The attribution already covers SRD 5.1 and 5.2.
- **The 2024 background's tool** comes from the reference JSON: `tool?` is added to `BackgroundDefinition`, with a
  schema entry (the catalog round-trip test catches a missing one).
- **`ChoiceOption`** gains:
  - `info?: { kind, id }`, saying how to describe it;
  - for spells, `school`, `castingTime`, `concentration`, `ritual` and the damage type that colours its tile.
    `SpellFacts` already has most of these. This way the tiles and filters don't look up every spell.
- **`BuiltFeature`** gains `at: { characterLevel, owner, classLevel? }`, for the timeline.
- **`src/lib/character-builder/timeline.ts`** (new, pure): `timeline(build, built, sources)` gives each level's
  features, hit points, proficiency, slots and choices, plus the levels ahead, from the catalog.
- **`src/lib/character-builder/spell-grids.ts`** (new, pure). The spell grids' model (D4), with no change to how
  choices are stored:
  - `yourSpells(built)`: every pick and granted spell by spell level, each with the slot it came from, prepared or
    not, and where a granted one is from;
  - `gridView(slot, filters)`: a slot's options sorted highest level first, with the slot's picks split out as
    "chosen" and the options you already have split out as "tucked away", each with its reason;
  - `nextOpenSpellSlot(choices, after?)`: which grid opens next.
- **`src/lib/character-builder/steps.ts`** (new, pure): `stepOf(slot)` and the open counts per step.
  - Ability increases go to Abilities, wherever they come from. An Ability Score Improvement's points stay with their
    feat in Class, and Abilities shows them read-only.
  - Spell choices go to Spells.
  - Everything else goes to Origin for background and species slots, and to Class for level slots.
- **`src/lib/character-builder/drafts.ts`** (new). Drafts are kept in localStorage, inside try/catch, per window kind
  and character id. They're cleared on apply or cancel, and versioned, so a draft from an older build schema is
  dropped. The draft's history is the undo stack.
- **`src/components/rules-card/`** (new): `RulesCard`, `useRulesCard`, `RulesText` (markdown), and a body per kind.
- **`src/components/builder/`** (rebuilt):
  - `BuilderWindow`: the header, rail, footer and preview;
  - `steps/ClassStep`, `OriginStep`, `AbilitiesStep`, `SpellsStep`, `EquipmentStep`, `ReviewStep`;
  - `pickers/CardGrid`, `ChipGroup`, `SpellGrid` (with `SpellTile` and the shared `SpellFilters`), `MasteryTable`;
  - `BuildPreview`, with a frame per look;
  - `LevelUpWindow`, built on the same parts.

  `ChoiceControl` becomes the dispatcher by kind over the new pickers.

## 6. Phases

Each phase is one commit, with its tests and a browser check in both looks (and both Codex palettes) and both
editions.

### Phase 0: shared Codex pieces (refactor; medium)

Move the Codex's pieces into `codex-ui`, and make `CodexSheet` use them. Before-and-after screenshots of the Codex
(four creatures, both palettes) must match, and `codex-sheet` and `codex-parity` must pass. The tabs gain arrow keys,
as `Character Codex.html` has.

### Phase 1: the describe layer (headless; medium)

Build `describe.ts` and `rules-text.ts`, the `ChoiceOption` info and spell facts, the level on `BuiltFeature`,
`hpBreakdown`, `scoreBreakdown`, and the background's tool. Tests:

- per edition: 2024 Sage, 2014 Acolyte, the 2024 and 2014 Dwarf (with the Hill Dwarf), the Half-Elf's choice, and a
  homebrew background without a description falling back;
- every option in every slot of every SRD class at levels 1 to 20 describes itself without throwing and with non-empty
  text, which catches missing refs;
- 18 skills and 8 masteries have text.

### Phase 2: rules cards in today's builder (UI; medium)

This ships the hover ask early, before the redesign. Build `RulesCard` and the markdown renderer. Wire them into
today's `ChoiceControl` chips, into ⓘ buttons beside today's selects (class, background, species, subclass, feat), and
into Create Token's selects. "ref" becomes a support dot and words. Tests cover hover, focus, tap, Esc and pin, and
each kind's card contents.

### Phase 3: the new window, both looks, the preview, Origin and Review (UI; large)

- `BuilderWindow`, its `BuilderLook` context, and the Standard | Codex switch shared with PC sheets (D1).
- The header in both looks: name, pills, level dial or select, and edition filter.
- The step rail and the footer.
- The live preview in both looks, with its breakdowns and flashes.
- The Origin step: species and background card grids, what each gives, and their picks.
- The Review step: the checklist, `ChangeList`, and "Named twice".
- Draft saving and undo (D11).
- The species picker's accessible name follows its label.
- `tests/builder-parity.test.tsx` (§7).

Until their phases, the Class, Abilities, Spells and Equipment steps show today's sections, restyled.

### Phase 4: the Class step and the timeline (UI, plus a little lib; large)

- The class grid, the header card and the class table.
- The timeline: features with their text, and hit points per level, with rolled HP and Roll.
- Inline choices as card and chip pickers: subclass, feat with prerequisites, picks, skills with bonuses, expertise,
  and the mastery table.
- "Ahead", the ✦ suggestions, and "Choose for me".
- Changing the class keeps the scores and origin (D11).

### Phase 5: the Abilities step (UI; medium)

- The dials (Codex) and score boxes (Standard).
- Placing the standard array by click and by drag. With the keyboard, you pick a value and then a score.
- Point buy's steppers and meter.
- Manual, and Roll 4d6.
- The "increases from" cards, the increases picker, and the list of later increases.
- The breakdown on hover.

### Phase 6: the Spells step (lib + UI; medium to large)

`spell-grids.ts`, with tests:

- a Wizard 5's and a Wizard 9's grids: every pick appears in "Your spells" once, under its spell level, linked to its
  slot;
- a grid lists its highest level first, its picks as "chosen", and spells already in the spellbook as "tucked away"
  with the reason;
- the next open grid after finishing one;
- Magic Initiate's grids under the background, Evocation Savant's under its levels;
- a cleric's prepared grid, a warlock's pact spells, and a homebrew class's list;
- always-prepared and free-cast spells in "Your spells", locked, with where they're from.

Then the UI: folded and open grids, spell tiles with marks and colours, the shared filters, "Your spells", the swap in
a one-spell grid, the full-grid card text, auto-advance, and keyboard movement between tiles.

### Phase 7: the Equipment step (UI; small to medium)

Package cards, the 2014 lines, weapon and armor cards, and the AC and attacks in the preview.

### Phase 8: Level up and Create Token (UI; medium)

- `LevelUpWindow` on the new parts, in both looks (D12): class cards with multiclass prerequisites, "You gain", hit
  points, the choices (with the §3.4 spell grids), "What changes" folded, and the edition filter.
- Create Token: "Open the builder…" carries the edition and folder over, its selects get ⓘ cards, and Quick party
  files every member into the folder.

### Phase 9: icons, docs and polish (small to medium)

- Class, species and spell-school icons from the token script: `npm run srd:tokens` also writes
  `public/icons/builder/*.svg`, and the credits stay CC BY 3.0.
- Rewrite the guide (`docs/guides/build-a-character.md`) with new screenshots in both looks, and fix its "2024 rules"
  wording and DocsPage's line 303 for editions.
- A reduced-motion pass.
- The builder's keyboard shortcuts, listed in its ? tooltip.

## 7. Testing

- **Headless** (Vitest): describe, timeline, spell grids, steps and drafts.
- **Components** (RTL with happy-dom):
  - a card on hover, focus, tap, Esc and pin, for each kind in both editions;
  - the standard array's swap, and point buy's meter;
  - the step counts;
  - restoring a draft, and undo;
  - the spell grids: folding, auto-advance, the swap, tucked-away spells, the filters;
  - the style switch, and that it updates `storedStyle("pc")`;
  - Create Token's carry-over.
- **Builder parity** (`tests/builder-parity.test.tsx`, new), in the manner of `codex-parity.test.tsx`. For a 2024
  Wizard 5, a 2014 Cleric 5 and a Fighter 5, every step and Level up is rendered in both looks, and the sets of
  controls (role and accessible name) must be equal. Unlike the sheet's, it allows no exceptions.
- **Existing tests** need updating for these names:
  - `character-builder-ui.test.tsx`:
    - labels "Class", "Level", "Species", "Size", "Class to level";
    - buttons "Suggest the rest", "Create character", "Level up to N";
    - groups "Class skills", "Two cantrips: Cantrips", "A 1st-level spell, always prepared: 1st level";
    - the text "Guidance ref".
  - `editions-builder.test.tsx`: `CatalogOptions`' optgroups become the card grid's group headings.
  - `homebrew-window.test.tsx`: Create Token keeps its selects, so it's mostly unchanged.
  - `popout-window.test.tsx`.

  Accessible names stay where the control survives. A card grid named "Class" holds radios named by entry, so most
  queries change from `selectOption` to clicking a radio. Spell grids keep their group names ("Two cantrips:
  Cantrips").
- **Codex parity.** The sheet's builder buttons keep their names ("Level up…", "Open in the builder…", "Rebuild with
  the builder…").
- **Contrast.** The card, tile and preview colours join the Codex palette contrast test. The spell element colours
  are checked against both looks' tile backgrounds.
- **Browser** (Playwright, scripted per phase), in both looks, both Codex palettes, a narrow window, and by keyboard
  only:
  - a 2024 Wizard 5 (Evoker, Sage, 2024 Dwarf);
  - a 2014 Cleric 5 (Hill Dwarf, Acolyte);
  - a 2024 Paladin with a 2014 race (mixed editions);
  - a 2024 Fighter 5 (masteries);
  - a level up from 4 to 5 with spells;
  - a multiclass level up;
  - adopting a hand-built PC;
  - a homebrew class;
  - switching looks mid-build keeps the draft, the step and the open grid.
- **Performance.** Hovering never rebuilds, and a pick rebuilds once (today's `useMemo`). A Wizard 20's builder should
  open, and each pick land, in about 100 ms, measured in the browser check.

## 8. Risks

- **A big UI surface.** Phases 3 to 8 replace most of the builder's UI. Phase 2 ships hover first in the old builder,
  and every later phase keeps the builder working end to end.
- **Two looks to keep in step** (D1). One component tree, ornaments that hold no controls, and the builder parity
  test keep them together. Each phase is checked in both looks.
- **Long spell lists.** A Wizard 17's spellbook grid lists about 200 spells. Folding, the highest-level-first order,
  tucking away what you have and the shared filters keep it short; tiles render only for open grids.
- **Text written for a page.** The SRD markdown has headings and tables (species traits), meant for a page. The hover
  card renders a short first part, the pinned pane renders all of it, and long cards scroll.
- **Two places for the Codex look.** Phase 0 makes them one.
- **A draft against a changed catalog.** A saved draft that names a since-deleted homebrew entry goes through
  `CatalogGate`'s missing notice, like a saved build does.
- **Hover on touch, and hover fatigue.** The open delay and hover intent help, and so does the tap model. Cards never
  cover the option under the pointer.
- **Test churn.** Moving from selects to radios changes many queries. Each phase updates the tests it breaks.

## 9. Out of scope

- New rules, classes or builder logic. The build record, `buildCharacter` and the engine stay as they are.
- Pooling spell choices across levels (the first draft's D4). The user chose a grid per choice.
- Uploading a portrait in the builder. The preview shows token art when there is some.
- Moving builder windows into a popped-out sheet (CHARACTER_SHEET_WINDOWS_PLAN.md).
- The Homebrew window's editors.
- Swapping spells on a level up or a long rest, and retraining.
- Tool proficiencies, beyond showing the background's tool.
- Character details: personality, backstory, and alignment beyond what the sheet has.
- The full rules card on the sheet's own feature rows. That's a natural follow-up, with the same `RulesCard`.

## Built so far

Built on the branch `builder-ux`, one commit per phase.

- **Phase 0** (e268982). The Codex's root, banner and astrolabe, level dial, headings, ability dials, tabs and
  portrait live in `src/components/codex-ui`, and the sheet uses them. Screenshots of the Codex before and after
  match pixel for pixel. The tabs gained arrow keys, Home and End.
- **Phase 1** (023c698). `describe.ts`: a rules entry for every class, subclass, species, background, feat, pick,
  skill, mastery, ability, spell and feature, and every choice's options; the hit point and score breakdowns
  (`BuiltCharacter.breakdown`); the level and owner of each feature. Skill and mastery text is copied word for word
  into `rules-text.ts`. A 2024 background's tool comes from the reference data. The 2024 Greater Invisibility had no
  text, and an override gives it the SRD 5.2's.
- **Phase 2** (ea815be). `RulesCard` and its provider: hover after 300 ms (at once while another card is open),
  focus, a first tap, Esc, and pinning. Today's chips, the ⓘ beside each select and Create Token's selects show
  cards. "ref" became a drawn support dot with its words.
- **Phase 3** (e95354a). The new window (`CharacterBuilder.tsx`, about 1180 by 820, resizable): the header in both looks
  (banner and level dial, or Standard's), the step rail with each step's open count, the footer, and the live
  preview, with breakdowns and flashes, and a strip in a narrow window. Origin has species and background card
  grids. Review has the checklist, the summary, the changes and "Named twice". Class, Abilities, Spells and
  Equipment show today's sections, restyled, until their phases. The look is the PC sheets' (`storedStyle("pc")`),
  and the Codex's colours are switched in the title bar. The draft is kept per character
  (`battlesim:builder-draft:<key>`), with undo and redo (buttons, Ctrl+Z, Ctrl+Shift+Z, Ctrl+Y). Opening again offers
  it ("Continue where you left off" or "Start over"); creating, applying or cancelling forgets it. Tests:
  `builder-steps` (where each choice is made, counts), `builder-window` (counts, undo, drafts, look) and
  `builder-parity` (a 2024 Wizard 5, a 2014 Cleric 5 and a Fighter 5: equal controls on every step, no exceptions).
  The step area is named "<Step> step", so it doesn't share a name with the Class select.
- **Phase 4** (f606c5e). The Class step (`steps/ClassStep.tsx`) on `timeline.ts`: `timeline(build, built, sources)` gives each
  level its class, hit points, what grew (the proficiency bonus and every class table number that changed), its own
  features (the class's, then the subclass's under the choices) and its choices; `ahead` runs the last level's class
  on to 20; `classTable` is the 1–20 table with the slots in one column. A feature or choice that comes back at a later
  level (Font of Magic, Evocation Savant) is named at its first. The header card has the class's facts, "Change class"
  (creating or rebuilding only) over a card grid with a note before it switches, and the table. The hit point method is
  a segmented switch, and Rolled gives each later level a typed roll and a Roll button. Choices sit inline
  (`pickers/InlineChoice.tsx`): subclass, feat and one-of picks as cards, skills and expertise as chips with the
  ability and bonus, weapon mastery as a table (the weapons you start with first, then by property, the property's
  card on hover), Ability Score Improvement points as steppers, a level's spells as one line to Spells. Open choices
  offer "Choose for me", and the builder's picks are marked ✦. `withClass` changes a new character's class and keeps
  its scores, background, species, origin choices and hit point method (D11). Card grids drop to three columns, then
  two, in a narrow window. A Wizard 20's pick lands in about 110 ms in the browser.
- **Phase 5** (81c9690). The Abilities step (`steps/AbilitiesStep.tsx`). Each score is a dial (Codex) or a box (Standard) with its
  base and every increase under it, and its breakdown card on hover; the class's primary abilities are starred. The
  method is a segmented switch (changing it keeps the scores' order: the array is dealt highest first, point buy clamps
  to 8–15). Standard array: click a value and then a score, or drag a value (or a score) onto a score, and the two swap;
  by keyboard, Enter on a value, then Enter on a score. Point buy: − and + under each score, a meter ("27 points: 23
  spent, 4 left"), and each + says what it costs. Manual: type, or "Roll 4d6, drop lowest" (the browser's dice) and
  place the rolls. "✦ Suggested for a …" puts the class's array back. Increases: two cards say what the background and
  the species or race give when both can (a 2014 race, a mixed origin), otherwise a line says where they come from;
  a background's three points are "+2 and +1" (two rows of ability radios, the +2 never also the +1) or "+1 to three";
  a race's are said, and a Half-Elf's chosen; later increases (an Ability Score Improvement) are listed, set in Class.
  A score's card closes when its score changes, so it can't show stale numbers.
- **Phase 6** (45a7f23). The Spells step (`steps/SpellsStep.tsx`, `pickers/SpellGrid.tsx`) on `spell-grids.ts`: `gridView` (a
  slot's picks as "chosen", the rest by level from the highest down under the filters, what's had "tucked away" with
  the slot's own reason, how many the filters hide), `nextOpenSpellSlot`, `spellGroups` (background, species, each
  level) and `yourSpells` (every spell once, by level, linked to the grids that chose it, prepared or only in the book,
  always prepared or cast free with what gives it). Finished grids fold to a line ("✓ Spellbook 2 of 2 Web · Blur
  Change"); one opens at a time (the first open one, or the one asked for); finishing a grid folds it and opens the
  next open one. Tiles are `role="checkbox"` named by the spell, with the school, cost mark (● ▲ ◆ ◷), C and R, the
  support dot and an edge in the element's colour; arrow keys move between them. A grid of one swaps its pick; a full
  grid of more dims the rest, and their cards say "… is full: remove one to swap". One filter bar (search, school,
  cost, only what runs, concentration, ritual) serves every grid. "Your spells" opens the grid that chose a spell, and
  a level's line in Class opens that level's grid (`openSpells` on the builder model). The window's root is now one
  element in both looks (`CodexRoot plain`), so switching looks keeps an open grid.
- **Phase 7** (3dae5d4). The Equipment step (`steps/EquipmentStep.tsx`): the class's and the background's packages as cards
  ("A: Two daggers, a quarterstaff…", "B: 55 GP", "None"); a 2014 class's lines as cards, and a table for each "any
  martial weapon" ("Martial weapon 1 of 2"); "What reaches the sheet" lists the weapons and armor, each with its card
  (`describeEquipment`: a weapon's damage, properties, reach or range and mastery; armor's AC, Dexterity, Strength and
  Stealth). The preview's AC and attacks follow. A built character's step says equipment was set when it was made.
  The interim steps are gone (`scoresProblem` lives in `builder/scores.ts`).
- **Phase 8** (bd71ec5). Level up (`LevelUpWindow.tsx`) on the builder's parts, in either look (the title bar's `LookSwitch`,
  shared with the builder), about 780 px wide: the banner (or Standard's header) with the edition filter ("Rules
  shown") and the level turning from N to N+1 (the dial arrives, unless reduced motion is on); "Class to level" as
  cards, its classes first and "Multiclass…" opening the rest with what each needs (the other edition's version of its
  own class is disabled, saying why once); "You gain" (the level's features and what grew); hit points (Average or
  Rolled, typed or rolled); the choices (§3.4 grids for spells, inline pickers for the rest, already suggested); and
  "What changes", folded. It provides the builder model, so the pickers are the builder's. Create Token's "Step
  through the choices…" became "Open the builder…": the seed carries the edition filter and the target folder, the
  builder opens on that filter and files the new character in the folder, and Quick party files every member. Create
  Token's 2014 or 2024 filter now turns the chosen class, background and species into that edition's. Found and fixed:
  a typed hit die roll after a level without one left a hole in `hp.rolls`, saved as `null`, which failed the build's
  schema (the old Level up had it too); `withHitDieRoll` keeps the list full (0: no roll), and the schema reads an old
  `null` as 0. `builder-parity` now covers Level up too.
- **Phase 9** (7d9ed88). Icons: `npm run srd:tokens` also writes `public/icons/builder/<group>-<name>.svg` from
  `scripts/srd-tokens/builder-icons.ts` (12 classes, 11 species and races, 8 schools; each SRD id's slug without its
  edition, so both Wizards share one), recorded in `token-icons.json` under `builder` with the same CC BY 3.0 credits
  (`lorc/lyre` and `delapouite/hobbit-door` checked against the game-icons GitHub folders; the rest already credited).
  `builderIconUrl` finds one; `BuilderIcon` draws it as a CSS mask in the colour around it: on class, species and
  Level up cards, the class's header tile, and spell tiles. The guide (`docs/guides/build-a-character.md`) is rewritten
  for the new windows with 13 new screenshots in both looks (the Homebrew ones kept and renumbered 14–20), and
  DocsPage's line says both editions. Reduced motion: the meter's transition and the Spells step's smooth scroll stop
  too (the preview's flash, the level dial and the cards already did). A "?" in each window's title bar lists the
  keyboard shortcuts. Contrast (§7): every spell element colour reads at 3:1 on Standard's and the Codex Dark's tiles;
  on the Codex Light palette they didn't (1.2 to 2.9), so there they're shaded to 55% (tile edges, "Your spells", the
  rules card's edge), and `builder-contrast` checks both. Multiclass options now take the edition filter over the whole
  list, so a 2024 rogue isn't offered the 2014 Rogue.
