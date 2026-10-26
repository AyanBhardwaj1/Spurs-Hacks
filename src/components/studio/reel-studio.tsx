"use client";

import { Suspense, useEffect, useRef } from "react";
import { PauseIcon, PlayIcon } from "@/components/landing/icons";
import { reelStudioId } from "@/lib/studio/clips";
import type { MissingReason, RenderedClip } from "@/lib/studio/library";
import { scoreplayMediaUrl } from "@/lib/studio/links";
import { clipLength } from "@/lib/studio/time";
import type { Clip } from "@/lib/studio/types";
import { ScorePlayNote, useExtras } from "./extras";

type Props = {
  clips: Clip[];
  activeId: string | null;
  onActive: (id: string) => void;
  onRelease: (id: string) => void;
};

/** The key a Reel Studio comparison uses in the page's one-video-at-a-time state. */
export const reelKey = (clipId: string) => `reel:${clipId}`;

/** Clips with a Reel Studio edit uploaded to ScorePlay, with that edit's media ID, in the order given. */
export const withReelEdit = (clips: Clip[]) =>
  clips.flatMap((clip) => {
    const reelId = reelStudioId(clip);
    return reelId === undefined ? [] : [{ clip, reelId }];
  });

// The headline clips as Reel Studio finished them, beside the plain render of the same plan, both streamed
// back from ScorePlay. Renders nothing until the run has Reel Studio edits.
export function ReelStudioEdits({ clips, activeId, onActive, onRelease }: Props) {
  const edited = withReelEdit(clips);
  if (edited.length === 0) return null;
  return (
    <section aria-labelledby="reel-title" data-reel-studio className="mt-6 rounded-[18px] bg-grouped p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h3 id="reel-title" className="text-title3 font-semibold">
          Edited in Reel Studio
        </h3>
        <p className="text-caption text-secondary">The same plan, as a plain cut and as Reel Studio finished it. Both files are in ScorePlay.</p>
      </div>
      <ScorePlayNote part="uploads" className="mt-2" />
      <div className="mt-4 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
        {edited.map(({ clip, reelId }) => (
          <Suspense key={clip.id} fallback={<div className="aspect-[9/8] rounded-[14px] bg-card" />}>
            <Comparison clip={clip} reelId={reelId} playing={activeId === reelKey(clip.id)} onActive={onActive} onRelease={onRelease} />
          </Suspense>
        ))}
      </div>
    </section>
  );
}

type ComparisonProps = { clip: Clip; reelId: number; playing: boolean; onActive: (id: string) => void; onRelease: (id: string) => void };

function Comparison({ clip, reelId, playing, onActive, onRelease }: ComparisonProps) {
  const { rendered, missing } = useExtras();
  const plain = clip.scoreplayMediaId ? rendered[clip.scoreplayMediaId] : undefined;
  const reel = rendered[reelId];
  const key = reelKey(clip.id);
  const aspect = clip.format === "16:9" ? "aspect-video" : clip.format === "1:1" ? "aspect-square" : "aspect-[9/16]";

  return (
    <article aria-labelledby={`${key}-title`}>
      <div className="flex items-baseline justify-between gap-3">
        <h4 id={`${key}-title`} className="min-w-0 truncate text-subhead font-semibold">
          {clip.title}
        </h4>
        <span className="num shrink-0 text-caption text-secondary">
          {clip.format} · {clipLength(clip.durationSec)}
        </span>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 rounded-[14px] bg-[var(--monitor)] p-2">
        <FileFrame file={plain} id={clip.scoreplayMediaId} label="Plain cut" aspect={aspect} playing={playing} missing={missing.uploads} />
        <FileFrame file={reel} id={reelId} label="Reel Studio edit" aspect={aspect} playing={playing} missing={missing.uploads} />
      </div>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          aria-pressed={playing}
          onClick={() => (playing ? onRelease(key) : onActive(key))}
          className="press inline-flex h-8 items-center gap-1.5 rounded-full bg-button px-3.5 text-caption font-semibold text-white hover:bg-button-hover"
        >
          {playing ? <PauseIcon className="size-3" /> : <PlayIcon className="size-3" />}
          {playing ? "Pause" : clip.scoreplayMediaId ? "Play both" : "Play edit"}
        </button>
        <a href={scoreplayMediaUrl(reelId)} target="_blank" rel="noreferrer" className="press ml-auto rounded-md text-caption font-semibold text-tint hover:underline">
          Open the Reel Studio edit in ScorePlay <span aria-hidden>↗</span>
        </a>
      </div>
    </article>
  );
}

function FileFrame({
  file,
  id,
  label,
  aspect,
  playing,
  missing,
}: {
  file?: RenderedClip;
  id?: number;
  label: string;
  aspect: string;
  playing: boolean;
  missing?: MissingReason;
}) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    if (playing) {
      v.currentTime = 0;
      v.play().catch((err: DOMException) => {
        if (err.name !== "AbortError") console.error(`ScorePlay file ${id} did not play:`, err);
      });
    } else {
      v.pause();
    }
  }, [playing, id]);

  return (
    <figure className="min-w-0">
      <div className={`relative overflow-hidden rounded-[8px] bg-card ${aspect}`}>
        {file ? (
          <video ref={video} src={file.url} poster={file.thumbnailUrl} muted loop playsInline preload="metadata" aria-label={`${label}: ${file.name}`} className="absolute inset-0 size-full object-cover" />
        ) : (
          <p className="absolute inset-0 grid place-items-center p-3 text-center text-caption text-secondary">
            {missing === "off" ? "ScorePlay is not connected" : missing === "slow" ? "ScorePlay is slow" : missing ? "ScorePlay did not answer" : id ? `ScorePlay media ${id} did not load` : "No plain render"}
          </p>
        )}
      </div>
      <figcaption className="mt-1.5 truncate px-1 text-caption text-secondary">
        <span className="font-semibold text-label">{label}</span>
        {id ? <span className="num"> · media {id}</span> : null}
      </figcaption>
    </figure>
  );
}
