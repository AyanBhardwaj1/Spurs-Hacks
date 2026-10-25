"use client";

import { Suspense, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { clubClipName } from "@/lib/studio/clips";
import { timecode } from "@/lib/studio/time";
import type { SearchHit, SearchResult } from "@/lib/studio/search";
import type { GroundTruthClip, MatchAnalysis, Moment, Rejected } from "@/lib/studio/types";
import { KIND_LABEL } from "./bits";
import { SpritePoster } from "./extras";

type Props = {
  durationSec: number;
  crowd: MatchAnalysis["crowd"];
  moments: Moment[];
  groundTruth: GroundTruthClip[];
  /** Candidates the run considered and dropped; the Dropped section lists the same items for keyboard use. */
  dropped: Rejected[];
  /** Twelve Labs search results; the search panel lists the same hits for keyboard use. */
  searchHits?: SearchHit[];
  searchSource?: SearchResult["source"];
  selectedId?: string;
  videoRef: RefObject<HTMLVideoElement | null>;
  onSelectMoment: (id: string) => void;
  onSeek: (t: number, play: boolean) => void;
};

const W = 1000;
const H = 100;
const MAX_COLUMNS = 900;

// The crowd's loudness as one filled shape. Long series are max-pooled to MAX_COLUMNS so a roar never
// averages away.
function crowdPath(values: number[]) {
  const n = Math.min(values.length, MAX_COLUMNS);
  const per = values.length / n;
  let d = `M0 ${H}`;
  for (let i = 0; i < n; i++) {
    let peak = 0;
    for (let j = Math.floor(i * per); j < Math.max(Math.floor((i + 1) * per), Math.floor(i * per) + 1); j++) {
      peak = Math.max(peak, values[j] ?? 0);
    }
    d += ` L${((i + 0.5) / n) * W} ${H - peak * H * 0.94}`;
  }
  return `${d} L${W} ${H} Z`;
}

const TICK_EVERY = 15 * 60;

export function MatchTimeline({ durationSec, crowd, moments, groundTruth, dropped, searchHits = [], searchSource = "live", selectedId, videoRef, onSelectMoment, onSeek }: Props) {
  const scrubRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const ghostRef = useRef<HTMLDivElement>(null);
  const peekRef = useRef<HTMLDivElement>(null);
  const clockRef = useRef<HTMLSpanElement>(null);
  const dragging = useRef(false);
  const [peekAt, setPeekAt] = useState(0);

  const path = useMemo(() => (crowd && crowd.values.length > 1 ? crowdPath(crowd.values) : undefined), [crowd]);
  const at = (t: number) => `${(Math.min(durationSec, Math.max(0, t)) / durationSec) * 100}%`;
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let t = TICK_EVERY; t < durationSec - 120; t += TICK_EVERY) out.push(t);
    return out;
  }, [durationSec]);
  const markers = moments.filter((m) => m.kind === "kickoff" || m.kind === "full-time");
  const selected = moments.find((m) => m.id === selectedId);

  // The playhead follows the source monitor every frame while it plays and once after each seek.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    let raf = 0;
    const place = () => {
      const t = v.currentTime;
      const width = scrubRef.current?.clientWidth ?? 0;
      if (headRef.current) headRef.current.style.transform = `translateX(${(t / durationSec) * width}px)`;
      if (clockRef.current) clockRef.current.textContent = timecode(t);
      scrubRef.current?.setAttribute("aria-valuenow", String(Math.floor(t)));
      scrubRef.current?.setAttribute("aria-valuetext", timecode(t));
    };
    const loop = () => {
      place();
      raf = requestAnimationFrame(loop);
    };
    const onPlay = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    };
    const onPause = () => {
      cancelAnimationFrame(raf);
      place();
    };
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("seeked", place);
    v.addEventListener("loadedmetadata", place);
    const resize = new ResizeObserver(place);
    if (scrubRef.current) resize.observe(scrubRef.current);
    place();
    return () => {
      cancelAnimationFrame(raf);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("seeked", place);
      v.removeEventListener("loadedmetadata", place);
      resize.disconnect();
    };
  }, [durationSec, videoRef]);

  const secondAt = (clientX: number) => {
    const box = scrubRef.current!.getBoundingClientRect();
    return Math.min(durationSec, Math.max(0, ((clientX - box.left) / box.width) * durationSec));
  };

  const hover = (e: PointerEvent) => {
    const box = scrubRef.current!.getBoundingClientRect();
    const x = Math.min(box.width, Math.max(0, e.clientX - box.left));
    if (ghostRef.current) ghostRef.current.style.transform = `translateX(${x}px)`;
    if (peekRef.current) {
      const half = peekRef.current.offsetWidth / 2;
      peekRef.current.style.transform = `translateX(${Math.min(box.width - 2 * half, Math.max(0, x - half))}px)`;
    }
    const t = Math.floor(secondAt(e.clientX));
    setPeekAt((prev) => (prev === t ? prev : t));
    if (dragging.current) onSeek(t, false);
  };

  const onKey = (e: KeyboardEvent) => {
    const v = videoRef.current;
    if (!v) return;
    const step = e.shiftKey ? 30 : 5;
    const to =
      e.key === "ArrowRight" ? v.currentTime + step
      : e.key === "ArrowLeft" ? v.currentTime - step
      : e.key === "Home" ? 0
      : e.key === "End" ? durationSec - 1
      : undefined;
    if (to === undefined) return;
    e.preventDefault();
    onSeek(Math.min(durationSec, Math.max(0, to)), false);
  };

  return (
    <div className="timeline">
      <div className="flex flex-wrap items-center justify-between gap-x-5 gap-y-1 pb-3 text-caption text-secondary">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="flex items-center gap-1.5">
            <i className="block size-2.5 rounded-full bg-tint" aria-hidden />
            Our moments
          </span>
          <span className="flex items-center gap-1.5">
            <i className="block h-2.5 w-4 rounded-[2px] bg-go" aria-hidden />
            Club clip we found
          </span>
          <span className="flex items-center gap-1.5">
            <i className="block h-2.5 w-4 rounded-[2px] shadow-[inset_0_0_0_1.5px_var(--secondary)]" aria-hidden />
            Club clip we missed
          </span>
          {dropped.length > 0 && (
            <span className="flex items-center gap-1.5">
              <i className="block h-2.5 w-[3px] rounded-[1px] bg-secondary" aria-hidden />
              Considered and dropped
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <i className="block h-2.5 w-4 rounded-[2px] bg-label/30" aria-hidden />
            {path ? "Crowd loudness" : "No crowd audio in this run"}
          </span>
        </div>
        <span className="num text-footnote text-label">
          <span className="sr-only">Source position </span>
          <span ref={clockRef}>0:00</span>
          <span className="text-secondary"> / {timecode(durationSec)}</span>
        </span>
      </div>

      {/* Twelve Labs search results, pinned where each hit starts. */}
      {searchHits.length > 0 && (
        <div className="relative mb-1 h-5" aria-hidden>
          {searchHits.map((h) => (
            <span
              key={`${h.start}-${h.rank}`}
              className="search-pin num"
              title={`${searchSource === "recorded" ? "Recorded Twelve Labs result" : "Twelve Labs result"} ${h.rank} · ${timecode(h.start)}`}
              style={{ left: at(h.start) }}
              onClick={() => onSeek(h.start, true)}
            >
              {h.rank}
            </span>
          ))}
        </div>
      )}

      {/* Our moments, pinned at their peaks. Higher-ranked moments get bigger pins and draw on top. */}
      <div className="relative h-7">
        {[...moments].sort((a, b) => a.scores.total - b.scores.total).map((m) => (
          <button
            key={m.id}
            type="button"
            className="pin"
            data-size={m.scores.total >= 0.6 ? "l" : m.scores.total >= 0.4 ? "m" : "s"}
            data-team={m.team}
            aria-pressed={m.id === selectedId}
            aria-label={`${m.title}, ${KIND_LABEL[m.kind]}${m.matchClock ? `, ${m.matchClock}` : ""}`}
            title={`${m.matchClock ?? timecode(m.peak)} · ${m.title}`}
            style={{ left: at(m.peak) }}
            onClick={() => {
              onSelectMoment(m.id);
              onSeek(m.start, true);
            }}
          >
            <i />
          </button>
        ))}
      </div>

      {/* The scrub area: the crowd's loudness across the whole source. */}
      <div
        ref={scrubRef}
        role="slider"
        tabIndex={0}
        aria-label="Match source position"
        aria-valuemin={0}
        aria-valuemax={Math.floor(durationSec)}
        aria-valuenow={0}
        className="timeline-scrub relative h-20 rounded-md bg-grouped"
        onKeyDown={onKey}
        onPointerMove={hover}
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          onSeek(secondAt(e.clientX), false);
        }}
        onPointerUp={(e) => {
          dragging.current = false;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
      >
        {path && (
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full" aria-hidden>
            <defs>
              <clipPath id="moment-windows">
                {moments.map((m) => (
                  <rect key={m.id} x={(m.start / durationSec) * W} width={Math.max(2, ((m.end - m.start) / durationSec) * W)} y={0} height={H} />
                ))}
              </clipPath>
              {selected && (
                <clipPath id="selected-window">
                  <rect x={(selected.start / durationSec) * W} width={Math.max(2, ((selected.end - selected.start) / durationSec) * W)} y={0} height={H} />
                </clipPath>
              )}
            </defs>
            <path d={path} fill="color-mix(in srgb, var(--label) 26%, transparent)" />
            <path d={path} fill="color-mix(in srgb, var(--tint) 60%, transparent)" clipPath="url(#moment-windows)" />
            {selected && <path d={path} fill="var(--label)" clipPath="url(#selected-window)" />}
          </svg>
        )}
        {markers.map((m) => (
          <span
            key={m.id}
            className="pointer-events-none absolute top-1.5 -translate-x-1/2 text-[10px] font-semibold uppercase tracking-wide text-secondary"
            style={{ left: at(m.peak) }}
            aria-hidden
          >
            {m.kind === "full-time" ? "FT" : m.peak > durationSec * 0.3 ? "2nd half" : "KO"}
          </span>
        ))}
        <div ref={ghostRef} className="timeline-ghost" aria-hidden />
        <div ref={headRef} className="timeline-head" aria-hidden />
        <div ref={peekRef} className="timeline-peek" aria-hidden>
          <div className="relative aspect-video overflow-hidden rounded-lg bg-card shadow-[0_12px_32px_-8px_rgb(0_0_0/0.7)] ring-1 ring-white/10">
            <Suspense fallback={null}>
              <SpritePoster at={peekAt} className="absolute inset-0" />
            </Suspense>
          </div>
          <p className="num mt-1 text-center text-caption text-label">{timecode(peekAt)}</p>
        </div>
      </div>

      {/* Where the club's own clips sit in the source. Ranges overlap where several club videos used the same
          moment, and the overlaps build up brighter. The accuracy panel lists the same ranges for keyboard use. */}
      <div className="relative mt-2 h-3" aria-hidden>
        {groundTruth.map((g) => (
          <span
            key={`${g.scoreplayId}-${g.start}`}
            className="club-span"
            data-found={g.matchedMomentId ? "" : undefined}
            title={`${clubClipName(g.name)} · ${g.matchedMomentId ? "found" : "missed"}`}
            style={{ left: at(g.start), width: `${((g.end - g.start) / durationSec) * 100}%` }}
            onClick={() => {
              if (g.matchedMomentId) onSelectMoment(g.matchedMomentId);
              onSeek(g.start, true);
            }}
          />
        ))}
      </div>

      {dropped.length > 0 && (
        <div className="relative mt-1.5 h-2.5" aria-hidden>
          {dropped.map((r, i) => (
            <span
              key={`${r.at}-${i}`}
              className="dropped-tick"
              title={`Dropped: ${r.title}`}
              style={{ left: at(r.at) }}
              onClick={() => onSeek(Math.max(0, r.at - 3), true)}
            />
          ))}
        </div>
      )}

      <div className="relative mt-1.5 h-4 text-[10px] text-secondary" aria-hidden>
        <span className="num absolute left-0">0:00</span>
        {ticks.map((t) => (
          <span key={t} className="num absolute -translate-x-1/2" style={{ left: at(t) }}>
            {timecode(t)}
          </span>
        ))}
        <span className="num absolute right-0">{timecode(durationSec)}</span>
      </div>
    </div>
  );
}
