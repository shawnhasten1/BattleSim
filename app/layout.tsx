import type { Metadata } from "next";
import { Signika } from "next/font/google";
import "./globals.css";

// UI font — exposed as the CSS variable that `--ui-font` (globals.css) chains to.
const signika = Signika({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-signika"
});

export const metadata: Metadata = {
  title: "D&D Battle Simulator",
  description: "Deterministic map-aware D&D 5e encounter simulator"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={signika.variable}>
      <body>{children}</body>
    </html>
  );
}
