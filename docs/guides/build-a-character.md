# Guide: Build player characters with the character builder

The character builder makes player characters from the 2024 rules (SRD 5.2): pick a class, a level, a background and a species, and it works out the scores, hit points, saves, skills, spells and every class and subclass feature up to that level. Leveling up adds what the next level gives. This guide makes a rogue, levels it up and into a second class, turns a hand-built PC into a built one, makes a whole party in one click, and adds homebrew content of your own.

> **What you'll end up with:** a Rogue 4 / Fighter 1, a rebuilt Barbarian, a party of four at 5th level, and your homebrew classes and subclasses offered beside the SRD's.

---

## 1. Make a character

Open the **Actors** tab, click **Create Token**, and choose the **Character** tab.

![The Character tab of Create Token](img/build-a-character/01-character-tab.png)

Type a name and choose a **Class**, **Level** and **Background**. A **Species** is optional: without one, set size, speed and senses on the sheet yourself.

- **Quick build** makes every choice for you (the class's suggested ability scores, skills, feats, spells and equipment) and puts the token on the map.
- **Step through the choices…** opens the builder with every choice filled in, for you to change first.

![The builder, every choice already suggested](img/build-a-character/02-builder.png)

The builder shows the scores (base, with what the background and feats add underneath), each level's choices, and the hit points (average by default, or rolls you type in). Change anything, or **Suggest the rest** after clearing some. **Create character** puts it on the map.

> **Either way, nothing is final.** Every choice can be changed later from the sheet.

## 2. Level up

Open the character's sheet. On the **Stats** tab, **Class & level** says what it is and offers **Level up…**, **Level down** and **Open in the builder…**

![Class & level on a built character's sheet](img/build-a-character/03-class-and-level.png)

**Level up…** shows only what the next level asks for, already chosen, and what applying it changes:

![The Level up window at Rogue 4: the Ability Score Improvement, and what changes](img/build-a-character/04-level-up.png)

Click **Level up to 4**. It's one undo step. Tokens at full health follow the new maximum; a hurt token keeps its hit points.

> **Your edits are kept.** If you changed something the builder made (renamed Cunning Action, typed a different max HP), leveling up leaves it as you made it, says so in the list, and offers to update it to the new level's version.

## 3. Add a second class

**Class to level**, at the top of the Level up window, lists the character's classes and, under *A new class (multiclass)*, every other class. A level in a new class is multiclassing.

The 2024 rule needs a 13 in the primary ability of the new class and of each class the character has. The window says when the scores fall short, and lets you take the level anyway:

![A Wizard level for the rogue: it needs Intelligence 13](img/build-a-character/05-multiclass-warning.png)

Choose **Fighter** (the Fighter needs Strength *or* Dexterity 13, and the rogue has the Dexterity). Its first level brings Fighting Style, Second Wind and Weapon Mastery, but not the Fighter's saving throws: those come only from the first class.

![The Fighter level: its choices and what changes](img/build-a-character/06-multiclass.png)

Spell slots from two casting classes are combined by the multiclass rule. A Bard, Ranger or Rogue level taken later also asks for one skill.

## 4. Rebuild a character made by hand

A PC you built by hand (or imported) has **Level & CR** on its Stats tab instead. Under its classes, **Rebuild with the builder…** turns it into a built character at the level it is.

![Rebuild with the builder: the hand-built Barbarian, as a Barbarian 6](img/build-a-character/07-rebuild.png)

- Its classes are found by name (and a subclass, when the builder has one by that name). Change the class if it guessed wrong.
- Its **ability scores and hit point maximum stay as they are**: the builder works out the base scores that give them.
- Nothing is added to its equipment.
- Its class features become the builder's 2024 versions.

Its own abilities stay too. The ones named like something the builder adds are listed, so you don't end up with two of each:

![Its hand-made Rage, Reckless Attack and the rest, named like the builder's](img/build-a-character/08-look-alikes.png)

Tick **Remove my versions when rebuilding** to take them off, or leave them to compare and remove later. Click **Rebuild**. It's one undo step.

## 5. Make a whole party

The **Quick party** box on the Character tab makes four characters at once, at the **Level** chosen above it: a Fighter, a Cleric, a Rogue and a Wizard to start. Change any of the four.

![The Quick party box](img/build-a-character/09-quick-party.png)

Each one is quick built, named after its class, and put on its own square. It's one undo step.

![The party on the map](img/build-a-character/10-party-on-the-map.png)

## 6. Homebrew: your own classes, subclasses, feats, backgrounds and species

**Homebrew content…**, at the bottom of the Character tab (and at the top of the builder window), opens the **Homebrew** window. What you save there belongs to your account and is offered in the Character tab and the builder beside the SRD's, marked *(Homebrew)*. Characters built from it level up with it.

![The Homebrew window, empty](img/build-a-character/11-homebrew.png)

There are four ways to start:

- **Make a new…** a class, a subclass, a feat, a background or a species.
- **Copy an SRD entry**: the quickest start for a variant. It keeps every feature, and you change what's different.
- **Import…** a file someone exported (**Export** saves the open entry as a file, **Export all** saves everything).
- **Import from Open5e…** searches Open5e's classes and subclasses (other publishers' open content). One comes in with its hit die, proficiencies, table and features by level, as reference text for you to make runnable.

### A subclass on an SRD class

A subclass names its **Class**, and that can be an SRD class: an Arcane Trickster on the Rogue, a Path of the Zealot on the Barbarian. It can have its own spellcasting (the Arcane Trickster is a third caster: Intelligence, the wizard's list) and its own table columns (the Zealot's healing dice).

![The Path of the Zealot: a subclass of the SRD Barbarian, with a table column of its own](img/build-a-character/12-subclass.png)

### Features by level

**Features by level** lists levels 1 to 20. Open one to see its features and choices. **+ Feature** makes a new feature in the ability editor, the same one the sheet uses, so anything you can make on a sheet you can make for a class. Each feature's details hold what makes it a class feature:

![A feature's details: the Spiritfire Gun's volley follows the Shots column](img/build-a-character/13-grant.png)

- **Numbers that follow the table**: pick a number or dice in the feature (here, how many shots the volley fires) and what it becomes. The buttons put in a column (`{col:shots}`), the class level (`{level}`) or the proficiency bonus (`{pb}`). Sneak Attack's dice follow its column the same way.
- **A pool of uses**: how many times it can be used (a number, or a column).
- **Replaces**: an earlier feature this one takes the place of (a better version at a higher level).
- **Speed +**, **Max HP +**, **Darkvision**, saving throw proficiencies, spells always prepared, and spells it casts without a slot.

**Edit** opens the feature in the ability editor, previewed on the class built to that level:

![The Spiritfire Gun in the ability editor](img/build-a-character/14-feature-in-editor.png)

**Done** takes it back to the class. **Check** builds the class at every level and lists anything that doesn't work out (a number that no longer exists in its feature, a missing class). **Save** stores it to your account.

![A copy of the SRD Rogue, ready to change](img/build-a-character/15-copy-srd.png)

### From Open5e

Search by name; a class's subclasses are found by its name too. The SRD 5.2 classes are left out, since the builder has them already.

![Open5e's Marshal and its subclasses](img/build-a-character/16-open5e.png)

An imported class is your copy: importing it again just opens yours, so your changes are never overwritten.

> **What runs, and what doesn't.** A feature's badge says how much of it the simulator runs, as the dots on the sheet's Abilities tab do: *Simulated*, *Partly simulated* (its text says what isn't), or *Reference only* (text for you to apply by hand). The SRD classes mark their own; a homebrew feature runs as far as you've made it run.

---

## Where to go next

- The [Zealot Barbarian guide](/docs/guides/zealot-barbarian) builds a character's features by hand in the ability editor, which is also how you make a homebrew class's features run.
- [Play a fight by hand](/docs/guides/play-a-fight-by-hand) runs a fight with your new party.
