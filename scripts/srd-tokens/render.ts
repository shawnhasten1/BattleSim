import type { CreatureType } from "../../src/engine";

/**
 * The disc colour of a placeholder token, by creature type. Dark and fairly muted so the
 * map's faction border (party / enemy) still reads as the token's loudest colour.
 */
export const TYPE_COLORS: Record<CreatureType, string> = {
  aberration: "#5e3a8c",
  beast: "#6e5134",
  celestial: "#a8842f",
  construct: "#4f5a63",
  dragon: "#8f2a24",
  elemental: "#25707a",
  fey: "#94406f",
  fiend: "#64202a",
  giant: "#7a5f2a",
  humanoid: "#365579",
  monstrosity: "#566126",
  ooze: "#43803a",
  plant: "#2b6139",
  undead: "#45455a"
};

const LIGHT_ICON = "#f3eee4";
const DARK_ICON = "#1f2126";

function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, "0")).join("")}`;
}

/** Mix toward white (amount > 0) or black (amount < 0). */
function shade(hex: string, amount: number): string {
  const target = amount > 0 ? 255 : 0;
  const t = Math.abs(amount);
  return toHex(channels(hex).map((c) => c + (target - c) * t) as [number, number, number]);
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The icon colour that contrasts best with a disc. */
export function iconColorFor(disc: string): string {
  const l = luminance(disc);
  const onLight = (l + 0.05) / (luminance(DARK_ICON) + 0.05);
  const onDark = (luminance(LIGHT_ICON) + 0.05) / (l + 0.05);
  return onLight > onDark ? DARK_ICON : LIGHT_ICON;
}

/**
 * A round placeholder token: a softly lit disc in `color` with a game-icons glyph centred on
 * it. `iconBody` is the icon's inner SVG from `@iconify-json/game-icons` (a 512×512 path drawn
 * in `currentColor`).
 */
export function renderTokenSvg(iconBody: string, color: string, title: string): string {
  const fg = iconColorFor(color);
  const escapedTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img">`,
    `<title>${escapedTitle}</title>`,
    `<defs><radialGradient id="disc" cx="50%" cy="36%" r="70%">`,
    `<stop offset="0" stop-color="${shade(color, 0.22)}"/><stop offset="1" stop-color="${shade(color, -0.35)}"/>`,
    `</radialGradient></defs>`,
    `<circle cx="256" cy="256" r="256" fill="url(#disc)"/>`,
    `<circle cx="256" cy="256" r="236" fill="none" stroke="${fg}" stroke-opacity=".18" stroke-width="5"/>`,
    `<g color="${fg}" transform="translate(104 104) scale(.59375)">${iconBody}</g>`,
    `</svg>`,
    ""
  ].join("\n");
}
