// The live crowd meter's arithmetic: one loudness value per 2 s feed segment, the same measure the
// analysis used, a spike test against the feed's recent past, and agreement with the analysis' series.
//
// The analysis (scripts/studio/crowd.ts) measures 100 ms RMS frames of mono audio and takes the 20th
// percentile of the frames around each second as the crowd floor, because crowd noise is continuous while
// commentary has gaps. A feed segment holds 20 such frames, so its floor is their 20th percentile.

/** Stand-in for digital silence, which ffmpeg's astats reports as -inf. Same as scripts/studio/crowd.ts. */
export const SILENCE_DB = -90;
const FLOOR_PERCENTILE = 0.2;

/** Crowd floor of one segment, in dB, from its 100 ms RMS frames. */
export function segmentFloorDb(framesDb: number[]): number {
  if (framesDb.length === 0) throw new Error("A segment with no audio frames has no crowd floor");
  const sorted = framesDb.map((v) => (Number.isFinite(v) ? Math.max(SILENCE_DB, v) : SILENCE_DB)).sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length * FLOOR_PERCENTILE)];
}

/** Reads ffmpeg's ametadata print of lavfi.astats.Overall.RMS_level into one dB value per frame. */
export function parseRmsFrames(text: string): number[] {
  return [...text.matchAll(/lavfi\.astats\.Overall\.RMS_level=(\S+)/g)].map((m) => {
    const db = Number(m[1]);
    return Number.isFinite(db) ? Math.max(SILENCE_DB, db) : SILENCE_DB;
  });
}

/**
 * The dB range the analysis scaled its crowd series by: the 2nd and 99.5th percentiles of its 5 s means.
 * The analysis file keeps only the scaled values, so these were recomputed from the pipeline's cached
 * frames (.media/studio/crowd-frames.json) on 23 October; rescaling with them reproduces every committed
 * value within 0.001.
 */
export const ANALYSIS_SCALE_DB = { low: -36.56, high: -22.05 };

/** A floor in dB on the analysis' 0-to-1 scale, clamped as the analysis clamps. */
export function toAnalysisScale(db: number): number {
  const { low, high } = ANALYSIS_SCALE_DB;
  return Math.min(1, Math.max(0, (db - low) / (high - low)));
}

/** The analysis' crowd value at source second `t`. */
export function analysisCrowdAt(crowd: { stepSec: number; values: number[] }, t: number): number | undefined {
  return crowd.values[Math.floor(t / crowd.stepSec)];
}

// Chosen on 23 October by running detectSpikes over all 3,167 segments of the analysed audio (the cached
// proxy frames, which differ from the feed by 0.24 dB on average). With a 5 dB rise over the previous minute it fires 91
// times in the match; 51% of those fall within 5 s of an analysed moment, against 39% of the match those
// windows cover, and it fires on all 7 moments scoring 0.55 or more. 4 dB fired 124 times; 6 dB caught 4 of
// the 7. So a spike is a loud crowd, not a detected event, and the UI says only that.
export const SPIKE = {
  /** Segments of feed history the baseline is the median of: the previous minute, as the analysis compares. */
  baselineSegments: 30,
  /** Fewer earlier segments than this and there is no baseline yet. */
  minBaselineSegments: 5,
  /** Rise of a segment's floor over the baseline that counts as a spike. */
  riseDb: 5,
  /** After a spike, segments that cannot start another, so one roar is one spike: 20 s. */
  refractorySegments: 10,
};

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

export type SpikeReading = { baselineDb?: number; riseDb?: number; spike: boolean };

/**
 * Spike test for each floor in feed order. `undefined` marks a segment that could not be measured; the
 * baseline starts again after it, since a baseline across a gap would compare different parts of the match.
 */
export function detectSpikes(floorsDb: (number | undefined)[], params = SPIKE): SpikeReading[] {
  const out: SpikeReading[] = [];
  let lastSpike = -Infinity;
  let runStart = 0;
  for (let i = 0; i < floorsDb.length; i++) {
    const floor = floorsDb[i];
    if (floor === undefined) {
      runStart = i + 1;
      out.push({ spike: false });
      continue;
    }
    // Every floor from runStart on was measured.
    const history = floorsDb.slice(Math.max(runStart, i - params.baselineSegments), i) as number[];
    if (history.length < params.minBaselineSegments) {
      out.push({ spike: false });
      continue;
    }
    const baselineDb = median(history);
    const riseDb = floor - baselineDb;
    const spike = riseDb >= params.riseDb && i - lastSpike > params.refractorySegments;
    if (spike) lastSpike = i;
    out.push({ baselineDb, riseDb, spike });
  }
  return out;
}

/** How closely the live readings track the analysis: the share within `band` of it, and the mean gap. */
export function agreement(pairs: { live: number; analysis: number }[], band = AGREEMENT_BAND) {
  if (pairs.length === 0) return undefined;
  const gaps = pairs.map((p) => Math.abs(p.live - p.analysis));
  return {
    within: gaps.filter((g) => g <= band).length,
    total: pairs.length,
    meanGap: gaps.reduce((a, b) => a + b, 0) / gaps.length,
  };
}

/**
 * Readings within this distance of the analysis, on its 0-to-1 scale, count as agreeing. The analysis
 * averages 5 s and a segment is 2 s, so even identical audio differs: over the cached match audio, 82% of
 * segments fall within 0.15 and 67% within 0.1.
 */
export const AGREEMENT_BAND = 0.15;

/** Segments the browser keeps and draws: 90 s. More than SPIKE.baselineSegments, so the newest has a full baseline. */
export const HISTORY_SEGMENTS = 45;

/**
 * Which segments one meter request measures, newest first, given what the browser already holds. New
 * segments come first, up to `forward`; the rest of the budget fills history backward from the oldest
 * segment the browser has. Nothing older than the history window is measured.
 */
export function segmentsToMeasure(
  edgeSeq: number,
  have: { after?: number; before?: number },
  budget: { total: number; forward: number; history: number },
): number[] {
  const oldest = edgeSeq - budget.history + 1;
  const out: number[] = [];
  const newestKnown = have.after ?? -Infinity;
  for (let seq = edgeSeq; seq > newestKnown && seq >= oldest && out.length < Math.min(budget.forward, budget.total); seq--) out.push(seq);
  if (have.before !== undefined) {
    for (let seq = Math.min(have.before - 1, edgeSeq); seq >= oldest && out.length < budget.total; seq--) {
      if (seq > newestKnown || out.includes(seq)) continue;
      out.push(seq);
    }
  }
  return out;
}

/** One measured feed segment, as the meter route answers and the browser keeps it. */
export type SegmentReading = {
  seq: number;
  n: number;
  /** When the segment airs on the feed's clock, epoch ms. */
  airsAt: number;
  /** Crowd floor in dB, or absent when the measurement failed. */
  floorDb?: number;
  error?: string;
};

/** A reading with the spike test the browser ran on it. */
export type LiveReading = SegmentReading & { level?: number; baselineDb?: number; riseDb?: number; spike: boolean };

/** The newest segment the browser holds, and the oldest of the unbroken run ending there. */
export function heldRange(held: SegmentReading[]): { after?: number; before?: number } {
  if (held.length === 0) return {};
  const seqs = new Set(held.map((r) => r.seq));
  const after = Math.max(...seqs);
  let before = after;
  while (seqs.has(before - 1)) before -= 1;
  return { after, before };
}

/**
 * The held readings in feed order within the history window, each with its spike test. A segment the
 * browser does not hold, or one that failed to measure, starts the baseline again.
 */
export function withSpikes(held: SegmentReading[], edgeSeq: number): LiveReading[] {
  if (held.length === 0) return [];
  const bySeq = new Map(held.map((r) => [r.seq, r]));
  const newest = Math.max(...bySeq.keys());
  const oldest = Math.max(edgeSeq - HISTORY_SEGMENTS + 1, Math.min(...bySeq.keys()));
  const run = Array.from({ length: Math.max(0, newest - oldest + 1) }, (_, i) => bySeq.get(oldest + i));
  const spikes = detectSpikes(run.map((r) => r?.floorDb));
  return run.flatMap((r, i) =>
    r ? [{ ...r, level: r.floorDb === undefined ? undefined : toAnalysisScale(r.floorDb), ...spikes[i] }] : [],
  );
}
