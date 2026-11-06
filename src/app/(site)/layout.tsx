import Link from "next/link";
import type { ReactNode } from "react";
import { container } from "@/components/landing/page-parts";
import { SiteHeader } from "@/components/landing/site-header";
import "@/components/landing/landing.css";

const REPO_URL = "https://github.com/AyanBhardwaj1/Spurs-Hacks";

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
          <p className="max-w-[48em]">
            A video you upload stays in its job&apos;s folder on the server running Rundown until you delete the
            job. Nothing is posted anywhere. With an OpenAI key set, the audio and a few sampled frames go to
            OpenAI to transcribe the commentary, follow the play and write the copy; nothing else leaves.
          </p>
          <p className="mt-2 max-w-[48em]">
            On the case study pages, the demo rows, the Pegasus description and the video log values are written by
            hand to show the format. Match footage, photos and logos belong to the clubs and leagues and are not
            hosted here.
          </p>
          <div className="mt-8 flex flex-col gap-3 md:flex-row md:justify-between">
            <p>Started at the Spurs² Hackathon, UT Austin, October 2026. Built by Ayan Bhardwaj.</p>
            <p className="flex gap-6">
              <Link href="/case-study" className="hover:text-label hover:underline">
                Case study
              </Link>
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
