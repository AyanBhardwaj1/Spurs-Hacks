import type { Metadata } from "next";
import Link from "next/link";
import { ProjectView } from "@/components/studio/project-view";
import { RunBadge, StudioBar, recordedLabel, studioContainer } from "@/components/studio/studio-bar";
import { findRecap, reelStudioId } from "@/lib/studio/clips";
import { sourceExtras } from "@/lib/studio/library";
import { loadAnalysisFor, loadStudioAnalysis } from "@/lib/studio/load";
import { mediaTitle, timecode } from "@/lib/studio/time";

// The analysed match is known at build time, so its page is prerendered with the analysis baked in.
// ScorePlay's extras (sprite sheets, the club's thumbnails) stream in at request time.
export function generateStaticParams() {
  return [{ mediaId: String(loadStudioAnalysis().source.id) }];
}

export async function generateMetadata({ params }: PageProps<"/studio/[mediaId]">): Promise<Metadata> {
  const loaded = loadAnalysisFor(Number((await params).mediaId));
  return { title: loaded ? `${mediaTitle(loaded.source.name)} · Studio · Rundown` : "Not analysed · Studio · Rundown" };
}

const SECTIONS = [
  { href: "#run", label: "Run" },
  { href: "#match", label: "Match" },
  { href: "#dropped", label: "Dropped" },
  { href: "#clips", label: "Clips" },
  { href: "#accuracy", label: "Club check" },
  { href: "#recap", label: "Recap" },
  { href: "#published", label: "In ScorePlay" },
];

export default async function ProjectPage({ params }: PageProps<"/studio/[mediaId]">) {
  const { mediaId } = await params;
  const loaded = loadAnalysisFor(Number(mediaId));

  if (!loaded) {
    return (
      <>
        <StudioBar current={`Media ${mediaId}`} />
        <main className={`${studioContainer} py-24`}>
          <h1 className="text-title2 font-semibold">This media has not been analysed</h1>
          <p className="mt-2 max-w-[52ch] text-body text-secondary">
            The studio has an analysis for one match so far. Run the pipeline on ScorePlay media {mediaId} to open it here.
          </p>
          <Link href="/studio" className="press mt-6 inline-flex h-9 items-center rounded-full bg-button px-4 text-footnote font-semibold text-white hover:bg-button-hover">
            Back to the library
          </Link>
        </main>
      </>
    );
  }

  const analysis = loaded;
  const { source } = analysis;
  const recordedAt = recordedLabel(analysis.generatedAt);
  const renderedIds = analysis.clips.flatMap((c) => (c.scoreplayMediaId ? [c.scoreplayMediaId] : []));
  const reelIds = analysis.clips.flatMap((c) => {
    const id = reelStudioId(c);
    return id ? [id] : [];
  });
  const extras = sourceExtras(source.id, source.durationSec, [...renderedIds, ...reelIds]);
  const nav = SECTIONS.filter(
    (s) => (s.href !== "#recap" || findRecap(analysis.clips)) && (s.href !== "#published" || renderedIds.length > 0),
  );

  return (
    <>
      <StudioBar current={mediaTitle(source.name)} nav={nav}>
        <RunBadge recordedAt={recordedAt} />
        <Link
          href={`/studio/${source.id}/live`}
          className="press inline-flex h-8 items-center gap-1.5 rounded-full bg-fill px-3 text-caption font-semibold text-label hover:bg-separator"
        >
          <span aria-hidden className="size-1.5 rounded-full bg-tally" />
          Live
        </Link>
      </StudioBar>
      <main className={`${studioContainer} pb-28 pt-6`}>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-x-8 gap-y-2">
          <div className="min-w-0">
            <h1 className="text-title2 font-semibold">{mediaTitle(source.name)}</h1>
            <p className="num mt-1 text-caption text-secondary">
              ScorePlay {source.id} · {timecode(source.durationSec)} · {source.height}p{source.fps} · {source.players.length} players tagged
            </p>
          </div>
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-caption">
            {analysis.writeback && (
              <a href="#match" className="rounded-md font-semibold text-go hover:underline">
                Written to ScorePlay: {analysis.writeback.videoLogs} timecoded moments
              </a>
            )}
            {renderedIds.length > 0 && (
              <a href="#published" className="rounded-md font-semibold text-tint hover:underline">
                {renderedIds.length} {renderedIds.length === 1 ? "clip" : "clips"} rendered and uploaded to ScorePlay
              </a>
            )}
          </p>
        </div>
        <ProjectView analysis={analysis} recordedAt={recordedAt} extras={extras} />
      </main>
    </>
  );
}
