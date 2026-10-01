# Guide: Build a Zealot Barbarian (level 5)

This walkthrough builds a level 5 Path of the Zealot Barbarian from scratch: a hard-hitting melee fighter who rages, attacks recklessly, and adds radiant "Divine Fury" damage to a hit each turn while raging.

Along the way you'll use the token creator, the **Add ability** search, and the **ability editor** for features — the last one is the important skill, because almost every class feature is built the same way.

> **What you'll end up with:** 55 HP, AC 15, a Greataxe, two attacks per Attack action, Rage (3 uses) with Divine Fury built in, and Reckless Attack.

**Shortcut:** the library has a ready-made **Rage (Zealot)**. It bundles Rage and Divine Fury, and its Divine Fury lets the wielder choose radiant *or* necrotic per hit. If you just want the character, add it with the others in [step 2](#2-add-the-greataxe-extra-attack-and-reckless-attack) (search `rage`, then its **+**) and skip step 3. Read on if you want to understand how it's put together, or need to build a variant.

---

## 1. Create the token

Open the **Actors** tab in the sidebar and click **Create Token**.

![Create Token dialog filled in for the Zealot](img/zealot-barbarian/01-create-token.png)

| Field | Value | Why |
| --- | --- | --- |
| Name | Zealot Barbarian | Anything you like. |
| Faction | Party | Which side they fight on. |
| AC | 15 | Unarmored Defense: 10 + DEX (+2) + CON (+3). |
| HP | 55 | Level 5 with a +3 CON modifier. |
| Speed | 30 | |
| Proficiency | 3 | Level 5. |
| STR / DEX / CON / INT / WIS / CHA | 18 / 14 / 16 / 8 / 12 / 10 | A standard point-buy-style spread favouring STR and CON. |

Click **Create token**. The token appears on the map and in the actor list.

Then select it and click **Sheet** to open its sheet. Weapons, spells, attacks and features are all added on the **Abilities** tab.

![The empty Abilities tab](img/zealot-barbarian/02-abilities-empty.png)

> **Tip:** the sheet's **Stats** tab also has **Level** and **Class** fields (they default to 1 / Adventurer). They're informational, so set them to 5 / Barbarian if you like.

## 2. Add the Greataxe, Extra Attack and Reckless Attack

All three are in the library, ready to use, so they go on in one go. Click **Add ability** and type `greataxe`.

![Searching for greataxe](img/zealot-barbarian/03-add-greataxe.png)

One search covers everything you can add: recipes, the library's weapons, spells and features, and the abilities of the SRD monsters (four of them swing a greataxe too). Click the **+** beside the library's **Greataxe** to add it as it is.

The panel stays open and says *Added Greataxe*, with your search selected, so just type the next one: `extra attack`, then its **+**. Then `reckless`, and its **+**.

![Adding Extra Attack after the Greataxe](img/zealot-barbarian/04-add-extra-attack.png)

Click **Done**. All three are listed under **Actions**:

![The three on the Abilities tab](img/zealot-barbarian/05-library-added.png)

- **Extra Attack** comes first, as a multiattack does in a statblock: `2 × any weapon attack`. Each Attack action makes two attacks, and each one picks the Zealot's best weapon for its target.
- **Greataxe** reads `+7 to hit, reach 5 ft · 10 (1d12 + 4) slashing`, the way a statblock would print it.
- **Reckless Attack** gives advantage on your melee attacks this turn, at the cost of attacks against you having advantage until your next turn.

The dot before each row says how much of it the simulator runs. Extra Attack's and the Greataxe's are full: the AI uses them as written. Reckless Attack's is half, and hovering it says why: it costs no action, and the AI only switches on features that cost a bonus action (and reactions), so in an automatic fight the Zealot never attacks recklessly. Use it by hand when you play the fight yourself.

> **Clicking a result instead of its +** opens it in the ability editor first, to check or change before it's added (**Add to sheet**). **Enter** in the search does the same for the first result.

To see how Extra Attack works, click its row and open **Grants → Extra Attack**. Its **Sequence** is one step, `2 × Any weapon attack`, with what that does in an average round. A fighter makes it three at 11th level; a Barbarian stays at two.

![The Extra Attack routine](img/zealot-barbarian/06-extra-attack-routine.png)

## 3. Build Rage (with Divine Fury inside it)

Divine Fury only works **while raging**, so it's built as one more effect inside the Rage feature rather than as a separate feature. That way it switches on and off with Rage automatically.

### 3a. Start from the Rage recipe

Click **Add ability** and type `rage`.

![Searching for rage](img/zealot-barbarian/07-add-rage.png)

**Recipes** are patterns to start from; the **Library** has finished features, including the shortcut's **Rage (Zealot)**. Click the **Rage** recipe.

It opens in the ability editor. The preview at the top reads the way the feature works, and each section below it has a one-line summary. The two sections the recipe expects you to look at, **Use & cost** and **While active**, are open and marked **fill in**.

![Rage in the ability editor](img/zealot-barbarian/08-rage-form-top.png)

What **Use & cost** says:

- **It works: When switched on** — Rage is something the character switches on, not an always-on bonus (Pack Tactics is *Always*).
- **Takes: Bonus action** — switching it on costs the bonus action.
- **Limit: Pool, spends 1 from `rage`** — each use spends one from a pool named `rage`. The pool is added to the creature when you add Rage (see [the check at the end](#check-your-work)).
- **Lasts: 1 minute** — ten six-second rounds.

### 3b. Read what it does while active

Fold **Use & cost** to see all of **While active**. Each card is one thing that's true while Rage lasts, written as a sentence.

![Rage's While active cards](img/zealot-barbarian/09-rage-effects.png)

The recipe gives you: **+2** damage on STR melee hits, **resistance** to bludgeoning, piercing and slashing, and **advantage on STR saves**. Click a card's pencil to see its fields.

### 3c. Add Divine Fury

Click **+ Add effect**. The menu is grouped by what an effect changes (its attacks, its defense, saving throws, staying alive, its turn). Choose **Extra damage on its hits**, then set the card up like this:

![The Divine Fury card](img/zealot-barbarian/10-divine-fury-effect.png)

| Setting | Value | Why |
| --- | --- | --- |
| Damage | `1` d `6` `+2` | The 1d6, plus half the Barbarian level, rounded down (level 5 → 2). Raise it as they level. |
| Type | radiant | Then open the line's **…** and tick **Choose the type each time**, with **radiant** and **necrotic** picked. |
| Once per turn | ticked | Only the first hit each turn. |
| When | nothing picked | It already only happens while Rage lasts. |
| Which attacks | melee and ranged | Any weapon attack. |

> **Radiant or necrotic:** the Zealot picks the type each time. With both picked, the simulator chooses whichever the target resists least.

The card reads *Once per turn, its melee or ranged hits deal an extra 5 (1d6 + 2) radiant or necrotic damage.* Click **Done**, then **Add to sheet**.

> **Tip:** this is exactly what the library's **Rage (Zealot)** holds. Opening that one in the editor shows the same cards.

## Check your work

The **Abilities** tab should now read:

![The finished Abilities tab](img/zealot-barbarian/11-finished-list.png)

- **Actions:** Extra Attack, Greataxe and Reckless Attack.
- **Bonus actions:** Rage, with a **1 rage** chip for what each use costs, and `+2 on melee hits, advantage on STR saves, +5 (1d6 + 2) radiant or necrotic on melee or ranged hits once a turn, resists bludgeoning, piercing, and slashing for 1 minute`.

Above the list, **Resources** reads **Rage 3/3**: the rage pool, created when you added Rage, with all three uses left. Three is right for a level 5 Barbarian. Open it to change what this token has left, and the full size every fight starts with.

![The rage pool's sizes](img/zealot-barbarian/12-rage-pool.png)

Now drop the token onto a map and run a fight from the **Combat** panel. Use **Step** to watch each decision, and see whether the Zealot rages and how Divine Fury shows up in the log.

## Next steps

- Add **Danger Sense** (advantage on DEX saves): **Add ability → Start from scratch → Trait or feature**, then in **While active** choose **Add effect → Advantage on its saves** and pick **DEX**.
- Tweak the tactics on the sheet's **Token** tab to make the Zealot charge in more or less aggressively.
- Build a Bear Totem variant: the library has **Rage (Totem Warrior: Bear)**, which resists every damage type except psychic.
