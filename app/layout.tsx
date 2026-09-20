import type { Metadata } from "next";
import { Signika } from "next/font/google";
import { SessionProviderWrapper } from "@/components/providers/SessionProviderWrapper";
import "./globals.css";

// UI font — exposed as the CSS variable that `--ui-font` (globals.css) chains to.
const signika = Signika({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-signika"
});

export const metadata: Metadata = {
  title: "BattleSim — Encounter Simulator",
  description: "Deterministic map-aware encounter simulator, compatible with fifth edition"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={signika.variable}>
      <body>
        <SessionProviderWrapper>{children}</SessionProviderWrapper>
      </body>
    </html>
  );
}
