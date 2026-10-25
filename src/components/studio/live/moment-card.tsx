"use client";

import { PlayIcon } from "@/components/landing/icons";
import type { LiveClipStreams } from "@/lib/studio/live";
import { scoreplayMediaUrl } from "@/lib/studio/links";
import { clipLength } from "@/lib/studio/time";
import { EVIDENCE_LABEL, KIND_LABEL, ScoreParts, pct } from "../bits";
import type { LiveClip, LiveMoment } from "./live-view";

type Props = {
  moment: LiveMoment;
  /** When it passed, such as "2 s ago on the feed". */
  when: string;
  expanded: boolean;
  /** Arrived while the page was open, so it gets the arrival highlight. */
  fresh: boolean;
  clips: LiveClip[];
  streams: LiveClipStreams;
  streamsError?: string;
  playingClipId?: string;
  onPlayClip: (id: string | undefined) => void;
  onExpand?: () => void;
};

// Evidence a producer can read in a line; the Twelve Labs description is a paragraph and stays in the studio.
const shownEvidence = (m: LiveMoment) =>
  m.evidence
    .filter((e) => e.source !== "twelvelabs-analysis")
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 3);

export function MomentCard({ moment, when, expanded, fresh, clips, streams, streamsError, playingClipId, onPlayClip, onExpand }: Props) {
  const playing = clips.find((c) => c.id === playingClipId);
  const stream = playing && streams[playing.scoreplayMediaId];

  return (
    <article className="live-card" data-fresh={fresh || undefined} data-kind={moment.kind} aria-labelledby={`live-${moment.id}`}>
      <div className="flex items-baseline gap-2.5">
        <span className="num text-[26px] font-semibold leading-none">{moment.matchClock ?? "–"}</span>
        <span className="text-caption font-semibold text-secondary">{KIND_LABEL[moment.kind]}</span>
        <span className="num ml-auto shrink-0 text-caption text-secondary">{when}</span>
      </div>
      <h3 id={`live-${moment.id}`} className="mt-1.5 text-subhead font-semibold text-balance">
        {onExpand && !expanded ? (
          <button type="button" onClick={onExpand} className="text-left hover:underline" aria-expanded={false}>
            {moment.title}
          </button>
        ) : (
          moment.title
        )}
      </h3>

      {expanded && (
        <>
          <p className="mt-1 line-clamp-2 text-footnote text-secondary text-pretty">{moment.summary}</p>
          <div className="mt-3 grid grid-cols-[1fr_auto] items-start gap-x-4">
            <ScoreParts parts={moment.scores} dense />
            <div className="text-right">
              <p className="num text-title2 font-semibold leading-none">{pct(moment.scores.total)}</p>
              <p className="mt-1 text-caption text-secondary">Rundown score</p>
            </div>
          </div>
          <ul className="mt-3 space-y-1.5">
            {shownEvidence(moment).map((e, i) => (
              <li key={i} className="grid grid-cols-[96px_1fr] gap-2 text-caption">
                <span className="font-semibold text-secondary">{EVIDENCE_LABEL[e.source]}</span>
                <span className="line-clamp-2 text-label/85" title={e.detail}>
                  {e.source === "commentary" ? `“${e.detail}”` : e.detail}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}

      {clips.length > 0 && (
        <div className="mt-3 rounded-xl bg-black/35 p-3">
          <p className="flex items-center gap-1.5 text-caption font-semibold text-go">
            <span aria-hidden className="live-ready" />
            ASAP {clips.length === 1 ? "clip" : `clips (${clips.length})`} ready in ScorePlay
          </p>
          <p className="mt-0.5 text-caption text-secondary">Rendered from the analysis and uploaded to the match folder.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {clips.map((c) => {
              const has = Boolean(streams[c.scoreplayMediaId]);
              const on = c.id === playingClipId;
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={!has}
                  aria-pressed={on}
                  onClick={() => onPlayClip(on ? undefined : c.id)}
                  title={has ? c.title : streamsError ?? "ScorePlay has not returned this clip's file"}
                  className="press hit inline-flex h-8 items-center gap-1.5 rounded-full bg-fill px-3 text-caption font-semibold text-label hover:bg-separator disabled:opacity-40 aria-pressed:bg-white aria-pressed:text-black"
                >
                  <PlayIcon className="size-3" />
                  {c.variant} · {c.format}
                </button>
              );
            })}
          </div>
          {playing && stream && (
            <figure className="mt-3">
              <div className="live-clip" data-format={playing.format}>
                <video key={playing.id} src={stream.url} poster={stream.thumbnailUrl} controls autoPlay playsInline />
              </div>
              <figcaption className="mt-2 flex items-baseline justify-between gap-3 text-caption">
                <span className="min-w-0 truncate font-semibold">{playing.title}</span>
                <a href={scoreplayMediaUrl(playing.scoreplayMediaId)} target="_blank" rel="noreferrer" className="num shrink-0 text-tint hover:underline">
                  ScorePlay {playing.scoreplayMediaId} · {clipLength(playing.durationSec)} ↗
                </a>
              </figcaption>
            </figure>
          )}
        </div>
      )}
    </article>
  );
}
