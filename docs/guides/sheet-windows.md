# Guide: Open several sheets, pop them out, and use the Codex

Each creature on the map can have its own sheet window, and you can keep several open at once. A sheet can pop out into a browser window of its own, for a second monitor, and you can still edit it there. And any sheet can be shown as the **Codex**, a styled character sheet, instead of the Standard one. This guide opens a few sheets, pops one out, and goes through the Codex.

> **What you'll end up with:** a cleric's Codex in its own window, a goblin pack edited from one window, and your sheets where you want them.

---

## 1. Open sheets

**Double-click a token** to open its sheet. You can also use **Edit sheet** on its right-click menu, **Sheet** in the Actors panel, or an initiative row in the Combat panel (double-click it, or right-click › **Open sheet**).

![Two sheets open at once](img/sheet-windows/01-two-windows.png)

- **A sheet belongs to its creature.** Selecting another token doesn't change it. Opening the sheet of a creature whose sheet is already open brings that window to the front.
- **Several at once:** up to eight. A new one opens a little below and right of the one in front. Clicking a window brings it to the front. If you open a ninth, the one you used least recently closes. A sheet with unsaved changes is never the one that closes.
- **Resize** a sheet from its bottom-right corner. Each style remembers its size.

## 2. A creature with several tokens

Five goblins share one sheet. **Stats** and **Abilities** change the creature, so every goblin gets the change. A token's own values are its HP, temp HP, conditions, spent spell slots and the **Token** tab. The switcher above them picks which goblin they're for: **Goblin 3 · 7/7 HP**, 3 of 5. Choosing a goblin there also selects it on the map.

To make one goblin different from the rest, use ⋯ › **Make it its own creature**. The window follows that token to its new creature.

## 3. Pop a sheet out

Click the **pop out** icon in a sheet's title bar. The sheet moves into a browser window of its own: drag it to another monitor and resize it as you like.

![A sheet in its own browser window](img/sheet-windows/03-popped-out.png)

- **It's the same sheet.** An edit there shows on the map at once. Its bar has **Undo** and **Redo**, because the main window's may be on another screen.
- **Dock** puts it back in the page. Anything you were in the middle of (an ability half edited) comes back with it.
- **Closing its browser window** closes the sheet. If it had unsaved changes, it docks back into the page instead, so nothing is lost.
- **It closes with the main page.** Reloading or closing the main page closes every popped-out sheet. Pop them out again afterwards.
- **The builder opens in the main window.** "Level up…", "Open in the builder…" and Homebrew open there, and the popped-out sheet tells you so.

> **If nothing pops out,** your browser blocked the window. The sheet says so. Allow pop-ups for this site and click the icon again.

## 4. The Codex

Click **Codex** in a sheet's title bar to show it as the Codex, a character sheet in teal and copper. **Standard** switches it back. Player characters and everything else each remember the style you last used, so your party can open in the Codex while monsters stay on Standard. The Codex is at its best popped out, in a window of its own.

![A cleric's Codex, popped out](img/sheet-windows/03-popped-out.png)

The Codex edits what you'd fill in on a paper sheet. It saves the same way Standard does, so the two never disagree.

- **The banner:** the name, what it is (class and subclass, species, background), and its alignment, which you can type. The dial shows its level, or a monster's challenge rating. A character made with the builder reads its level from the build, with **Level up…** and **Open in the builder…** beside it. A hand-made character's level can be typed into the dial.
- **The sidebar:** the token's art, then armor class (worked out from worn armor, or typed when there's none), initiative, speed and proficiency. Below them are hit points and temp HP, hit dice and death saves.
- **Ability dials:** type a score into a dial. The modifier is the copper pill below it.

Below the dials are the tabs.

- **Details:**
  - **Skills,** with each one's bonus and passive score. Click a skill's box for proficiency, again for expertise, and once more to clear it.
  - **Saving throws.** A save's box switches proficiency on or off. A dashed box is a number of its own (one typed on Standard).
  - **Origin:** creature type, size, species, background and languages.
  - **Defenses & conditions:** damage immunities, resistances and vulnerabilities, and the conditions it's immune to, each a tag. **×** takes a tag off, and the dashed "Add…" picks a new one. Its conditions right now are below, with **+ Condition**.
- **Items:** weapons, armor and shields, consumables and gear. The box beside armor or a shield puts it on or takes it off, and the AC follows.

![The Items tab](img/sheet-windows/04-items.png)

- **Abilities:** its attacks, each with its to-hit and damage, then its actions, bonus actions, reactions and features. The arrow opens a row to show what it does.

![The Abilities tab, a row opened](img/sheet-windows/05-abilities.png)

- **Spells:** spellcasting ability, save DC and attack bonus, then spell slots and spells by level. A filled slot box is a slot the token still has. Click one to spend it, or click an empty one to get it back.

![Spellcasting on the Codex](img/sheet-windows/06-spellcasting.png)

**Edit** on any attack, ability, item or spell opens it in the ability editor, right in the Codex and in its colours, with the banner and sidebar still in view. It's the same editor as on Standard and works the same way. **Save** or **Cancel**, or its back link (named for the tab you came from), returns you to that tab, where you were, with the row you edited in focus. Unsaved changes are guarded as on Standard: switching to Standard, closing the window or pressing Escape asks first.

![Editing a spell in the Codex](img/sheet-windows/07-edit-in-codex.png)

**Add ability**, at the bottom of the Abilities tab (and **Add spell** on Spells, **Add item** on Items, which open on those kinds), is Standard's Add ability, in the Codex. Search the library, the SRD monsters' abilities, recipes and Open5e, or start from scratch. A library row's **+** adds it as it is. Clicking a row, a recipe or a kind under "Start from scratch" opens it in the ability editor, and nothing is added until **Add to sheet**. Once added, the Codex shows it on its tab, in focus.

![Add ability in the Codex](img/sheet-windows/07-add-ability.png)

A monster's Codex leaves out what it hasn't got: a goblin has no Items or Spells tab. With several tokens, the switcher is in the banner, and the HP, conditions and slots are that token's.

![Three goblins in one Codex](img/sheet-windows/09-goblins.png)

### Light and dark

⋯ › **Codex colours** switches every Codex in this browser between **Dark** (the default) and **Light**. The banner stays dark teal in both.

![The Codex in Light](img/sheet-windows/08-codex-light.png)

---

## Where to go next

- [Build player characters with the character builder](/docs/guides/build-a-character) makes the characters whose Codex reads their build, and is where **Level up…** takes you.
- [Play a fight by hand](/docs/guides/play-a-fight-by-hand) runs a fight with sheets open beside it: they show each token as the fight changes it.
