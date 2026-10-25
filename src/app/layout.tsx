import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rundown · Assisted auto-production for match day",
  description:
    "Rundown watches every asset from a game, drafts the pieces worth making for each audience, and shows the producer what it dropped and why. Built at the Spurs² Hackathon on ScorePlay and Twelve Labs.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="antialiased">
      <body>{children}</body>
    </html>
  );
}
