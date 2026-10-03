# Play Mode Plan: run a fight by hand, BG3-style

**Status:** on branch `play-mode`. Phases 0–2 committed 2026-10-03. D2, D3, D5 and D10 were decided on 2026-10-03; the
other decisions have recommended defaults (§6).

A **Play** mode for the encounter editor. You choose which sides you control (one faction, several, or all) and run
the fight turn by turn like a tactics RPG:

- On your creatures' turns a hotbar shows what they can do. You move by clicking the map, and aim attacks, spells and
  areas at tokens or squares.
- When one of your creatures could react, a prompt asks you: an opportunity attack, Shield, Counterspell, Hellish
  Rebuke, Legendary Resistance.
- When a legendary creature you control gets a legendary action, a prompt asks you which one and at what.
- The sides you don't control play themselves with the existing AI: moves, attacks, spells, reactions, legendary and
  lair actions. Their turns play out on the map before control comes back to you.

This is the Manual and Assisted modes of AGENTS.md §11. It's built on the engine calls Auto Run already makes, so the
UI and the AI resolve everything the same way (§19). It covers:

- the engine: turn sequencing, commands, decision points, previews, and one rules fix.
- the store.
- new UI: the Play setup in the Combat panel, a turn bar, the hotbar, targeting on the map, and prompts.

Researched in the code (engine, store, scene and combat UI), 2026-10-03.

## Summary

- **One turn loop first (Phase 0).** Two places sequence turns today: `runAutomatedEncounter` and the Step button's
  `advanceTurn`. Play would make a third. The sequencing moves into the engine (`openNextTurn` / `closeTurn`), and
  Auto Run, Step and Play all use it. Auto Run and Batch results must not change.
- **Everything you do is an engine command.** Moving, attacking, casting and ending the turn each call the resolvers
  the AI already calls (`moveCombatant`, `resolveAttack`, `resolveAreaSaveAction`…), through one `executeCommand`. The
  UI holds no rules.
- **The engine asks instead of deciding, but only when told to.** Some choices are made in the middle of resolving
  something: which reaction to take (opportunity attacks included), Legendary Resistance, legendary and lair actions,
  and each swing of a multiattack. Each becomes a decision point whose default is today's AI choice. Auto Run and Batch
  never ask, so they don't change.
- **A prompt pauses the fight by running a step again.** The engine is synchronous and can't wait for a click. When a
  choice is needed:
  - the step finishes with a placeholder answer, and its result is thrown away.
  - the prompt shows the board as it was at that moment.
  - your answer runs the step again from its start.

  The dice repeat exactly, because each step is seeded from where it starts in the log. Pausing by throwing was ruled
  out: the AI's 32 `catch` blocks would swallow it (§3.4).
- **Shield and Parry after the roll (Phase 2).** Today they fire before the attack roll, so the AI spends a Shield slot
  on every attack, and a prompt would ask before you know whether the attack hits. A new `would-be-hit` window opens
  after the roll and before damage, as the rules say. The AI then shields only when that turns a hit into a miss (D2).
  Batch numbers change for anything with Shield or Parry.
- **The hotbar** groups what the active creature can use: attacks, spells by level with slot pips, bonus actions,
  features, Dash/Disengage/Dodge. Each button shows its cost, why it's greyed out, and its variants (slot level, Power
  Attack, spend a charge). Hovering a target shows the chance to hit or to fail the save, from the same numbers the
  roll will use.
- **The AI's turns play out on the map** like Auto Run's replay: tokens walk, and dice and damage float up. They play
  one turn at a time, with speed and Skip. A prompt during an AI turn waits until the playback reaches the moment it's
  about.
- **Undo** takes back your last command. Undoing End turn also takes back the AI turns it set off. Undo rewinds the log
  too (today it only appends "Undo applied"). The same command again rolls the same dice (D5).
- **The app rolls the dice, and you can overrule a roll** (D10). Any attack roll, save, death save, escape check or
  recharge since your last command can be made a success or a failure, and an attack can be made a critical hit. The
  step that made the roll runs again with the new outcome, so the damage and everything after it follow, and the log
  marks it as a DM override.
- **The DM can still step in:** set HP, add or remove a condition, move a token freely, open a door. In Play these are
  logged, so the report and the replay stay right.
- **Abilities the engine can't run** sit on the hotbar marked *by hand*. Using one spends the action and its cost and
  logs it. You apply the effect with the DM tools (AGENTS.md §11).

---

## 1. What's there today

### 1.1 Turns

- Step, Auto Run and Batch all play every creature with `takeAutomatedTurn` (`src/engine/simulation.ts:1146`):
  - Step is `advanceTurn` (`src/store/encounter-store.ts:1100`).
  - Auto Run is `runAutomatedEncounter` (`simulation.ts:240`).
- Nothing lets you choose an action or a target. Dragging a token just places it: no movement cost, no opportunity
  attacks.
- **The turn-boundary rules are shared:** `runTurnStart`, `finishTurn` (= `runTurnEnd` + `runLegendaryWindow`),
  `runLairWindow` and `runDownedTurn`.
- **The sequencing around them isn't shared:**
  - picking the next creature, and skipping creatures that can't take a turn.
  - the round wrap and its hooks (`admitReinforcements`, `tickZones`, `despawnExpiredSummons`).
  - closing the action economy.

  `advanceTurn` re-sorts by initiative and calls the round hooks on every step; Auto Run calls them on the wrap. The
  zones bug that Step silently missed came from this kind of drift.
- **Seeding is deterministic, and Play relies on it.** Step seeds each turn from `${seed}:turn:${log.length}`. Event
  ids are `${type}-${log.length + 1}` (`event()`, `combat.ts:3312`). The engine never calls `Math.random` or
  `crypto.randomUUID` during a fight.

### 1.2 Choices made in the middle of resolving something

All of these are synchronous, and the AI makes all of them:

| Where | What it decides | The AI's rule today |
|---|---|---|
| `runReactionWindow` / `eligibleReactionFor` (`combat.ts:6143`, `:6104`) | Which reaction a creature takes for a trigger | The first eligible one: always for `priority: "always"`, else if it clears `reactionClearsValueBar` |
| `findLeaveReachReaction` (`combat.ts:5936`) | Opportunity attacks | Always taken, authored reaction copy first |
| `counterspellWindow` (`combat.ts:6261`) | Counterspell | Spells of 2nd level and up |
| `rollSavingThrow` → `wantsLegendaryResistance` (`combat.ts:5504`) | Legendary Resistance | By resource stance and how bad the failure is |
| `runLegendaryWindow` (`simulation.ts:353`) | A legendary action and its target | The best offensive option that reaches |
| `runLairWindow` (`simulation.ts:387`) | A lair action and its target | The same, never last round's |
| `resolveMultiattackAction`'s `beforeSwing` (`combat.ts:1011`) | Each swing's target and attack, and a move before it | `decideMultiattackSwing` |

### 1.3 Shield and Parry

- Shield (`src/data/srd/spells.ts:1365`) and Parry (`scripts/srd-monsters/monster.ts:273`,
  `src/lib/ability-editor/templates.ts:208`) trigger on `targeted-by-attack` with `priority: "always"`, before the roll.
- The AI raises its AC against every attack it can pay for.
- Parry's +2 lasts the round. The rules give it against one attack.
- A player asked before the roll can't make the choice the rules give them: whether this hit is worth a slot.

### 1.4 Undo

`undo` restores the encounter but not the log, and appends an "Undo applied" warning (`encounter-store.ts:1239`).
That's fine for editing. In a fight, the log would keep events that no longer happened, and the battle report reads
the log.

### 1.5 What Play reuses

- **Engine:**
  - every resolver.
  - `targetingProblem`, `canAct` and `remainingMovementBudget`.
  - `resolveAreaTargeting` with `cellsInArea` / `combatantsInArea`.
  - `findPath`, `findReachableCells` and `opportunityAttackThreats`.
- **Replay and feedback:**
  - the replay reducer (`src/lib/replay.ts`): events carry absolute values, so any stretch of the log folds onto the
    board it started from.
  - `useReplayPlayback`'s dwell timer and `useReplayPathWalk`.
  - `useSceneFeedback`: floaties, area flashes, and the roll cues of `DICE_ROLL_FEEDBACK_PLAN.md`.
- **Hotbar text:** `abilityList`, `actionStatblock`, `costText`, `spellSlotLevel`, `variantsOf`, `attackFamilyId` and
  `multiattackBaseId` give names, tooltips and variant groups. The resource list (`src/lib/actor-sheet/resources.ts`)
  gives the pips.
- **Components:** `FloatingWindow`, `ContextMenu`, `AiDecisionCard`, and `BattleReport`
  (`buildBattleReport(encounter, log)`).

---

## 2. How it plays

```
┌───────────────────────────────────────────── map ─────────────────────────────────────────────┐
│ [Fighter 31/44 ▲You] [Goblin 1 7/7 AI] [Ogre 59/59 AI] [Wizard 22/22 You] [20 · Lair]          │  turn bar
│                                                                                               │
│                ┌───────────────────────────────────────────────────┐                          │
│                │ ◆ Wizard can react                                 │                          │  prompt
│                │ Ogre's Greatclub hits you: 16 against AC 12.      │                          │
│                │ [ Shield · 1st-level slot, 2 left: AC 17, misses ] │                          │
│                │ [ Don't ]                  This fight: Ask ▾       │                          │
│                └───────────────────────────────────────────────────┘                          │
│ ┌─────────────────────────────────────────────────────────────────────────────────────────┐   │
│ │ (portrait) Fighter  31/44  AC 18 │ ● Action ▲ Bonus ◆ Reaction  ▮▮▮▮▯ 25 of 30 ft          │   │  hotbar
│ │ Blessed · Concentrating: —       │ Attacks  Spells  Bonus  Features  Common  Reactions     │   │
│ │                                  │ [1 Longsword] [2 Javelin] [3 Second Wind] [4 Shove] …   │   │
│ │                                  │                       [ End turn ] [ AI: take turn ] ↶  │   │
│ └─────────────────────────────────────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Starting a fight

- The Combat panel gets **Play** beside Step, Auto Run and Batch. It opens a short setup:
  - **Who plays each side** in the scene: *You* or *AI*. The default is Party: You, Enemies: AI, Neutral: AI, and
    "You play everyone" is one click.
  - **Prompts:** "Ask before my creatures react" and "…including opportunity attacks" (both on).
  - **AI turns:** play them out at 1×, 2× or 4×, or instantly.
- **Start** rolls initiative if needed, as Step does, and keeps the board as it is now as **the setup**. Play can also
  start from a board that Step has advanced; it carries on from the next turn.
- **You / AI chips.** Each row of the initiative list gets one, so a single token can be handed over: the goblin boss
  you want to run yourself, or an ally NPC you leave to the AI.
- **Control follows the side a creature fights for** (`effectiveFaction`):
  - a dominated fighter is played by whoever plays the dominator.
  - a summon is played by whoever plays its summoner.
- **While playing:**
  - the wall, terrain and elevation tools are locked. The DM tools (§2.8) cover doors.
  - Step and Auto Run are hidden.
  - Restart becomes **Reset to setup**.

### 2.2 Your turn

- **A turn bar** runs across the top of the map: portraits in initiative order, the current one raised, You/AI
  badges, HP bars, and the lair slot at 20. Click a portrait to select that creature.
- At the start of your creature's turn, the map pans to it and selects it. **The hotbar** appears at the bottom of the
  map:
  - **Left:** portrait, HP and temp HP, AC, conditions (hover: what they do and when they end), concentration.
  - **Economy:** Action ●, Bonus action ▲, Reaction ◆, and a movement bar ("25 of 30 ft").
  - **Tabs:** Attacks · Spells · Bonus · Features · Common · Reactions. Spells sort by level, with slot pips per
    level.
  - **Each button:** name; cost (1st-level slot, 1 ki, Recharge 5–6); a dot when the engine runs it only in part or
    it's *by hand*; and a tooltip with its statblock line.
  - **Greyed-out buttons** say why: no action left, no 3rd-level slots, nobody in range, incapacitated…
  - **Variants:** the upcast level (the slot pips are the picker), Power Attack, spend a charge.
  - **Keys:** 1–0 arm the first ten buttons of the tab. Esc or right-click disarms.
  - **Right:** End turn, AI: take this turn, and Undo. *AI: take this turn* hands the rest of this turn, from where it
    stands, to the AI. It's handy when you play every side.
- **End turn** is the button, or Enter when nothing is armed. Space already pans the map (`useViewport.ts:101`).
- **Some turns end on their own:**
  - a creature that can't act at all (stunned, or surprised in round 1) shows why for a moment, then its turn ends.
  - a confused creature's turn is rolled, as now.
  - a downed character rolls its death save.

### 2.3 Moving

- **Hovering a square** with nothing armed shows the route the engine would take:
  - the line, its cost ("20 ft"), and the squares that cost double.
  - a mark on each step that provokes an opportunity attack: who, and with what.
  - a tint on the squares the creature can still reach.
- **Click to move.** Shift-click adds waypoints, so you can go around the ogre instead of past it. Dragging the token
  does the same, and it snaps back with the reason if the square can't be reached.
- **What you see is what it walks.** The preview is the path `moveCombatant` will walk: one function serves both.
- **Fliers** get ▲ ▼ beside the movement bar to set the altitude for the next move.
- **Common tab:** Dash, Disengage and Dodge. Escape shows there while the creature is grappled.
- **Bonus tab:** "Move Moonbeam" shows there when the creature has a zone it can move.
- **Other tokens** can only be dragged with Alt, as a logged DM move.

### 2.4 Aiming

Arming an ability draws its range around the creature and marks who it can target. Hovering one it can't target says
why: "beyond 60 ft.", "line of effect is blocked", "inside another creature".

- **One creature:**
  - an attack: "70% to hit · +6 against AC 15 (half cover +2) · advantage: Pack Tactics · 1d8+4 slashing".
  - a save: "45% to fail DC 14 Dex · 8d6 fire, half on a success".
  - Click to use it.
- **Several creatures** (Bless, an upcast Hold Person, Scorching Ray's rays, Eldritch Blast's beams): click each one;
  rays and beams can repeat. Enter finishes. The count shows at the cursor.
- **An area:**
  - the template follows the cursor: a point within range, or a cone or line turning around the caster.
  - the squares it covers are shaded.
  - everyone caught is ringed, foes in one colour and allies in a warning colour, with each one's chance to fail.
  - Click to cast.
- **A place** (Misty Step, or a teleport that moves someone else): first pick the creature if it moves another one,
  then the square.
- **An option** (which creature to summon, which form to take): a small menu.
- **A multiattack** (and a character's Attack action with Extra Attack):
  - pick the first target.
  - after each swing, a "Swing 2 of 3" prompt asks for the next target. You can click a square to move first.
  - the weapon can change swing by swing where the routine allows it.
- **Out of reach (optional, Phase 5):** click a target the creature can reach by moving first. It shows the walk and
  its opportunity attacks, and a second click does both, as BG3 does.
- **Warnings before you commit:** "ends your concentration on Bless", "long range: disadvantage", "Fireball will
  catch the Ranger".

### 2.5 Prompts: reactions and Legendary Resistance

A prompt appears over the map near the creature it's about. It names the trigger and the numbers, lists every reaction
the creature could take, and waits for your choice. There's no timer.

- **Opportunity attack:** "Goblin 2 is leaving your reach. Make an opportunity attack?" Options are the creature's
  melee attacks with their chances (Longsword 70%), and Don't.
- **Shield, Parry** (after Phase 2): "Ogre's Greatclub hits you: 16 against AC 12. Shield (1st-level slot, 2 left):
  AC 17, the attack misses."
  - It only asks when an option would make the attack miss.
  - A critical hit never asks: nothing can stop it.
- **Hellish Rebuke** (after damage): "Ogre hit you for 13. Hellish Rebuke it?"
- **Protection:** "Ogre attacks the Wizard, 5 ft from you. Give the attack disadvantage?"
- **Counterspell:** "Mage is casting Fireball (3rd level) 40 ft away. Counterspell (3rd-level slot): it will be
  countered." Only spells the slot can counter are offered (the engine's v1 rule).
- **Legendary Resistance:** "The dragon failed a DC 15 Wisdom save against Hold Person (rolled 9). Use Legendary
  Resistance (3 left) to succeed instead?"
- **The "This fight" setting** (D3). Every reaction asks by default, opportunity attacks included. Each prompt has
  *This fight: Ask · Always use · Never* for that reaction on that creature. *Always use* takes it every time it's
  offered, without asking. The hotbar's Reactions tab shows and changes the same setting, as BG3 does. Turning off "Ask
  before my creatures react" in the setup leaves the ones without a setting of their own to the AI's rule.
- **A prompt that shows a roll** (Shield, Legendary Resistance) also lets you overrule that roll (§2.10).
- **The AI's creatures never prompt.** It decides their reactions itself.

### 2.6 Legendary and lair actions

- **After each other creature's turn,** a legendary creature you play with points left gets a prompt: "Adult Red
  Dragon, legendary action (2 of 3 left), after the Fighter's turn". It lists the options with their costs and a line
  each, plus Pass.
  - Choosing an option arms it with the usual targeting (§2.4). Esc goes back to the prompt.
  - Options the engine can't run, such as Detect, are offered *by hand*: they spend the points and are logged.
- **On initiative 20** (losing ties), a lair you play asks the same way, without last round's option.
- Points left unspent come back at the start of the creature's own turn, as now.

### 2.7 The AI's turns

- **A banner names the turn** ("Ogre's turn"). The turn is worked out instantly, then played back like Auto Run's
  replay:
  - the token walks its route.
  - dice and damage float up, and areas flash.
  - speed and **Skip** are on the banner.
  - your commands wait until it ends.
- **AI turns run one after another** until it's one of your creatures' turns, or the fight ends.
- **Your reactions during an AI turn:** say an Ogre walks away from your fighter.
  - the playback stops at that moment, and the prompt shows the board as it is then.
  - after your answer, the turn carries on from there.
  - while a prompt is open, the board is read-only. Undo cancels the prompt along with the step it belongs to.

### 2.8 DM tools

- **Right-click a token** to:
  - set HP: damage, heal, or temp HP.
  - add or remove a condition.
  - move it freely (or Alt-drag it).
  - give back its reaction or a resource.
- **Right-click a door** next to the creature whose turn it is to open or close it.
- **In Play, each of these is logged** with `data.source: "dm"`, using event types the replay already reads plus a new
  `DoorToggled`. The report counts them and a replay shows them.

### 2.9 Undo, the end, saving

- **Undo** takes back your last command, with its log entries.
  - Undoing **End turn** also takes back the AI turns it set off, back to your creature's turn.
  - The same command again rolls the same dice (each step is seeded from where it starts). Undo is for "what if I'd
    done something else", not for rerolling (D5). To change how a roll came out, overrule it (§2.10).
- **When one side is left:** "Party wins in round 4", with:
  - **Battle report.**
  - **Save this run:** a `SimulationRun` with `metrics.mode: "manual"` and who played what. No schema change.
  - **Reset to setup** and **Keep the board** (D6).
- **Odds from here** (Phase 8): Batch 100 from the board as it stands now: "Party wins 82% from here."
  `runBatchSimulations` resets each run to round 0 (`batch.ts:60`), so it needs a resume option.
- **The fight in progress survives a reload.** The store already persists `encounter` and `log`, and Play adds its own
  state (§3.6).
- **Save while playing** saves the setup, not the half-fought board (D8).

### 2.10 Overriding a roll

The app rolls every die (D10). The DM can still overrule a roll: a player's lucky roll at the table, or a call made
for the story.

- **Which rolls:** attack rolls, saving throws (concentration saves included), death saves, escape checks and recharge
  rolls. Damage isn't overridden; change HP with the DM tools instead.
- **The outcomes:**
  - an attack: Hit, Critical hit or Miss.
  - the rest: Success or Failure, for whoever rolled it. A recharge succeeds when the ability comes back. A death save
    counts as one success or one failure.
- **Where:**
  - a roll strip above the hotbar lists the rolls since your last command, newest first: "Ogre → Fighter: 9 + 6 = 15
    against AC 18, miss". During an AI turn it adds each roll as the playback reaches it.
  - each roll there has a ⋯ menu, and so does its entry in the Combat panel's log.
  - a prompt that shows a roll offers it too.
- **What happens:**
  - the step that made the roll runs again with the new outcome. The damage, the effects and everything after it
    follow from it, and the AI turns after it play again.
  - a prompt you answered after that roll comes back if it still happens.
  - making a legendary creature's save fail still lets it use Legendary Resistance.
  - the log keeps the number rolled and reads "hit (DM override)". The battle report counts overrides.
  - Undo puts the roll back the way it came out.
- **Only rolls since your last command** can be overridden. Older ones have later commands built on them.

---

## 3. Architecture

### 3.1 One turn sequencer (engine)

`src/engine/turns.ts`:

- `openNextTurn(state, options) → { kind: "turn", actor } | { kind: "over", winner }`:
  - rolls initiative if nobody has it.
  - finds the next creature that can take a turn.
  - on the wrap, increments the round and runs the round hooks.
  - runs the lair window.
  - plays a downed creature's turn: its death save, or a regenerator standing up.
  - runs `runTurnStart`, and skips the creature if the start of its turn took it out.
  - logs `TurnStarted`, with the controller.
- `closeTurn(state, actorId)`: `finishTurn` (the turn-end rules and the legendary window), then `closeActionEconomy`.
- **The callers:**
  - `runAutomatedEncounter` becomes `openNextTurn → takeAutomatedTurn → closeTurn` until the fight is over.
  - Step is one pass of the same loop.
  - Play's runner (§3.4) is the third caller.
- `canTakeTurn`, `hasOpenActionEconomy`, `closeActionEconomy` and `steppedOutcome` move from the store into the engine.
- **Golden logs come first.** No log-snapshot tests exist today. Phase 0 records a hash of every Auto Run log for the
  regression fixtures (20 seeds each), with a helper that prints the first difference, and checks them after the
  change.
- **Step may change where it differed from Auto Run.** That's the point of the change. Each difference is listed in the
  phase notes.

### 3.2 Commands (engine)

`src/engine/commands.ts`:

```ts
type CombatCommand =
  | { kind: "move"; actorId: Id; waypoints: Point[]; altitude?: number }
  | { kind: "use"; actorId: Id; actionId: Id; targetIds?: Id[]; aim?: Point; destination?: Point; moverId?: Id; optionId?: Id }
  | { kind: "use-by-hand"; actorId: Id; actionId: Id; targetIds?: Id[]; note?: string }
  | { kind: "move-zone"; actorId: Id; zoneId: Id; destination: Point }
  | { kind: "ai-turn"; actorId: Id }
  | { kind: "end-turn"; actorId: Id }
  | { kind: "dm"; change: DmChange };
```

- **`executeCommand(state, command)`** sends `use` to the resolver for the action's kind: attack (beams included),
  multiattack, save with `bonusTargetIds`, area-save, healing and healing bursts, buff, reposition, activate-feature,
  utility, summon, transform. These are the calls `executeOffensivePlan` and the rest of the AI already make. No rule is
  resolved here.
- **`resolveManualAction`** (new, small) handles partial, manual-only and unsupported abilities, reference legendary
  actions, and Hide/Help:
  - checks and spends the slot and the cost (`validateAndSpendAction`).
  - declares the action.
  - logs `ManualActionUsed` with its statblock text.
- **`commandProblem(snapshot, command) → string | undefined`** says why a command can't be used now. It's built from
  `canAct`, `canSpendResource`, `targetingProblem`, `validateOriginTargeting`, and the reposition and healing checks
  (exported for it). The hotbar's greyed-out reasons and the targeting hovers come from here, and `executeCommand`
  refuses with the same text.
- **`plannedPath(snapshot, combatantId, destination)`** is the route `moveCombatant` takes (today a private
  `hazardAwarePath` call). The preview uses it, so it can't disagree with the move.

### 3.3 Decision points (engine)

`src/engine/decisions.ts`:

```ts
type DecisionRequest =
  | { kind: "reaction"; key: string; reactorId: Id; trigger: ReactionEvent; options: ReactionOption[]; context: ReactionContext }
  | { kind: "legendary-resistance"; key: string; combatantId: Id; ability: Ability; dc: number; rolled: number; against: string; usesLeft: number }
  | { kind: "legendary-action"; key: string; combatantId: Id; afterId: Id; pointsLeft: number; options: TurnOption[] }
  | { kind: "lair-action"; key: string; combatantId: Id; options: TurnOption[] }
  | { kind: "multiattack-swing"; key: string; attackerId: Id; actionId: Id; swing: number; of: number; candidates: Id[]; previous?: { targetId: Id; hit: boolean } }
  | { kind: "roll"; key: string; rollerId: Id; purpose: "attack" | "save" | "death-save" | "check" | "recharge"; natural: number; total: number; against?: number; outcome: "success" | "failure" | "critical" };
```

- **`EngineState.decide?: (request) => answer | undefined`.** `undefined` means "use the AI's choice". Each site in
  §1.2 builds its request, calls `decide`, and falls back to today's code. With no decider set, nothing changes.
- **Reactions:** `runReactionWindow` asks once per reactor, listing every reaction it could take for the trigger. That
  includes ones the AI's value bar would skip, and `priority: "manual"` ones. The AI's default is today's pick. The
  leave-reach branch does the same with the melee attacks `findLeaveReachReaction` finds.
- **`context`** carries what the prompt shows: the attack roll and the AC, the spell and its level, the mover's step,
  the damage taken.
- **Rolls are decision points that never pause** (D10):
  - each attack roll (`resolveAttackCore`), saving throw (`rollSavingThrow`), death save (`resolveDeathSave`), escape
    check (`attemptEscape`) and recharge (`rollRecharges`) passes a `roll` request to `decide` once the dice are
    rolled, before anything reads the outcome.
  - the answer is normally `undefined`: keep the roll. An override answers `"success"`, `"failure"` or `"critical"`,
    which changes the outcome, not the dice.
  - in `rollSavingThrow` the override comes before Legendary Resistance, which then sees the new outcome.
  - the roll's event records its `rollKey`, and `overridden` when it was.
- **`key`** is `${n}:${kind}:${subjectId}`, where `n` counts the decision points in this step, rolls included. It's
  identical on every re-run (§3.4), and it tells apart two decisions that come with no log entry between them: say a
  reactor passes on Shield and is then asked about Protection.

### 3.4 Asking a human: run the step again (engine)

`src/engine/play.ts`:

```ts
runPlayStep({ snapshot, log, step, control, answers, overrides }) →
  | { kind: "done"; snapshot; log; next: "your-turn" | "ai-turn" | "over" }
  | { kind: "needs-decision"; request; board; log }   // the board and the log when it asked
  | { kind: "refused"; reason: string }
```

- **`step`** is a command, or `advance`: open the next turn, and if the AI plays it, play it and close it.
- **Seeding.** The engine state is seeded from `${seed}:play:${log.length}`, so the same step from the same place rolls
  the same dice.
- **Its decider:**
  - a roll gets its override if `overrides` has one, or else `undefined` (keep the roll). Rolls never pause and never
    take an answer from `answers`.
  - an AI-played subject, or a reaction set to *Always use*, gets `undefined` (the AI decides).
  - a reaction set to *Never* gets a decline.
  - anything else takes the next answer in `answers`. Its key must match, or the step fails with "play desync"; tests
    make that impossible.
  - with no answer left, it records the request (only the first one), a copy of the board and the log so far, answers
    as the AI would, and lets the step finish. The result is thrown away and `needs-decision` returned.
- **The store** shows the prompt. An answer runs the same step again with `answers + [answer]`. Each prompt costs one
  more run of one step: at most one AI turn.
- **Overriding a roll** runs its step again with the override added to `overrides` (`Record<rollKey, outcome>`), and
  with only the answers given before that roll (lower `n`). Prompts after it come back if they still happen, and the AI
  turns after that step run again.
- **Why not throw to pause.** The AI wraps its moves and resolvers in `try { … } catch { /* map state moved on */ }`
  (32 such blocks in `simulation.ts`), and `fireReaction` catches too (`combat.ts:6248`). A thrown pause would be
  swallowed there, and the AI would carry on as if its move had failed. Running the step again needs no change to any
  of them.
- **`controllerOf(snapshot, control, combatant)`** returns the token's override, or else its side's control, by
  `effectiveFaction`.

### 3.5 Previews (engine, pure)

`src/engine/preview.ts`. No dice are rolled and nothing changes:

- `previewAttack` → whether it can, the roll mode and why, the total bonus, AC with cover, the chance to hit and to
  crit, and average damage.
- `previewSave` → the chance to fail (advantage, bonuses, cover on Dex saves), and average damage on each outcome.
- `previewArea` → origin and aim, the squares covered, and everyone caught, with their side, chance to fail and
  average damage.
- `previewMove` → the path, its cost, whether it's reachable, who gets opportunity attacks, and hazards on the way.
- **Previews and resolvers share their inputs:**
  - `resolveAttackCore`'s modifier block (advantage sources, long range, feature and condition bonuses, AC, cover)
    becomes `attackRollInputs(...)`.
  - `rollSavingThrow`'s becomes `saveRollInputs(...)`.
  - both resolvers and previews call them, so a preview can't drift from the roll.
- **A test checks it:** 2,000 seeded attacks and saves per fixture, compared against the preview's chance.

### 3.6 Play state (store)

A new slice, `src/store/play-slice.ts`, composed into `useEncounterStore`, so it shares `commitEncounter`,
`mergeEdits` and undo:

```ts
play: {
  control: { factions: Record<Faction, "human" | "ai">; tokens: Record<Id, "human" | "ai"> };
  reactions: Record<string, "ask" | "use" | "never">;   // `${combatantId}:${reaction family}`, plus the OA default
  playbackSpeed: 0 | 1 | 2 | 4;                         // 0 = instant
  pending?: { step: PlayStep; answers: DecisionAnswer[]; request: DecisionRequest; board: EncounterSnapshot; log: CombatLogEvent[] };
  recent: Array<{ step: PlayStep; answers: DecisionAnswer[]; overrides: Record<string, RollOutcome>; before: EncounterSnapshot; logLength: number }>;
  status: "your-turn" | "ai-turn" | "prompt" | "over";
} | null
```

- **Actions:** `startPlay(options)`, `issueCommand(command)`, `answerPrompt(answer)`, `overrideRoll(rollKey, outcome)`,
  `setControl`, `setReactionPolicy`, `endPlay({ restoreSetup })`.
- **`issueCommand`** runs one step and commits it. After `end-turn` or `ai-turn`, it runs `advance` steps, one commit
  per AI turn, joined into one undo step with `mergeEdits`.
- **Undo in Play** restores the log length along with the board: undo entries keep `logLength`, and redo entries keep
  the log's tail.
- **`recent`** holds the steps since your last command, each with the board before it, so a roll in any of them can be
  overridden. An override is its own undo step. `recent` isn't persisted, so after a reload, overriding picks up again
  from your next command.
- **Persistence:**
  - `play` is persisted with `encounter` and `log`.
  - the setup board goes to IndexedDB beside the map image (`mapImageStore`'s pattern), so localStorage doesn't hold
    two boards.
  - a pending prompt is rebuilt on load by running its step again.
- **UI-only state** (what's armed, the targets picked so far, the hover) lives in a small, unpersisted store:
  `src/store/play-ui-store.ts`.

### 3.7 UI modules

- **`src/lib/play/hotbar.ts`** (pure) builds the hotbar from `getExecutableActions`, `commandProblem` and
  `actionStatblock`:
  - buttons by tab, with variants folded into their family: `:power`, `:charged`, `:upcast-N`, multiattack options.
  - a targeting spec per button: none; creatures (side, range, count); area; place; option; routine.
  - cost text, the automation dot, the greyed-out reason, and warnings.
- **`src/components/play/`:**
  - `PlaySetup`, `TurnBar`, `Hotbar`, `RollStrip`, `TargetTooltip`, `AiTurnBanner`, `PlayEndCard`.
  - `TargetingLayer`, inside `SceneOverlays`: the range ring, highlights, area template, path, and opportunity-attack
    marks.
  - `PromptCard`: reactions, Legendary Resistance, legendary and lair actions, and multiattack swings.
- **`src/hooks/usePlayTargeting.ts`:** armed → hover → pick(s) → confirm. Esc or right-click backs out one step.
- **`src/hooks/usePlayPlayback.ts`** plays the AI turns, and a pending prompt's lead-up:
  - it uses `replayTo(base, log, index, from)`; `replayTo` gains `from`.
  - it reuses the dwell timer and the path walk.
  - the prompt shows when the playback reaches its end.
- **`useDisplayEncounter`** shows the playback board, or the prompt's board while a prompt is open.

### 3.8 Shield and Parry after the roll (rules)

- **A new trigger, `{ kind: "would-be-hit"; meleeOnly?: boolean }`.** In `resolveAttackCore`, its window opens after
  the roll and before any damage, when the attack hits and isn't a critical hit. After the window, the AC is read
  again and the hit decided again.
- **The AI uses it only when the reaction's AC bonus makes the attack miss** (D2). The bonus is read from the condition's
  `modifiers.armorClass`.
- **Duration:**
  - Parry's bonus lasts for the triggering attack only (`reaction.lastsFor: "triggering-attack"`, cleared once that
    attack resolves).
  - Shield's lasts until the start of the caster's next turn (it used to last a round from the attacker's turn).
- **Data:**
  - Shield in `spells.ts`.
  - Parry in the generator (`monster.ts`), then regenerate the monsters.
  - the editor templates, and the reaction default in `ability-editor/spells.ts`.
  - the trigger picker: `triggerText` in `statblock.ts`, validation, and the schema in `types.ts:2086`.
- **Migration.** A load-time step in `import-normalize.ts` moves saved `targeted-by-attack` activations whose condition
  only adds AC to `would-be-hit`. Everything else keeps `targeted-by-attack`.
- **Docs:** update "Shield, Parry and Counterspell" and "What the AI does with them".

---

## 4. Phases

Each phase ships on its own and keeps the tests green.

### Phase 0 — One turn loop (engine; medium; do first)

- Golden logs of Auto Run first, then `src/engine/turns.ts` (§3.1).
- `runAutomatedEncounter`, `advanceTurn` and Batch move onto it.

Done when:

- The golden logs match.
- Outside the tests, only `turns.ts` calls `runTurnStart`, `finishTurn` and `runLairWindow`.
- The turn-loop, reinforcement, lair, summon, insertion and stepped-reaction tests pass.
- Step's differences from before are listed.
- In the browser, Step, Auto Run and Batch still play the zones and lair fixtures the same way.

> **✅ Implemented 2026-10-03**, committed on `play-mode`.
>
> Built:
>
> - **Golden logs** (36a5fe4): five fights built through the store (`tests/helpers/golden-fixtures.ts`), 34 runs,
>   each log and outcome hashed into `tests/fixtures/auto-run-golden.json`. `UPDATE_GOLDEN=1` regenerates it and
>   `GOLDEN_DUMP=<dir>` writes the logs for diffing. Rounds capped at 20 to keep it under half a minute.
> - **`src/engine/turns.ts`:**
>   - `openNextTurn` and `closeTurn`.
>   - `ensureInitiative` (Auto Run's old `rollIfNeeded`) and `syncTurnOrder` (Step, and later Play).
>   - `stepAutomatedTurn` (the Step button) and `combatOutcome`.
>   - `hasOpenActionEconomy` and `closeActionEconomy`.
>   - `runAutomatedEncounter` and its result types, moved from `simulation.ts`.
> - **Step** is now one call to `stepAutomatedTurn`. The store's own copies of the helpers are gone. Outside the
>   tests, only `turns.ts` calls the turn-boundary functions.
>
> Found on the way, and fixed in commits of their own before the refactor, so the golden logs could prove the refactor
> changed nothing:
>
> - **Fear Aura** (26b801b): `applyEmanation` asked whether the bearer could still take an action, so a pit fiend's
>   aura went quiet once it had acted. It now only checks for incapacitation.
> - **Log entries keep what happened at the time** (775ac4f): `event()` kept references to live objects. A finished
>   log showed every death save with the final tally, and replay drew a drifting zone at its last spot and a summon as
>   it ended the fight. `event()` now stores a copy. The flow of every golden run was unchanged; only what the entries
>   record. About 8% slower.
>
> Step's differences from before (Auto Run's golden logs are unchanged):
>
> - `TurnStarted` reads "X started a turn" and comes after the start-of-turn rules. Before, it read "started an
>   automated turn", came before them, and carried `mode: "automated"`.
> - A downed character's death save no longer takes a Step of its own. It's rolled on the way to the next creature's
>   turn, with no `TurnStarted`, as Auto Run always did.
> - Reinforcements, zone expiry and summon expiry happen when the round wraps. Before, they were re-checked every Step.
> - A token added mid-fight rolls its own initiative and joins the order. Before, everyone re-rolled.
> - Once one side is left, Step does nothing more; before, the winners kept taking turns. A turn that ends the fight
>   no longer runs the end-of-turn rules or the legendary window, as in Auto Run.
>
> Kept as it was: Auto Run sorts a pre-rolled order by initiative then id, while `compareInitiative` breaks ties by
> Dex. Changing that would change every Batch over a pre-rolled order (noted at `ensureInitiative`).
>
> Tests:
>
> - `tests/turn-sequencer.test.ts` (14), including stepping a whole fight turn by turn giving exactly Auto Run's log.
> - The golden logs (2), the Fear Aura test, and replay tests for summons, splits and copied entries.
> - Two heavy tests that timed out under a full parallel run before this branch got longer limits.
> - The full suite passes: 152 files, 1,839 tests.
>
> Browser (Playwright, the default scene), all passed:
>
> - eight Steps play turns in initiative order into round 2, with roll cues on the map.
> - Auto Run from the half-fought board goes into replay.
> - Batch 100 reports.
> - no page errors.

### Phase 1 — Commands and decisions, headless (engine; large)

- `commands.ts`, `decisions.ts`, `play.ts` and `preview.ts` (§3.2–3.5), the decision sites of §1.2, and the roll
  decision points (§3.3).
- A test helper that plays a fight from a script: `playScripted(fixture, control, script)`.

Done when (all headless):

- A scripted party beats the sample fixture using moves, attacks, a spell, an area and End turn.
- An AI goblin walking away from a human fighter asks about the opportunity attack:
  - Yes and No both finish the turn.
  - the prompt's log is the start of the finished one.
- The same step with the same answers gives the same log every time.
- **Control:**
  - AI-played creatures never ask.
  - a dominated party member is played by the dominator's side.
  - a summon is played by its summoner's player.
- Legendary Resistance, a legendary action with a target, a lair action, and a multiattack swing with a move first
  each ask and resolve.
- **Overrides:**
  - a miss made a hit deals its damage and runs its riders.
  - a failed save made a success takes half damage or none.
  - the dice before the overridden roll are unchanged, and the log keeps the number rolled.

> **✅ Implemented 2026-10-03**, committed on `play-mode`.
>
> Built:
>
> - **`src/engine/decisions.ts`:** the request and answer types, and `askDecision`, which every decision point calls.
>   Keys are `${n}:${kind}:${subject}`, counting every point in the step, rolls included.
> - **Decision points**, each falling back to the AI's choice. With no decider, the golden logs are unchanged.
>   - the reaction windows offer every eligible reaction, including those the AI's value bar would skip and
>     `priority: "manual"` ones; opportunity attacks offer one option per attack.
>   - Legendary Resistance, after the save's roll (and its override).
>   - legendary and lair windows: a person picks from every affordable option, with targets, or passes.
>   - multiattack swings: `askingSwingHook` makes the first swing as aimed and asks before each later one (whom, with
>     what, a move first, or skip).
>   - rolls: attack rolls, saves, death saves, escape checks and recharges. They never pause; an override changes the
>     outcome, not the die, and the log says "(DM override)".
> - **`src/engine/commands.ts`:** `executeCommand` (move with waypoints, use, use by hand, move a zone, AI: take this
>   turn, end turn), and `commandProblem`, `actionProblem` and `targetProblem`, worded as the resolvers throw.
> - **`src/engine/combat.ts`:**
>   - `resolveUse`, the one dispatcher for a person's abilities, legendary and lair picks included.
>   - `resolveManualAction` and its `ManualActionUsed` event.
>   - the reaction event carries the attack or spell and the roll, for prompts.
> - **`src/engine/preview.ts`:** `previewAttack`, `previewRoutine`, `previewSave`, `previewArea` and `previewMove`.
>   They're built from inputs extracted from the resolvers, which now use them too: `attackRollInputs`,
>   `saveRollInputs`, `actionSaveContext`, `areaSaveTargets` and `plannedPath`. `averageDamage` (the AI's) gained a
>   critical-hit option.
> - **`src/engine/play.ts`:**
>   - `PlayControl` and `controllerOf`: a dominator's player, then a token's own setting, then a summoner's player,
>     then the side's.
>   - `runPlayStep`: re-runs a step with its answers and overrides, and reports the step's rolls for the roll strip.
>   - reaction policies: *Always use*, *Never*, ask, or the AI's rule when asking is off.
>
> Fixed on the way: Step and the Initiative button kept the seed they derived for their dice, so the encounter's seed
> grew with every Step (`seed:turn:0:turn:12:…`). The encounter now keeps its own seed.
>
> Differences from the plan:
>
> - Reference-only legendary actions (Detect) aren't offered by hand yet; Phase 8.
> - The scripted fight uses moves, attacks and End turn. Spells and areas are covered by their own tests (Fireball
>   and Counterspell, an area, a save).
>
> Tests:
>
> - `tests/play-headless.test.ts` (16): fights played by a person, commands, opportunity-attack questions and
>   policies, who plays what.
> - `tests/play-decisions.test.ts` (15): Legendary Resistance, legendary and lair picks, swings, overrides,
>   Counterspell, and previews against 2,000 seeded rolls and against the resolvers.
> - The full suite passes: 154 files, 1,870 tests. The golden logs are unchanged.
- With no decider, Auto Run's golden logs still match.
- The previews agree with 2,000 seeded rolls to within 2 percentage points.

### Phase 2 — Shield and Parry after the roll (rules; small to medium)

§3.8. This can ship before Phase 1.

Done when:

- **Shield:** cast only on a hit it turns into a miss, and never on a critical hit.
- **Parry:** only against melee attacks, and its +2 lasts for that attack only.
- A saved actor with the old Shield loads with the new trigger.
- `parry.test.ts`, `reaction-spells.test.ts` and the SRD fight tests are updated.
- Batch numbers for a Mage and a Knight are noted before and after.

> **✅ Implemented 2026-10-03**, committed on `play-mode`.
>
> Built:
>
> - **The trigger `would-be-hit`** (types, schema, normalizer), and `ReactionMeta.lastsFor`:
>   `"triggering-attack"` or `"until-start-of-next-turn"`.
> - **The window**, in `resolveAttackCore`, after the roll and any DM override. It doesn't open on a critical hit, and
>   a DM-ruled roll stands. The AC is read again afterwards and the hit decided again.
> - **The trigger passes only when the reaction's AC bonus turns the hit into a miss**, for the AI and for a person's
>   prompt alike.
> - **Durations:** a Parry's condition is removed once the attack resolves (`ConditionExpired`, reason
>   `triggering-attack-resolved`). Shield's +5 now lasts until the start of its caster's next turn; it used to last a
>   round from the attacker's turn.
> - **Data:**
>   - the library's Shield.
>   - the generator's Parry, regenerated: only the Shield and Parry entries changed.
>   - the editor's templates and the default for a new activation reaction.
> - **The editor's trigger picker:** "An attack would hit it (after the roll, before damage)", with "before the roll"
>   and "after damage" on the other two; "Melee attacks only"; **What it gives lasts** (As While active says, For that
>   attack, Until its next turn); and a note on the trigger.
> - **The statblock** reads "When a melee attack would hit it (reaction): it gains a +2 bonus to AC against that
>   attack."
> - **`migrateDefinition`** (`import-normalize.ts`) moves saved AC-only `targeted-by-attack` activations to
>   `would-be-hit`. The library's Shield and Parry copies get their durations, and anything else keeps its own. It
>   returns the same object when there's nothing to change, and runs on import, on every load and commit of an
>   encounter (`normalizeEncounterVisuals`), and on loading the library.
> - **Docs:** "Shield, Parry and Counterspell" and "What the AI does with them".
>
> Batch numbers, 200 runs each:
>
> | Fight | Before | After |
> |---|---|---|
> | Mage vs 2 veterans | party wins 77%, 4.25 rounds, Shield cast 2.77 times a run, 19.9 HP left | 78%, 4.25 rounds, 1.38 a run, 19.8 HP left |
> | Knight vs 2 orcs | party wins 99%, 3.63 rounds, Parry 3.02 times a run, 36.7 HP left | 99%, 3.62 rounds, 0.37 a run, 36.2 HP left |
>
> The golden logs were regenerated. The casters, monsters and legendary fights changed (they have Mages and
> Knights); the sample and reinforcements fights didn't.
>
> Tests:
>
> - `parry.test.ts` rewritten with scripted d20s: a hit it turns, a hit it can't, a miss, a critical hit, a ranged
>   attack, that attack only, once a round.
> - Shield in `reaction-spells.test.ts`: only on a hit it turns, not on a critical hit, lasts until its caster's next
>   turn.
> - `reaction-migration.test.ts` (5).
> - In Play, Shield's question shows the roll against the AC.
> - The editor: an old Parry comes up to date, and its lasting can change.
> - The full suite passes: 155 files, 1,880 tests.

### Phase 3 — The Play frame (UI; medium to large)

- **Builds:**
  - Play setup and You/AI chips.
  - the turn bar, the AI-turn banner and playback.
  - End turn, *AI: take this turn*, turns that end on their own.
  - the end card and Reset to setup.
  - undo in Play, locked tools, persistence.
- **No hotbar yet.** On your turn you can end it or hand it to the AI. That's enough to play a whole fight through the
  new loop.

Done when:

- A fight where you play every side, handing each turn to the AI, finishes.
- Every AI turn plays back on the map.
- Undoing End turn returns to your creature's turn, and the log is cut back with it.
- A reload mid-fight resumes on the same turn, prompt included.
- Reset to setup restores positions, HP, conditions and resources.

### Phase 4 — Moving (UI; medium)

- The path and its cost on hover, the reachable tint, opportunity-attack marks.
- Click, drag, and waypoints; altitude for fliers.
- Dash and Disengage: the budget doubles, the marks clear.

Done when:

- The hover path is the path walked, around a wall, through difficult terrain and past a hazard (store test).
- A move that provokes an AI opportunity attack plays it out.
- A move out of reach is refused with the reason.
- Other tokens move only with Alt, and that move is logged.

### Phase 5 — The hotbar and creature targets (UI; large)

- **The hotbar:** `hotbar.ts` and the Hotbar component.
- **Creature targeting:** one, several, rays and beams, with hit and fail tooltips.
- **Variants:** upcast, Power Attack, spend a charge.
- **Multiattack** swing prompts.
- **By hand:** abilities the engine doesn't run.
- **Common:** Dash, Disengage, Dodge, Escape, Help, Hide.
- **Features:** Rage, Action Surge, Second Wind.
- **Warnings.**
- **Optional:**
  - approach-and-attack.
  - "What would the AI do?": runs `takeAutomatedTurn` on a scratch copy and shows its `AiDecision` in an
    `AiDecisionCard`.

Done when:

- A blank creature given one ability of each kind shows each on the right tab, with the right cost and a reason when
  it's greyed out (one test per kind).
- A level-5 fighter's Attack makes two swings with a move between them.
- An upcast Scorching Ray fires four rays at chosen targets.
- Using an ability by hand spends its slot and logs it.

### Phase 6 — Areas, places and options (UI; medium)

- **Area templates:** a point, self, aimed cones and lines, zones.
- **The caught list,** with allies flagged.
- **Teleports.**
- **The move-the-zone button.**
- **Summon and form menus.**

Done when:

- Fireball's preview catches exactly who `resolveAreaSaveAction` hits, over a grid of aim points (test).
- A cone aimed between two foes catches both.
- A zone spell settles, then moves with its bonus action.
- A summon appears and plays on its side.

### Phase 7 — Prompts (UI; medium)

- **`PromptCard` for reactions:** opportunity attacks, would-be-hit, hit-by-attack, ally-targeted, Counterspell.
- **`PromptCard` for Legendary Resistance.**
- **The per-reaction setting,** in the prompt and on the Reactions tab.
- **Prompts during AI playback.**

Done when:

- Each prompt in §2.5 appears with its numbers.
- Yes and No both finish the step.
- Always and Never stop the asking for that creature.
- A prompt during an AI turn shows the board at that moment, and the playback carries on after it.

### Phase 8 — Legendary and lair actions, DM tools, the end (UI; medium)

- **Legendary and lair prompts,** with targeting (§2.6).
- **DM tools,** logged (§2.8), and `DoorToggled` in the replay reducer.
- **Save this run, and Odds from here.**
- **Docs:** a "Playing a fight by hand" section and a short guide.

Done when:

- A dragon you play takes a Tail Attack after the fighter's turn, and its points come back on its own turn.
- A lair action you pick fires on initiative 20.
- DM edits show in the report and in a replay of the saved run.

### Phase 9 — Overriding a roll (UI; medium)

§2.10. This can come any time after Phase 3.

- **The roll strip** above the hotbar, with a ⋯ menu on each roll. The same menu is on the Combat panel's log entries
  and in prompts that show a roll.
- **`overrideRoll`** in the store: runs the roll's step again with the override and the answers before it, then the
  AI turns after it.
- **The battle report** counts overrides.

Done when:

- An AI ogre's miss made a hit damages the fighter, and the AI turns after it play again from there.
- A goblin's failed save against Fireball made a success takes half damage.
- A prompt answered after the overridden roll comes back if it still happens, and doesn't if it no longer does.
- Undo after an override puts the roll back the way it came out.

---

## 5. Testing

- **Engine** (headless): the done-when tests of each phase, and the golden logs, rerun after every engine change.
- **Store:**
  - commit, undo and redo with the log.
  - a pending prompt surviving a reload.
  - control chips, and control following domination.
  - overriding a roll, both in your last command and in an AI turn after it, then undoing the override.
- **Pure:** the hotbar model, and previews against resolution.
- **Components** (happy-dom, with RTL `cleanup()`): hotbar tabs and reasons, prompts, the setup.
- **Browser** (Playwright, seeded login):
  - a full fight in each control setup.
  - every prompt kind.
  - Step, Auto Run and Batch after Phase 0, through every UI path that drives a turn: the duplicate-loop lesson.

---

## 6. Decisions

### Decided (2026-10-03)

| # | Question | Decision |
|---|---|---|
| D2 | Shield and Parry | After the roll, for the AI too (Phase 2). AI creatures spend them only when that turns a hit into a miss. Batch numbers for fights with Shield or Parry shift. |
| D3 | What prompts by default | Every reaction, opportunity attacks included. Each prompt offers Always (and Never) for that reaction for the rest of the fight. |
| D5 | Undo in a fight | Your last command, or End turn with the AI turns it set off. The same command again rolls the same dice. |
| D10 | Dice | The app rolls. Any roll since your last command can be overridden as a success or a failure, and an attack as a critical hit (§2.10, Phase 9). |

### Open (the recommended default applies unless changed)

| # | Question | Recommended | Alternatives |
|---|---|---|---|
| D1 | Who controls what | Per side, with a per-token override | Per side only |
| D4 | The AI's turns | Played back at 1×, with speed and Skip | Instant |
| D6 | The board after a fight | Keep it, with Reset to setup | Always restore the setup |
| D7 | Clicking an enemy with nothing armed | Selects it | Attacks it with the first weapon (BG3) |
| D8 | Save while playing | Saves the setup | Saves the board as it stands |
| D9 | Bonus actions between a multiattack's swings | Not in v1; moving between swings is | A routine becomes a running state that any command can come between |

---

## 7. Out of scope, and related

- Multiplayer, chat, fog of war and stealth (AGENTS.md §18).
- Ready; Help and Hide as rules (they're *by hand*); object interactions other than doors.
- Sentinel and Mage Slayer-style reactions.
- Uncanny Dodge and Deflect Missiles. A damage-reducing reaction would fit Phase 2's window later.
- Counterspell against spells above its slot's level (the ability check). The v1 rule stays.
- Choosing where summons appear. The engine places them.
- Picking a path square by square. Waypoints cover it.
- Typing in the number a physical die showed. D10 overrides the outcome instead.
- Related: Restart's reset (Actor sheet plan §8) still applies outside Play.
