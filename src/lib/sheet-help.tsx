/**
 * Shared `InfoTooltip` content for concepts that show up in more than one
 * sheet tab (automation support, combatant state). Tooltip content that's
 * local to a single dropdown (tactics profiles, resource stances, actor tags,
 * rider triggers, feature-effect kinds) is built next to that dropdown
 * instead — see TacticsTab.tsx, RiderEditor.tsx, FeatureEffectEditor.tsx.
 */

export const AUTOMATION_HELP = (
  <dl>
    <div>
      <dt>full</dt>
      <dd>The AI can pick and use this entirely on its own — attack rolls, damage, saves, and conditions all resolve automatically.</dd>
    </div>
    <div>
      <dt>partial</dt>
      <dd>The engine models part of this, but part needs a DM call to resolve. The AI never chooses it on its own.</dd>
    </div>
    <div>
      <dt>reference-only</dt>
      <dd>Visible on the sheet so the DM can play it by hand. The AI and batch runs always skip it.</dd>
    </div>
    <div>
      <dt>unsupported</dt>
      <dd>Not modeled by the engine yet — a note only. Always skipped by the AI.</dd>
    </div>
  </dl>
);

export const COMBATANT_STATE_HELP = (
  <dl>
    <div>
      <dt>Active</dt>
      <dd>Can act and be targeted normally.</dd>
    </div>
    <div>
      <dt>Downed</dt>
      <dd>Hit 0 HP and is making death saves — party members only, when that rule is on. Still a valid finishing target.</dd>
    </div>
    <div>
      <dt>Defeated</dt>
      <dd>Hit 0 HP without death saves — out of the fight for good (the usual outcome for enemies).</dd>
    </div>
    <div>
      <dt>Dead</dt>
      <dd>Permanently out: 3 failed death saves, or the DM's call. Can't be healed or targeted.</dd>
    </div>
    <div>
      <dt>Fled</dt>
      <dd>Left the fight under its own power. A DM-set state only — the engine never sets this automatically. Can't be healed or targeted.</dd>
    </div>
  </dl>
);
