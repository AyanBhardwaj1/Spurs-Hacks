// Which stretches of the source nothing in the run pointed at. A second is kept when a planned clip, a
// moment, a club clip, a dropped candidate or a loud crowd touches it; the long gaps between kept ranges
// are footage the system can say why it will never use, so their master can go to cold storage.

import type { MatchAnalysis } from "./types";

export type Range = { start: number; end: number };

export const STORAGE_RULES = {
  /** Seconds kept either side of a dropped candidate, so a rescue is always possible. */
  padSec: 10,
  /** Gaps shorter than this are too short to act on. */
  minColdSec: 60,
  /** Crowd bins in this loudest share of the match count as kept. */
  loudShare: 0.1,
};

export type StorageRules = typeof STORAGE_RULES;

export type ColdStretch = Range & { crowdPeak: number };

export type StoragePlan = {
  durationSec: number;
  keptSec: number;
  /** Longest first. */
  cold: ColdStretch[];
  coldSec: number;
};

type Crowd = NonNullable<MatchAnalysis["crowd"]>;

export type StorageInput = Pick<MatchAnalysis, "moments" | "clips" | "groundTruth" | "rejected" | "crowd"> & {
  source: { durationSec: number };
};

/** Clamps to the source, drops empty ranges, and merges ranges that overlap or touch. Sorted by start. */
export function mergeRanges(ranges: Range[], durationSec: number): Range[] {
  const clamped = ranges
    .map((r) => ({ start: Math.max(0, r.start), end: Math.min(durationSec, r.end) }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start);
  const out: Range[] = [];
  for (const r of clamped) {
    const last = out.at(-1);
    if (last && r.start <= last.end) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

/** The uncovered ranges of [0, durationSec], given merged, sorted kept ranges. */
export function gapsBetween(kept: Range[], durationSec: number): Range[] {
  const gaps: Range[] = [];
  let at = 0;
  for (const r of kept) {
    if (r.start > at) gaps.push({ start: at, end: r.start });
    at = Math.max(at, r.end);
  }
  if (durationSec > at) gaps.push({ start: at, end: durationSec });
  return gaps;
}

/** The crowd bins in the loudest `share` of the match, ties included, and always at least one bin. */
export function loudBins(crowd: Crowd, share: number): Range[] {
  const { stepSec, values } = crowd;
  if (values.length === 0) return [];
  const rank = Math.max(1, Math.ceil(values.length * share));
  const threshold = [...values].sort((a, b) => b - a)[rank - 1];
  return values.flatMap((v, i) => (v >= threshold ? [{ start: i * stepSec, end: (i + 1) * stepSec }] : []));
}

/** The highest crowd value among the bins a range overlaps, 0 when there is no crowd data. */
function crowdPeak(crowd: Crowd | undefined, r: Range) {
  if (!crowd) return 0;
  const first = Math.max(0, Math.floor(r.start / crowd.stepSec));
  const last = Math.min(crowd.values.length, Math.ceil(r.end / crowd.stepSec));
  let peak = 0;
  for (let i = first; i < last; i++) peak = Math.max(peak, crowd.values[i]);
  return peak;
}

export function storagePlan(analysis: StorageInput, rules: StorageRules = STORAGE_RULES): StoragePlan {
  const durationSec = analysis.source.durationSec;
  const kept = mergeRanges(
    [
      ...analysis.clips.flatMap((c) => c.segments),
      ...analysis.moments,
      ...analysis.groundTruth,
      ...analysis.rejected.map((r) => ({ start: r.at - rules.padSec, end: r.at + rules.padSec })),
      ...(analysis.crowd ? loudBins(analysis.crowd, rules.loudShare) : []),
    ],
    durationSec,
  );
  const cold = gapsBetween(kept, durationSec)
    .filter((g) => g.end - g.start >= rules.minColdSec)
    .map((g) => ({ ...g, crowdPeak: crowdPeak(analysis.crowd, g) }))
    .sort((a, b) => b.end - b.start - (a.end - a.start) || a.start - b.start);
  return {
    durationSec,
    keptSec: kept.reduce((s, r) => s + r.end - r.start, 0),
    cold,
    coldSec: cold.reduce((s, r) => s + r.end - r.start, 0),
  };
}
