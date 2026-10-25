import type { ReactNode } from "react";
import { container } from "@/components/landing/page-parts";
import { SiteHeader } from "@/components/landing/site-header";
import "@/components/landing/landing.css";

const BRIEF_URL =
  "https://scoreplay.notion.site/Spurs-Hackathon-Builder-Brief-3fb9d8f0d4ce815096d4dc8294142346";
const REPO_URL = "https://github.com/SamGu-NRX/spurs-hackathon";

// The pages that explain Rundown share one header and footer. The footer sits at the bottom of the window
// even when a page is shorter than it.
export default function SiteLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#main"
        className="sr-only rounded-full bg-label px-4 py-2 text-footnote font-semibold text-page focus:not-sr-only focus:fixed focus:left-4 focus:top-2 focus:z-30"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="bg-grouped">
        <div className={`${container} py-8 text-caption text-secondary`}>
          <ol className="space-y-2">
            <li>
              The demo rows, the Pegasus description and the video log values are written by hand to show the format.
              None of them come from match data.
            </li>
            <li>
              Match footage, photos and logos belong to the clubs and leagues and stay on ScorePlay and Twelve Labs.
              None of it is hosted here.
            </li>
          </ol>
          <div className="mt-8 flex flex-col gap-3 md:flex-row md:justify-between">
            <p>Spurs² Hackathon, UT Austin, October 22 to 23, 2026.</p>
            <p className="flex gap-6">
              <a href={BRIEF_URL} className="hover:text-label hover:underline">
                Builder brief
              </a>
              <a href={REPO_URL} className="hover:text-label hover:underline">
                GitHub
              </a>
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
