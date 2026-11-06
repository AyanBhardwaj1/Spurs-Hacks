// Crowd energy from a match's audio, and the loud stretches in it. Crowd noise is continuous while speech
// has gaps, so a low percentile of short frames (the noise floor) follows the crowd and mostly ignores the
// commentators. On the hackathon's Tottenham match the floor rose from about -30 dB to -21 dB within three
// seconds of a goal call. Pure, so the hackathon scripts and the job engine share it.

/** Length of one RMS frame. */
export const FRAME_SEC = 0.1;
/** Frames around each second that the floor percentile is taken over. */
const FLOOR_WINDOW_SEC = 3;
const FLOOR_PERCENTILE = 0.2;
/** Stand-in for digital silence, which astats reports as -inf. */
const SILENCE_DB = -90;

/** How far back the "normal" crowd level is read from, skipping the last few seconds. */
const BASELINE_FROM_SEC = 60;
const BASELINE_TO_SEC = 5;
/** A rise smaller than this over the baseline is chatter, not a moment. */
const MIN_RISE_DB = 6;
/** Two roars closer than this are one moment. */
const GAP_SEC = 20;
/** The play comes before the roar: a window opens this long before the peak and runs this long after. */
const LEAD_SEC = 15;
const TAIL_SEC = 10;
/** A roar's onset: walk back from its loudest second while the rise stays above this share of it. */
const ONSET_SHARE = 0.5;
const ONSET_MAX_SEC = 8;
/** About one moment per three minutes of video, never fewer than five. */
const SEC_PER_MOMENT = 180;
const MIN_MOMENTS = 5;

export type CrowdFrames = { frameSec: number; durationSec: number; rmsDb: number[] };
export type Peak = { peak: number; start: number; end: number; score: number };

/** Per-second crowd floor in dB: the 20th percentile of the frames in a window centred on each second. */
export function floorPerSecond(frames: CrowdFrames): number[] {
  const perSec = Math.round(1 / frames.frameSec);
  const half = Math.round((FLOOR_WINDOW_SEC * perSec) / 2);
  const seconds = Math.ceil(frames.rmsDb.length / perSec);
  const out: number[] = [];
  for (let s = 0; s < seconds; s++) {
    const centre = s * perSec + Math.floor(perSec / 2);
    const window = frames.rmsDb.slice(Math.max(0, centre - half), centre + half).sort((a, b) => a - b);
    out.push(window.length ? window[Math.floor(window.length * FLOOR_PERCENTILE)] : SILENCE_DB);
  }
  return out;
}

/** Parses ffmpeg's ametadata print output into one RMS value per frame slot, placed by pts_time. */
export function parseRmsPrint(text: string, frameSec: number, durationSec: number): number[] {
  const slots = Math.ceil(durationSec / frameSec - 1e-9);
  const out = new Array<number>(slots).fill(SILENCE_DB);
  let slot = -1;
  for (const line of text.split("\n")) {
    const pts = /pts_time:([\d.]+)/.exec(line);
    if (pts) {
      slot = Math.round(Number(pts[1]) / frameSec);
      continue;
    }
    const rms = /RMS_level=(\S+)/.exec(line);
    if (rms && slot >= 0 && slot < slots) {
      const db = Number(rms[1]);
      out[slot] = Number.isFinite(db) ? Math.max(SILENCE_DB, db) : SILENCE_DB;
    }
  }
  return out;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
}

/**
 * The loud stretches in a per-second crowd floor, loudest first. Each second's rise is measured against
 * the median of the minute before it, so a match that gets louder overall does not flood the list. A
 * moment is placed at its roar's onset. Scores are relative to the loudest rise, which scores 1.
 */
export function findPeaks(floor: number[], gapSec = GAP_SEC): Peak[] {
  const duration = floor.length;
  if (duration === 0) return [];
  const overall = median(floor);
  const riseAt = floor.map((db, s) => {
    const before = floor.slice(Math.max(0, s - BASELINE_FROM_SEC), Math.max(0, s - BASELINE_TO_SEC));
    return db - (before.length ? median(before) : overall);
  });
  const rises = riseAt.flatMap((rise, s) => (rise >= MIN_RISE_DB ? [{ s, rise }] : []));
  rises.sort((a, b) => b.rise - a.rise || a.s - b.s);
  const limit = Math.max(MIN_MOMENTS, Math.round(duration / SEC_PER_MOMENT));
  const picked: { s: number; rise: number }[] = [];
  for (const r of rises) {
    if (picked.length >= limit) break;
    if (picked.every((p) => Math.abs(p.s - r.s) >= gapSec)) picked.push(r);
  }
  const top = picked[0]?.rise ?? 1;
  return picked.map(({ s, rise }) => {
    // The loudest second can sit anywhere in a long roar; the play is just before the roar starts.
    let onset = s;
    while (onset > 0 && s - onset < ONSET_MAX_SEC && riseAt[onset - 1] >= rise * ONSET_SHARE) onset -= 1;
    return {
      peak: onset,
      start: Math.max(0, onset - LEAD_SEC),
      end: Math.min(duration, onset + TAIL_SEC),
      score: Math.round((rise / top) * 1000) / 1000,
    };
  });
}

/** A roar has settled once the floor is back below this share of the way from baseline to its peak. */
const SETTLE_SHARE = 0.4;
const SETTLE_MAX_SEC = 60;

/**
 * Seconds after `peak` until the crowd settles: the first of two seconds in a row back under 40% of the
 * way from the minute-before baseline to the roar's loudest. Undefined for no real roar, or one still
 * going at the end of the video or a minute later.
 */
export function settleAfter(floor: number[], peak: number): number | undefined {
  const before = floor.slice(Math.max(0, peak - BASELINE_FROM_SEC), Math.max(0, peak - BASELINE_TO_SEC));
  const baseline = median(before.length ? before : floor);
  const loudest = Math.max(...floor.slice(peak, peak + 11));
  if (!Number.isFinite(loudest) || loudest - baseline < MIN_RISE_DB) return undefined;
  const threshold = baseline + SETTLE_SHARE * (loudest - baseline);
  for (let s = peak + 1; s + 1 < floor.length && s - peak <= SETTLE_MAX_SEC; s++) {
    if (floor[s] < threshold && floor[s + 1] < threshold) return s - peak;
  }
  return undefined;
}

/**
 * The crowd floor to draw on the job page: whole seconds up to `maxPoints`, and past that the loudest
 * second of each bucket, so a roar never drops out of the picture. dB to one decimal.
 */
export function energyCurve(floor: number[], maxPoints = 900): { stepSec: number; db: number[] } {
  const stepSec = Math.max(1, Math.ceil(floor.length / maxPoints));
  const db: number[] = [];
  for (let s = 0; s < floor.length; s += stepSec) db.push(Math.round(Math.max(...floor.slice(s, s + stepSec)) * 10) / 10);
  return { stepSec, db };
}
