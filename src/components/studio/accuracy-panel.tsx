"use client";

import { Suspense } from "react";
import { CheckIcon } from "@/components/landing/icons";
import { clubClipName, clubVideos, coveredMinutes, type ClubVideo } from "@/lib/studio/clips";
import { clubCheck, type ClubCheck } from "@/lib/studio/evaluation";
import { clipLength, timecode } from "@/lib/studio/time";
import type { GroundTruthClip, MatchAnalysis, Moment } from "@/lib/studio/types";
import { SectionTitle, pct } from "./bits";
import { ScorePlayNote, useExtras } from "./extras";
import { HoverPreview } from "./hover-preview";

type Props = {
  evaluation: MatchAnalysis["eval"];
  groundTruth: GroundTruthClip[];
  moments: Moment[];
  momentsById: Map<string, Moment>;
  durationSec: number;
  onSelectMoment: (id: string) => void;
  onSeek: (t: number, play: boolean) => void;
};

export function AccuracyPanel({ evaluation, groundTruth, moments, momentsById, durationSec, onSelectMoment, onSeek }: Props) {
  const videos = clubVideos(groundTruth);
  const missed = groundTruth.filter((g) => !g.matchedMomentId).sort((a, b) => a.start - b.start);
  const check = clubCheck(evaluation);

  return (
    <section aria-labelledby="accuracy-title">
      <SectionTitle eyebrow="Checked against the club" title="Did we find what Tottenham's editors found?" id="accuracy-title" />
      <ScorePlayNote part="club" className="mt-2" />
      <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(380px,440px)_1fr]">
        <div className="rounded-[18px] bg-grouped p-6">
          <RankingHeadline check={check} alignedBy={alignedMethods(groundTruth)} />
          <p className="mt-4 border-t border-separator/60 pt-4 text-footnote text-secondary text-pretty">
            Overall, {check.matched} of {check.total} cuts from the club&rsquo;s {videos.length}{" "}
            {videos.length === 1 ? "video" : "videos"} overlap one of our {moments.length} moments (
            <span className="num">{pct(check.recall)}%</span>). That number flatters: those moments span{" "}
            <span className="num">{Math.round(coveredMinutes(moments))}</span> of the match&rsquo;s{" "}
            <span className="num">{Math.round(durationSec / 60)}</span> minutes.
          </p>
          {missed.length > 0 && (
            <div className="mt-5 border-t border-separator/60 pt-4">
              <p className="text-footnote font-semibold">Missed</p>
              <ul className="mt-2 space-y-1">
                {missed.map((g) => (
                  <li key={`${g.scoreplayId}-${g.start}`}>
                    <button
                      type="button"
                      onClick={() => onSeek(g.start, true)}
                      className="press grid w-full grid-cols-[auto_1fr] gap-x-3 rounded-lg px-2 py-1.5 text-left hover:bg-fill"
                    >
                      <span className="num text-caption text-tint">{timecode(g.start)}</span>
                      <span className="min-w-0 truncate text-caption text-secondary">
                        {clipLength(g.end - g.start)} from {clubClipName(g.name)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <ol className="divide-y divide-separator/60 rounded-[18px] bg-grouped px-2">
          {videos.map((v) => (
            <ClubVideoRow key={v.scoreplayId} video={v} durationSec={durationSec} momentsById={momentsById} onSelectMoment={onSelectMoment} onSeek={onSeek} />
          ))}
        </ol>
      </div>
    </section>
  );
}

function ClubVideoRow({
  video,
  durationSec,
  momentsById,
  onSelectMoment,
  onSeek,
}: {
  video: ClubVideo;
  durationSec: number;
  momentsById: Map<string, Moment>;
  onSelectMoment: (id: string) => void;
  onSeek: (t: number, play: boolean) => void;
}) {
  const found = video.ranges.filter((r) => r.matchedMomentId).length;
  const total = video.ranges.length;
  return (
    <li className="grid grid-cols-[52px_1fr] gap-4 px-3 py-3.5">
      <Suspense fallback={<div className="aspect-[9/16] w-[52px] rounded-md bg-card" />}>
        <ClubThumb scoreplayId={video.scoreplayId} name={video.name} />
      </Suspense>
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4">
          <p className="min-w-0 truncate text-subhead font-semibold">{video.name}</p>
          <p className={`num shrink-0 text-footnote font-semibold ${found === total ? "text-go" : "text-label"}`}>
            {found === total && <CheckIcon className="mr-1 inline size-4 align-[-3px]" />}
            {found}/{total} found
          </p>
        </div>
        {/* Where each of the club's cuts sits in the full match. Each tick plays that cut on the monitor. */}
        <div className="relative mt-2.5 h-3 rounded-[3px] bg-fill/70" aria-hidden>
          {video.ranges.map((r) => (
            <span
              key={r.start}
              onClick={() => onSeek(r.start, true)}
              title={`${timecode(r.start)} · ${r.matchedMomentId ? "found" : "missed"}`}
              className={`absolute inset-y-0 min-w-[4px] cursor-pointer rounded-[2px] ${r.matchedMomentId ? "bg-go" : "shadow-[inset_0_0_0_1.5px_var(--secondary)]"}`}
              style={{ left: `${(r.start / durationSec) * 100}%`, width: `${((r.end - r.start) / durationSec) * 100}%` }}
            />
          ))}
        </div>
        <details className="group mt-2">
          <summary className="press inline-flex cursor-pointer list-none items-center gap-1 rounded-md text-caption font-semibold text-tint [&::-webkit-details-marker]:hidden">
            {total === 1 ? "Show the cut" : `Show the ${total} cuts`}
            <svg aria-hidden viewBox="0 0 16 16" className="size-3 transition-transform duration-200 group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 3l5 5-5 5" />
            </svg>
          </summary>
          <ol className="mt-2 space-y-0.5">
            {video.ranges.map((r) => {
              const m = r.matchedMomentId ? momentsById.get(r.matchedMomentId) : undefined;
              return (
                <li key={r.start} className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 rounded-lg px-1 py-1">
                  <button
                    type="button"
                    onClick={() => onSeek(r.start, true)}
                    className="press num rounded-md px-1 text-caption text-tint hover:underline"
                    aria-label={`Play ${timecode(r.start)} to ${timecode(r.end)} on the monitor`}
                  >
                    {timecode(r.start)}
                  </button>
                  <span className="min-w-0 truncate text-caption">
                    {m ? (
                      <span className="text-label">{m.title}</span>
                    ) : (
                      <span className="text-secondary">Missed: no moment overlaps</span>
                    )}
                    <span className="text-secondary">
                      {" "}
                      · {clipLength(r.end - r.start)}
                      {r.cutAt ? `, at ${r.cutAt} in the club's video` : ""} · {r.alignedBy} {pct(r.confidence)}%
                    </span>
                  </span>
                  {m ? (
                    <button type="button" onClick={() => onSelectMoment(m.id)} className="press rounded-md px-1 text-caption font-semibold text-tint hover:underline">
                      Open moment
                    </button>
                  ) : (
                    <span />
                  )}
                </li>
              );
            })}
          </ol>
        </details>
      </div>
    </li>
  );
}

// The headline is the ranking, not overall recall: of our top K moments, how many overlap the club's own
// edits, next to what same-length picks score when placed at random or sampled from the loudest crowd.
function RankingHeadline({ check, alignedBy }: { check: ClubCheck; alignedBy: string }) {
  const { head, cutoffs } = check;
  return (
    <>
      <p className="num text-[56px] font-semibold leading-none tracking-tight">
        {head.hits}
        <span className="text-secondary">/{head.k}</span>
      </p>
      <p className="mt-3 text-body font-semibold text-balance">
        {head.hits} of our top {head.k} moments overlap clips and highlights Tottenham&rsquo;s team made by hand
      </p>
      <p className="mt-1.5 text-footnote text-secondary">
        Same-length picks placed at random in the playing halves: about <span className="num text-label">{head.random}</span>.
        {" "}Sampled from the loudest crowd moments: about <span className="num text-label">{head.loudCrowd}</span>.
      </p>
      <p className="mt-1.5 text-footnote text-secondary">
        Against single-moment clips only:{" "}
        <span className="num text-label">
          {check.clipsOnly.hits} of {check.clipsOnly.k}
        </span>
        .
      </p>
      <div className="-mx-1 mt-5 overflow-x-auto px-1">
        <table className="w-full whitespace-nowrap text-left text-caption">
          <caption className="sr-only">The ranking at each cut-off, against random and loud-crowd picks</caption>
          <thead className="text-secondary">
            <tr>
              <th scope="col" className="pb-1.5 pr-2 font-normal">Top</th>
              <th scope="col" className="pb-1.5 font-normal">Overlap the club</th>
              <th scope="col" className="pb-1.5 pl-3 text-right font-normal">Random</th>
              <th scope="col" className="pb-1.5 pl-3 text-right font-normal">Loud crowd</th>
              <th scope="col" className="pb-1.5 pl-3 text-right font-normal">Stretches</th>
              <th scope="col" className="pb-1.5 pl-3 text-right font-normal">Footage</th>
            </tr>
          </thead>
          <tbody className="num">
            {cutoffs.map((c) => (
              <tr key={c.k} className="border-t border-separator/50">
                <th scope="row" className="py-1.5 font-semibold">
                  {c.k}
                </th>
                <td className="py-1.5">
                  <span className="flex items-center gap-2">
                    <span className="w-11 text-label">
                      {c.hits}/{c.k}
                    </span>
                    <span className="score-bar relative w-14" aria-hidden>
                      <i style={{ transform: `scaleX(${c.hits / c.k})` }} />
                      <span className="absolute inset-y-[-2px] w-px bg-secondary" style={{ left: `${(c.random / c.k) * 100}%` }} />
                    </span>
                  </span>
                </td>
                <td className="py-1.5 pl-3 text-right text-secondary">~{c.random}</td>
                <td className="py-1.5 pl-3 text-right text-secondary">~{c.loudCrowd}</td>
                <td className="py-1.5 pl-3 text-right">
                  {pct(c.recall)}% <span className="text-secondary">vs {pct(c.randomRecall)}%</span>
                </td>
                <td className="py-1.5 pl-3 text-right text-secondary">{c.minutes.toFixed(1)} min</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-caption text-secondary">
        Stretches: share of the {check.stretches} stretches of the match the club clipped that the top K cover. The tick on each
        bar is the random baseline.
      </p>
      <p className="mt-3 text-caption text-secondary">
        One development match. Club clips were located by their {alignedBy}
; a match must overlap by at least {check.overlapMinSec} s.
      </p>
    </>
  );
}

function ClubThumb({ scoreplayId, name }: { scoreplayId: number; name: string }) {
  const { clubThumbs, clubPreviews } = useExtras();
  return (
    <HoverPreview
      label={`the club's video ${name}`}
      thumbnailUrl={clubThumbs[scoreplayId]}
      previewUrl={clubPreviews[scoreplayId]}
      className="aspect-[9/16] w-[52px] rounded-md"
    />
  );
}

function alignedMethods(groundTruth: GroundTruthClip[]) {
  const methods = new Set(groundTruth.map((g) => g.alignedBy));
  if (methods.size === 2) return "subtitles or audio";
  return methods.has("audio") ? "audio" : "subtitles";
}
