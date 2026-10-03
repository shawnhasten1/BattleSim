# Guide: Play a fight by hand

This walkthrough runs the default scene the way you'd run it at the table: you play the party, the AI plays the goblins, and a dragon of your own joins in to show legendary actions. It takes about five minutes.

> **What you'll do:** start a fight in Play, move and attack on the map, cast an area spell, answer a reaction's question, take a legendary action, and use the DM's hand.

---

## 1. Start the fight

Open the **Combat** tab and click **Play**. A short setup opens under the buttons.

![The Play setup in the Combat panel](img/play-a-fight-by-hand/01-setup.png)

| Setting | Choose | Why |
| --- | --- | --- |
| Party | You | You play the fighter and the archer. |
| Enemies | AI | The goblins play themselves. |
| Ask before my creatures react | On | You're asked before an opportunity attack, Shield, Counterspell and the like. |
| The AI's turns | 1× | Their turns play out on the map, one at a time. |

Click **Start**. Initiative is rolled if it hasn't been, and the board as it is now becomes the fight's setup (for **Reset to setup** at the end).

> **Tip:** each row of the initiative list now has a **You/AI** chip. Click one to hand a single creature to the other player, say a goblin boss you want to run yourself.

## 2. Move

On your creature's turn the **hotbar** sits at the bottom of the map, and the squares it can still reach are tinted. Point at a square: the route the engine would take appears, with what it costs.

![A route, its cost, and an opportunity attack on the way](img/play-a-fight-by-hand/02-moving.png)

- **Click** to move there. **Shift-click** to plan a stop on the way, to go round something; **Esc** or right-click takes the last stop back.
- A red ring and a weapon's name mark each creature that would get an **opportunity attack**, and the line under the hotbar says so.
- **Dash** and **Disengage** are on the **Common** tab: the movement doubles, or the opportunity attacks go away.
- You can also drag the token. Dropped somewhere it can't reach, it stays put and says why.

## 3. Attack

Press a weapon on the **Attacks** tab, or its number key. Its range is tinted and each creature it can hit gets a ring. Point at one to see your chances.

![Aiming the shortbow: the chance to hit, the AC and the damage](img/play-a-fight-by-hand/03-aiming.png)

Click the creature to attack. A greyed-out button says why it can't be used ("Fighter has already used its action"); a creature it can't reach says so too ("Line of effect is blocked").

## 4. Cast an area spell

Give a creature spells to try this: the SRD **Mage** in the Actors tab's monster library has plenty. On the **Spells** tab, the slots left are shown as pips, and the level to cast at sits under each spell.

![Fireball following the cursor, with the goblin it catches](img/play-a-fight-by-hand/04-area.png)

The template follows the cursor. Foes it catches are ringed with their chance to fail the save; a friend it would catch is ringed in yellow, and the hotbar warns you. Click to cast.

## 5. Answer a question

When one of your creatures could react, a card asks, with the numbers.

![An opportunity attack's question](img/play-a-fight-by-hand/05-question.png)

Pick an option, or **Don't**. The row at the bottom sets that reaction for the rest of the fight: **Always** takes it every time without asking, **Never** never does. The hotbar's **Reactions** tab changes the same settings.

## 6. Take a legendary action

Add an **Adult Red Dragon** from the monster library and set its chip to **You**. After each other creature's turn, the dragon is asked whether to spend a legendary action.

![The dragon's legendary actions after the fighter's turn](img/play-a-fight-by-hand/06-legendary.png)

Pick **Tail Attack** and aim it on the map, as in step 3 (**Esc** comes back to the card). **Detect** is marked *by hand*: taking it spends its point and logs it, and you apply what it does. Its points come back at the start of its own turn.

## 7. The DM's hand

Right-click any token to change it as the DM: HP, temporary HP, conditions, its reaction back. **Alt-drag** puts it anywhere; right-click a door to open or close it.

![The DM's hand on a goblin](img/play-a-fight-by-hand/07-dm-menu.png)

Each of these is logged as the DM's, so the battle report counts them and a replay shows them.

## 8. Finish

- **Undo** (on the hotbar) takes back your last command, or an **End turn** with the AI turns after it. The same command again rolls the same dice.
- **Odds from here** in the Combat panel lets the AI play out the rest of the fight from the board as it stands, 100 times over.
- When one side is left, the card offers the **Battle report**, **Save this run** (kept with the scene), **Reset to setup** and **Keep the board**.

A fight in progress survives a reload. Saving the scene while you play saves its setup, not the half-fought board.
