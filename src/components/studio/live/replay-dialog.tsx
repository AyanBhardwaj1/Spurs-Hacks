"use client";

import { useEffect, useRef, useState } from "react";
import { crossedPeaks, scorebug, type LiveClipStreams } from "@/lib/studio/live";
import { timecode } from "@/lib/studio/time";
import { MomentCard } from "./moment-card";
import type { LiveClip, LiveMoment } from "./live-view";

type Props = {
  moment: LiveMoment;
  moments: LiveMoment[];
  previewUrl: string;
  clips: LiveClip[];
  streams: LiveClipStreams;
  streamsError?: string;
  onClose: () => void;
};

/** Seconds of build-up the replay starts before the peak, within the moment. */
const LEAD_SEC = 15;

// A live feed cannot seek, so this shows what the feed looked like at a moment by playing ScorePlay's
// full-match rendition from that second. It is labelled as a replay throughout.
export function ReplayDialog({ moment, moments, previewUrl, clips, streams, streamsError, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const last = useRef<number | undefined>(undefined);
  const from = Math.max(moment.start, moment.peak - LEAD_SEC);
  const [at, setAt] = useState(from);
  const [passed, setPassed] = useState<LiveMoment[]>([]);
  const [playingClipId, setPlayingClipId] = useState<string>();

  // Focus goes back to the button that opened the replay, which the page keeps mounted.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => opener?.focus();
  }, []);

  const onTime = () => {
    const t = videoRef.current?.currentTime;
    if (t === undefined) return;
    setAt(t);
    const prev = last.current;
    last.current = t;
    if (prev === undefined) return;
    const crossed = crossedPeaks(prev, t, moments);
    if (crossed.length) setPassed((p) => [...crossed.reverse(), ...p.filter((m) => !crossed.includes(m))]);
  };

  const bug = scorebug(at);
  const shown = passed[0];

  return (
    <dialog ref={dialogRef} onClose={onClose} className="live-dialog" aria-labelledby="replay-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-caption font-semibold uppercase tracking-[0.06em] text-secondary">
            <span className="chip bg-fill text-label">Replay</span>
            Full-match recording, not the live feed
          </p>
          <h2 id="replay-title" className="mt-1.5 text-title3 font-semibold text-balance">
            {moment.matchClock} · {moment.title}
          </h2>
        </div>
        <button
          type="button"
          onClick={() => dialogRef.current?.close()}
          autoFocus
          className="press hit inline-flex h-9 items-center gap-2 rounded-full bg-white px-4 text-footnote font-semibold text-black"
        >
          <span className="live-dot" aria-hidden />
          Back to live
        </button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          <div className="live-screen">
            <video
              ref={videoRef}
              src={`${previewUrl}#t=${from}`}
              autoPlay
              controls
              playsInline
              onTimeUpdate={onTime}
              onSeeking={() => (last.current = undefined)}
            />
            <span className="chip chip-film pointer-events-none absolute right-3 top-3">Replay · not live</span>
          </div>
          <p className="num mt-2 flex flex-wrap gap-x-4 text-caption text-secondary">
            <span className="text-label">{bug ?? "Not in play"}</span>
            <span>
              {timecode(at)} into the recording · peak at {timecode(moment.peak)}
            </span>
          </p>
        </div>
        <div aria-live="polite">
          {shown ? (
            <MomentCard
              moment={shown}
              when="In the replay"
              expanded
              fresh
              clips={clips.filter((c) => c.momentIds.includes(shown.id))}
              streams={streams}
              streamsError={streamsError}
              playingClipId={playingClipId}
              onPlayClip={setPlayingClipId}
            />
          ) : (
            <div className="rounded-[14px] border border-dashed border-separator p-4 text-footnote text-secondary">
              The moment card appears here when the replay reaches the peak Rundown&rsquo;s analysis marked at {timecode(moment.peak)}, as it does on the
              live feed.
            </div>
          )}
        </div>
      </div>
    </dialog>
  );
}
