"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { BookOpen, LayoutGrid, Swords } from "lucide-react";
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
            <a href="#walls">Walls &amp; the Battle Map</a>).
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
          Inside a campaign, create an encounter to get a fresh map and roster. Opening an encounter drops
          you into the main editor, which is made up of a few areas:
        </p>
        <ul>
          <li>
            <strong>Top bar</strong> — switch scenes, open the Encounter Builder, undo/redo, save, reset the
            encounter, view the battle report, and scene settings.
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
    label: "Walls & the Battle Map",
    content: (
      <>
        <p>
          The battle map is a grid you can drop a background image onto and then build out with walls and
          terrain using the left tool rail.
        </p>
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
        <p>
          Besides walls, you can paint <strong>terrain</strong> onto grid cells — normal, difficult (costs
          extra movement), impassable, hazardous, or terrain that grants cover/elevation. Terrain painted this
          way is permanent for the encounter, as opposed to the temporary zones spells create (see{" "}
          <a href="#zones">Zones &amp; Persistent Effects</a>).
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
            <strong>Stats</strong> — ability scores, AC, HP, speed, proficiency bonus, saving throws and
            skills.
          </li>
          <li>
            <strong>Actions</strong> — the attacks, spells, and features this actor can use in combat.
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
          You can build an actor by hand using the form-based builders on the Actions tab, or drop in a
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
          Attacks and spells are both defined as actions on an actor's sheet, with a shared shape: damage dice,
          a to-hit bonus or save DC, range, and any secondary effects.
        </p>
        <ul>
          <li>
            <strong>Attacks</strong> roll to hit against AC and deal damage on a hit (with the usual crit and
            resistance/vulnerability handling).
          </li>
          <li>
            <strong>Save-based spells</strong> force a saving throw against the caster's DC instead of an
            attack roll.
          </li>
          <li>
            <strong>Upcasting</strong> — a spell can scale its damage (or add extra targets, Hold Person–style)
            when cast using a higher spell slot. The AI will choose to upcast a spell on its own when it has
            slots to spare and the fight calls for it.
          </li>
          <li>
            <strong>Riders</strong> — an attack or spell can attach a secondary effect, like an applied
            condition, on top of its normal damage.
          </li>
          <li>
            <strong>Creature-type restrictions</strong> — some effects (Turn Undead–style abilities, for
            example) only work against specific creature types, and won't be considered valid targets for
            anything else.
          </li>
        </ul>
        <p>
          Some spells also place a lasting area on the map when cast — those are covered next, since they
          behave differently turn to turn than a one-shot attack or save.
        </p>
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
    id: "accounts",
    label: "Accounts",
    content: (
      <>
        <p>
          BattleSim supports full multi-user accounts — sign up with an email and password (or another
          supported sign-in method) from the login screen. Once you're signed in, every campaign, encounter,
          and custom actor you create is scoped to your account and private to you.
        </p>
        <p>
          You can sign out from the icon in the top bar of the editor or from the Campaigns page. There's
          currently no sharing of campaigns between accounts — each user's content is their own.
        </p>
      </>
    )
  }
];

export function DocsPage() {
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
