"use client";

import { useState, type KeyboardEvent, type MouseEvent } from "react";
import { matchClock } from "@/lib/jobs/moments";
import type { Job } from "@/lib/jobs/types";

const W = 1000;
const H = 120;

/** The curve as an SVG area: quiet stretches near the bottom, the loudest roar at the top. */
function areaPath(db: number[]) {
  if (db.length === 0) return "";
  const sorted = [...db].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.05)];
  const hi = sorted.at(-1)!;
  const y = (v: number) => (H - 4 - Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1))) * (H - 16)).toFixed(1);
  const x = (i: number) => ((i / Math.max(1, db.length - 1)) * W).toFixed(1);
  return `M0,${H} ${db.map((v, i) => `L${x(i)},${y(v)}`).join(" ")} L${W},${H} Z`;
}

// The whole match at a glance: how loud the crowd was, second by second, with every moment Rundown found
// marked on it. Filled markers became clips; hollow ones were left out. With onPick, clicking the curve
// offers that second as a new moment.
export function EnergyTimeline({ job, onPick }: { job: Job; onPick?: (sec: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const energy = job.energy;
  const duration = job.source?.durationSec ?? 0;
  if (!energy || energy.db.length < 2 || duration <= 0) return null;
  const clipped = new Set(job.clips.map((c) => c.momentId));
  const at = (e: MouseEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((e.clientX - box.left) / box.width) * duration));
  };
  const pct = (sec: number) => `${(sec / duration) * 100}%`;
  const ranked = [...job.moments].sort((a, b) => b.score - a.score);

  return (
    <figure className="mt-10">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-footnote font-semibold">The crowd across the match</span>
        <span className="text-caption text-secondary">
          {onPick ? "Click anywhere to make a clip from that second. " : ""}Filled marks became clips.
        </span>
      </figcaption>
      <div
        className={`relative mt-2 h-28 select-none rounded-xl bg-grouped outline-none focus-visible:ring-2 focus-visible:ring-tint ${onPick ? "cursor-crosshair" : ""}`}
        onPointerMove={(e) => setHover(at(e))}
        onPointerLeave={(e) => {
          if (document.activeElement !== e.currentTarget) setHover(null);
        }}
        onClick={(e) => onPick?.(Math.round(at(e)))}
        // With onPick it is a slider too: the arrows move five seconds (Shift for thirty), Enter picks.
        {...(onPick
          ? {
              role: "slider",
              tabIndex: 0,
              "aria-valuemin": 0,
              "aria-valuemax": Math.round(duration),
              "aria-valuenow": Math.round(hover ?? 0),
              "aria-valuetext": matchClock(hover ?? 0),
              onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
                const step = e.shiftKey ? 30 : 5;
                if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                  e.preventDefault();
                  setHover((h) => Math.max(0, Math.min(duration, (h ?? 0) + (e.key === "ArrowRight" ? step : -step))));
                } else if (e.key === "Enter") {
                  e.preventDefault();
                  onPick(Math.round(hover ?? 0));
                }
              },
            }
          : { role: "img" })}
        aria-label={`Crowd loudness over ${matchClock(duration)}, with ${job.moments.length} moments marked at ${ranked.map((m) => matchClock(m.peak)).join(", ")}.${onPick ? " Use the arrow keys to choose a second and Enter to make a clip from it." : ""}`}
      >
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 size-full overflow-hidden rounded-xl" aria-hidden>
          <path d={areaPath(energy.db)} className="fill-tint/25 stroke-tint" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        </svg>
        {ranked.map((m, i) => (
          <span key={m.id} className="pointer-events-none absolute inset-y-1 w-px bg-label/50" style={{ left: pct(m.peak) }} aria-hidden>
            <span
              className={`num absolute -top-0.5 left-1/2 grid size-5 -translate-x-1/2 place-items-center rounded-full text-[10px] font-semibold ${clipped.has(m.id) ? "bg-label text-page" : "border border-label/60 bg-grouped text-label"}`}
            >
              {i + 1}
            </span>
          </span>
        ))}
        {hover !== null && (
          <span className="pointer-events-none absolute inset-y-0 w-px bg-tint" style={{ left: pct(hover) }} aria-hidden>
            <span className="num absolute bottom-1 left-1.5 rounded bg-label px-1 text-[11px] text-page">{matchClock(hover)}</span>
          </span>
        )}
      </div>
      <div className="num mt-1 flex justify-between text-caption text-secondary" aria-hidden>
        <span>0:00</span>
        <span>{matchClock(duration / 2)}</span>
        <span>{matchClock(duration)}</span>
      </div>
    </figure>
  );
}
