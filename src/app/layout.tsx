import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rundown · Turn a full match into clips for every feed",
  description:
    "Upload a full match from any sport. Rundown finds the moments from the crowd and the commentary, cuts each one for TikTok, Reels, Shorts, X and YouTube, captions it, follows the play, and puts every clip in front of you to approve.",
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
