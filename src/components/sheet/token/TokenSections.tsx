"use client";

import { ImagePlus } from "lucide-react";
import { useId, useState, type ChangeEvent } from "react";
import { DEFAULT_GRID_VISUALS, sizeFootprint, type CombatantState, type CreatureDefinition } from "@/engine";
import { MAX_ELEVATION_FT, useEncounterStore } from "@/store/encounter-store";
import { InfoTooltip } from "@/components/ui/InfoTooltip";
import { COMBATANT_STATE_HELP } from "@/lib/sheet-help";
import { appearanceLine, fightLine, statusLine } from "@/lib/actor-sheet/summaries";
import { imageSource, isSurprised, prepBuffs } from "@/lib/actor-sheet/token";
import { tokenVisualsFor } from "@/lib/ui-helpers";
import { srdSlugOf } from "@/lib/token-image";
import { TWIN_SLUGS } from "@/lib/token-pack-match";
import { useDeviceTokenImages, useTokenPackStore } from "@/store/token-pack-store";
import { Segmented } from "../ability-editor/controls";
import { SheetColor, SheetNumber } from "../SheetInputs";
import { SheetSection } from "../SheetSection";
import { Row } from "./Row";
import styles from "../sheet.module.css";

interface SectionProps {
  combatant: CombatantState;
  definition: CreatureDefinition;
  open: boolean;
  onToggle: () => void;
}

const BEFORE_ONLY = "Set before the fight starts: restart it from the Combat panel to change this.";

const ALTITUDE_HELP = (
  <p>
    How many feet above the ground this token is flying. A creature more than its reach above a foe can&apos;t be hit
    in melee (bows and spells still reach), and it falls if it&apos;s knocked prone, can&apos;t move, or dies in the
    air, unless it can hover. The AI raises and lowers fliers itself; set it here to start a fight airborne.
  </p>
);

const PREP_HELP = (
  <p>
    Spells it casts before the fight, like Mage Armor. One that&apos;s up starts the fight on it, with its slot
    already spent. Restart takes it down again.
  </p>
);

/**
 * How this token starts the fight: when it enters, whether it's surprised, what it already has up, how high it flies,
 * and whether it's in its lair. Each row is the store action its shortcut on the right-click menu or the Combat panel
 * uses. Entering, surprise and what's up are set before the fight, so they're disabled once it's under way.
 */
export function FightSection({ combatant, definition, open, onToggle }: SectionProps) {
  const id = useId();
  const underWay = useEncounterStore((s) => s.encounter.round > 0);
  const groundHeight = useEncounterStore((s) => s.encounter.map.elevation?.cells[`${combatant.position.x},${combatant.position.y}`] ?? 0);
  const setArrivesRound = useEncounterStore((s) => s.setArrivesRound);
  const toggleSurprised = useEncounterStore((s) => s.toggleCombatantSurprised);
  const togglePrepBuff = useEncounterStore((s) => s.togglePrepBuff);
  const setAltitude = useEncounterStore((s) => s.setAltitude);
  const setInLair = useEncounterStore((s) => s.setInLair);

  const later = (combatant.arrivesRound ?? 1) > 1;
  const buffs = prepBuffs(definition, combatant);
  const altitude = combatant.altitude ?? 0;
  const fly = definition.movement?.fly ?? 0;
  const why = underWay ? BEFORE_ONLY : undefined;

  return (
    <SheetSection title="This fight" summary={fightLine(definition, combatant)} open={open} onToggle={onToggle}>
      <div className={styles.rows}>
        <Row label="Enters">
          <Segmented
            label="Enters" value={later ? "later" : "board"} disabled={underWay} title={why}
            options={[{ value: "board", label: "On the board" }, { value: "later", label: "On a later round" }]}
            onChange={(next) => setArrivesRound([combatant.id], next === "later" ? 2 : undefined)}
          />
          {later ? (
            <>
              <span className={styles.unit}>round</span>
              <SheetNumber
                label="Arrives on round" className={styles.coreBox} value={combatant.arrivesRound} min={2} max={99}
                disabled={underWay} title={why} onCommit={(round) => setArrivesRound([combatant.id], round)}
              />
            </>
          ) : null}
        </Row>
        <Row label="Surprised" htmlFor={`${id}-surprised`}>
          <label className={styles.checkLine} title={why}>
            <input id={`${id}-surprised`} type="checkbox" checked={isSurprised(combatant)} disabled={underWay} onChange={() => toggleSurprised(combatant.id)} />
            loses its first turn
          </label>
        </Row>
        {buffs.length ? (
          <Row label="Already up" help={PREP_HELP}>
            {buffs.map(({ action, active, affordable }) => (
              <label key={action.id} className={styles.checkLine} title={why ?? (!active && !affordable ? `Not enough left to cast ${action.name}` : undefined)}>
                <input type="checkbox" checked={active} disabled={underWay || (!active && !affordable)} onChange={() => togglePrepBuff(combatant.id, action.id)} />
                {action.name}
              </label>
            ))}
          </Row>
        ) : null}
        {fly || altitude ? (
          <>
            <Row label="Altitude" htmlFor={`${id}-altitude`} help={ALTITUDE_HELP}>
              <SheetNumber
                id={`${id}-altitude`} label="Altitude in feet" className={styles.coreBox} value={altitude} min={0} max={MAX_ELEVATION_FT} step={5}
                onCommit={(feet) => setAltitude([combatant.id], feet)}
              />
              <span className={styles.unit}>ft</span>
              <div className={styles.chips}>
                {[0, 10, 20, 30, 60].map((feet) => (
                  <button key={feet} type="button" aria-pressed={altitude === feet} onClick={() => setAltitude([combatant.id], feet)}>
                    {feet === 0 ? "Land" : feet}
                  </button>
                ))}
              </div>
            </Row>
            <p className={`${styles.note} ${styles.rowNote}`}>
              {groundHeight !== 0 ? `Standing on ground ${groundHeight} ft high. ` : ""}
              {fly
                ? `Flies ${fly} ft${definition.movement?.hover ? " and hovers, so it stays up when knocked prone" : ""}.`
                : "No fly speed: only magic (Fly, Levitate) keeps it up."}
            </p>
          </>
        ) : null}
        {definition.lairActions?.length ? (
          <Row label="In its lair" htmlFor={`${id}-lair`}>
            <label className={styles.checkLine}>
              <input id={`${id}-lair`} type="checkbox" checked={Boolean(combatant.inLair)} onChange={(e) => setInLair([combatant.id], e.target.checked)} />
              takes a lair action on initiative 20
            </label>
          </Row>
        ) : null}
      </div>
      {underWay ? (
        <p className={styles.note}>
          The fight is under way. When it enters, surprise and what&apos;s already up are set before it starts: restart
          it from the Combat panel to change them.
        </p>
      ) : null}
    </SheetSection>
  );
}

/** The token as the map draws it (the map's own `.token` styles), at its size on the map up to four squares. */
function TokenPreview({ combatant, definition }: { combatant: CombatantState; definition: CreatureDefinition }) {
  const squarePx = useEncounterStore((s) => s.encounter.map.grid.squareSizePx ?? DEFAULT_GRID_VISUALS.squareSizePx);
  const deviceImages = useDeviceTokenImages();
  const visuals = tokenVisualsFor(definition, combatant, deviceImages);
  const size = Math.min(4 * DEFAULT_GRID_VISUALS.squareSizePx, sizeFootprint(definition.size) * squarePx);
  const scale = Math.min(1.5, Math.max(0.5, visuals.scale ?? 1));
  return (
    <div className={styles.preview} role="img" aria-label={`How ${combatant.displayName} looks on the map`}>
      <div
        className={`token ${visuals.imageUrl ? "image-token" : ""} ${combatant.faction}`}
        style={{ position: "relative", width: size, height: size, borderColor: visuals.borderColor ?? undefined, cursor: "default" }}
      >
        {visuals.imageUrl ? (
          <img
            src={visuals.imageUrl} alt="" draggable={false}
            style={{ transform: `scale(${scale})`, filter: visuals.tint ? `drop-shadow(0 0 5px ${visuals.tint})` : undefined }}
          />
        ) : (
          <span className="token-initials">{combatant.displayName.slice(0, 2)}</span>
        )}
        {visuals.showNameplate ? <span className="token-nameplate">{combatant.displayName}</span> : null}
      </div>
    </div>
  );
}

/** A glow's first color: the map draws it as a soft light around the image. */
const FIRST_GLOW = "#f0c95e";

/**
 * How the token looks on the map: a preview; its image, for this token or for every token of its creature; its border;
 * its image's scale and glow (which only change an image); and its nameplate.
 */
export function AppearanceSection({ combatant, definition, open, onToggle }: SectionProps) {
  const id = useId();
  const updateCombatantVisuals = useEncounterStore((s) => s.updateCombatantVisuals);
  const updateDefinitionVisuals = useEncounterStore((s) => s.updateDefinitionVisuals);
  const deviceImages = useDeviceTokenImages();
  const visuals = tokenVisualsFor(definition, combatant, deviceImages);
  const source = imageSource(definition, combatant, deviceImages);
  const srdSlug = srdSlugOf(definition);
  const removeDeviceArt = async (slug: string) => {
    const remove = useTokenPackStore.getState().remove;
    for (const each of [slug, ...(TWIN_SLUGS[slug] ?? [])]) await remove(each);
  };
  const [scope, setScope] = useState<"token" | "creature">(source === "token" ? "token" : "creature");
  const scopedImage = scope === "token" ? combatant.tokenVisuals?.imageUrl : definition.tokenVisuals?.imageUrl;
  const every = `every ${definition.name}`;

  function setImage(imageUrl: string | undefined) {
    if (scope === "token") updateCombatantVisuals(combatant.id, { imageUrl });
    else updateDefinitionVisuals(definition.id, { imageUrl });
  }

  function onUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setImage(reader.result);
    };
    reader.readAsDataURL(file);
  }

  const imageNote = source === "token"
    ? definition.tokenVisuals?.imageUrl ? `This token has its own image, in place of the one ${every} has.` : "This token has its own image."
    : source === "creature" ? `Every ${definition.name} shows this image, unless a token has its own.`
    : source === "device" ? "Your imported token art for this SRD monster, kept on this device only."
    : source === "placeholder" ? "The SRD monster's placeholder token. Upload an image, or import token art from the SRD Monsters folder."
    : "No image: it shows its initials.";

  return (
    <SheetSection title="Appearance" summary={appearanceLine(definition, combatant, deviceImages)} open={open} onToggle={onToggle}>
      <div className={styles.appearance}>
        <TokenPreview combatant={combatant} definition={definition} />
        <div className={styles.stack}>
          <div className={styles.field}>
            Image for
            <Segmented
              label="Image for" value={scope} onChange={setScope}
              options={[{ value: "token", label: "This token" }, { value: "creature", label: `Every ${definition.name}` }]}
            />
          </div>
          <div className={styles.inlineRow}>
            <label className={styles.upload}>
              <ImagePlus size={13} /> {scopedImage ? "Replace image" : "Upload image"}
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={onUpload} />
            </label>
            <button type="button" className={styles.upload} disabled={!scopedImage} onClick={() => setImage(undefined)}>
              Clear
            </button>
            {source === "device" && srdSlug ? (
              <button type="button" className={styles.upload} onClick={() => void removeDeviceArt(srdSlug)}>
                Remove your art
              </button>
            ) : null}
          </div>
          <p className={styles.note}>{imageNote}</p>
        </div>
      </div>
      <div className={styles.rows}>
        <Row label="Border">
          <SheetColor label="Border color" value={visuals.borderColor ?? "#ffffff"} onCommit={(borderColor) => updateCombatantVisuals(combatant.id, { borderColor })} />
          {combatant.tokenVisuals?.borderColor ? (
            <button type="button" className={styles.toggleSmall} onClick={() => updateCombatantVisuals(combatant.id, { borderColor: undefined })}>
              Reset
            </button>
          ) : (
            <span className={styles.unit}>{visuals.borderColor ? `every ${definition.name}'s` : "white"}</span>
          )}
        </Row>
        {visuals.imageUrl ? (
          <>
            <Row label="Image scale" htmlFor={`${id}-scale`}>
              <SheetNumber
                id={`${id}-scale`} className={styles.coreBox} value={visuals.scale ?? 1} min={0.5} max={1.5} step={0.05}
                onCommit={(scale) => updateCombatantVisuals(combatant.id, { scale })}
              />
              <span className={styles.unit}>0.5 to 1.5 times the token</span>
            </Row>
            <Row label="Glow" htmlFor={`${id}-glow`}>
              <label className={styles.checkLine}>
                <input
                  id={`${id}-glow`} type="checkbox" checked={Boolean(visuals.tint)}
                  onChange={(e) => updateCombatantVisuals(combatant.id, { tint: e.target.checked ? FIRST_GLOW : undefined })}
                />
                a soft light around the image
              </label>
              {visuals.tint ? <SheetColor label="Glow color" value={visuals.tint} onCommit={(tint) => updateCombatantVisuals(combatant.id, { tint })} /> : null}
            </Row>
          </>
        ) : null}
        <Row label="Nameplate" htmlFor={`${id}-nameplate`}>
          <label className={styles.checkLine}>
            <input
              id={`${id}-nameplate`} type="checkbox" checked={visuals.showNameplate ?? false}
              onChange={(e) => updateCombatantVisuals(combatant.id, { showNameplate: e.target.checked })}
            />
            its name under the token
          </label>
        </Row>
      </div>
      {visuals.imageUrl ? null : <p className={styles.note}>With an image, it can also be scaled and given a glow.</p>}
    </SheetSection>
  );
}

const STATES: Array<[CombatantState["state"], string]> = [
  ["active", "Active"], ["downed", "Downed"], ["defeated", "Defeated"], ["dead", "Dead"], ["fled", "Fled"]
];

/** Its state, set by hand (a creature that fled), and its square. */
export function StatusSection({ combatant, open, onToggle }: Omit<SectionProps, "definition">) {
  const updateCombatant = useEncounterStore((s) => s.updateCombatant);
  const placeCombatant = useEncounterStore((s) => s.placeCombatant);
  const grid = useEncounterStore((s) => s.encounter.map.grid);
  const reserve = combatant.state === "reserve";
  return (
    <SheetSection title="Status & position" summary={statusLine(combatant)} open={open} onToggle={onToggle}>
      <div className={styles.coreRow}>
        <div className={styles.field}>
          <span className={styles.fieldLabel}>
            State
            <InfoTooltip label="About combatant states" content={COMBATANT_STATE_HELP} />
          </span>
          <select
            aria-label="State" value={combatant.state} disabled={reserve}
            onChange={(e) => updateCombatant(combatant.id, { state: e.target.value as CombatantState["state"] })}
          >
            {reserve ? <option value="reserve">Arrives round {combatant.arrivesRound}</option> : null}
            {STATES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        {/* Placed as the Move tool places it: a large token's footprint stays on the grid. */}
        <label className={styles.field}>
          X
          <SheetNumber className={styles.coreBox} value={combatant.position.x} min={0} max={grid.width - 1} onCommit={(x) => placeCombatant(combatant.id, { ...combatant.position, x })} />
        </label>
        <label className={styles.field}>
          Y
          <SheetNumber className={styles.coreBox} value={combatant.position.y} min={0} max={grid.height - 1} onCommit={(y) => placeCombatant(combatant.id, { ...combatant.position, y })} />
        </label>
      </div>
      {reserve ? (
        <p className={styles.note}>It isn&apos;t on the board until round {combatant.arrivesRound}: change that in This fight.</p>
      ) : null}
    </SheetSection>
  );
}
