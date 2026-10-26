"use client";

import { useEffect, useRef, useState } from "react";
import { CheckIcon, PauseIcon, PlayIcon } from "@/components/landing/icons";
import type { MissingReason, RenderedClip } from "@/lib/studio/library";
import { scoreplayEventUrl, scoreplayMediaUrl } from "@/lib/studio/links";
import { clipLength } from "@/lib/studio/time";
import type { PublishedClip } from "@/lib/studio/clips";
import type { Moment } from "@/lib/studio/types";
import { SectionTitle } from "./bits";
import { ClipFrame } from "./clip-frame";
import { ScorePlayNote, useExtras } from "./extras";
import { ReviewControl } from "./review-control";

type Props = {
  clips: PublishedClip[];
  momentsById: Map<string, Moment>;
  src: string;
  activeId: string | null;
  onActive: (id: string) => void;
  onRelease: (id: string) => void;
};

// The best few short clips lead; the rest wait behind a toggle so the section stays one screen in the demo.
const SHOWN = 3;

/** The key a published pair uses in the page's one-video-at-a-time state. */
export const pairKey = (clipId: string) => `published:${clipId}`;

const UPLOADED = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZone: "America/Chicago",
});

// The demo's payoff: clips the pipeline rendered and uploaded back into the match's ScorePlay event, each
// shown as the plan (cut live in the browser from the source) beside the file ScorePlay now holds.
export function Published({ clips, momentsById, src, activeId, onActive, onRelease }: Props) {
  const { rendered, missing } = useExtras();
  const uploads = missing.uploads;
  const eventId = clips.map((c) => rendered[c.scoreplayMediaId]?.eventId).find(Boolean);
  const [all, setAll] = useState(false);
  const portraitAll = clips.filter((c) => c.format !== "16:9");
  const portrait = all ? portraitAll : portraitAll.slice(0, SHOWN);
  const wide = clips.filter((c) => c.format === "16:9");

  return (
    <section aria-labelledby="published-title">
      <SectionTitle eyebrow="Back in ScorePlay" title={`${clips.length} clips rendered and uploaded to the club's library`} id="published-title">
        {eventId && (
          <a
            href={scoreplayEventUrl(eventId)}
            target="_blank"
            rel="noreferrer"
            className="press inline-flex h-8 items-center gap-1 rounded-full bg-fill px-3 text-caption font-semibold text-label hover:bg-separator"
          >
            Open the match folder in ScorePlay <span aria-hidden>↗</span>
          </a>
        )}
      </SectionTitle>
      <p className="mt-2 max-w-[64ch] text-footnote text-secondary">
        Each pair plays the plan on the left, cut live from the source in this page, and on the right the file the pipeline
        rendered and uploaded, streamed back from ScorePlay. The club&rsquo;s team finds them next to the match.
      </p>
      <ScorePlayNote part="uploads" className="mt-3" />
      <div className="mt-6 grid grid-cols-1 gap-x-4 gap-y-8 md:grid-cols-2 xl:grid-cols-3">
        {portrait.map((clip) => (
          <Pair
            key={clip.id}
            clip={clip}
            file={rendered[clip.scoreplayMediaId]}
            missing={uploads}
            momentsById={momentsById}
            src={src}
            playing={activeId === pairKey(clip.id)}
            onActive={onActive}
            onRelease={onRelease}
          />
        ))}
      </div>
      {portraitAll.length > SHOWN && (
        <button type="button" onClick={() => setAll((a) => !a)} className="press mt-6 rounded-md text-footnote font-semibold text-tint hover:underline">
          {all ? "Show the top three" : `Show all ${portraitAll.length} short clips`}
        </button>
      )}
      {wide.length > 0 && (
        <div className="mt-8 grid grid-cols-1 gap-8">
          {wide.map((clip) => (
            <Pair
              key={clip.id}
              clip={clip}
              file={rendered[clip.scoreplayMediaId]}
              missing={uploads}
              momentsById={momentsById}
              src={src}
              playing={activeId === pairKey(clip.id)}
              onActive={onActive}
              onRelease={onRelease}
            />
          ))}
        </div>
      )}
    </section>
  );
}

type PairProps = {
  clip: PublishedClip;
  /** Why ScorePlay did not return the uploads, if it did not. */
  missing?: MissingReason;
  file?: RenderedClip;
  momentsById: Map<string, Moment>;
  src: string;
  playing: boolean;
  onActive: (id: string) => void;
  onRelease: (id: string) => void;
};

function Pair({ clip, file, missing, momentsById, src, playing, onActive, onRelease }: PairProps) {
  const video = useRef<HTMLVideoElement>(null);
  const [sound, setSound] = useState(false);
  const key = pairKey(clip.id);
  const wide = clip.format === "16:9";
  const aspect = wide ? "aspect-video" : clip.format === "1:1" ? "aspect-square" : "aspect-[9/16]";

  // The file starts with the plan, so the two run side by side from their first frame.
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (playing) {
      v.currentTime = 0;
      v.play().catch((err: DOMException) => {
        if (err.name !== "AbortError") console.error(`ScorePlay file ${file?.id} did not play:`, err);
      });
    } else {
      v.pause();
    }
  }, [playing, file?.id]);

  const firstSegment = clip.segments[0];

  return (
    <article aria-labelledby={`${key}-title`} id={`published-${clip.id}`} className="scroll-mt-24">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={`${key}-title`} className="min-w-0 truncate text-subhead font-semibold">
          {clip.title}
        </h3>
        <span className="num shrink-0 text-caption text-secondary">
          {clip.format} · {clipLength(clip.durationSec)}
        </span>
      </div>
      <ReviewControl clip={clip} className="mt-2" />
      <div className={`mt-2 grid grid-cols-2 gap-2 rounded-[14px] bg-[var(--monitor)] p-2 ${wide ? "" : "max-w-[440px]"}`}>
        <figure className="min-w-0">
          <div className={`relative overflow-hidden rounded-[8px] ${aspect}`}>
            <ClipFrame
              format={clip.format}
              segments={clip.segments}
              momentsById={momentsById}
              src={src}
              label={`Plan: ${clip.title}`}
              playing={playing}
              restart
              loop
              warm="visible"
              posterAt={firstSegment.start + Math.min(2, (firstSegment.end - firstSegment.start) / 2)}
              className="absolute inset-0 size-full"
            />
          </div>
          <figcaption className="mt-1.5 px-1 text-caption text-secondary">Plan, cut live</figcaption>
        </figure>
        <figure className="min-w-0">
          <div className={`relative overflow-hidden rounded-[8px] bg-card ${aspect}`}>
            {file ? (
              <video
                ref={video}
                src={file.url}
                poster={file.thumbnailUrl}
                muted={!sound}
                loop
                playsInline
                preload="metadata"
                aria-label={`ScorePlay file: ${file.name}`}
                className="absolute inset-0 size-full object-cover"
              />
            ) : (
              <p className="absolute inset-0 grid place-items-center p-3 text-center text-caption text-secondary">
                {missing === "off" ? "ScorePlay is not connected" : missing === "slow" ? "ScorePlay is slow" : missing ? "ScorePlay did not answer" : `ScorePlay media ${clip.scoreplayMediaId} did not load`}
              </p>
            )}
            <span className="chip chip-film pointer-events-none absolute bottom-2 left-2 gap-1">
              <CheckIcon className="size-3" />
              In ScorePlay
            </span>
          </div>
          <figcaption className="num mt-1.5 truncate px-1 text-caption text-secondary" title={file?.uploadedAt ? `Uploaded ${file.uploadedAt}` : undefined}>
            Media {clip.scoreplayMediaId}
            {file?.uploadedAt ? ` · ${UPLOADED.format(new Date(file.uploadedAt))}` : ""}
          </figcaption>
        </figure>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={playing}
          onClick={() => (playing ? onRelease(key) : onActive(key))}
          className="press inline-flex h-8 items-center gap-1.5 rounded-full bg-button px-3.5 text-caption font-semibold text-white hover:bg-button-hover"
        >
          {playing ? <PauseIcon className="size-3" /> : <PlayIcon className="size-3" />}
          {playing ? "Pause" : "Play both"}
        </button>
        {file && (
          <button
            type="button"
            aria-pressed={sound}
            onClick={() => setSound((s) => !s)}
            className="press inline-flex h-8 items-center rounded-full bg-fill px-3 text-caption font-semibold text-label hover:bg-separator"
          >
            {sound ? "File sound on" : "File sound off"}
          </button>
        )}
        <a
          href={scoreplayMediaUrl(clip.scoreplayMediaId)}
          target="_blank"
          rel="noreferrer"
          className="press ml-auto inline-flex h-8 items-center gap-1 rounded-full px-2 text-caption font-semibold text-tint hover:underline"
        >
          Open in ScorePlay <span aria-hidden>↗</span>
        </a>
      </div>
    </article>
  );
}
