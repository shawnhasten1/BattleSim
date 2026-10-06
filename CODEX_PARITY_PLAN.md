# Codex Parity Plan: everything Standard does, in the Codex

**Status:** complete, built 2026-10-06 on branch `sheet-windows`, one commit per phase. It follows
`CHARACTER_SHEET_WINDOWS_PLAN.md` (Phases 0–10). The user accepted every decision's default and asked for all the
phases. See "Built so far" at the end.

The Codex can now edit and add abilities in place (that plan's D13 and D14). But Standard's sheet still does things the
Codex can't. The user found the first one: an ability can't be deleted from the Codex. This plan lists every gap and
closes them, so a DM never has to switch to Standard to finish a job.

## The rule: the same code, never a copy

As with the ability editor and Add ability, the Codex calls the same store actions and helpers as Standard. Where
Standard's logic sits inside a component, it moves into a shared module first, and both sheets use that. There are two
kinds of fix:

- **A quick, paper-sheet interaction** gets Codex-styled controls over the shared helper: a delete, a uses box, a typed
  save, a speed.
- **A dense form** is hosted as is, in a Codex panel: Resources, the Token tab's sections, Level & CR, qualified
  defenses. Inside the Codex root the app's `--ui-*` tokens are the palette's (the Phase 9 mapping), so Standard's
  components take the Codex's colours with no restyling. Any hard-coded colour found in them becomes a token with its
  old value as the fallback, as Phase 9 did for the editor.

## What Standard has that the Codex hasn't

| # | Standard | Codex today | Fix | Phase |
|---|---|---|---|---|
| 1 | **Delete** a row, from its ⋯ menu. "Delete Claws?" asks when a multiattack or legendary action uses it, and offers a replacement. "Deleted Bite. Undo" follows. | None | ⋯ menu on every Codex row, with the same prompt and toast | 1 |
| 2 | **Duplicate** a row | None | The same ⋯ menu | 1 |
| 3 | **Move to** actions, bonus actions or reactions | None | The same ⋯ menu | 1 |
| 4 | An optional rule's **Use it** switch (a feature switched on or off) | Shows "off" as a chip | A Codex on/off pill on the row | 1 |
| 5 | The **automation dot** on each row (● simulated, ◐ partly, ○ reference only), with why | None | The same dot, Codex-coloured | 1 |
| 6 | **Resources**: what each pool has left for this token, and what every token starts with. Also Refill all, add a spell slot level or a named pool, and remove a pool. Recharges show ready or recharging. | Spell slot boxes only | A Resources panel (Standard's `ResourceList`, hosted), plus Character Codex's **Uses** boxes on each row that spends a pool | 2 |
| 7 | **Legendary actions a round** (the pool's size) | Shown in a note | Through Resources (#6) | 2 |
| 8 | **Spellcasting ability** picker (Auto, or an ability) | A read-only tile | The Ability tile becomes a picker, through the same store call as `SpellcastingHeading` | 2 |
| 9 | **Upcast offers** (an SRD spell's upcasting for a homebrew copy) and **item offers** (the SRD's simulated item for an Open5e one) | None | Hosted on Spells and Items | 2 |
| 10 | **Max HP**, typed (tokens at full follow it) | Read-only, "set on Standard's Stats" | Typed in the sidebar's HP block | 3 |
| 11 | **AC without armor**, typed while worn armor works the AC out | Total only | "Without armor" under the AC tile when armor is worn | 3 |
| 12 | **Speeds**: fly, swim, climb and burrow, and hover | Walk only | Mode pills under Speed: add, type, remove, hover | 3 |
| 13 | A save's or a skill's **own number**, typed (a statblock's +7) | Boxes only (an own number shows dashed) | The value is typed in place, as on Stats | 3 |
| 14 | **Add a skill** (a skill it doesn't have, at its proficient bonus) | Cycling a box covers the 18; no way to add another | "Add a skill" under the list, as on Stats | 3 |
| 15 | **Qualified defenses** ("from nonmagical attacks that aren't silvered") and **Absorbs** | Plain tags; a qualified tag shows and can be removed | "More defenses…" opens Standard's `DefensesSection` in the panel | 3 |
| 16 | **Senses** (darkvision, blindsight, tremorsense, truesight) | None | Range fields in Origin | 3 |
| 17 | **Level & CR**: challenge rating, proficiency override, a hand-made PC's classes, a monster's caster level, Rebuild with the builder, and Level down | Level typed for one class; CR read-only | CR typed in the dial; the Proficiency tile typed (an override); a "Level & class" panel hosting `LevelSection` | 3 |
| 18 | **Source** ("Source: 5e SRD") | None | In Origin | 3 |
| 19 | **The Token tab**: token name, faction, This fight (enters, surprised, already up, altitude, in its lair), Tactics (profile, spending, "Use these for every Goblin", what the AI will use), Appearance (image, border, scale, glow, nameplate), Status & position | None | A **Token** tab hosting those sections. "What the AI will use" opens abilities in the Codex's editor. | 4 |
| 20 | **Standard actions** reference ("Every creature can Dash · Disengage · Dodge · Hide · Help") | None | One line at the foot of Abilities | 5 |

**Already the same,** by sharing the frame or a component: the vitals' conditions and concentration, compendium and
SRD drops onto the window, the ⋯ window menu (save to library, export, duplicate token, make it its own creature,
delete token, level up), Undo and Redo, the automation count in the title bar, editing and adding abilities.

**Left out on purpose:** editing death saves and spending hit dice (D10 of the windows plan), and the fields the app
doesn't store (D7).

## Decisions

| | Decision | Default |
|---|---|---|
| P1 | How a row's actions look | **Standard's ⋯ menu on every Codex row**: Duplicate, Move to…, Delete. `RowMenu` is exported from `AbilitiesList` and used by both sheets. *Alternative:* Character Codex's **×** for delete, with ⋯ for the rest. |
| P2 | Deleting | **Exactly Standard's flow.** The "Delete Claws?" prompt under the row (with its replacement picker) and the "Deleted Bite. Undo" toast come out of `ActionsTab` into a shared `useAbilityRemoval` hook and `RemovalPrompt` component. |
| P3 | Uses on rows | **Character Codex's Uses boxes**: an ability that spends a pool shows that pool's boxes for the token shown, and a box spends or gives back one, as Resources' dots do. A recharge shows Ready or Recharging. A new `rowPool(definition, ref)` helper, next to the list model, says which pool a row spends. Above 8, it's a number, as Resources does. |
| P4 | Managing pools | **Standard's `ResourceList`, hosted** in a folded Resources panel at the top of Abilities, and on Spells for slot levels. |
| P5 | The Token tab | **Hosted**: a fifth Codex tab with Standard's four Token sections, each in a Codex panel. The token name and faction sit at the top in Codex style. |
| P6 | Level, CR and proficiency | **Typed where they show** (the dial, the Proficiency tile). The rest goes in a "Level & class" panel in Details, hosting `LevelSection`. A built character keeps its read-only dial (windows plan D9). |
| P7 | Qualified defenses | **Quick tags stay for plain ones.** "More defenses…" opens `DefensesSection` for qualifiers and Absorbs. |
| P8 | Attunement (beyond parity) | **An Attuned pill on Items rows** that need attunement, as Character Codex has. Standard only sets it in the editor. It's the same record change the editor makes. *Alternative:* leave it in the editor. |

## Phases

Each phase is one commit. Tests pass before it's committed. Browser checks (Playwright, Chromium and Firefox) cover
both the Codex popped out and the Codex in the page.

### Phase 1: row actions (the user's ask)

- Extract from `ActionsTab`: `useAbilityRemoval` (request, the replacement state, remove, and the undo toast's depth)
  and `RemovalPrompt`. Also `duplicateRow` and `moveRow` as helpers (`lib/ability-editor/list.ts` has `duplicateOf`
  already). `ActionsTab` uses them unchanged.
- Export `RowMenu` (and the automation dot) from `AbilitiesList`.
- In the Codex, every row on Items, Abilities, Attacks and Spells gets the dot, the ⋯ menu, and, for an optional rule,
  a "Use it" pill. The delete prompt opens under the row, and the toast is the Codex's.
- **Tests:** delete a plain ability, and Undo brings it back; delete a weapon a multiattack uses (the prompt, a
  replacement, then cancel); duplicate shows the copy focused; move an action to bonus actions; switch an optional
  feature off and on; Standard's Abilities tab tests unchanged.

### Phase 2: uses and resources

- `rowPool(definition, ref)`: the pool a row spends, if any (uses, charges, a class pool, slots for a spell), with its
  kind (pool or recharge).
- Uses boxes on rows, for the token shown, through `updateResource`, as Resources' dots.
- A folded **Resources** panel at the top of Abilities, hosting `ResourceList`.
- Spells: the Ability tile becomes a picker (Auto, INT, WIS, CHA, then the rest), and `UpcastOffers` shows above the
  list. Items: `ItemOffers` above the list.
- **Tests:** spending a use on a row changes that token's pool and no other's; a recharge toggles; Refill all; adding
  a pool shows on its row; the spellcasting ability picked changes the DC and attack tiles; an upcast offer taken.

### Phase 3: Details

- The sidebar's max HP is typed (tokens at full follow it, through the same store call as Stats).
- "Without armor" sits under AC while armor works it out.
- Speed mode pills: `withMovementMode` comes out of `StatsCore`, and Stats uses it too.
- Saves and skills: the value is typed in place (an own number); "Add a skill".
- Origin gets senses, the source, and "More defenses…" (`DefensesSection`).
- The dial takes a typed CR for a monster, and the Proficiency tile takes a typed override.
- A "Level & class" panel hosts `LevelSection`.
- **Tests:** each of these against the same values Stats shows, and one undo step per edit.

### Phase 4: the Token tab

- A Token tab: the name and faction in Codex style, then This fight, Tactics, Appearance and Status & position, hosted.
  "What the AI will use" opens the ability in the Codex's editor.
- The tab is per token, so it follows the switcher.
- **Tests:** each section's main control reaches the token shown, and not the creature's other tokens. "Use these for
  every Goblin" reaches them all.

### Phase 5: the rest, and a parity check

- The Attuned pill on Items rows (P8), and the Standard actions line on Abilities.
- Any hard-coded colours found in the hosted components become tokens.
- The guide's Codex section: delete, uses, resources and the Token tab, with screenshots.
- **A parity checklist test.** It lists Standard's sheet controls by their accessible names (from rendering Standard's
  tabs), maps each to its place in the Codex, and fails on one with no entry. A control added to Standard later must
  be given a place in the Codex, or be marked Standard-only with a reason.

## Risks

- **Hosted forms in a narrow Codex.** Standard's sections are laid out for a 680 px sheet. In a Codex below 880 px the
  main column is the whole width, so they fit. Above that they sit in the main column (about 780 px at 1060). Each
  hosted panel is checked at 640 px.
- **Two lists with one meaning.** The Codex shows rows grouped differently from Standard (Items, Attacks, Abilities,
  Spells). Every row action goes through the record's ref, so where a row shows doesn't matter. The tests act on rows
  in each Codex tab.
- **Colours in hosted components.** Some may still hard-code a colour that reads poorly on Light. Phase 5 sweeps them,
  and each phase's browser check includes Light.

## Out of scope

- Editing death saves and spending hit dice (windows plan D10).
- Fields the app doesn't store: XP, inspiration, coins, biography (windows plan D7).
- Drag-to-reorder rows: Standard doesn't have it either.

## Built so far

### Phase 1: row actions

- `src/components/sheet/abilities/row-actions.tsx` is the shared logic. `useRowEdits(definition)` does Duplicate,
  Move to, Use it and Worn, and returns the row id to show for a copy or a moved row. `useAbilityRemoval(definition)`
  handles Delete: it deletes at once, or opens "Delete Claws?" under the row through `under(row)`, and shows the
  "Deleted Bite. Undo" toast. `RemovalPrompt` keeps its own "Replace it with" state, and a `fieldClassName` option
  styles its dropdown as the sheet's own field. `ActionsTab` uses all of this, and its tests are unchanged.
- `AbilitiesList` exports `RowMenu` (with an optional `className`) and `AutomationDot`. The dot's colours are now
  `--ui-good` and `--ui-warn`, falling back to the old values. The app doesn't define those tokens, so Standard looks
  the same.
- The Codex: each row in its lists (Items, Attacks, Abilities, Spells) has the automation dot before its name, an
  optional rule's **Use it** switch (`role="switch"`, named "Use <name>"), Edit, and the ⋯ menu. The delete prompt opens
  under the row, and the toast sits at the foot of the view. A copy or a moved row is focused and briefly highlighted.
  The rows read all of this from one context (`RowKitContext`) instead of passing `onEdit` through every tab. The
  "off" chip has gone, since the switch shows it.
- Tests: 8 new ones in `tests/codex-sheet.test.tsx`. Browser checks passed 12/12 in Chromium and in Firefox, in the
  page and popped out, Dark and Light.

### Phase 2: uses and resources

- `recordPool(record, rows)` in `src/lib/actor-sheet/resources.ts` gives the pool a record spends, as its row in the
  resource list: its own uses or recharge, a weapon's charges, an item's stack, or a named pool. Spell slots and
  legendary actions don't count. It takes the record rather than a ref, so the resources model stays separate from
  the editor's refs.
- Codex rows show that pool in place of the cost pill, for the token shown, through `updateResource`. Up to 8 it's
  boxes (a filled box spends one, an empty one gets one back). Above that it's a number. A recharge is a Ready or
  Recharging pill. The cost text ("1 rage") moves into the row's details. The boxes' group is named "Rage left: 2 of
  3", so it isn't confused with the Resources list's dots for the same pool.
- Abilities and Spells each have a Resources panel at the top, which is Standard's `ResourceList` hosted as is. Its
  colours are now tokens (`--ui-good`, `--ui-warn`, and a new `--ui-hover`), with Standard's old values as the
  fallbacks. The Codex maps `--ui-hover` to `--row`.
- `SpellcastingAbilitySelect` comes out of `SpellcastingHeading`, and it's the Ability tile on Codex Spells.
  `UpcastOffers` sits above the spells, and `ItemOffers` sits at the top of Items.
- Tests: 2 in `tests/actor-sheet-resources.test.ts` and 6 in `tests/codex-sheet.test.tsx`. Browser checks passed 7/7
  in Chromium and in Firefox: popped out, in the page, Light, and at 640 px.

### Phase 3: Details

- Shared helpers in `src/lib/actor-sheet/edits.ts`: `MOVEMENT_MODES`, `movementOf`, `withMovementMode`, `withHover`,
  `SENSES` and `withSense`. Standard's `StatsCore` and `SensesSection` use them now too, in place of their own copies.
- The sidebar: max HP is typed, through the same store call as Stats (a token at full stays full). The Proficiency tile
  takes a typed override, with what its level or CR gives as the placeholder. A built character's tile stays
  read-only, as on Standard. "AC without armor" shows under the tiles while worn armor works out the AC. A Speeds line
  has a pill for each other speed (typed, hover with fly, ×) and "+ Speed".
- The dial: a monster's challenge rating is a dropdown, through `withChallengeRating`, so its proficiency follows as on
  Stats.
- Skills and saves: the bonus is typed in place. Blank shows the modifier and clears its own number, as Stats' saves
  do. The proficiency boxes still cycle.
- Origin gains the four senses' ranges and the source.
- Defenses gains "More defenses: qualified, and absorbing…", which opens Standard's `DefensesSection` in place. A new
  Level panel in Details hosts `LevelSection`: Level & CR for a hand-made creature (CR, proficiency, caster level,
  classes, Rebuild with the builder), or Class & level for a built one (Level up, Level down, the builder).
- Hosted sections get the Codex's face for their fold heads. Fields that Standard leaves to the browser get the
  Codex's field look. The hover colours left in `sheet.module.css` are now `--ui-hover`, with their old values as
  fallbacks.
- Plan item 14, "Add a skill": nothing more was needed. Standard's Add a skill only offers the 18 standard skills,
  which the Codex lists already, and adding one at its proficient bonus is the same as cycling its box.
- Tests: 9 in `tests/codex-sheet.test.tsx`. Two older ones now read the proficiency box and the CR dropdown, since both
  became inputs. Browser checks passed 11/11 in Chromium and in Firefox: popped out, in the page, Light, at 640 px. They
  caught two layout bugs, both fixed: save names squeezed out by the typed box, and clipped sense labels.

### Phase 4: the Token tab

- The Codex has a fifth tab, **Token**, after Spells. It hosts Standard's `TokenTab` whole, in a Codex panel: the token
  name and faction, then This fight, Tactics, Appearance, and Status & position, with Standard's fold state. It uses
  the same component, so nothing is copied. Its fields take the palette through the `--ui-*` mapping, its fold heads
  take the Codex's face, and the token name is set in the display face.
- It shows the token the switcher shows, so its edits reach that token only. "Use these for every Brakka" reaches them
  all, as on Standard. "What the AI will use" opens the ability in the Codex's own editor (`onOpenAbility` is the
  Codex's `openEditor`), and Cancel comes back to Token.
- Tests: 4 in `tests/codex-sheet.test.tsx`. The monster test's tab list now includes Token. Browser checks passed 10/10
  in Chromium and in Firefox: in the page, popped out, the switcher, Light, and 640 px. The check caught that the
  hosted-fields rule outranked the token name's face, and that is fixed.

### Phase 5: the rest, and a parity check

- The Items tab has an **Attuned** switch on each item that needs attunement (P8). It makes the same record change as
  the editor's box, through a shared `withAttuned` in `src/lib/ability-editor/items.ts`, which `ItemSections` uses too.
- The foot of Abilities has Standard's "Every creature can Dash · Disengage · Dodge · Hide · Help" line (one text,
  `STANDARD_ACTIONS` in `src/lib/sheet-help.tsx`, used by both sheets). Its heading has "About automation levels".
- Colour sweep: the editor's three remaining white overlays (a section head's hover, a menu item's focus, the "more
  set" chip) are now `--ui-hover` or a mix of `--ui-accent`, with Standard's values kept. The only hard-coded colours
  left in hosted code are token-appearance data defaults (a glow and a border colour), which aren't UI theming.
- The guide's Codex section (`docs/guides/sheet-windows.md`) covers the ⋯ menu, uses and Resources, the new Details
  edits, More defenses, Level & CR, Attuned and the Token tab. Screenshots 03–06, 08 and 09 were retaken, and 10 (⋯
  menu), 11 (Resources and uses) and 12 (Token) are new.
- **`tests/codex-parity.test.tsx`** is the parity checklist. For four creatures (a fighter with a bit of everything, a
  built fighter, a goblin, and a built wizard), it reads every control each sheet shows (every tab, every fold open)
  by role and accessible name. Each Standard name must appear in the Codex as it is, under the name `ALIASES` gives it
  ("STR score" is "Strength score"), or in `STANDARD_ONLY` with a reason. Only Stats' four help tooltips are listed
  there. Another test fails on an alias or Standard-only entry that no fixture uses any more. Breaking one alias on
  purpose made all four fixtures fail and name the control.
- Two things were found while building it. Names are collected through Testing Library's `name` callback, not
  `dom-accessibility-api`, whose package `exports` hide its types from `next build`. The Phase 3 hosted-fields rule
  outranked a narrower Codex rule. That was fixed for the token name, so watch for it in the future.

## Where the build differs from the plan

- Plan item 14, "Add a skill", needed nothing new. The Codex lists all 18 skills, and cycling a box does what
  Standard's Add a skill does.
- Senses are a column of four in Origin rather than a grid. In a grid, the labels were clipped.
- The Resources panel is hosted on both Abilities and Spells, as P4 said, and it's the same component both times.
- The Codex's uses boxes are named "Rage left: 2 of 3", apart from the Resources list's "Rage: 2 of 3 left", because
  both can be on screen for the same pool.
