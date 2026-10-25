import type { Metadata } from "next";
import { LockIcon } from "@/components/landing/icons";
import { Highlight, Page, PageIntro } from "@/components/landing/page-parts";
import { PlatformFlow } from "@/components/landing/platform-flow";

export const metadata: Metadata = { title: "Built on · Rundown" };

export default function BuiltOn() {
  return (
    <Page>
      <PageIntro eyebrow="Built on" title="ScorePlay keeps the record. Twelve Labs watches the tape.">
        Rundown sits between the club&apos;s media library and a video model.{" "}
        <Highlight>The footage stays on both platforms.</Highlight> Rundown moves IDs, timecodes and decisions between
        them.
      </PageIntro>
      <PlatformFlow />
      <div className="mt-14 grid gap-12 md:grid-cols-2 md:gap-16">
        <div className="reveal">
          <p className="text-body font-semibold text-secondary">ScorePlay</p>
          <h2 className="mt-2 text-tile font-semibold">The club&apos;s system of record.</h2>
          <p className="mt-3 text-secondary">
            Rundown reads assets and tags from ScorePlay and writes every decision back onto the asset as a timecoded
            action.
          </p>
        </div>
        <div className="reveal">
          <p className="text-body font-semibold text-secondary">Twelve Labs</p>
          <h2 className="mt-2 text-tile font-semibold">Search and description for video.</h2>
          <p className="mt-3 text-secondary">
            Marengo finds moments across every clip and Pegasus describes them. Each Twelve Labs video carries its
            ScorePlay asset ID, which is how every result finds its way back.
          </p>
        </div>
      </div>
      <p className="reveal mt-16 flex items-start gap-4 text-secondary">
        <LockIcon className="mt-0.5 size-6 shrink-0 text-label" />
        <span className="max-w-[62ch]">
          <Highlight>Match media stays where it lives.</Highlight> Rundown streams renditions by URL and keeps only IDs,
          timecodes and metadata. It never downloads, commits or re-hosts footage, and the platforms are wiped after
          the event.
        </span>
      </p>
    </Page>
  );
}
