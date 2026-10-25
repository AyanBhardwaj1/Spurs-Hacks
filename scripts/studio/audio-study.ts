// Rebuild evidence with STUDIO_CACHE_ONLY=1 bun scripts/studio/audio-study.ts after audio-features.ts has populated the caches.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { alignClip } from "./align";
import { correlate, mergeAudioWindows, type AudioFeatures } from "./audio-align";
import { audioFeatures } from "./audio-features";
import { writeCache } from "./cache";
import { englishSubtitles, getMedia } from "./scoreplay";
import { parseSrt } from "./srt";

// The 259 subtitle checks gave reversed-control maxima of 0.5005 score and 1.464 ratio.
// These gates leave a 0.1495 score margin; they are empirical for this match, not probabilities.
const THRESHOLDS = { minScore: 0.65, minRatio: 1.5 };
const accepted = (score: number, ratio: number) => score >= THRESHOLDS.minScore && ratio >= THRESHOLDS.minRatio;
const rounded = (n: number) => Math.round(n * 1e6) / 1e6;
const SOURCE_ID = 130852725;
const TARGETS = [130852685, 130852721, 130852785, 130852787, 130852791, 130852805];
const CONTROLS = [130852722, 130852723, 130852724, 130852788, 130852789, 130852790, 130852806, 130852807, 130852808, 130852809];

function slice(features: AudioFeatures, start: number, end: number): AudioFeatures {
  return { ...features, values: features.values.slice(Math.round(start / features.stepSec) * features.bands, Math.round(end / features.stepSec) * features.bands) };
}

async function featuresFor(id: number) {
  const media = await getMedia(id);
  if (!media.video?.proxy_medium) throw new Error(`Media ${id} has no proxy_medium`);
  return { media, features: await audioFeatures(id, media.video.proxy_medium) };
}

const { media: sourceMedia, features: source } = await featuresFor(SOURCE_ID);
const srt = await englishSubtitles(sourceMedia);
if (!srt) throw new Error("Match subtitles missing");
const sourceCues = parseSrt(srt);
const rows = [];
for (const id of [...CONTROLS, ...TARGETS]) {
  const { media, features } = await featuresFor(id);
  const subtitleText = CONTROLS.includes(id) ? await englishSubtitles(media) : undefined;
  const spans = subtitleText ? alignClip(sourceCues, parseSrt(subtitleText)) : [];
  const windows = [];
  const end = features.values.length / features.bands * features.stepSec;
  for (let start = 0; start + 4 <= end; start += 2) {
    const query = slice(features, start, start + 4);
    const match = correlate(source, query);
    const expected = spans.find((span) => start >= span.clipStart && start + 4 <= span.clipEnd);
    // Reversing the frame order preserves the spectrum and loudness distribution but destroys the broadcast's timing.
    let nullMatch;
    if (expected) {
      const reversed = [];
      for (let i = query.values.length - query.bands; i >= 0; i -= query.bands) reversed.push(...query.values.slice(i, i + query.bands));
      nullMatch = correlate(source, { ...query, values: reversed });
    }
    windows.push({ clipStart: start, clipEnd: start + 4, offset: match.sourceStart === null ? null : match.sourceStart - start, ...match,
      ...(expected && match.sourceStart !== null ? { subtitleOffset: expected.offset, errorSec: match.sourceStart - start - expected.offset, nullMatch } : {}) });
  }
  rows.push({ scoreplayId: id, name: media.name, durationSec: media.video!.duration, control: CONTROLS.includes(id), windows });
  console.log(`${id}: ${windows.length} windows, ${windows.filter((w) => "subtitleOffset" in w).length} subtitle checks`);
  writeCache("report/audio-study.json", { sourceId: SOURCE_ID, windowSec: 4, hopSec: 2, rows });
}
const checks = rows.filter((row) => row.control).flatMap((row) => row.windows).filter((w) => w.errorSec !== undefined);
const passing = checks.filter((w) => accepted(w.score, w.ratio));
const negatives = checks.flatMap((w) => w.nullMatch ? [w.nullMatch] : []);
if (negatives.some((w) => accepted(w.score, w.ratio))) throw new Error("Audio gate accepts a reversed control; recalibrate before writing ground truth");
if (passing.some((w) => w.errorSec !== undefined && Math.abs(w.errorSec) > 1)) throw new Error("Accepted audio differs from subtitle placement by more than one second");
const validation = rows.filter((row) => row.control).map((row) => {
  const checked = row.windows.filter((w) => w.errorSec !== undefined);
  const passed = checked.filter((w) => accepted(w.score, w.ratio));
  const errors = passed.flatMap((w) => w.errorSec === undefined ? [] : [Math.abs(w.errorSec)]);
  return { scoreplayId: row.scoreplayId, name: row.name, checked: checked.length, accepted: passed.length,
    meanAbsErrorSec: rounded(errors.reduce((a, b) => a + b, 0) / errors.length), maxAbsErrorSec: rounded(Math.max(...errors)),
    recoveredWithinOneSec: checked.filter((w) => w.errorSec !== undefined && Math.abs(w.errorSec) <= 1).length,
    windows: checked.map((w) => ({ clipStart: w.clipStart, clipEnd: w.clipEnd, offset: w.offset,
      subtitleOffset: w.subtitleOffset, errorSec: w.errorSec, score: w.score, ratio: w.ratio, accepted: accepted(w.score, w.ratio) })) };
});
if (validation.some((row) => row.accepted === 0)) throw new Error("Audio gate recovers no validated window for a control clip");
const targets = rows.filter((row) => !row.control).map((row) => {
  const windows = row.windows.map((w) => ({ clipStart: w.clipStart, clipEnd: w.clipEnd,
    offset: w.offset === null ? null : rounded(w.offset), score: w.score, secondScore: w.secondScore, ratio: w.ratio,
    accepted: w.offset !== null && accepted(w.score, w.ratio) }));
  return { scoreplayId: row.scoreplayId, name: row.name, durationSec: row.durationSec, windows, segments: mergeAudioWindows(windows),
    reason: windows.every((w) => w.score === 0) ? "silent audio; no offset" : windows.some((w) => w.accepted) ? "only accepted windows are mapped" : "no window passes the broadcast-audio gate; music, retiming or different audio cannot be located by this method",
    unexaminedTailSec: rounded(Math.max(0, row.durationSec - (windows.at(-1)?.clipEnd ?? 0))) };
});
const report = {
  sourceId: SOURCE_ID,
  method: "8 kHz mono PCM pipe; 2048-sample Hann FFT, 16 log bands from 120 to 3800 Hz, temporal differences at 10 Hz; normalized cross-correlation of 4 s windows every 2 s; runner-up outside +/-2 s of the best peak; no speed warping or extrapolation",
  thresholds: THRESHOLDS,
  thresholdEvidence: { checks: checks.length, accepted: passing.length,
    maxAcceptedAbsErrorSec: rounded(Math.max(...passing.flatMap((w) => w.errorSec === undefined ? [] : [Math.abs(w.errorSec)]))),
    nullControls: negatives.length, nullAccepted: negatives.filter((w) => accepted(w.score, w.ratio)).length,
    maxNullScore: rounded(Math.max(...negatives.map((w) => w.score))), maxNullRatio: rounded(Math.max(...negatives.map((w) => w.ratio))),
    limitation: "Thresholds are checked on this match, not an independent corpus. Overlapping windows are dependent. Subtitle offsets have cue-timing error. Only windows entirely inside a subtitle span are validation checks." },
  validation, targets,
};
const output = join(import.meta.dir, "audio-report.json");
writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
console.table(validation.map((row) => ({ id: row.scoreplayId, checked: row.checked, accepted: row.accepted, meanError: row.meanAbsErrorSec, maxError: row.maxAbsErrorSec })));
console.log(`Wrote ${output}; ${targets.reduce((n, t) => n + t.segments.length, 0)} accepted audio segments`);
