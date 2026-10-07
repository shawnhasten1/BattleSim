# Hotbar Redesign Plan: what you can do, by what it costs

**Status:** complete 2026-10-07: Phases 1–5 built on branch `hotbar-redesign`, one commit each (see "Built so far" at
the end). D1–D3 are the user's decisions (2026-10-07). D4–D12 are defaults derived from them; reverse any of
them before building.

Play's hotbar (PLAY_MODE_PLAN.md §2.2) should work more like Baldur's Gate 3's. The user asked for three things:

1. **Tabs by cost.** Everything that takes your action goes under Actions, and everything that takes your bonus
   action goes under Bonus.
2. **Colours by type,** the way BG3 colours its abilities.
3. **No Multiattack button next to the weapons.** Having both "Extra Attack" and "+1 Greataxe" will confuse people.

## What's wrong today

| # | Problem | Where |
|---|---|---|
| 1 | **The tabs mix what a thing is with what it costs.** Spells and Features hold both actions and bonus actions. Bonus holds only bonus attacks and leftovers. Second Wind (a bonus action) is under Features, Healing Word under Spells, Cunning Action's Dash under Common, and a Quickened Fireball under Spells. Nothing answers "what can I do with my bonus action?" | `tabOf` in `src/lib/play/hotbar.ts` |
| 2 | **There are two ways to attack, and one of them is a trap.** "Extra Attack" (2 attacks) sits next to "+1 Greataxe". Pressing the greataxe makes **one** attack and spends the action, so the second attack is lost. | `hotbarFor`: a multiattack is a button of its own |
| 3 | **A multiattack takes over the turn.** After the first swing, the swing card asks for each later swing. You can step between swings, but you can't use a bonus action or drink a potion between them. Undo takes back the whole routine. | `askingSwingHook`, `SwingCard.tsx` |
| 4 | **A routine's options are hard to find.** "Multiattack (ranged)" and "With Breath Weapon" are small chips under the Multiattack button. | `variantLabel` |
| 5 | **Every button looks the same.** They're grey boxes: only the text tells a weapon from a spell from a potion. The Action, Bonus and Reaction pills are all orange. | `play.module.css` `.hotButton`, `.dockEconomy` |

## Decisions

| | Decision |
|---|---|
| D1 | **The weapons are the attack buttons, and swings stay open.** *(User.)* The Extra Attack, Attack and Multiattack buttons go. The first weapon attack takes the Attack action (or Multiattack). The swings left stay lit on the weapon buttons for the rest of the turn ("1 left"). You can move, use a bonus action or drink a potion between them, and Undo takes back one swing at a time. Auto Run doesn't change. |
| D2 | **Three tabs: Actions · Bonus · Reactions.** *(User.)* A button's tab is the slot it takes. Inside a tab, buttons are grouped in a fixed order: **Attacks, Spells, Features, Items, Common**, each under a small coloured label. |
| D3 | **A colour says what a thing is, and a spell takes its element.** *(User.)* Weapon attacks are red, features gold, items teal and common actions grey. Each spell takes the colour of its damage type (fire orange, necrotic green, radiant yellow), or of its school when it deals no damage. A corner mark gives the cost: a green ● for an action and an orange ▲ for a bonus action (BG3's own), a purple ◆ for a reaction. |
| D4 | **A routine that costs more than its slot keeps its own button.** Flurry of Blows (1 ki) and a limited-use multiattack aren't the same choice as swinging a weapon, so they stay as buttons. Pressing one aims its first strike. Its later strikes ride the weapon buttons, as in D1. |
| D5 | **Open swings last until the turn ends.** Moving, a bonus action, a potion or a second action from Action Surge doesn't close them. A weapon press always uses an open routine's swings before it starts a new routine. |
| D6 | **The routine is settled as late as possible.** Take a vampire's "two attacks, only one of which can be a bite", or a fighter's "Attack with Breath Weapon": the swings made so far only have to fit *some* routine. The hotbar offers every attack that still fits one. |
| D7 | **Swings can come in any order,** except a step tied to the one before it. A grick's beak comes only right after a tentacle hit, at the same target. A save step (Frightful Presence) can be taken at any point in its routine. |
| D8 | **A weapon that's in no routine makes one attack, as today.** An example is a javelin next to a "two greatclub attacks" Multiattack. While a routine holds the action, that weapon is greyed out with "Its action went to Multiattack". |
| D9 | **An item gets one button per slot.** A 2024 healing potion has **Drink** under Bonus and **Give** under Actions, and each shows how many are left. Today it's one button with "(bonus action)" chips. |
| D10 | **Free abilities go in Actions,** marked free: Action Surge, Reckless Attack. |
| D11 | **Legendary and lair actions that are routines keep the swing card.** They happen on someone else's turn, so there's no turn for swings to stay open in. |
| D12 | **End turn doesn't ask about swings left.** BG3 doesn't either. Its tooltip and the hint line say "1 attack left". |

## 1. Tabs and groups

```
┌───────────────────────────────────────────────────────────────────────────────────────────────┐
│ Eddie                [● ATTACK · 1 LEFT] [▲ BONUS] [◆ REACTION]  ▮▮▮▮▯ 35 of 50 ft  ↶ [AI] [End turn] │
│ HP 65/65 · AC 15                                                                              │
│ ● Actions 8    ▲ Bonus 1    ◆ Reactions 1                                                      │
│ ─────────────────────────────────────────────────────────────────────────────────────────────  │
│ ATTACKS   [1 +1 Greataxe  ⚔ 1 left ●] [2 Javelin  ⚔ 1 left ●]                                  │
│ FEATURES  [3 Action Surge  ◇]                                                                  │
│ COMMON    [4 Dash ●] [5 Disengage ●] [6 Dodge ●] [7 Help ●] [8 Hide ●]   greyed: action used   │
│ Pick a target for +1 Greataxe (attack 2 of 2). Esc puts it away.                              │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

Where things go:

| Ability | Today | New |
|---|---|---|
| Weapon and natural attacks | Attacks | Actions › Attacks |
| Extra Attack, Attack, Multiattack | Attacks, listed first | Gone: its swings ride the weapons (D1). A costed one stays (D4). |
| Breath Weapon, Frightful Presence | Attacks | Actions › Attacks |
| Fire Bolt, Fireball, Hold Person | Spells | Actions › Spells |
| Healing Word, Misty Step, a Quickened Fireball | Spells, "bonus action" chip | Bonus › Spells |
| Move Moonbeam | Bonus | Bonus › Spells |
| Second Wind, Rage | Features | Bonus › Features |
| Channel Divinity, Lay on Hands | Features | Actions › Features |
| Action Surge, Reckless Attack (free) | Features | Actions › Features, marked free (D10) |
| A potion: drink (2024 bonus) / give (action) | Items, one button | Bonus › Items "Drink", Actions › Items "Give" (D9) |
| A wand's spell | Items | Actions › Items |
| Dash, Disengage, Dodge, Help, Hide, Escape | Common | Actions › Common |
| Cunning Action's Dash, Disengage, Hide | Common | Bonus › Common |
| Off-hand attack, Martial Arts strike | Bonus | Bonus › Attacks |
| Flurry of Blows | Bonus | Bonus › Attacks, its own button (D4) |
| Shield, Counterspell, opportunity attacks | Reactions (settings) | Reactions, unchanged |

- **Tab** is the slot: `action` and `free` go to Actions, `bonus` to Bonus. Reactions stay the settings rows they are
  today (Ask / Always / Never).
- **Group** is today's tab rule (`tabOf`) without its Bonus branch: item → Items; Dash and the like → Common; spell →
  Spells; attack → Attacks; feature-granted → Features; a save or area ability → Attacks; anything else → Features.
- A group is a row with its label on the left; the buttons wrap. When the panel is narrow, the label goes above the
  buttons. The panel keeps today's height limit and scrolls.
- The Spells label carries the slot pips. Each tab that has spells shows them.
- Keys 1–0 press the first ten buttons of the tab, counted across its groups in order. Enter and Esc work as now.
- A tab's label carries its cost mark and the number of buttons in it. An empty tab is disabled, as today. The
  default tab is Actions.

## 2. Colours and marks

- **A button's colour:** a 3 px left edge plus a faint tint of the same hue over `--ui-panel-2`. The text stays
  `--ui-text`, so contrast doesn't depend on the hue. A greyed-out button keeps its hue, dimmed as now.
- **Group labels** are in their group's colour. The Spells label uses plain spell blue.
- **Cost marks** sit in a button's top-right corner: ● green (action) and ▲ orange (bonus action), BG3's own
  ([bg3.wiki](https://bg3.wiki/wiki/Bonus_actions)), and ◇ grey (free). The purple ◆ marks reactions, on the Reaction
  pill and the Reactions tab.
- **The economy pills** use the same colours and marks. A spent pill is struck through, as now.
- **Colour is never the only signal.** The group label, the name, the cost mark and the tooltip all say the same thing.
- **The "partly" and "by hand" badges** stay as they are.

**A spell's colour** is chosen in this order:

1. It heals: Healing.
2. It deals damage: the type of the first damage it lists. A zone spell (Moonbeam, Spike Growth) uses its zone's
   damage.
3. Its school (`spellSchool`, which the engine compiles onto every spell's action).
4. Plain spell blue.

Weapons are always Attacks red, whatever their damage type. An item's spell (a wand's Web) is an Item.

The palette below is a starting point. Phase 2 tunes it in the browser against the dark panel; the app has no light
theme. It lives as CSS custom properties, one per tone, so it can be tuned in one place.

| Tone | Hue | Start |
|---|---|---|
| Attacks | crimson | `#d0574e` |
| Features | gold | `#d8b04a` |
| Items | teal | `#3fb0a5` |
| Common | slate | `#8a94a6` |
| Spell (plain) | blue | `#6fa8ff` |
| Healing | soft green | `#7ee08a` |
| Fire | orange | `#ff8a3d` |
| Cold | ice | `#8fdcff` |
| Lightning | electric blue | `#4f86ff` |
| Thunder | periwinkle | `#9d9bff` |
| Acid | chartreuse | `#c3d83a` |
| Poison | green | `#74c04a` |
| Necrotic | grave green | `#5f9a72` |
| Radiant | pale gold | `#fff0a0` |
| Force | magenta | `#e46fd8` |
| Psychic | orchid | `#c48aff` |
| Bludgeoning, piercing, slashing | steel | `#b4bcc8` |
| Abjuration | shield blue | `#6fa8ff` |
| Conjuration | cyan | `#45c6cf` |
| Divination | silver | `#d6dde8` |
| Enchantment | pink | `#ff8fc8` |
| Evocation | orange | `#ff9f4a` |
| Illusion | violet | `#a98bff` |
| Necromancy | grave green | `#6f9f6a` |
| Transmutation | amber | `#d9a35a` |

Some hues overlap on purpose: radiant with Features, evocation with fire. A spell always sits under the Spells label,
so the overlap doesn't mislead.

## 3. Attacking

### 3.1 How it plays

- **A level-5 fighter (Extra Attack).** The Attacks group shows +1 Greataxe and Javelin, each marked "×2". Press the
  greataxe and click a goblin: one attack. The Action pill now reads "● Attack · 1 left". Both weapons show "⚔ 1 left",
  and Dash and the other actions are greyed out ("Eddie has already used its action"). Walk 15 ft, use Second Wind
  from Bonus, then press Javelin and click the archer: the second attack, and the routine is done.
- **An owlbear: "one with its beak and one with its claws".** Press Claws first: it opens Multiattack, and Beak shows
  "1 left". Claws is greyed out: "No claws attack left in Multiattack".
- **A vampire: "two attacks, only one of which can be a bite"** (two routines: two unarmed strikes, or one and a bite).
  After an unarmed strike, both Unarmed Strike and Bite are offered. After a bite, only Unarmed Strike is (D6).
- **A grick: tentacles, then the beak if they hit, against the same target.** Beak is greyed out until a tentacle
  attack hits. After the hit, only the tentacles' target is ringed (D7).
- **A tyrannosaurus: "can't make both attacks against the same target".** For the second swing, the first target isn't
  ringed. Clicking it is refused, and the refusal says why.
- **An adult dragon: "can use its Frightful Presence. It then makes three attacks".** Frightful Presence, pressed
  before any swing, opens Multiattack and is free inside it. It can also be pressed between swings (D7). Pressed once
  the action has gone to something else, it's greyed out.
- **Breath Weapon in place of an attack** (a 2024 dragonborn, `replacesAttack`): Breath Weapon sits in the Attacks
  group. Pressed, it opens the Attack action with the breath as one of its swings: one weapon attack is left, and the
  breath's recharge is spent.
- **A monk: Flurry of Blows (1 ki).** It's a button of its own in Bonus (D4). Pressing it aims the first strike and
  spends the ki. Unarmed Strike in Bonus then shows "Flurry · 1 left".
- **Action Surge.** With swings still open, a weapon press uses them (D5). Once the first routine is finished, Action
  Surge gives a new action, and the next weapon press opens a second routine.
- **AI: take this turn,** pressed with swings left: the AI makes the swings left first, then plays the rest of the turn.
- **Undo** takes back the last swing, not the whole routine.
- **A dragon's legendary action that is a routine:** the swing card, as today (D11).

### 3.2 What the hotbar shows

- **The Action pill** (or Bonus, for Flurry), while a routine is open: "● Attack · 1 left". It uses the routine's own
  name: Attack, Multiattack, Extra Attack or Flurry of Blows.
- **A weapon that would open a routine** shows the attacks the action gives ("×2"). One in an open routine shows the
  swings left ("⚔ 1 left"). One that can't be used for the swings left is greyed out, with the reason in the engine's
  words.
- **The hint line**, before the first swing: "Pick a target for +1 Greataxe. It takes your action: 2 attacks." Once
  open: "Pick a target for +1 Greataxe (attack 2 of 2)." A routine's statblock sentences that aren't simulated
  (`unsimulated`, such as "It uses Reel.") show in the hint once it's open.
- **Variants stay chips** on the weapon button, picked swing by swing: Power Attack, spend a charge, a mastery swap,
  Shillelagh.
- **End turn's tooltip** adds "1 attack left" (D12).

## 4. Architecture

### 4.1 Engine: a routine the turn keeps open

**State.** `TurnFlags.routines?: OpenRoutine[]`, at most one per slot. Add it to the zod schema next to
`dashed` / `disengaged` / `movementUsed`, so a board saved mid-turn keeps it.

```ts
interface OpenRoutine {
  /** The slot the routine took: "action" or "bonus" (Flurry). */
  slot: "action" | "bonus";
  /** The compiled routines it can still be (`<id>`, `<id>:option-N`, `<id>:with-<ability>`): those the swings so far fit (D6). */
  candidates: Id[];
  /** The swings made so far, in order. */
  made: Array<{ actionId: Id; targetId?: Id; hit?: boolean }>;
  /** `oneWeapon`: the family of the weapon the first swing used. */
  weapon?: Id;
}
```

**Fitting** (`src/engine/multiattack.ts`, pure):
- `routineFit(routine, made, executables)` places each swing made into a distinct swing of the routine, or returns
  null. A step tied to the one before it (`same-as-previous`, `requiresPreviousHit`) must directly follow its step
  (D7). Routines are a handful of swings, so a small backtracking search is enough.
- `routineOffers(snapshot, actorId)` gives, per slot:
  - the open routine (or the routines that could start),
  - the attacks and step abilities a swing can use now,
  - the swings left (the most any candidate has left),
  - the target rule (`different`, `same-as-previous`).

  The hotbar, the aim layer and the resolver all read it.

**One swing, shared** (`src/engine/combat.ts`). Move the body of `resolveMultiattackAction`'s loop into
`resolveRoutineSwing(state, context, swing, choice)`. That body covers the target rule, the fallback when out of
reach, the choice of variant, `spendEmbeddedCost` and `resolveAttackCore`, plus the save or area step. The loop keeps
calling it, so **Auto Run's logs must come out identical** (`tests/turn-loop-golden.test.ts`).

**The command** (`src/engine/commands.ts`):
`{ kind: "swing"; actorId; actionId; target?: UseTarget; routineId?: Id }`. `actionId` is an attack (or a variant of
one) or a step's ability. `routineId` opens a particular costed routine (D4).
- **With a routine open in that slot that the swing fits,** the swing continues it. Nothing more is spent but the
  swing's own cost: a charge, or the breath's recharge.
- **Otherwise it opens a routine.** The candidates are the free routines in that slot the swing fits, or
  `routineId`'s. Opening:
  - spends the slot, plus the routine's own cost when it has one.
  - logs `ActionDeclared` with the routine's name.
  - then makes the swing.
- **When no candidate has a swing left,** the routine closes and logs `MultiattackResolved`.
- **Refusals:** `swingProblem` gives the reason, in the words the resolver throws, and `commandProblem` returns it.

The `use` command keeps its meaning. A plain `use` of a weapon makes one attack (D8), and a `use` of a multiattack id
still runs the whole routine with the swing card. Legendary picks (D11) and existing tests rely on that.

**Turn end** (`finishTurn` in `src/engine/simulation.ts`, the one turn sequencer). Each open routine closes there. Its
unused swings log `MultiattackSwingSkipped` with the reason "its controller ended the turn", then `MultiattackResolved`
is logged. Auto Run, Step and Batch never open a routine, so nothing changes for them. A turn-boundary change is still verified
through Step, Auto Run and Play.

**The AI taking over** (`playAutomatedTurn` in `src/engine/turns.ts`). Before `takeAutomatedTurn`, finish the open
routines with the AI's own swing choice: `planMultiattackSwings` / `decideMultiattackSwing` over the remaining swings
of the candidate with the most left. This only runs in Play.

**Events** are the same types Auto Run logs (`ActionDeclared`, `AttackRolled`…, `MultiattackResolved`), so replay and
the report need no change.

**Undo and overruling a roll** work per command, so they now work per swing, with no changes.

### 4.2 The hotbar model (`src/lib/play/hotbar.ts`)

- `HotbarTab` becomes `"actions" | "bonus" | "reactions"`. A new `HotbarGroup` is
  `"attacks" | "spells" | "features" | "items" | "common"`.
- A tab carries both `groups: Array<{ id, label, buttons }>` and the flat `buttons` (in group order), which the keys
  use.
- Each button gains:
  - `group`.
  - `tone`: its group, or a spell's element (§2).
  - `press: "use" | "swing"`.
  - `routine?: { name, left, open }`: the "×2" and "⚔ 1 left" badges.
- **Families key on the item and its slot,** so a potion's Drink and Give are separate buttons (D9). A spell's
  Quickened copy is already keyed apart by its slot; it now lands in Bonus.
- **A free multiattack drops out** (D1). Its swings are offered on the attacks and step abilities it names. A
  `routineOnly` attack (Open Hand Technique's strikes) appears only while its routine is open or can start. A costed
  routine keeps a button that presses as a `swing` with `routineId` (D4). A by-hand multiattack keeps its by-hand
  button.
- **A routine's variant chips** ("Multiattack (ranged)", "With Breath Weapon") go. Late settling (D6) covers what they
  chose.
- **`HotbarModel` gains `routines`** (per slot: name, swings left, `unsimulated`), for the pill and the hint.

### 4.3 The UI

- **`Hotbar.tsx`:** the three tabs with their marks, group rows with labels, the slot pips on the Spells label, the
  routine badges, the coloured pills, and the new hint lines.
- **`play.module.css`:** one custom property per tone (`--tone-fire` and so on). A button takes its colour from
  `data-tone`. Add classes for the cost marks.
- **`usePlayAim.ts`:**
  - a `swing` press arms the attack as one creature.
  - the routine's target rule narrows the rings: `only` for same-as-previous, `exclude` for different.
  - the click sends a `swing` command.
- **`play-ui-store.ts`:** `tab` defaults to `"actions"`. The store isn't persisted, so there's nothing to migrate.
- **`SwingCard`** stays, for legendary and lair routines only (D11).

## 5. Phases

Tabs and colours don't depend on the engine work. They come first, so the new look can be judged while the riskier
engine phase is built.

### Phase 1 — Tabs by cost (model + UI; medium)

- Tabs and groups in `hotbar.ts`, and the group rows in `Hotbar.tsx`.
- Items split by slot (D9). Free abilities in Actions (D10). Slot pips per tab.
- The multiattack button stays for now, listed first in Actions › Attacks.

Done when:
- `tests/play-hotbar.test.ts` has one test per row of the §1 table: the tab, the group and the order.
- Keys 1–0 count across groups. `items-play` and `play-upcasting` pass with the new tab ids.
- `tests/play-hotbar-ui.test.tsx` covers the tabs, the group labels and the keys.
- In the browser (the seeded test account), the default scene's fighter and archer show the expected tabs, and a
  2024 caster's Healing Word and Misty Step sit in Bonus.

### Phase 2 — Colours and marks (UI; small to medium)

- `tone` in the model: the rule in §2.
- The tone properties and `data-tone` in the CSS. Cost marks on buttons, tabs and pills.

Done when:
- A model test checks tones: Fireball fire, Hold Person enchantment, Cure Wounds healing, Spiritual Weapon force,
  Moonbeam radiant (its zone), a longsword Attacks, a potion Items, a wand's spell Items.
- A test checks that every tone the model can produce has a rule in `play.module.css`.
- The palette is reviewed in the browser with the user: a caster's Actions tab, a fighter's, and a spent action.
  Retune before moving on.

### Phase 3 — Open routines (engine; large)

The whole of §4.1.

Done when (`tests/play-routines.test.ts`, headless):
- **A level-5 fighter:**
  - swing, move, Second Wind, swing. The routine closes with one `MultiattackResolved` (2 attacks).
  - Undo after the second swing gives back "1 left".
  - End turn with 1 left logs the skipped swing and closes the routine.
- **Owlbear:** claws then beak. A second claws is refused, with the reason.
- **Vampire:** unarmed then bite is allowed; bite then bite is refused.
- **Grick:** beak is refused before the tentacles and after a tentacle miss. After a hit, it's allowed only at the
  same target.
- **Tyrannosaurus:** the second swing at the same target is refused.
- **Dragon:** Frightful Presence before any swing opens Multiattack. Between swings it spends nothing more. After the
  action went elsewhere, it's refused.
- **Breath Weapon in place of an attack:** it's a swing, its recharge is spent, and one weapon swing is left.
- **`oneWeapon`:** a second swing with another weapon is refused.
- **Action Surge:** an open routine is finished first; after the surge, a weapon press opens a second routine.
- **Flurry of Blows:** opens only through `routineId`, spends 1 ki, and its second strike is a bonus-slot swing.
- **AI: take this turn** mid-routine makes the swings left, then plays the rest of the turn.
- **A board saved mid-routine** loads with the routine still open (the schema).
- **Unchanged:** the golden Auto Run logs, `multiattack-routines`, `multiattack-srd-fights`, `attack-replacement`,
  `save-immunity-multiattack` and `play-decisions`.

### Phase 4 — Weapons take the routine (model + UI; medium)

- The hotbar reads `routineOffers`: free multiattacks drop out, swing presses send the new command, and the badges,
  pill text and hint lines are added (§3.2).

Done when:
- **A level-5 fighter's hotbar** has no Extra Attack button, and the greataxe shows "×2". After one swing:
  - the greataxe shows "⚔ 1 left" and the pill reads "Attack · 1 left".
  - Dash is greyed out and Second Wind is usable.
- **An owlbear** shows Beak and Claws. After Claws, Claws is greyed out with the reason.
- **A monk:** Flurry of Blows is a button, and after its first strike Unarmed Strike shows "Flurry · 1 left".
- **A legendary action that's a routine** still uses the swing card (`play-legendary`).
- **The UI test** covers the badges, the pill and the narrowed rings.
- **In the browser,** Eddie's turn from the screenshot runs: greataxe, move, greataxe, End turn. Then an SRD owlbear
  played by hand.

### Phase 5 — Docs and tidy (small)

- The Docs page's Play section and its Items note. `docs/guides/play-a-fight-by-hand.md` steps 2–4 ("the Attacks tab"
  becomes the Actions tab), with screenshots 02–04 retaken.
- A note in PLAY_MODE_PLAN.md §2.2 and §2.4 pointing here.
- Remove what's left unused: the multiattack's `"routine"` aim from the hotbar's own path. `aimForAction` still uses it
  for legendary picks.

## 6. Testing

- **The golden Auto Run logs must not change.** If they do, Phase 3's refactor of the swing loop has changed
  behaviour.
- **Every rules case in §3.1 gets a headless test** (Phase 3) before any UI is built on it.
- **The `play-*` suites** pass after every phase, with only the tab ids, labels and expectations from D1 updated.
- **The browser checks** follow each phase's list and are reported phase by phase.

## 7. Out of scope

- **Approach-and-attack** (click a target out of reach to walk and swing), from PLAY_MODE_PLAN.md Phase 5's optional
  list.
- **Icons or art on the buttons.** Colour, marks and names only.
- **Rearranging the hotbar by hand** (BG3's drag-to-slot), and custom key bindings.
- **Any change to how the AI picks its multiattacks** in Auto Run or Batch.

## Built so far

### Phase 1 — Tabs by cost (2026-10-07)

- `hotbar.ts`: `HotbarTab` is `actions | bonus | reactions`, and each button has a `group`. A tab carries `groups`, plus
  its `buttons` in group order for the number keys. A family is keyed by its slot, so an item whose uses take different
  slots gets a button on each tab.
- `Hotbar.tsx`: the three tabs, and the group rows with labels. Buttons are matched to what's armed by the variant's
  action id, not the family key, because a weapon's action and bonus-action buttons share one key.

Differences from the plan:

- **The slot pips** stay at the right of the tab row (shown when the tab has spells), rather than on the Spells label.
  Five levels of pips in the label column would wrap into a tall stack.
- **A potion split across tabs** whose button holds one use is named for it: "Potion of Healing: Drink" under Bonus,
  "Potion of Healing: Give" under Actions. With two uses on a tab, it keeps its name and its Drink / Give chips.
- **A Quickened copy** alone under Bonus keeps its compiled name, "Fireball (Quickened)".

### Phase 2 — Colours and marks (2026-10-07)

- `hotbar.ts`: each button has a `tone`, following §2's rule. `HOTBAR_TONES` lists every tone the model can produce,
  and a test checks that `play.module.css` styles each one. "Move Moonbeam" takes its zone's damage colour.
- `play.module.css`: one `[data-tone]` rule per tone, with the hues from §2's table. A button has a 3 px left edge and a
  13% tint of its tone; armed, a 30% tint and a ring. The cost marks (● ▲ ◇ ◆) are CSS `::before` / `::after`
  content with empty alt text, so they're not read out and don't change any button's name. The tabs and the
  Action / Bonus / Reaction pills use the slot colours, and the selected tab is underlined in its slot's colour.

Differences from the plan:

- **Spells the engine doesn't run** (Hex, Misty Step and Mage Hand used by hand) were filed under Features. That was
  true before this work too: the engine stamps `spellLevel` and `spellSchool` only on the kinds it runs. The hotbar now
  finds them in the creature's spell list, so they sit in Spells at their level, in their school's colour.
- **The group panel** is 190 px tall rather than 156 px: a level-6 bard's 18 actions need three rows.

Found while checking in the browser, not fixed here:

- **Imported save spells that deal no damage get a phantom damage line.** In `import-normalize.ts`,
  `normalizeDamageComponents` turns a missing `damage` into `[{ dice: "1", damageType: "slashing" }]`. The library's
  Lore Bard and Arcane Trickster carry it on Faerie Fire, Hypnotic Pattern, Charm Person and Tasha's Hideous Laughter,
  so the hotbar colours them "physical". The engine does deal it: the library bard's Faerie Fire logged "Goblin 1 took
  1 damage" on all 13 failed saves in 20 seeded casts. The SRD's own copies have `damage: []` and are fine.

### Phase 3 — Open routines (2026-10-07)

- `multiattack.ts` (pure):
  - `routineFit` places the swings made into a routine's swings (D6, D7) or returns null.
  - `nextSwingOptions` gives what each routine still fitting can swing next.
  - `swingsLeftOf`, `swingsFilledBy` and `routineBaseId` support the hotbar and the refusal messages.
- `combat.ts`:
  - `planSwing`: how a swing would be made (continue the routine open in its slot, or open one), or why not.
  - `resolveRoutineSwing`: makes the swing. It opens the routine on the first swing (spends the slot and a costed
    routine's cost, then declares it) and closes it, logged as one, when nothing more fits.
  - `closeOpenRoutines` and `freeRoutines`.
  - `TurnFlags.routines`, in the zod schema too.
- `commands.ts`: the `swing` command and `swingProblem`. End turn closes any routine left open when it ends the fight.
- `simulation.ts`: `finishTurn` closes open routines ("its controller ended the turn"). `finishOpenRoutines`, called
  first in `playAutomatedTurn`, makes the swings left with `decideMultiattackSwing`.
- `tests/play-routines.test.ts` (15 tests) covers every case in the Phase 3 list. The full suite passes: 272 files,
  3,065 tests, with the golden Auto Run logs unchanged.

Differences from the plan:

- **The AI's loop in `resolveMultiattackAction` is untouched.** A person's swing is validated differently: the target
  and attack are explicit, and an illegal pick is refused rather than retargeted. So the two share the resolution
  (`resolveAttackCore` under the routine, `spendEmbeddedCost`, a step's ability `embedded`), not the choosing.
  Auto Run's logs can't change.
- **A swing aimed at a creature the routine's rule forbids** (a tyrannosaurus's tail at the bite's target, a grick's
  beak at anyone but the tentacles' target) is refused with the reason, not moved to someone else.

### Phase 4 — Weapons take the routine (2026-10-07)

- `hotbar.ts`:
  - Free multiattacks have no button. Every attack or step ability that is a swing of one of the creature's routines
    is pressed as a swing (`variant.swing`), with a `routine` badge.
  - A costed routine (Flurry of Blows) keeps a button. Its variants are its first swing's strikes, plain or with Open
    Hand's options, each opening it by name (`swing.routineId`).
  - `HotbarModel.routines` lists the routines open.
- `usePlayAim.ts`: an armed swing sends the `swing` command. The routine's target rule greys out a creature and
  refuses a click on it, with the reason.
- `Hotbar.tsx`:
  - the badge ("⚔ 2 attacks", then "⚔ 1 left").
  - the Action or Bonus pill reads "Attack · 1 left" while a routine is open.
  - hints: "It takes your action: Attack, 2 attacks", "(attack 2 of 2)", "Attack: 1 attack left.", and what the
    routine says that isn't simulated.
  - End turn's tooltip names the swings left.
- Tests: `play-hotbar` (a level-5 fighter, an owlbear, a monk's Flurry), `play-hotbar-ui` (badge, pill and hints; a
  tyrannosaurus's narrowed rings), `attack-replacement` (the breath's own button). Full suite: 272 files, 3,067 tests.
- Browser (the Sandbox):
  - The library's Level 6 Barbarian, the turn from the user's screenshot, shows "+1 Greataxe ⚔ 2 attacks" and no
    Attack button. A swing sets the pill to "Attack · 1 left" and greys the other actions; a step; then
    "(attack 2 of 2)".
  - An SRD owlbear played by hand: after Claws, Claws is greyed ("No Claws attack left in Multiattack") and Beak
    shows "⚔ 1 left".

Differences from the plan:

- **The badge reads "⚔ 2 attacks", not "×2"**: an item's stack already shows "×3".
- **D8's wording covers everything that takes the action:** while a routine holds it, Dash says "Fighter's action went
  to Extra Attack", not just a weapon outside the routine.
- **A feature's ability pressed as a swing goes in Attacks** (a dragonborn's Breath Weapon is a species trait).
- **An on-hit option's chip is named for it** ("Open Hand: Addle", a smite), where every one used to say "Spend a
  charge".
- **No "Skip this swing" on the hotbar:** a swing left unused is skipped when the turn ends. The swing card stays for
  legendary and lair actions that are routines (D11).

### Phase 5 — Docs and tidy (2026-10-07)

- The Docs page's Play section covers the tabs, groups, colours and marks, and attacking a swing at a time. Its Items
  note describes the per-slot potion buttons.
- `docs/guides/play-a-fight-by-hand.md` steps 2–4 now name the Actions tab and its groups, with a note on Extra Attack
  and Multiattack. Screenshots 02–04 were retaken in the Sandbox with the new hotbar.
  - An SRD Mage can only be added as an enemy, so the Fireball shot catches the party, and its caption says so.
- PLAY_MODE_PLAN.md §2.2 and §2.4 now point here.
- Removed the hotbar's "routine" hint and its multiattack-first sort. `aimForAction` and `aimAtCreature` keep the
  routine aim for legendary picks.
- A spell's colour prefers an element over bludgeoning, piercing or slashing (Ice Storm is cold, not physical). It was
  spotted in the guide's Mage shot.
- Full suite: 272 files, 3,067 tests.
