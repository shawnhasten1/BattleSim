import { Cormorant_Garamond } from "next/font/google";

/**
 * The Codex's display face, for its headings and numbers (CHARACTER_SHEET_WINDOWS_PLAN.md D11). Only the Codex's
 * chunk imports it, and it isn't preloaded, so it's fetched the first time a Codex opens. Body text stays the app's Signika.
 */
export const codexDisplay = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
  preload: false,
  variable: "--font-codex"
});
