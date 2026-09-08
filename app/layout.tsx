import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "D&D Battle Simulator",
  description: "Deterministic map-aware D&D 5e encounter simulator"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
