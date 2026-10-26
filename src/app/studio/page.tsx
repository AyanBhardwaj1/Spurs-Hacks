import Link from "next/link";
import { Suspense } from "react";
import { HoverPreview } from "@/components/studio/hover-preview";
import { DOWN_COPY, OFF_COPY, SLOW_COPY } from "@/components/studio/extras";
import { LibraryPresenter } from "@/components/studio/library-presenter";
import { RunBadge, StudioBar, recordedLabel, studioContainer } from "@/components/studio/studio-bar";
import { clubClipName, clubVideos, type ClubRange } from "@/lib/studio/clips";
import { MATCH_FOLDERS, MATCH_LABEL, matchLibrary, type LibraryItem } from "@/lib/studio/library";
import { scoreplayMediaUrl } from "@/lib/studio/links";
import { clubCheck, type Cutoff } from "@/lib/studio/evaluation";
import { loadStudioAnalysis } from "@/lib/studio/load";
import { clipLength, timecode } from "@/lib/studio/time";
import type { GroundTruthClip } from "@/lib/studio/types";

type Summary = {
  sourceId: number;
  /** The analysed match as the committed analysis records it, shown when ScorePlay's listing is slow or down. */
  source: LibraryItem;
  /** Source second for the poster frame when ScorePlay's thumbnail is not available: the top moment's peak. */
  posterAt: number;
  recordedAt: string;
  moments: number;
  clips: number;
  /** The ranking at K = 10 (or the first cut-off measured): of our top K moments, how many the club clipped. */
  topK: Cutoff;
  renderedIds: number[];
  groundTruth: GroundTruthClip[];
};

// The analysis summary is read at build time and baked in; the ScorePlay listing streams in per request.
export default function LibraryPage() {
  const analysis = loadStudioAnalysis();
  const summary: Summary = {
    sourceId: analysis.source.id,
    source: {
      id: analysis.source.id,
      name: analysis.source.name,
      folderId: MATCH_FOLDERS[0].id,
      durationSec: analysis.source.durationSec,
      width: analysis.source.width,
      height: analysis.source.height,
      previewUrl: analysis.source.previewUrl,
    },
    posterAt: [...analysis.moments].sort((a, b) => b.scores.total - a.scores.total)[0]?.peak ?? 0,
    recordedAt: recordedLabel(analysis.generatedAt),
    moments: analysis.moments.length,
    clips: analysis.clips.length,
    topK: clubCheck(analysis.eval).head,
    renderedIds: analysis.clips.flatMap((c) => (c.scoreplayMediaId ? [c.scoreplayMediaId] : [])),
    groundTruth: analysis.groundTruth,
  };

  return (
    <>
      <StudioBar>
        <RunBadge recordedAt={summary.recordedAt} />
      </StudioBar>
      <main className={`${studioContainer} pb-28 pt-10`}>
        <p className="text-caption font-semibold uppercase tracking-[0.06em] text-secondary">ScorePlay library</p>
        <h1 className="mt-1 text-[34px] font-semibold leading-tight tracking-tight">{MATCH_LABEL}</h1>
        {/* The match and its run come from the committed analysis, so they show at once; only the club's
            videos and the uploads wait on ScorePlay. */}
        <FullMatch item={summary.source} summary={summary} />
        <Suspense fallback={<p className="mt-14 text-footnote text-secondary">Loading the club&rsquo;s videos from ScorePlay…</p>}>
          <LibraryContent summary={summary} />
        </Suspense>
      </main>
    </>
  );
}

async function LibraryContent({ summary }: { summary: Summary }) {
  const library = await matchLibrary();
  if (!library.ok) {
    // The run is in the committed analysis, so the match and its project open whatever ScorePlay does.
    return (
      <>
        <LibraryPresenter
          projectHref={`/studio/${summary.sourceId}`}
          note={`The full ${timecode(summary.source.durationSec)} match in the club's ScorePlay. The run starts from the full match alone.`}
        />
        <p role="status" className="mt-14 text-caption text-secondary" title={library.error}>
          {library.off ? OFF_COPY : `${library.slow ? SLOW_COPY : DOWN_COPY} The club’s videos will show when it answers.`}
        </p>
      </>
    );
  }

  const located = new Map(clubVideos(summary.groundTruth).map((v) => [v.scoreplayId, v.ranges]));
  const clubCount = library.folders.reduce((n, f) => n + f.items.length, 0);
  const rendered = new Set(summary.renderedIds);
  const uploads = library.matchFolder.filter((i) => rendered.has(i.id));

  return (
    <>
      <LibraryPresenter
        projectHref={`/studio/${summary.sourceId}`}
        note={`The full ${timecode(summary.source.durationSec)} match and the ${clubCount} videos Tottenham's team made from it by hand, read live from ScorePlay. The run starts from the full match alone.`}
      />
      {uploads.length > 0 && (
        <section aria-labelledby="uploads-title" data-section="published" className="band mt-14 pt-10">
          <p className="text-caption font-semibold uppercase tracking-[0.06em] text-secondary">Back in ScorePlay</p>
          <h2 id="uploads-title" className="mt-1 text-title2 font-semibold">
            {uploads.length} {uploads.length === 1 ? "clip" : "clips"} Rundown rendered and uploaded next to the match
          </h2>
          <p className="mt-2 max-w-[62ch] text-footnote text-secondary">
            These are ScorePlay media now, in the same folder as the full match, where the club&rsquo;s team already works.
          </p>
          <ul className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-x-3 gap-y-5">
            {uploads.map((item) => (
              <ClubTile key={item.id} item={item} href={scoreplayMediaUrl(item.id)} />
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="club-title" data-section="library" className="band mt-14 pt-10">
        <p className="text-caption font-semibold uppercase tracking-[0.06em] text-secondary">Published by the club</p>
        <h2 id="club-title" className="mt-1 text-title2 font-semibold">
          {clubCount} videos Tottenham&rsquo;s team made from this match
        </h2>
        <p className="mt-2 max-w-[62ch] text-footnote text-secondary">
          The clips cut by hand are what the studio checks itself against. Clips it located inside the full match say where,
          and whether our run found the same moment.
        </p>
        {library.folders.map((folder) => (
          <div key={folder.id} className="mt-9">
            <h3 className="flex items-baseline gap-2 text-subhead font-semibold">
              {folder.name}
              <span className="num text-caption font-normal text-secondary">{folder.items.length}</span>
            </h3>
            <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-x-3 gap-y-5">
              {folder.items.map((item) => (
                <ClubTile key={item.id} item={item} located={located.get(item.id)} />
              ))}
            </ul>
          </div>
        ))}
      </section>
    </>
  );
}

function FullMatch({ item, summary }: { item: LibraryItem; summary: Summary }) {
  const href = `/studio/${item.id}`;
  const analysed = item.id === summary.sourceId;
  return (
    <section aria-labelledby="full-match-title" data-section="library" className="mt-8 grid grid-cols-1 items-center gap-8 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <Link href={href} className="press group relative block aspect-video overflow-hidden rounded-[18px] bg-grouped" tabIndex={-1} aria-hidden>
        {item.previewUrl && (
          // The top moment's frame, from the rendition on ScorePlay's CDN, so it does not wait on ScorePlay's API.
          <video src={`${item.previewUrl}#t=${summary.posterAt}`} muted playsInline preload="metadata" className="absolute inset-0 size-full object-cover" />
        )}
        <span className="chip chip-film num absolute bottom-3 right-3">{timecode(item.durationSec)}</span>
      </Link>
      <div>
        <p className="text-caption font-semibold uppercase tracking-[0.06em] text-secondary">Full match</p>
        <h2 id="full-match-title" className="mt-1 text-tile font-semibold text-balance">
          {clubClipName(item.name)}
        </h2>
        <p className="num mt-2 text-caption text-secondary">
          ScorePlay {item.id} · {timecode(item.durationSec)}
          {item.height ? ` · ${item.height}p` : ""}
        </p>

        {analysed ? (
          <div className="mt-6 rounded-[14px] bg-grouped p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-footnote font-semibold">Analysis</p>
              <RunBadge recordedAt={summary.recordedAt} />
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Stat label="Moments found" value={summary.moments} />
              <Stat label="Clips planned" value={summary.clips} />
              <Stat label={`Of our top ${summary.topK.k}, the club also clipped`} value={`${summary.topK.hits}/${summary.topK.k}`} />
              <Stat label="Uploaded to ScorePlay" value={summary.renderedIds.length} />
            </dl>
            <p className="mt-3 text-caption text-secondary">
              Same-length picks placed at random: about {summary.topK.random} of {summary.topK.k}.
            </p>
            <Link href={href} className="press mt-5 inline-flex h-10 items-center rounded-full bg-button px-5 text-footnote font-semibold text-white hover:bg-button-hover">
              Open the project
            </Link>
          </div>
        ) : (
          <p className="mt-6 text-footnote text-secondary">Not analysed yet.</p>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dt className="text-caption text-secondary">{label}</dt>
      <dd className="num mt-0.5 text-[28px] font-semibold leading-none">{value}</dd>
    </div>
  );
}

function aspectLabel(w?: number, h?: number) {
  if (!w || !h) return undefined;
  const r = w / h;
  const known: [number, string][] = [
    [9 / 16, "9:16"],
    [4 / 5, "4:5"],
    [1, "1:1"],
    [16 / 9, "16:9"],
  ];
  const hit = known.find(([k]) => Math.abs(r - k) < 0.02);
  return hit ? hit[1] : `${w}×${h}`;
}

function ClubTile({ item, located, href }: { item: LibraryItem; located?: ClubRange[]; href?: string }) {
  const portrait = (item.height ?? 0) > (item.width ?? 0);
  const name = clubClipName(item.name);
  return (
    <li>
      <div className="clip-stage">
        <HoverPreview
          label={name}
          thumbnailUrl={item.thumbnailUrl}
          previewUrl={item.previewUrl}
          className={`rounded-[8px] ${portrait ? "h-full aspect-[9/16]" : "w-full aspect-video"}`}
        />
      </div>
      <p className="mt-2 line-clamp-2 text-footnote font-semibold" title={item.name}>
        {name}
      </p>
      <p className="num mt-0.5 text-caption text-secondary">
        {clipLength(item.durationSec)}
        {aspectLabel(item.width, item.height) ? ` · ${aspectLabel(item.width, item.height)}` : ""}
      </p>
      {located && <LocatedNote ranges={located} />}
      {href && (
        <a href={href} target="_blank" rel="noreferrer" className="mt-1 inline-block rounded-md text-caption font-semibold text-tint hover:underline">
          Open in ScorePlay <span aria-hidden>↗</span>
        </a>
      )}
    </li>
  );
}

function LocatedNote({ ranges }: { ranges: ClubRange[] }) {
  const found = ranges.filter((r) => r.matchedMomentId).length;
  const all = found === ranges.length;
  return (
    <p className={`mt-1 text-caption font-semibold ${all ? "text-go" : "text-label"}`}>
      {ranges.length === 1
        ? `At ${timecode(ranges[0].start)} · ${all ? "we found it" : "we missed it"}`
        : `${ranges.length} cuts located · ${found} found`}
    </p>
  );
}
