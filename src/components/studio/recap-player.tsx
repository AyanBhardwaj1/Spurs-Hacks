"use client";

import { useEffect, useRef, useState } from "react";
import { PauseIcon, PlayIcon, ReplayIcon } from "@/components/landing/icons";
import { clipLength, timecode } from "@/lib/studio/time";
import type { Clip, Moment } from "@/lib/studio/types";
import { LANE_LABEL, SectionTitle, pct } from "./bits";
import { ClipFrame, type ClipFrameHandle } from "./clip-frame";
import { ReviewControl } from "./review-control";

type Props = {
  clip: Clip;
  momentsById: Map<string, Moment>;
  src: string;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
};

// The post-match recap as one continuous edit: its segments play back to back from the source.
export function RecapPlayer({ clip, momentsById, src, playing, onPlayingChange }: Props) {
  const frame = useRef<ClipFrameHandle>(null);
  const fill = useRef<HTMLSpanElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const [current, setCurrent] = useState(0);
  const [muted, setMuted] = useState(true);
  const [ended, setEnded] = useState(false);
  // Mounts the video once the recap is near the screen and cues it to the first cut, so Play starts at once.
  const root = useRef<HTMLElement>(null);
  const [warm, setWarm] = useState(false);
  useEffect(() => {
    if (!root.current) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setWarm(true), { rootMargin: "600px 0px" });
    io.observe(root.current);
    return () => io.disconnect();
  }, []);
  const total = clip.segments.reduce((s, seg) => s + (seg.end - seg.start), 0);

  const onProgress = (elapsed: number, index: number) => {
    if (fill.current) fill.current.style.transform = `scaleX(${Math.min(1, elapsed / total)})`;
    if (clock.current) clock.current.textContent = clipLength(elapsed);
    if (index !== current) setCurrent(index);
  };

  const jump = (i: number) => {
    setEnded(false);
    setCurrent(i);
    frame.current?.seekSegment(i);
    onPlayingChange(true);
  };

  const portrait = clip.format === "9:16";

  return (
    <section ref={root} aria-labelledby="recap-title" className="scroll-mt-28">
      <SectionTitle eyebrow={`${LANE_LABEL[clip.lane]} · ${clip.variant}`} title={clip.title} id="recap-title">
        <p className="text-footnote text-secondary">
          {clip.segments.length} cuts · <span className="num">{clipLength(clip.durationSec)}</span> · viral score{" "}
          <span className="num text-label">{pct(clip.viralScore)}</span>
        </p>
      </SectionTitle>

      <div className={`mt-6 grid grid-cols-1 gap-6 ${portrait ? "lg:grid-cols-[360px_1fr]" : "lg:grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)]"}`}>
        <div>
          <div className="relative overflow-hidden rounded-[14px] bg-[var(--monitor)]">
            <ClipFrame
              ref={frame}
              format={clip.format}
              segments={clip.segments}
              momentsById={momentsById}
              src={src}
              label={`Recap: ${clip.title}`}
              playing={playing}
              warm={warm}
              muted={muted}
              posterAt={clip.segments[0].start}
              onProgress={onProgress}
              onEnded={() => {
                setEnded(true);
                onPlayingChange(false);
              }}
              className={`mx-auto rounded-none ${portrait ? "aspect-[9/16] w-full" : clip.format === "1:1" ? "aspect-square w-full" : "aspect-video w-full"}`}
            />
          </div>

          <div className="mt-3 flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                if (ended) jump(0);
                else onPlayingChange(!playing);
              }}
              className="press inline-flex h-9 items-center gap-2 rounded-full bg-button px-4 text-footnote font-semibold text-white hover:bg-button-hover"
            >
              {ended ? <ReplayIcon className="size-3.5" /> : playing ? <PauseIcon /> : <PlayIcon />}
              {ended ? "Play again" : playing ? "Pause" : "Play recap"}
            </button>
            <button
              type="button"
              aria-pressed={!muted}
              onClick={() => setMuted((m) => !m)}
              className="press inline-flex h-9 items-center rounded-full bg-fill px-3.5 text-footnote font-semibold text-label hover:bg-separator"
            >
              {muted ? "Sound off" : "Sound on"}
            </button>
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-fill" aria-hidden>
                <span ref={fill} className="absolute inset-0 origin-left rounded-full bg-label" style={{ transform: "scaleX(0)" }} />
                {clip.segments.slice(1).map((_, i) => {
                  const at = clip.segments.slice(0, i + 1).reduce((s, seg) => s + (seg.end - seg.start), 0);
                  return <span key={i} className="absolute inset-y-0 w-0.5 bg-page" style={{ left: `${(at / total) * 100}%` }} />;
                })}
              </div>
              <span className="num shrink-0 text-caption text-secondary">
                <span ref={clock} className="text-label">
                  0:00
                </span>{" "}
                / {clipLength(total)}
              </span>
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <p className="text-footnote text-label/85 text-pretty">{clip.caption}</p>
          <p className="mt-1 text-caption text-secondary">{clip.rationale}</p>
          <ReviewControl clip={clip} className="mt-3" />
          <ol className="mt-4 space-y-0.5" aria-label="Cuts in the recap">
            {clip.segments.map((seg, i) => {
              const m = seg.momentId ? momentsById.get(seg.momentId) : undefined;
              const isNow = i === current && (playing || !ended);
              return (
                <li key={i}>
                  <button
                    type="button"
                    aria-current={isNow ? "step" : undefined}
                    onClick={() => jump(i)}
                    className="press grid w-full grid-cols-[28px_1fr_auto] items-baseline gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-fill aria-[current=step]:bg-card"
                  >
                    <span className="num text-caption text-secondary">{String(i + 1).padStart(2, "0")}</span>
                    <span className="min-w-0">
                      <span className="block truncate text-footnote font-semibold">{m?.title ?? "Untitled cut"}</span>
                      <span className="num block text-caption text-secondary">
                        {m?.matchClock ? `${m.matchClock} · ` : ""}
                        {timecode(seg.start)}
                      </span>
                    </span>
                    <span className="num text-caption text-secondary">{clipLength(seg.end - seg.start)}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      </div>
    </section>
  );
}
