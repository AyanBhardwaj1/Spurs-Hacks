import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import "@/components/studio/live/live.css";
import { LiveView, type LiveClip, type LiveMoment } from "@/components/studio/live/live-view";
import { StudioBar } from "@/components/studio/studio-bar";
import { loadAnalysisFor, loadStudioAnalysis } from "@/lib/studio/load";
import { mediaTitle } from "@/lib/studio/time";

// The live view: ScorePlay's live feed of the analysed match, with Rundown's analysis following it. The
// analysis is baked in at build time like the project page; the feed, the crowd meter and the clip files
// arrive in the browser.

export function generateStaticParams() {
  return [{ mediaId: String(loadStudioAnalysis().source.id) }];
}

export async function generateMetadata({ params }: PageProps<"/studio/[mediaId]/live">): Promise<Metadata> {
  const loaded = loadAnalysisFor(Number((await params).mediaId));
  return { title: loaded ? `Live · ${mediaTitle(loaded.source.name)} · Rundown` : "Not analysed · Studio · Rundown" };
}

export default async function LivePage({ params }: PageProps<"/studio/[mediaId]/live">) {
  const { mediaId } = await params;
  const analysis = loadAnalysisFor(Number(mediaId));
  // The live feed loops this one match, so there is no live view for anything else.
  if (!analysis) notFound();

  // Only what the page draws goes to the browser; the focus keys alone are thousands of numbers.
  const moments: LiveMoment[] = analysis.moments.map((m) => ({
    id: m.id,
    kind: m.kind,
    title: m.title,
    summary: m.summary,
    start: m.start,
    end: m.end,
    peak: m.peak,
    matchClock: m.matchClock,
    players: m.players,
    team: m.team,
    evidence: m.evidence,
    scores: m.scores,
    tags: m.tags,
  }));
  const clips: LiveClip[] = analysis.clips.flatMap((c) =>
    c.lane === "asap" && c.scoreplayMediaId
      ? [
          {
            id: c.id,
            variant: c.variant,
            format: c.format,
            title: c.title,
            durationSec: c.durationSec,
            scoreplayMediaId: c.scoreplayMediaId,
            momentIds: [...new Set(c.segments.flatMap((s) => (s.momentId ? [s.momentId] : [])))],
          },
        ]
      : [],
  );
  const title = mediaTitle(analysis.source.name);

  return (
    <>
      <StudioBar current={`${title} · Live`}>
        <Link href={`/studio/${analysis.source.id}`} className="press hit inline-flex h-8 items-center rounded-full bg-fill px-3 text-caption font-semibold text-label hover:bg-separator">
          Open the analysis
        </Link>
      </StudioBar>
      <LiveView
        source={{ id: analysis.source.id, title, previewUrl: analysis.source.previewUrl, durationSec: analysis.source.durationSec }}
        moments={moments}
        clips={clips}
        crowd={analysis.crowd}
      />
    </>
  );
}
