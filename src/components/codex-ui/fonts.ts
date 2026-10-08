import { Figtree, Fraunces } from "next/font/google";

/**
 * The Codex's faces, as Character Codex.html has them (CHARACTER_SHEET_WINDOWS_PLAN.md D11): Fraunces for its names and
 * numbers, Figtree for everything else. Only the Codex's chunk imports them, and they aren't preloaded, so they're
 * fetched the first time a Codex opens.
 */
export const codexDisplay = Fraunces({
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
  preload: false,
  variable: "--font-codex-display"
});

export const codexBody = Figtree({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
  preload: false,
  variable: "--font-codex-body"
});
