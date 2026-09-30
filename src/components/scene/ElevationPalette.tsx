"use client";

import { useMemo } from "react";
import { MAX_STEP_HEIGHT_FT } from "@/engine";
import { ELEVATION_STEP_FT, useEncounterStore, type ElevationMode } from "@/store/encounter-store";
import { feetLabel, heightFill } from "@/components/scene/elevation-style";
import styles from "./ElevationPalette.module.css";

const MODES: Array<{ mode: ElevationMode; label: string; hint: string }> = [
  { mode: "set", label: "Paint", hint: "Drag over cells to set them to the height below." },
  { mode: "raise", label: `Raise ${ELEVATION_STEP_FT}`, hint: `Each cell you drag over goes up ${ELEVATION_STEP_FT} ft — build a hill or stairs one step at a time.` },
  { mode: "lower", label: `Lower ${ELEVATION_STEP_FT}`, hint: `Each cell you drag over goes down ${ELEVATION_STEP_FT} ft — dig a pit or a ditch.` },
  { mode: "ramp", label: "Ramp", hint: "Drag from the low end to the high end. The steps in between fill in for you." },
  { mode: "flatten", label: "Flatten", hint: "Drag over cells to level them back to ground height." }
];

const HEIGHT_PRESETS = [0, 5, 10, 15, 20, 30, 40, 60];

/** Swatches for the heights on the map, plus what a cliff edge means. Shown while editing, and on its own when the map has heights. */
export function ElevationLegend({ compact = false }: { compact?: boolean }) {
  const cells = useEncounterStore((state) => state.encounter.map.elevation?.cells);
  const heights = useMemo(
    () => [...new Set(Object.values(cells ?? {}))].sort((a, b) => a - b).slice(0, 8),
    [cells]
  );
  if (heights.length === 0) return null;
  return (
    <div className={`${styles.legend} ${compact ? styles.compact : ""}`} aria-label="Ground height legend">
      <div className={styles.swatches}>
        {heights.map((height) => (
          <span key={height} className={styles.swatch}>
            <i style={{ background: heightFill(height, 1.6) }} />
            {feetLabel(height)}
          </span>
        ))}
      </div>
      <div className={styles.edgeNote}>
        <b className={styles.edgeSample} />
        Cliff edge — a drop of more than {MAX_STEP_HEIGHT_FT} ft. Walkers can&apos;t cross it; climbers pay extra, and fliers ignore it.
      </div>
    </div>
  );
}

export function ElevationPalette() {
  const mode = useEncounterStore((state) => state.elevationMode);
  const height = useEncounterStore((state) => state.elevationHeight);
  const rampWidth = useEncounterStore((state) => state.elevationRampWidth);
  const setMode = useEncounterStore((state) => state.setElevationMode);
  const setHeight = useEncounterStore((state) => state.setElevationHeight);
  const setRampWidth = useEncounterStore((state) => state.setElevationRampWidth);
  const clearElevation = useEncounterStore((state) => state.clearElevation);
  const hasHeights = useEncounterStore((state) => Boolean(state.encounter.map.elevation));
  const active = MODES.find((entry) => entry.mode === mode) ?? MODES[0]!;

  return (
    <aside className={styles.palette} aria-label="Elevation tool">
      <header className={styles.header}>
        <strong>Ground height</strong>
        <button type="button" className={styles.link} onClick={clearElevation} disabled={!hasHeights} title="Level the whole map back to ground height">
          Flatten map
        </button>
      </header>

      <div className={styles.modes} role="group" aria-label="Elevation mode">
        {MODES.map((entry) => (
          <button
            key={entry.mode} type="button" aria-pressed={mode === entry.mode}
            className={`${styles.mode} ${mode === entry.mode ? styles.on : ""}`}
            onClick={() => setMode(entry.mode)}
          >
            {entry.label}
          </button>
        ))}
      </div>
      <p className={styles.hint}>{active.hint}</p>

      {mode === "set" ? (
        <div className={styles.heightRow}>
          <div className={styles.stepper}>
            <button type="button" aria-label="Lower the height" onClick={() => setHeight(height - ELEVATION_STEP_FT)}>−</button>
            <label>
              <span className={styles.srOnly}>Height in feet</span>
              <input type="number" step={ELEVATION_STEP_FT} value={height} aria-label="Height in feet" onChange={(e) => setHeight(Number(e.target.value))} />
              <em>ft</em>
            </label>
            <button type="button" aria-label="Raise the height" onClick={() => setHeight(height + ELEVATION_STEP_FT)}>+</button>
          </div>
          <div className={styles.presets} role="group" aria-label="Height presets">
            {HEIGHT_PRESETS.map((preset) => (
              <button
                key={preset} type="button" aria-pressed={height === preset}
                className={`${styles.preset} ${height === preset ? styles.on : ""}`}
                style={{ borderColor: height === preset ? undefined : heightFill(preset, 2) }}
                onClick={() => setHeight(preset)}
              >
                {preset}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {mode === "ramp" ? (
        <div className={styles.heightRow}>
          <span className={styles.rowLabel}>Width</span>
          <div className={styles.presets} role="group" aria-label="Ramp width">
            {[1, 2, 3, 4].map((width) => (
              <button
                key={width} type="button" aria-pressed={rampWidth === width}
                className={`${styles.preset} ${rampWidth === width ? styles.on : ""}`}
                onClick={() => setRampWidth(width)}
              >
                {width} {width === 1 ? "square" : "squares"}
              </button>
            ))}
          </div>
          <p className={styles.hint}>
            Paint each level first (say 0 and 10 ft), then drag the ramp between them. A walker climbs {MAX_STEP_HEIGHT_FT} ft per square,
            so a 10 ft rise needs a ramp at least 3 squares long. The map warns you when it&apos;s too steep.
          </p>
        </div>
      ) : null}

      <ElevationLegend compact />
    </aside>
  );
}
