"use client";

import type Hls from "hls.js";
import { useEffect, useRef, useState } from "react";
import { PauseIcon, PlayIcon } from "@/components/landing/icons";
import { LIVE_PLAYLIST_URL, segmentNumber } from "@/lib/studio/live";

/** Where playback is: the fragment hls.js is playing, or, in Safari's native player, the program date. */
export type PlayerPosition = { kind: "fragment"; seq: number; n: number; offsetSec: number; dateMs?: number } | { kind: "date"; dateMs: number };

// Safari's native HLS player exposes the playlist's program date for currentTime 0; other browsers do not.
type NativeHlsVideo = HTMLVideoElement & { getStartDate?: () => Date };

export type PlayerStatus = "connecting" | "playing" | "buffering" | "blocked" | "error";

type Props = {
  muted: boolean;
  onMutedChange: (muted: boolean) => void;
  onPosition: (p: PlayerPosition) => void;
};

// Plays ScorePlay's live HLS feed straight from its URL: the playlist and the segments both allow any
// origin, so nothing is proxied or stored. Chrome and Firefox play it through hls.js, Safari natively.
export function LivePlayer({ muted, onMutedChange, onPosition }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const report = useRef(onPosition);
  const [status, setStatus] = useState<PlayerStatus>("connecting");
  const [error, setError] = useState<string>();
  const [attempt, setAttempt] = useState(0);
  const [airTime, setAirTime] = useState<number>();
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    report.current = onPosition;
  }, [onPosition]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.muted !== muted) video.muted = muted;
  }, [muted]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    let hls: Hls | undefined;
    let cancelled = false;
    let frag: { seq: number; n: number; start: number } | undefined;

    const tell = () => {
      if (frag) {
        const dateMs = hls?.playingDate?.getTime();
        report.current({ kind: "fragment", seq: frag.seq, n: frag.n, offsetSec: video.currentTime - frag.start, dateMs });
        if (dateMs) setAirTime(dateMs);
      } else if (!hls) {
        const start = (video as NativeHlsVideo).getStartDate?.().getTime();
        if (start && Number.isFinite(start)) {
          report.current({ kind: "date", dateMs: start + video.currentTime * 1000 });
          setAirTime(start + video.currentTime * 1000);
        }
      }
    };
    const onPlaying = () => setStatus("playing");
    const onPlay = () => setPaused(false);
    const onPause = () => setPaused(true);
    const onWaiting = () => setStatus((s) => (s === "playing" ? "buffering" : s));
    video.addEventListener("timeupdate", tell);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);

    const start = () =>
      video.play().catch((err: Error) => {
        // Autoplay is blocked until the visitor interacts; muted autoplay is normally allowed.
        if (!cancelled && err.name === "NotAllowedError") setStatus("blocked");
      });

    void (async () => {
      const { default: HlsJs } = await import("hls.js");
      if (cancelled) return;
      if (HlsJs.isSupported()) {
        hls = new HlsJs({ liveSyncDurationCount: 3 });
        hls.on(HlsJs.Events.FRAG_CHANGED, (_e, { frag: f }) => {
          if (typeof f.sn !== "number") return;
          frag = { seq: f.sn, n: segmentNumber(f.url), start: f.start };
          tell();
        });
        hls.on(HlsJs.Events.ERROR, (_e, data) => {
          if (!data.fatal || !hls) return;
          if (data.type === HlsJs.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else if (data.type === HlsJs.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          else {
            setError(`The feed stopped: ${data.details}`);
            setStatus("error");
            hls.destroy();
          }
        });
        hls.loadSource(LIVE_PLAYLIST_URL);
        hls.attachMedia(video);
        start();
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = LIVE_PLAYLIST_URL;
        start();
      } else {
        setError("This browser cannot play HLS video.");
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      video.removeEventListener("timeupdate", tell);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [attempt]);

  const retry = () => {
    setError(undefined);
    setStatus("connecting");
    setAttempt((a) => a + 1);
  };

  return (
    <div className="live-screen" data-status={status}>
      <video ref={videoRef} muted playsInline aria-label="ScorePlay live feed of Manchester United v Spurs" />

      {/* Top right, clear of the broadcast's own scorebug in the top left. */}
      <div className="pointer-events-none absolute inset-x-3 top-3 flex items-center justify-end gap-2">
        <span className="chip chip-film live-tally" data-on={(status === "playing" && !paused) || undefined}>
          <i aria-hidden />
          {paused && status !== "error" ? "Paused" : status === "playing" ? "Live" : status === "buffering" ? "Buffering" : status === "error" ? "Off air" : "Connecting"}
        </span>
        <span className="chip chip-film num">
          ScorePlay live feed{airTime ? ` · ${new Date(airTime).toISOString().slice(11, 19)} UTC` : ""}
        </span>
      </div>

      {status === "blocked" && (
        <button type="button" onClick={() => videoRef.current?.play()} className="live-cover press">
          <span className="rounded-full bg-white px-4 py-2 text-footnote font-semibold text-black">Play the live feed</span>
        </button>
      )}
      {status === "error" && (
        <div className="live-cover" role="alert">
          <div className="max-w-[40ch] text-center">
            <p className="text-subhead font-semibold text-white">{error}</p>
            <button type="button" onClick={retry} className="press mt-3 inline-flex h-8 items-center rounded-full bg-white px-4 text-caption font-semibold text-black">
              Reconnect
            </button>
          </div>
        </div>
      )}

      <div className="absolute bottom-3 right-3 flex gap-2">
        <button
          type="button"
          onClick={() => {
            const video = videoRef.current;
            if (!video) return;
            if (video.paused) void video.play();
            else video.pause();
          }}
          aria-label={paused ? "Play the live feed" : "Pause the live feed"}
          className="press hit chip chip-film h-8 gap-1.5 px-3 text-caption"
        >
          {paused ? <PlayIcon className="size-3" /> : <PauseIcon className="size-3" />}
          {paused ? "Play" : "Pause"}
        </button>
        <button
          type="button"
          onClick={() => onMutedChange(!muted)}
          aria-pressed={!muted}
          className="press hit chip chip-film h-8 gap-1.5 px-3 text-caption"
        >
          <SpeakerIcon muted={muted} />
          {muted ? "Unmute" : "Mute"}
        </button>
      </div>
    </div>
  );
}

function SpeakerIcon({ muted }: { muted: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 6h2.5l3.5-3v10l-3.5-3h-2.5z" fill="currentColor" />
      {muted ? <path d="M11 6l3 4M14 6l-3 4" /> : <path d="M11 5.5a3.5 3.5 0 010 5M12.8 3.8a6 6 0 010 8.4" />}
    </svg>
  );
}
