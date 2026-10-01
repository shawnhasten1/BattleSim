"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen, LayoutGrid, Swords } from "lucide-react";
import type { GuideSummary } from "@/lib/guides";
import { SrdAttribution } from "./SrdAttribution";
import styles from "./docs.module.css";

interface Section {
  id: string;
  label: string;
  content: ReactNode;
}

const SECTIONS: Section[] = [
  {
    id: "getting-started",
    label: "Getting Started",
    content: (
      <>
        <p>
          BattleSim is a tabletop-RPG battle simulator: you build a map, populate it with actors (player
          characters and monsters), and then run combat turn-by-turn — either watching it play out live or
          fast-forwarding hundreds of runs to see how a fight tends to go.
        </p>
        <p>The basic flow is:</p>
        <ol>
          <li>
            <strong>Sign up / log in</strong> — every campaign you create is scoped to your account.
          </li>
          <li>
            <strong>Create a campaign</strong> — a folder that holds a set of encounters (see{" "}
            <a href="#campaigns">Campaigns</a>).
          </li>
          <li>
            <strong>Create an encounter</strong> inside that campaign and open it in the editor (see{" "}
            <a href="#encounters">Encounters</a>).
          </li>
          <li>
            <strong>Build the map</strong> — draw walls, paint terrain, drop in a background image (see{" "}
            <a href="#walls">Walls, Terrain &amp; Height</a>).
          </li>
          <li>
            <strong>Add actors</strong> to each side and fill out their sheets — stats, attacks, spells,
            AI behavior (see <a href="#actors">Actor Sheets</a> and <a href="#spells">Spells &amp; Attacks</a>
            ).
          </li>
          <li>
            <strong>Run it</strong> — roll initiative and step through, auto-play, or batch-simulate the fight
            from the Combat panel.
          </li>
        </ol>
        <p>
          You don't have to start from a campaign — the sandbox at <code>/</code> is a scratch encounter that
          isn't saved to any campaign, good for quickly testing a matchup.
        </p>
      </>
    )
  },
  {
    id: "campaigns",
    label: "Campaigns",
    content: (
      <>
        <p>
          A campaign is the top-level container for your encounters — think of it as a folder for one
          ongoing game or one set of fights you're testing. From the <strong>Campaigns</strong> page you can:
        </p>
        <ul>
          <li>
            <strong>Create</strong> a campaign by typing a name and hitting <em>New Campaign</em>.
          </li>
          <li>
            <strong>Set a cover image</strong> on a campaign card (the image icon) so it's easier to pick out
            in the list.
          </li>
          <li>
            <strong>Rename</strong> or <strong>delete</strong> a campaign from the icons on its card. Deleting
            a campaign deletes every encounter inside it — there's no undo, so the app asks you to confirm
            first.
          </li>
          <li>Click a card to open that campaign and see its list of encounters.</li>
        </ul>
        <p>Everything you create is private to your account — other users can't see or edit your campaigns.</p>
      </>
    )
  },
  {
    id: "encounters",
    label: "Encounters",
    content: (
      <>
        <p>
          Inside a campaign, click <strong>New Encounter</strong> to open the Create Encounter dialog:
        </p>
        <ul>
          <li><strong>Encounter name</strong>.</li>
          <li>
            <strong>Grid size</strong> — pick a preset (Landscape 40×30, Portrait 30×40, Square 40×40) or hit{" "}
            <strong>Custom…</strong> for exact columns, rows, pixels-per-square, and feet-per-square.
          </li>
          <li>
            <strong>Background (optional)</strong> — upload an image now, or leave it blank and start with an
            empty grid; you can always add or replace it later from Scene settings. When you upload one, the
            canvas automatically resizes to match its shape rather than cropping it to a fixed size.
          </li>
        </ul>
        <p>
          The scene-switcher dropdown in the top bar has the same dialog under <strong>New scene</strong>,
          with an extra choice: <strong>Clone current map</strong> (copies your walls/terrain/tokens into a
          new scene, named "&lt;name&gt; Variant") or <strong>Start fresh</strong> to open the same
          name/grid/background picker instead. Replacing an existing background image on a map that already
          has walls, terrain, or tokens placed will warn you first if the new image's proportions don't match
          the old one, since that can throw off everything already positioned.
        </p>
        <p>
          Opening an encounter drops you into the main editor, which is made up of a few areas:
        </p>
        <ul>
          <li>
            <strong>Top bar</strong> — switch scenes, open the Encounter Builder, undo/redo, save, reset the
            encounter, view the battle report, and scene settings (grid size, background image, and{" "}
            <strong>Padding (sq)</strong> — extra border around the map outside the grid, Foundry-VTT style).
          </li>
          <li>
            <strong>Left tool rail</strong> — the map-editing tools: draw walls, paint terrain, measure, place
            templates, move tokens.
          </li>
          <li>
            <strong>Sidebar</strong> — your roster and the Combat panel.
          </li>
        </ul>
        <p>Once your map and roster are ready, the Combat panel drives the fight:</p>
        <ul>
          <li>
            <strong>Initiative</strong> rolls turn order for every actor on the board.
          </li>
          <li>
            <strong>Step</strong> advances a single action at a time — good for watching exactly what the AI
            decides to do and why.
          </li>
          <li>
            <strong>Auto Run</strong> plays the entire fight live, action by action, without you clicking
            Step repeatedly.
          </li>
          <li>
            <strong>Batch 100</strong> fast-forwards the encounter 100 times with no animation and reports
            aggregate results (win rate, average rounds) — useful for balancing a fight rather than watching
            one outcome of it.
          </li>
        </ul>
        <p>
          Each side can be given a tactics profile (e.g. skirmisher, brute, defender, controller) that steers
          how its actors choose targets and abilities, and a side can start <strong>surprised</strong>, which
          costs it its first turn.
        </p>
      </>
    )
  },
  {
    id: "walls",
    label: "Walls, Terrain & Height",
    content: (
      <>
        <p>
          The battle map is a grid you can drop a background image onto and then build out with walls and
          terrain using the left tool rail.
        </p>

        <h3>Walls & cover</h3>
        <p>
          <strong>Walls</strong> are line segments you draw between grid points. Each wall can:
        </p>
        <ul>
          <li>Block projectiles and line of sight, or not.</li>
          <li>
            Have a <strong>door state</strong> (open, closed, or destroyed) — an open or destroyed door stops
            blocking anything.
          </li>
          <li>
            Carry a <strong>cover level</strong>: half, three-quarters, or total. Cover reduces (or, at
            total, entirely blocks) an attacker's ability to target a creature standing behind it. On the map,
            heavier cover is drawn as a thicker, more solid line; lighter cover fades to a thin dashed line.
          </li>
        </ul>
        <p>
          Cover is worked out automatically during combat: the engine samples several lines from the attacker
          to the corners and center of the target's square, and uses the strongest obstruction it finds (a
          wall or another creature standing in the way) to decide how much cover applies to that shot.
        </p>

        <h3>Painting terrain</h3>
        <p>
          Select the <strong>Terrain</strong> tool in the left rail to reveal a brush sub-toolbar. Click a
          cell to paint it, or click-and-drag to paint every cell the cursor crosses — the whole stroke undoes
          in one step. Shift-click to multi-select painted tiles. The brush presets:
        </p>
        <ul>
          <li><strong>Difficult terrain</strong> — half speed (×2 move cost).</li>
          <li><strong>Greater difficult terrain</strong> — quarter speed (×4 move cost).</li>
          <li><strong>Impassable</strong> — blocks movement entirely.</li>
          <li><strong>Acid</strong> — DC 12 Dex save, 2d6 acid damage (half on a success), re-checked every round spent standing in it.</li>
          <li><strong>Lava</strong> — 4d10 fire damage on entry or while standing in it, no save.</li>
          <li><strong>Ice</strong> — DC 10 Dex save or fall prone on entry; no damage at all.</li>
          <li><strong>Eraser</strong> — clears painted terrain instead of adding it.</li>
        </ul>
        <p>
          Each hazard tile shows a small icon (a droplet, flame, or snowflake) so its type reads at a glance
          regardless of color. The AI treats hazardous and difficult/impassable terrain as real danger and
          cost when pathing — the same avoidance logic that steers it around a Spike Growth zone (see{" "}
          <a href="#zones">Zones &amp; Persistent Effects</a>) applies here too.
        </p>

        <h3>Editing painted terrain</h3>
        <p>
          Right-click one or more selected tiles for a context menu: swap the terrain type for the whole
          selection, step the movement-cost multiplier up/down, and — if every selected tile shares the same
          hazard — fine-tune that hazard's own <strong>Save DC</strong> and <strong>damage dice</strong> count
          beyond the three fixed presets (e.g. turn a DC 12 acid pool into a DC 15 one, or bump 2d6 up to
          3d6). The same menu deletes the selection.
        </p>

        <h3>Ground height, ramps &amp; cliffs</h3>
        <p>
          Select the <strong>Elevation</strong> tool (the stacked-layers icon) to open the Ground height
          palette. Height is its own layer, separate from terrain, so a lava pool can sit on top of a hill.
          Hover a cell to see its height (and what the brush would change it to). The modes:
        </p>
        <ul>
          <li><strong>Paint</strong> — drag over cells to set them to the chosen height (type a value or pick a preset).</li>
          <li><strong>Raise 5 / Lower 5</strong> — each cell you drag over goes up or down one 5 ft step.</li>
          <li>
            <strong>Ramp</strong> — paint the two levels first, then drag from the low end to the high end;
            the steps in between fill in. The preview turns red and tells you how long the ramp needs to be if
            it is too steep to walk.
          </li>
          <li><strong>Flatten</strong> — drag to level cells back to ground height; <em>Flatten map</em> clears every height.</li>
        </ul>
        <p>
          A walker can step up or down <strong>5 ft</strong> between neighbouring squares, which is what a
          stair or a ramp gives it. Anything steeper is a <strong>cliff</strong>, drawn on the map as a heavy
          dark-red line: walkers can&apos;t cross it (they path around to a ramp), climbers can at a square of
          movement per 5 ft, and fliers ignore it. A creature shoved off a ledge falls the difference; one
          shoved into a cliff face stops against it. Height also counts toward reach and range, so a spearman
          on the ground can&apos;t hit someone standing on a 10 ft ledge overhead.
        </p>

        <h3>Flying &amp; altitude</h3>
        <p>
          A creature with a fly speed can be airborne. Set a token&apos;s starting altitude from its
          right-click menu (<strong>Flight</strong> → Altitude, or <strong>Land</strong>; works on a whole
          selection) or the sheet&apos;s Token tab. An airborne token floats over a shadow with its height on
          a badge.
        </p>
        <ul>
          <li>
            Reach and range are measured in three dimensions: a creature more than its reach overhead can&apos;t be
            hit in melee, but bows, spells and breath weapons still reach it. The log says so plainly when a
            fighter can&apos;t reach a flier.
          </li>
          <li>Climbing or diving costs movement like any other flying (5 ft of fly speed per 5 ft of height).</li>
          <li>Rising out of a foe&apos;s reach provokes an opportunity attack, just like walking out of it.</li>
          <li>
            A flier that is knocked prone, restrained, grappled, stunned, paralyzed, unconscious or killed
            <strong> falls</strong>: 1d6 bludgeoning per 10 ft (up to 20d6), landing prone. Creatures that
            <strong> hover</strong> (a toggle beside fly speed on the Stats tab) stay up.
          </li>
          <li>
            In automated fights, melee fliers swoop down just far enough to strike, and ranged fliers climb
            out of reach of foes who can&apos;t follow them up.
          </li>
        </ul>
        <p>
          Walls still block sight and movement at every height, and cover doesn&apos;t yet account for height.
        </p>
      </>
    )
  },
  {
    id: "actors",
    label: "Actor Sheets",
    content: (
      <>
        <p>
          Every token on the board — player character or monster — has an actor sheet behind it, split into
          tabs:
        </p>
        <ul>
          <li>
            <strong>Stats</strong> — ability scores, AC, HP, speed, proficiency bonus, saving throws, skills,
            resources such as spell slots, and the spellcasting ability its spells follow.
          </li>
          <li>
            <strong>Abilities</strong> — the attacks, spells, and features this actor can use in combat.
          </li>
          <li>
            <strong>Tactics</strong> — the AI behavior profile that decides how this actor plays (who it
            targets, how aggressively it uses resources).
          </li>
          <li>
            <strong>Token</strong> — the on-map instance data: position and token image, kept separate from
            the reusable sheet so the same actor definition can be dropped onto multiple maps.
          </li>
        </ul>
        <p>
          Each row on the Abilities tab reads like a line from a statblock (<em>+6 to hit, reach 5 ft · 11 (2d6 + 4)
          slashing</em>), worked out from the numbers the simulator actually rolls.
        </p>
        <p>
          Weapons, attacks, spells and special actions (saves, areas, heals, buffs, teleports) open in the{" "}
          <strong>ability editor</strong>, in place of the list. Its preview at the
          top shows the ability as a statblock entry, with whether the simulator runs all of it, and any warnings
          (a pool the creature doesn&apos;t have, a trigger that never fires) with a link to the section that fixes
          them. Below, each section (Use &amp; cost, Target, Roll, Damage, Effects, Notes &amp; AI and more; see{" "}
          <a href="#spells">Spells &amp; Attacks</a>) shows a one-line summary and opens to its settings, with the rarer
          ones under <strong>More options</strong>. Save is one undo step and does nothing until something changes;
          Esc or leaving the sheet asks before throwing changes away. Features, summons and shapechanges still open
          the builder form.
        </p>
        <p>
          You can build an actor by hand on the Abilities tab, or drop in a
          ready-made creature from the SRD/Open5e compendium and adjust it from there. Actors also carry a{" "}
          <strong>creature type</strong> (beast, undead, fiend, etc.), which some spells and features key off
          of — see <a href="#spells">restrictions by creature type</a> below.
        </p>
      </>
    )
  },
  {
    id: "spells",
    label: "Spells & Attacks",
    content: (
      <>
        <p>
          Spells, attacks and special actions (a breath, a gaze, a heal) are all built in the{" "}
          <strong>ability editor</strong>, which opens in place of the Abilities list. This section walks through
          it: how to start one, what each section does, and two worked examples.
        </p>

        <h3>Starting one</h3>
        <p>Click <strong>Add</strong> on the Abilities tab:</p>
        <ul>
          <li>
            <strong>Library</strong> — search the built-in SRD spells and click one (or drag it onto the sheet) to
            attach it, fully simulated. It casts with this creature&apos;s spellcasting ability (below): its DC and
            attack bonus follow it, and a heal adds its modifier.
          </li>
          <li>
            <strong>Preset</strong> — recipes to start from: a damage cantrip, a save-or-condition spell, an area
            blast, healing, a buff, a teleport and a reaction spell.
          </li>
          <li>
            <strong>Blank</strong> — <em>Spell</em> starts a 1st-level spell attack; <em>Special action</em> starts a
            monster&apos;s saving throw. The Roll and Target sections turn either into anything else.
          </li>
          <li>
            <strong>Import</strong> — an Open5e spell comes in as reference text the simulator doesn&apos;t cast.
            Open it and pick how it works in its Roll section to simulate it.
          </li>
        </ul>

        <h3>The spellcasting ability</h3>
        <p>
          A creature&apos;s spellcasting ability is set on its <strong>Stats</strong> tab. A spell&apos;s DC or attack
          bonus can follow it: change it from WIS to CHA and every spell that follows it moves with it. A spell can
          use an ability of its own instead (the DC&apos;s ability in its Roll section, or the attack&apos;s Uses). A
          creature without one gets one the first time a spell follows it: the ability its spells name most, or else
          its highest of INT, WIS and CHA.
        </p>

        <h3>The sections</h3>
        <p>
          Each section shows a one-line summary and opens to its settings; rarer ones sit under{" "}
          <strong>More options</strong>, which says how many are set. The preview at the top is the ability as a
          statblock entry.
        </p>
        <ul>
          <li>
            <strong>Basics</strong> (spells) — level (cantrip or 1st–9th), school, concentration and ritual;
            components and source under More options. Changing the level moves the slot with it, and a cantrip is
            cast at will.
          </li>
          <li>
            <strong>Use &amp; cost</strong> — what it takes (an action, a bonus action or a reaction) and what it
            spends: at will, a spell slot (of its level to begin with), uses per encounter, a recharge, or a pool you
            pick or create. A reaction shows its trigger: hit by an attack, targeted by an attack, a creature leaving
            its reach, or something described. With a slot, <strong>Stronger with a higher slot</strong> adds dice,
            beams or targets for each level above.
          </li>
          <li>
            <strong>Target</strong> — one creature (5 ft reads as touch), several, itself, or an area: a sphere,
            cone, line or cube, its size, and where it starts (around itself, at a point in range, or out from itself
            the way a cone goes). A small diagram draws it to scale. An area save also picks whether it affects
            everyone in it or only its enemies; a teleport picks who teleports and how far.
          </li>
          <li>
            <strong>Roll</strong> — <em>How it works</em>: an attack roll, a saving throw, or automatic (it heals,
            grants a benefit or teleports). Switching keeps what the two kinds share and sets the rest aside, so
            switching back brings it back; a note says what moved. A saving throw sets the ability, the DC (as
            printed, or calculated from 8 + an ability + proficiency) and what a success does: half damage, no
            damage, or avoids it entirely.
          </li>
          <li>
            <strong>Healing</strong> or <strong>Benefit</strong> — for an automatic ability: healing lines (dice
            plus the ability they add), or what a buff grants (AC, attack rolls, saving throws, attacks against it,
            temporary hit points; resistances and a condition such as invisible under More options) and how long
            it lasts. <strong>Cast before combat</strong> (under Use &amp; cost) keeps a long buff like Mage Armor
            out of the fight.
          </li>
          <li>
            <strong>Damage</strong> — lines of dice, the ability each adds, and a type, with averages. A
            cantrip&apos;s lines can grow at levels 5, 11 and 17 (a line&apos;s own More).
          </li>
          <li>
            <strong>Effects</strong> — cards grouped by when they happen: on a hit, a critical hit or a miss after an
            attack; on a failed save, a successful one or either way after a save. After a save, a condition
            doesn&apos;t roll a save of its own (the save already decided it), and if it lasts until the creature
            shakes it off, it repeats that save. A card can be limited to{" "}
            <strong>creature types</strong> (Turn Undead) under its More options.
          </li>
          <li id="zone-builder">
            <strong>Lingering area</strong> (area saves) — makes the area stay on the map, the way Web, Cloudkill,
            Spike Growth and Moonbeam do: how long it lasts, when it affects a creature (entering it, starting or
            ending a turn in it), whether it also hits everyone in it when it appears, how it moves (stays put, moves
            with its caster, drifts away each turn, or the caster moves it with a bonus action), difficult or
            impassable ground, damage for moving through it, and whether it&apos;s heavily obscured. See{" "}
            <a href="#zones">Zones &amp; Persistent Effects</a> for how they play.
          </li>
          <li>
            <strong>Notes &amp; AI</strong> — reference text, and whether the simulator uses it at all.
          </li>
        </ul>
        <p>
          Warnings under the preview point at the section that fixes them: a spell whose slot the creature
          doesn&apos;t have (&quot;Never usable&quot;), a lingering area that never affects anyone, a benefit that grants
          nothing, or success effects a save that &quot;avoids it&quot; never reaches.
        </p>

        <h3>Worked example: building Fireball from scratch</h3>
        <ol>
          <li>Abilities tab → Add → Blank → Spell. Name: <em>Fireball</em>.</li>
          <li>Roll: How it works → <em>Saving throw</em>. Target: Reaches → <em>An area</em> (a 20-ft sphere at a point); within <em>150</em> ft.</li>
          <li>Roll: A success → <em>Half damage</em>. Damage: <em>8</em> d <em>6</em> fire.</li>
          <li>Basics: Level → <em>3rd</em>; it now spends a 3rd-level slot. Use &amp; cost: tick <strong>Stronger with a higher slot</strong> (+1d6 per level above).</li>
          <li>Add to sheet. Give the caster <code>slot-3</code> (and higher, to upcast) on its Stats tab; the editor warns until it has them.</li>
        </ol>

        <h3>Worked example: a Cloudkill-style poison cloud</h3>
        <ol>
          <li>Abilities tab → Add → Blank → Spell. Name: <em>Poison Cloud</em>. Basics: Level → <em>5th</em>, tick <strong>Needs concentration</strong>.</li>
          <li>Roll: How it works → <em>Saving throw</em>. Target: Reaches → <em>An area</em>.</li>
          <li>Roll: Saving throw → <em>CON</em>, A success → <em>Half damage</em>. Damage: <em>5</em> d <em>8</em> poison.</li>
          <li>Lingering area: tick <strong>Leaves a lingering area</strong>. It lasts while its caster concentrates and affects a creature that enters it or starts its turn in it. The area → <em>Drifts away</em>, 10 ft.</li>
          <li>Add to sheet. The cloud settles on the map, hits anyone who starts a turn in it, and drifts away from the caster each turn until concentration breaks.</li>
        </ol>
      </>
    )
  },
  {
    id: "zones",
    label: "Zones & Persistent Effects",
    content: (
      <>
        <p>
          A handful of spells leave a persistent zone on the battlefield instead of resolving instantly.
          There's no separate "zone builder" — casting one of these spells creates the zone automatically, and
          it's simulated every turn until it expires. A few patterns show up in the built-in spell library:
        </p>
        <ul>
          <li>
            <strong>Cloudkill</strong> — the zone automatically drifts a set distance away from the caster
            each of the caster's turns.
          </li>
          <li>
            <strong>Spike Growth</strong> — anything that moves through the zone takes automatic damage per
            square of movement, and the AI accounts for this when deciding whether to path through it.
          </li>
          <li>
            <strong>Moonbeam</strong> — the caster can spend a bonus action to reposition the zone rather than
            it moving on its own.
          </li>
          <li>
            <strong>Web / Insect Plague–style zones</strong> — terrain-only effects (difficult terrain,
            vision-blocking) with no direct damage.
          </li>
        </ul>
        <p>
          While a token is standing inside an active zone, it gets a visible highlight on the map so it's
          obvious at a glance who's currently affected.
        </p>
      </>
    )
  },
  {
    id: "traits",
    label: "Monster Traits & Lair Actions",
    content: (
      <>
        <p>
          Library monsters come with their traits already wired up, and you can give any creature the same
          abilities from <strong>Add → Preset</strong> in its Abilities tab. Each trait row says in plain words what it
          does in a fight — &ldquo;charge 20 ft: +1d6 slashing, STR 11 or prone&rdquo;, &ldquo;aura 10 ft: CON 14 or
          poisoned, at the start of their turn&rdquo;. Traits with nothing to simulate (Keen Smell, Amphibious) carry a
          quiet <strong>no combat effect</strong> badge rather than looking like something is missing.
        </p>

        <h3>Charges and pounces</h3>
        <ul>
          <li>
            <strong>Charge / Trampling Charge / Pounce</strong> — if the creature closes at least 20 ft (or the distance
            you set) straight toward a target and then hits it with the named attack that turn, the extra damage lands
            and the target saves or is knocked prone. A detour around a wall doesn&apos;t count: it has to get that much
            closer. Pounce and Trampling Charge then allow a bonus-action attack against the prone target. The AI knows
            this: a lion with room to run leads with its claw, not its (harder-hitting) bite.
          </li>
          <li><strong>Rampage</strong> — after dropping a creature with a melee attack, it moves (up to half its speed) and bites the next foe as a bonus action.</li>
          <li><strong>Blood Frenzy</strong> — advantage on melee attacks against anything missing hit points.</li>
          <li><strong>Surprise Attack / Sneak Attack / Martial Advantage</strong> — extra damage against a surprised target, with advantage or an ally beside the target, or with an ally beside the target (once per turn).</li>
          <li><strong>Aggressive / Cunning Action</strong> — a bonus-action Dash (and Disengage or Hide): the AI closes the gap and still attacks.</li>
        </ul>
        <p>
          A creature knocked prone gets up at the start of its next turn, which costs it half its movement (unless it&apos;s
          grappled or restrained and can&apos;t move).
        </p>

        <h3>Auras and retaliation</h3>
        <ul>
          <li><strong>Stench, Fear Aura</strong> — a creature that starts its turn close by makes a save or is poisoned (or frightened) until the start of its next turn; a creature that saves is immune for the rest of the fight.</li>
          <li><strong>Fire Aura</strong> — at the start of the bearer&apos;s own turn, everything next to it burns.</li>
          <li><strong>Heated Body, Corrosive Form</strong> — hitting the creature with a melee attack from within 5 ft hurts the attacker.</li>
          <li><strong>Death Burst, Death Throes</strong> — the creature explodes when it dies.</li>
          <li><strong>Evasion</strong> — a Dexterity save for half damage takes none on a success and half on a failure.</li>
        </ul>
        <p>
          To build your own, open a feature in the builder: <em>Affects creatures around it each round</em> (when, range,
          who, save, damage, condition), <em>Hurts creatures that hit it in melee</em>, and <em>Bonus-action follow-up</em>
          (pick which of its attacks it makes, and when it earns it).
        </p>

        <h3>Lair actions</h3>
        <p>
          Give a creature lair actions in its Abilities tab (<strong>+ Lair action</strong> — any save, area or attack
          ability). Then mark the token <strong>In its lair</strong> from its right-click menu or the Token tab. Each
          round, on initiative 20 (after anyone who rolled 20 or more), it takes one of its lair actions — never the same
          one two rounds running — without spending any of its own actions. The initiative tracker shows the slot as a
          dashed <em>Lair actions · 20</em> row, and the combat log reads &ldquo;Lair action (initiative 20): …&rdquo;. The SRD
          statblocks don&apos;t include lair actions, so these are yours to write.
        </p>
      </>
    )
  },
  {
    id: "credits",
    label: "Credits & Licensing",
    content: (
      <>
        <p>
          The built-in library of monsters, spells, weapons and features is based on the System Reference
          Document 5.1, which is provided under the Creative Commons Attribution 4.0 International License.
          BattleSim is compatible with fifth edition.
        </p>
        <SrdAttribution />
      </>
    )
  }
];

export function DocsPage({ guides = [] }: { guides?: GuideSummary[] }) {
  const [activeId, setActiveId] = useState(SECTIONS[0].id);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length === 0) return;
        const top = visible.reduce((best, entry) => (entry.boundingClientRect.top < best.boundingClientRect.top ? entry : best));
        setActiveId(top.target.id);
      },
      { rootMargin: "-15% 0px -70% 0px", threshold: 0 }
    );
    for (const section of SECTIONS) {
      const el = sectionRefs.current[section.id];
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return (
    <div className={styles.page}>
      <div className={styles.topbar}>
        <BookOpen size={16} />
        <h1>BattleSim Docs</h1>
        <div className={styles.spacer} />
        <a href="/campaigns">
          <LayoutGrid size={14} /> Campaigns
        </a>
        <a href="/">
          <Swords size={14} /> Sandbox
        </a>
      </div>

      <div className={styles.layout}>
        <nav className={styles.nav}>
          {SECTIONS.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className={section.id === activeId ? styles.navItemActive : styles.navItem}
            >
              {section.label}
            </a>
          ))}
          {guides.length > 0 && <span className={styles.navHeading}>Guides</span>}
          {guides.map((g) => (
            <a key={g.slug} href={`/docs/guides/${g.slug}`} className={styles.navItem}>
              {g.title}
            </a>
          ))}
        </nav>

        <main className={styles.content}>
          {SECTIONS.map((section) => (
            <section
              key={section.id}
              id={section.id}
              ref={(el) => {
                sectionRefs.current[section.id] = el;
              }}
              className={styles.section}
            >
              <h2>{section.label}</h2>
              {section.content}
            </section>
          ))}
        </main>
      </div>
    </div>
  );
}
