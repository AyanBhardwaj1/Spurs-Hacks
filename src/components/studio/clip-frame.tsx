"use client";

import { Suspense, useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { FORMAT_RATIO, cropShift, focusAt } from "@/lib/studio/reframe";
import type { ClipFormat, ClipSegment, Moment } from "@/lib/studio/types";
import { SpritePoster } from "./extras";

// Plays a planned edit straight from the source rendition: no rendered file exists, so the frame seeks to
// each segment's start, watches the playhead every animation frame, and jumps to the next segment at each
// end. A 9:16 or 1:1 edit is a window over the 16:9 reel, slid to the linked moment's focus point.

export type ClipFrameHandle = {
  /** Jump to the start of segment `index`, keeping the play state. */
  seekSegment: (index: number) => void;
};

type Props = {
  format: ClipFormat;
  segments: ClipSegment[];
  momentsById: Map<string, Moment>;
  src: string;
  label: string;
  playing: boolean;
  /**
   * Mount the video before it plays and show the real frame at `posterAt`, so the first press starts at once
   * and the poster is sharp. "visible" waits until the frame is near the screen, to keep a long grid from
   * opening a connection per card at load.
   */
  warm?: boolean | "visible";
  /** Start from the first segment every time play begins, as a hover preview does. */
  restart?: boolean;
  loop?: boolean;
  muted?: boolean;
  /** Source second the poster shows. */
  posterAt: number;
  /** Called every frame while playing, with seconds into the edit and the segment index. */
  onProgress?: (elapsed: number, index: number) => void;
  onEnded?: () => void;
  ref?: Ref<ClipFrameHandle>;
  className?: string;
};

const END_SLACK = 0.05;
// A cut to a range that starts within this much of where the last one ended plays straight through.
const CONTIGUOUS = 0.25;

export function ClipFrame({
  format,
  segments,
  momentsById,
  src,
  label,
  playing,
  warm = false,
  restart = false,
  loop = false,
  muted = true,
  posterAt,
  onProgress,
  onEnded,
  ref,
  className = "",
}: Props) {
  const frameRef = useRef<HTMLDivElement>(null);
  const reelRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const index = useRef(0);
  const shift = useRef(0);
  const raf = useRef(0);
  const nextFrame = useRef<() => void>(() => {});
  const playingRef = useRef(playing);
  const callbacks = useRef({ onProgress, onEnded });
  useEffect(() => {
    callbacks.current = { onProgress, onEnded };
  });

  // The video mounts the first time the frame plays or warms, and stays, so a second hover starts at once.
  const [nearView, setNearView] = useState(false);
  const wantVideo = playing || warm === true || nearView;
  const [mounted, setMounted] = useState(wantVideo);
  // The video mounts after hydration, so its own error event is enough to know the footage is gone.
  const [failed, setFailed] = useState(false);
  if (wantVideo && !mounted) setMounted(true);

  useEffect(() => {
    if (warm !== "visible" || !frameRef.current) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setNearView(true);
        io.disconnect();
      },
      { rootMargin: "300px 0px" },
    );
    io.observe(frameRef.current);
    return () => io.disconnect();
  }, [warm]);

  const ratio = FORMAT_RATIO[format];
  const offsets = useRef<number[]>([]);
  useEffect(() => {
    let sum = 0;
    offsets.current = segments.map((s) => {
      const at = sum;
      sum += s.end - s.start;
      return at;
    });
  }, [segments]);

  const focusFor = useCallback(
    (i: number) => {
      const id = segments[i]?.momentId;
      return id ? (momentsById.get(id)?.focus ?? []) : [];
    },
    [segments, momentsById],
  );

  const restShift = cropShift(focusAt(focusFor(0), posterAt), ratio);

  const placeReel = useCallback((value: number) => {
    shift.current = value;
    if (reelRef.current) reelRef.current.style.transform = `translateX(${value * 100}%)`;
  }, []);

  // Follows the focus point smoothly inside a segment and cuts with the edit between segments.
  const track = useCallback(
    (t: number, cut: boolean) => {
      const target = cropShift(focusAt(focusFor(index.current), t), ratio);
      placeReel(cut ? target : shift.current + (target - shift.current) * 0.12);
    },
    [focusFor, placeReel, ratio],
  );

  const report = useCallback(() => {
    const v = videoRef.current;
    const seg = segments[index.current];
    if (!v || !seg) return;
    const into = Math.min(seg.end - seg.start, Math.max(0, v.currentTime - seg.start));
    callbacks.current.onProgress?.((offsets.current[index.current] ?? 0) + into, index.current);
  }, [segments]);

  const goTo = useCallback(
    (i: number) => {
      index.current = i;
      const v = videoRef.current;
      if (!v) return;
      v.currentTime = segments[i].start;
      track(segments[i].start, true);
    },
    [segments, track],
  );

  const tick = useCallback(() => {
    const v = videoRef.current;
    const seg = segments[index.current];
    if (!v || !seg) return;
    if (!v.seeking) {
      const t = v.currentTime;
      if (t >= seg.end - END_SLACK) {
        const next = index.current + 1;
        if (next < segments.length) {
          if (Math.abs(segments[next].start - seg.end) > CONTIGUOUS) goTo(next);
          else index.current = next;
        } else if (loop) {
          goTo(0);
        } else {
          v.pause();
          callbacks.current.onEnded?.();
          return;
        }
      } else if (t < seg.start - 0.5 || t > seg.end + 0.5) {
        // Something else moved the playhead, such as a slow first seek landing late.
        goTo(index.current);
      } else {
        track(t, false);
      }
    }
    report();
    raf.current = requestAnimationFrame(() => nextFrame.current());
  }, [goTo, loop, report, segments, track]);
  useEffect(() => {
    nextFrame.current = tick;
  }, [tick]);

  const start = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    // play() starts loading a cold video; waiting for metadata first can leave it paused indefinitely.
    const seg = segments[index.current];
    if (restart || !seg || v.currentTime < seg.start - 0.5 || v.currentTime > seg.end) goTo(restart ? 0 : index.current);
    v.play().catch((err: DOMException) => {
      // pause() during a pending play() rejects with AbortError; that is the hover ending, not a fault.
      if (err.name !== "AbortError") console.error(`Preview of "${label}" did not play:`, err);
    });
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => nextFrame.current());
  }, [goTo, label, restart, segments]);

  // Shows the real frame at the poster time while paused; onSeeked reveals the video once it lands there.
  const cue = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = posterAt;
    placeReel(restShift);
  }, [placeReel, posterAt, restShift]);

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    const v = videoRef.current;
    v?.pause();
    if (!restart) return;
    if (v && v.readyState >= HTMLMediaElement.HAVE_METADATA) {
      cue();
    } else {
      frameRef.current?.removeAttribute("data-live");
      placeReel(restShift);
    }
  }, [cue, placeReel, restShift, restart]);

  useEffect(() => {
    playingRef.current = playing;
    if (playing) start();
    else stop();
  }, [playing, mounted, start, stop]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  useImperativeHandle(
    ref,
    () => ({
      seekSegment(i: number) {
        if (!segments[i]) return;
        goTo(i);
        report();
      },
    }),
    [goTo, report, segments],
  );

  return (
    <div ref={frameRef} data-format={format} className={`clip-frame ${className}`}>
      <div ref={reelRef} className="clip-reel" style={{ transform: `translateX(${restShift * 100}%)` }}>
        <Suspense fallback={null}>
          <SpritePoster at={posterAt} />
        </Suspense>
        {mounted && (
          <video
            ref={videoRef}
            src={src}
            muted={muted}
            playsInline
            preload={playing ? "auto" : "metadata"}
            aria-label={label}
            onError={() => setFailed(true)}
            onLoadedMetadata={() => {
              if (playingRef.current) start();
              else cue();
            }}
            onPlaying={() => {
              frameRef.current?.setAttribute("data-live", "");
              frameRef.current?.removeAttribute("data-waiting");
            }}
            onWaiting={() => frameRef.current?.setAttribute("data-waiting", "")}
            onSeeked={() => {
              frameRef.current?.removeAttribute("data-waiting");
              // A paused seek is a cue to the poster frame; show the decoded frame over the sprite.
              if (!playingRef.current) frameRef.current?.setAttribute("data-live", "");
              else report();
            }}
          />
        )}
      </div>
      <div className="clip-wait" aria-hidden />
      {failed && (
        <p className="absolute inset-0 grid place-items-center p-3 text-center text-caption text-secondary text-pretty">
          No footage: the club&rsquo;s video is no longer on ScorePlay.
        </p>
      )}
    </div>
  );
}
