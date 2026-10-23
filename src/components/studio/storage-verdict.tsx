"use client";

import { useMemo } from "react";
import { PlayIcon } from "@/components/landing/icons";
import { storagePlan } from "@/lib/studio/storage";
import { clipLength, timecode } from "@/lib/studio/time";
import type { MatchAnalysis } from "@/lib/studio/types";
import { SectionTitle, pct } from "./bits";

type Props = {
  analysis: MatchAnalysis;
  onSeek: (t: number, play: boolean) => void;
};

const SHOWN = 3;

// "If the system can defend why something will never be used, that is a storage decision as much as an
// editorial one." The stretches of the match nothing in the run pointed at, as a proposal for cold storage.
export function StorageVerdict({ analysis, onSeek }: Props) {
  const plan = useMemo(() => storagePlan(analysis), [analysis]);
  const { durationSec, cold } = plan;
  if (cold.length === 0) return null;
  const minutes = (s: number) => Math.round(s / 60);

  return (
    <section aria-labelledby="storage-title" className="mt-10">
      <SectionTitle eyebrow="Storage" title="What nothing pointed at" id="storage-title" />
      <p className="mt-2 max-w-[64ch] text-footnote text-secondary text-pretty">
        <span className="num">{minutes(plan.coldSec)}</span> minutes of the <span className="num">{minutes(durationSec)}</span>-minute
        match, in {cold.length} {cold.length === 1 ? "stretch" : "stretches"} of a minute or more, had no moment, no Twelve Labs hit,
        no candidate it weighed, no club clip and no loud crowd. Keep the proxy and move the master of those stretches to cold
        storage; the <span className="num">{minutes(plan.keptSec)}</span> minutes the run used or weighed stay at full quality.
      </p>
      <div className="mt-6 rounded-[18px] bg-grouped p-4">
        {/* The whole match, with each cold stretch where it sits. Each one plays from its start on the monitor. */}
        <div className="relative h-3 rounded-[3px] bg-fill/70" aria-hidden>
          {cold.map((r) => (
            <span
              key={r.start}
              onClick={() => onSeek(r.start, true)}
              title={`${timecode(r.start)} to ${timecode(r.end)}`}
              className="absolute inset-y-0 min-w-[4px] cursor-pointer rounded-[2px] bg-secondary"
              style={{ left: `${(r.start / durationSec) * 100}%`, width: `${((r.end - r.start) / durationSec) * 100}%` }}
            />
          ))}
        </div>
        <p className="mt-4 px-1 text-subhead font-semibold">Longest stretches</p>
        <ol className="mt-2 space-y-1">
          {cold.slice(0, SHOWN).map((r) => (
            <li key={r.start} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-xl px-2 py-2 hover:bg-fill/60">
              <button
                type="button"
                onClick={() => onSeek(r.start, true)}
                aria-label={`Play the stretch from ${timecode(r.start)}`}
                className="press num inline-flex shrink-0 items-center gap-1 rounded-md text-caption text-tint hover:underline"
              >
                <PlayIcon className="size-2.5" />
                {timecode(r.start)} to {timecode(r.end)}
              </button>
              <span className="num text-footnote font-semibold">{clipLength(r.end - r.start)}</span>
              <span className="text-caption text-secondary">
                crowd at most <span className="num">{pct(r.crowdPeak)}%</span> of the match&rsquo;s loudest
              </span>
            </li>
          ))}
        </ol>
      </div>
      <p className="mt-3 text-caption text-secondary">A proposal: nothing is moved, and nothing about storage is written to ScorePlay.</p>
    </section>
  );
}
