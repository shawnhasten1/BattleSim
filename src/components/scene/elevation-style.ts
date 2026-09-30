/**
 * One color scale for ground height, shared by the map tint and the legend so they can never disagree: warm and
 * stronger the higher the ground, cool below the datum. Heights past `SCALE_TOP_FT` all read as the strongest color.
 */
const SCALE_TOP_FT = 60;

export function heightFill(feet: number, alpha = 1): string {
  const strength = Math.min(Math.abs(feet), SCALE_TOP_FT) / SCALE_TOP_FT;
  if (feet < 0) return `hsla(208, 72%, ${58 - strength * 14}%, ${(0.24 + strength * 0.4) * alpha})`;
  return `hsla(${34 - strength * 14}, 82%, ${58 - strength * 12}%, ${(0.24 + strength * 0.4) * alpha})`;
}

/** "10 ft", "-5 ft" */
export function feetLabel(feet: number): string {
  return `${feet < 0 ? "−" : ""}${Math.abs(feet)} ft`;
}
