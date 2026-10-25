"use client";

import { useEffect, useRef } from "react";
import { SEGMENT_SEC } from "@/lib/studio/live";
import { AGREEMENT_BAND, agreement, analysisCrowdAt, SPIKE, type LiveReading } from "@/lib/studio/live-signal";
import type { MatchAnalysis } from "@/lib/studio/types";
import { useReducedMotion } from "../use-reduced-motion";
import type { LiveMoment } from "./live-view";

type Props = {
  readings: LiveReading[];
  /** The segment on screen. Readings after it are measured but not yet seen, so they wait. */
  playingSeq?: number;
  crowd: MatchAnalysis["crowd"];
  moments: LiveMoment[];
  error?: string;
  /** Why the server cannot measure, when it cannot run ffmpeg. */
  unavailable?: string;
  /** Wall-clock ms of the latest poll that succeeded, and the current time, to say how stale the trace is. */
  lastOkAt?: number;
  now: number;
};

/** Segments drawn: 90 s. */
const SHOWN = 45;
const STEP = 10;
const W = SHOWN * STEP;
const H = 96;
const y = (level: number) => H - 6 - level * (H - 14);

function path(points: { x: number; v?: number }[]) {
  let d = "";
  let pen = false;
  for (const p of points) {
    if (p.v === undefined) {
      pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${p.x.toFixed(1)} ${y(p.v).toFixed(1)} `;
    pen = true;
  }
  return d.trim();
}

// The one part of the page measured live: the server fetches each 2 s segment of the feed, measures its
// crowd floor with ffmpeg, and this draws it beside the analysis' value for the same second of the match.
export function CrowdMeter({ readings, playingSeq, crowd, moments, error, unavailable, lastOkAt, now }: Props) {
  const plotRef = useRef<SVGGElement>(null);
  const lastSeq = useRef<number | undefined>(undefined);
  const reduce = useReducedMotion();

  const seen = readings.filter((r) => playingSeq === undefined || r.seq <= playingSeq).slice(-SHOWN);
  const head = seen[seen.length - 1];
  const x = (seq: number) => W - STEP / 2 - (head.seq - seq) * STEP;

  // Each new segment slides the trace left by one step instead of jumping.
  useEffect(() => {
    const g = plotRef.current;
    const prev = lastSeq.current;
    lastSeq.current = head?.seq;
    if (!g || reduce || prev === undefined || head === undefined || head.seq <= prev || head.seq - prev > 3) return;
    g.animate([{ transform: `translateX(${(head.seq - prev) * STEP}px)` }, { transform: "translateX(0)" }], {
      duration: 600,
      easing: "cubic-bezier(0.23, 1, 0.32, 1)",
    });
  }, [head?.seq, head, reduce]);

  const pairs = seen.flatMap((r) => {
    const a = crowd && analysisCrowdAt(crowd, r.n * SEGMENT_SEC + SEGMENT_SEC / 2);
    return r.level !== undefined && a !== undefined ? [{ live: r.level, analysis: a }] : [];
  });
  const agree = agreement(pairs);
  const lastSpike = [...seen].reverse().find((r) => r.spike);
  // A failed latest poll means the trace is old; the meter says so instead of showing it as live.
  const paused = error !== undefined && seen.length > 0;
  const spikeNow = !paused && lastSpike && head && head.seq - lastSpike.seq <= 2;

  return (
    <section aria-labelledby="crowd-title" className="rounded-[18px] bg-grouped p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="min-w-0">
          {paused ? (
            <p className="text-caption font-semibold uppercase tracking-[0.06em] text-secondary" title={error}>
              Meter paused
              {lastOkAt !== undefined && now > 0 && <span className="num normal-case tracking-normal font-normal">: last reading {Math.max(0, Math.round((now - lastOkAt) / 1000))} s ago</span>}
            </p>
          ) : (
            <p className="flex items-center gap-2 text-caption font-semibold uppercase tracking-[0.06em] text-secondary">
              <span className="live-dot" aria-hidden />
              Measured live
            </p>
          )}
          <h2 id="crowd-title" className="mt-1 text-title3 font-semibold">
            Crowd noise
          </h2>
          <p className="mt-1 max-w-[60ch] text-caption text-secondary text-pretty">
            The server fetches each 2 s segment of the feed and measures its crowd floor with ffmpeg, the same way the analysis
            measured the match. Only the numbers are kept.
          </p>
        </div>
        <div className="text-right">
          <p className="num text-title2 font-semibold leading-none">{head?.floorDb !== undefined ? `${head.floorDb.toFixed(1)} dB` : "–"}</p>
          <p className="num mt-1 text-caption text-secondary">
            {head?.riseDb !== undefined ? `${head.riseDb >= 0 ? "+" : "−"}${Math.abs(head.riseDb).toFixed(1)} dB on the last minute` : "Building a baseline"}
          </p>
          <p className="live-spike mt-1.5" data-on={spikeNow || undefined} aria-hidden={!spikeNow}>
            {lastSpike?.riseDb !== undefined ? `Crowd spike +${lastSpike.riseDb.toFixed(1)} dB` : "Crowd spike"}
          </p>
        </div>
      </div>

      <div className="mt-4">
        {seen.length === 0 ? (
          <div className="grid h-24 place-items-center rounded-lg bg-black/30 text-caption text-secondary">
            <span title={unavailable}>{unavailable ? "Crowd meter unavailable on this server" : (error ?? "Measuring the first segments of the feed…")}</span>
          </div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="live-plot h-24 w-full" data-paused={paused || undefined} role="img" aria-label={`Crowd floor over the last ${seen.length * SEGMENT_SEC} seconds of the feed, live and from the analysis`}>
            <line x1={0} x2={W} y1={y(0)} y2={y(0)} className="live-plot-base" />
            <g ref={plotRef}>
              {seen.map((r) => {
                const peak = moments.find((m) => m.peak >= r.n * SEGMENT_SEC && m.peak < (r.n + 1) * SEGMENT_SEC);
                return peak ? (
                  <line key={`m${r.seq}`} x1={x(r.seq)} x2={x(r.seq)} y1={4} y2={H} className="live-plot-moment">
                    <title>{`${peak.matchClock ?? ""} ${peak.title}`}</title>
                  </line>
                ) : null;
              })}
              <path
                d={path(seen.map((r) => ({ x: x(r.seq), v: crowd ? analysisCrowdAt(crowd, r.n * SEGMENT_SEC + SEGMENT_SEC / 2) : undefined })))}
                className="live-plot-analysis"
              />
              <path d={path(seen.map((r) => ({ x: x(r.seq), v: r.level })))} className="live-plot-live" />
              {seen
                .filter((r) => r.spike && r.level !== undefined)
                .map((r) => (
                  <g key={`s${r.seq}`}>
                    <line x1={x(r.seq)} x2={x(r.seq)} y1={y(r.level!)} y2={H} className="live-plot-spike" />
                    {/* A zero-length round-capped line stays a circle when the plot stretches; a <circle> would not. */}
                    <line x1={x(r.seq)} x2={x(r.seq)} y1={y(r.level!)} y2={y(r.level!)} className="live-plot-spike-dot" />
                  </g>
                ))}
            </g>
          </svg>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-caption text-secondary">
        <span className="inline-flex items-center gap-1.5">
          <i className="live-key live-key-live" aria-hidden />
          Live feed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="live-key live-key-analysis" aria-hidden />
          Analysis, same second
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="live-key live-key-spike" aria-hidden />
          Spike: {SPIKE.riseDb} dB over the last minute&rsquo;s median
        </span>
        <span className="inline-flex items-center gap-1.5">
          <i className="live-key live-key-moment" aria-hidden />
          A moment&rsquo;s peak
        </span>
        {agree && (
          <span className="num ml-auto text-label">
            Agrees with the analysis on {agree.within} of {agree.total} segments (within {AGREEMENT_BAND} on its 0–1 scale)
          </span>
        )}
      </div>
    </section>
  );
}
