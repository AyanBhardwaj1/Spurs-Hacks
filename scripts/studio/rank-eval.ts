// Compare the ranked moments with the club's reference ranges and two baselines
// with the same K lengths, restricted to the estimated playing halves.

type Range = { start: number; end: number };
type Ranked = Range & { score: number; peak: number };
type Crowd = { stepSec: number; values: number[] };

export type AtK = { k: number; precision: number; recall: number; minutes: number; randomPrecision: number; randomRecall: number; loudCrowdPrecision: number };

// Tightened after review from >0 s; the top-10 hit count did not change.
export const OVERLAP_MIN_SEC = 3;
export const isHit = (a: Range, b: Range) => Math.min(a.end, b.end) - Math.max(a.start, b.start) >= OVERLAP_MIN_SEC;
const HIGHLIGHTS_PACKAGES = new Set([130852722, 130852723, 130852724]);
export const isSingleMomentClip = (reference: { scoreplayId: number }) => !HIGHLIGHTS_PACKAGES.has(reference.scoreplayId);

/** Merges overlapping reference ranges; ranges that only touch stay separate. */
export function mergeRanges(ranges: Range[]): Range[] {
  const merged: Range[] = [];
  for (const r of [...ranges].sort((a, b) => a.start - b.start)) {
    const last = merged.at(-1);
    if (last && r.start < last.end) last.end = Math.max(last.end, r.end);
    else merged.push({ start: r.start, end: r.end });
  }
  return merged;
}

function score(picked: Range[], references: Range[], merged = mergeRanges(references)) {
  const hits = picked.filter((p) => references.some((r) => isHit(p, r))).length;
  const found = merged.filter((r) => picked.some((p) => isHit(p, r))).length;
  return { precision: picked.length ? hits / picked.length : 0, recall: merged.length ? found / merged.length : 0 };
}

/** Uniform over the union of feasible start times, weighted by each half's available length. */
export function placeInHalves(length: number, halves: Range[], draw: number): Range {
  const eligible = halves.filter((half) => half.end - half.start >= length);
  if (!eligible.length) throw new Error(`No playing half can contain a ${length} s range`);
  const available = eligible.map((half) => half.end - half.start - length);
  const total = available.reduce((a, b) => a + b, 0);
  if (total === 0) {
    const start = eligible[Math.floor(draw * eligible.length)].start;
    return { start, end: start + length };
  }
  let position = draw * total;
  for (let i = 0; i < eligible.length; i++) {
    if (position < available[i]) {
      const start = eligible[i].start + position;
      return { start, end: start + length };
    }
    position -= available[i];
  }
  throw new Error(`Uniform draw ${draw} is outside [0, 1)`);
}

/** Bin centres inside the playing halves, selecting exactly the loudest ceil(10%); ties go to the earlier bin. */
export function loudCrowdPeaks(crowd: Crowd, halves: Range[]): number[] {
  const playing = crowd.values.map((value, i) => ({ value, peak: (i + 0.5) * crowd.stepSec }))
    .filter(({ peak }) => halves.some((half) => peak >= half.start && peak <= half.end));
  return playing.sort((a, b) => b.value - a.value || a.peak - b.peak).slice(0, Math.ceil(playing.length * 0.1)).map(({ peak }) => peak);
}

/** Filter the loud bins per moment so its original peak offset and whole range fit within one half. */
export function loudPlacements(moment: Range & { peak: number }, peaks: number[], halves: Range[]): Range[] {
  const before = moment.peak - moment.start;
  const after = moment.end - moment.peak;
  const placements = peaks.map((peak) => ({ start: peak - before, end: peak + after }))
    .filter((range) => halves.some((half) => range.start >= half.start && range.end <= half.end));
  if (!placements.length) throw new Error(`No loud playing-half bin can contain a ${before + after} s range with peak offset ${before} s`);
  return placements;
}

/** Mulberry32 keeps both Monte Carlo baselines reproducible. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const ranked = (moments: Ranked[]) => [...moments].sort((a, b) => b.score - a.score || a.peak - b.peak);

export function clipsOnlyAtK(moments: Ranked[], references: (Range & { scoreplayId: number })[], k = 10) {
  return { k, precision: r3(score(ranked(moments).slice(0, k), references.filter(isSingleMomentClip)).precision) };
}

/** Precision uses original references; recall counts their merged ranges. Both baselines preserve each top-K range's length. */
export function rankingAtK(input: {
  moments: Ranked[];
  references: Range[];
  ks: number[];
  halves: Range[];
  crowd: Crowd;
  trials: number;
  seed: number;
}): AtK[] {
  const ordered = ranked(input.moments);
  const merged = mergeRanges(input.references);
  const loudPeaks = loudCrowdPeaks(input.crowd, input.halves);
  return input.ks.map((k) => {
    const top = ordered.slice(0, k);
    const { precision, recall } = score(top, input.references, merged);
    const random = seeded(input.seed + k);
    const loudRandom = seeded(input.seed + k);
    const loudOptions = top.map((m) => loudPlacements(m, loudPeaks, input.halves));
    let randomPrecision = 0;
    let randomRecall = 0;
    let loudCrowdPrecision = 0;
    for (let trial = 0; trial < input.trials; trial++) {
      const placed = top.map((m) => placeInHalves(m.end - m.start, input.halves, random()));
      const uniform = score(placed, input.references, merged);
      randomPrecision += uniform.precision;
      randomRecall += uniform.recall;
      const loud = loudOptions.map((options) => options[Math.floor(loudRandom() * options.length)]);
      loudCrowdPrecision += score(loud, input.references, merged).precision;
    }
    return {
      k, precision: r3(precision), recall: r3(recall),
      minutes: Math.round(mergeRanges(top).reduce((sum, r) => sum + r.end - r.start, 0) / 60 * 10) / 10,
      randomPrecision: r3(randomPrecision / input.trials), randomRecall: r3(randomRecall / input.trials),
      loudCrowdPrecision: r3(loudCrowdPrecision / input.trials),
    };
  });
}
