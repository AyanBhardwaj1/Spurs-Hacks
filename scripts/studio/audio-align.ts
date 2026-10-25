export type AudioFeatures = { stepSec: number; bands: number; values: number[] };
export type AudioWindow = {
  clipStart: number;
  clipEnd: number;
  offset: number | null;
  score: number;
  secondScore: number;
  ratio: number;
  accepted: boolean;
};
export type AudioSegment = Pick<AudioWindow, "clipStart" | "clipEnd" | "score" | "ratio"> & { offset: number };

/** Normalized cross-correlation of temporal spectral changes. The runner-up excludes the same peak's +/-2 s neighbourhood. */
export function correlate(source: AudioFeatures, query: AudioFeatures) {
  if (source.bands !== query.bands || source.stepSec !== query.stepSec) throw new Error("Audio feature grids differ");
  const width = query.values.length;
  const frames = Math.floor(source.values.length / source.bands);
  const queryFrames = width / source.bands;
  if (!Number.isInteger(queryFrames) || queryFrames < 2 || queryFrames > frames) throw new Error("Audio query must contain 2 or more complete frames and fit the source");
  const energy = new Float64Array(frames + 1);
  for (let t = 0; t < frames; t++) {
    let sum = 0;
    for (let b = 0; b < source.bands; b++) sum += source.values[t * source.bands + b] ** 2;
    energy[t + 1] = energy[t] + sum;
  }
  const q = Float64Array.from(query.values);
  const s = Float64Array.from(source.values);
  const qEnergy = q.reduce((sum, v) => sum + v * v, 0);
  if (qEnergy < 1e-10) return { sourceStart: null, score: 0, secondScore: 0, ratio: 0 };
  const scores = new Float64Array(frames - queryFrames + 1);
  let best = 0;
  for (let t = 0; t < scores.length; t++) {
    const denominator = Math.sqrt(qEnergy * Math.max(0, energy[t + queryFrames] - energy[t]));
    let dot = 0;
    if (denominator > 1e-10) {
      const start = t * source.bands;
      for (let i = 0; i < width; i++) dot += s[start + i] * q[i];
      scores[t] = dot / denominator;
    }
    if (scores[t] > scores[best]) best = t;
  }
  let secondScore = 0;
  for (let t = 0; t < scores.length; t++) {
    if (Math.abs(t - best) * source.stepSec > 2) secondScore = Math.max(secondScore, scores[t]);
  }
  const score = scores[best];
  return { sourceStart: best * source.stepSec, score, secondScore, ratio: score > 0 ? score / Math.max(secondScore, 1e-6) : 0 };
}

/** Merge only overlapping/touching accepted windows with the same source offset; rejected gaps and edits remain separate. */
export function mergeAudioWindows(windows: AudioWindow[], toleranceSec = 0.3): AudioSegment[] {
  const segments: AudioSegment[] = [];
  for (const window of [...windows].sort((a, b) => a.clipStart - b.clipStart)) {
    if (!window.accepted || window.offset === null) continue;
    const last = segments.at(-1);
    if (last && window.clipStart <= last.clipEnd + 1e-6 && Math.abs(window.offset - last.offset) <= toleranceSec) {
      last.clipEnd = Math.max(last.clipEnd, window.clipEnd);
      last.score = Math.min(last.score, window.score);
      last.ratio = Math.min(last.ratio, window.ratio);
    } else {
      segments.push({ clipStart: window.clipStart, clipEnd: window.clipEnd, offset: window.offset, score: window.score, ratio: window.ratio });
    }
  }
  return segments;
}
