import type { GroundTruthClip, MatchAnalysis, Moment } from "../../src/lib/studio/types";
import { alignClip, bestOverlap, coverage } from "./align";
import { mergeAudioWindows } from "./audio-align";
import audioReport from "./audio-report.json";
import type { ClockAnchors } from "./clock";
import { clipsOnlyAtK, mergeRanges, OVERLAP_MIN_SEC, rankingAtK } from "./rank-eval";
import { englishSubtitles, getMedia, searchEventMedia } from "./scoreplay";
import { parseSrt, type Cue } from "./srt";

// The club's social team published clips cut from this match. Locating them
// in the source by their commentary gives an independent check on which
// moments matter: a moment the club clipped should be one the studio found.

/** ScorePlay events holding the club's published clips from this match. */
const GROUND_TRUTH_EVENTS = [1536139, 1536140, 1536142, 1536143];

/** Highlights packages: several cuts of the match in one file, located cut by cut. 130852721 is a single action clip. */
const PACKAGES = new Set([130852722, 130852723, 130852724]);

/** Items in those events that are not cut from the match broadcast, with what they are. */
const NOT_MATCH_FOOTAGE: Record<number, string> = {
  130852684: "fans b-roll",
  130852686: "De Zerbi press conference",
  130852687: "phone video message to fans",
  130852688: "Solanke post-match interview",
  130852786: "Solanke post-match interview",
  130852804: "De Zerbi post-match interview",
};
const SLIDE = /^Slide \d+/;

/** Share of a clip's trigrams that must land in the match before the clip counts as aligned. */
const MIN_COVERAGE = 0.3;

export type AlignmentRow = {
  scoreplayId: number;
  name: string;
  status: "aligned" | "skipped" | "unaligned";
  detail: string;
};

const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
const r1 = (x: number) => Math.round(x * 10) / 10;

export async function alignGroundTruth(sourceCues: Cue[], durationSec: number) {
  const clamp = (t: number) => Math.min(durationSec, Math.max(0, t));
  const media = await searchEventMedia(GROUND_TRUTH_EVENTS);
  const clips: GroundTruthClip[] = [];
  const rows: AlignmentRow[] = [];

  for (const item of [...media].sort((a, b) => a.ID - b.ID)) {
    const row = (status: AlignmentRow["status"], detail: string) => rows.push({ scoreplayId: item.ID, name: item.name, status, detail });
    if (SLIDE.test(item.name)) {
      row("skipped", "matchday slide (b-roll)");
      continue;
    }
    if (NOT_MATCH_FOOTAGE[item.ID]) {
      row("skipped", NOT_MATCH_FOOTAGE[item.ID]);
      continue;
    }
    const detail = await getMedia(item.ID);
    const srt = await englishSubtitles(detail);
    if (!srt) {
      const audio = audioReport.targets.find((target) => target.scoreplayId === item.ID);
      if (!audio) {
        row("unaligned", "no subtitles or measured audio windows");
        continue;
      }
      const windows = audio.windows.map((window) => ({ ...window,
        accepted: window.offset !== null && window.score >= audioReport.thresholds.minScore && window.ratio >= audioReport.thresholds.minRatio,
      }));
      const segments = mergeAudioWindows(windows);
      for (const segment of segments) {
        const start = clamp(segment.clipStart + segment.offset);
        const end = clamp(segment.clipEnd + segment.offset);
        if (end <= start) continue;
        clips.push({ scoreplayId: item.ID, name: `${item.name} · audio cut at ${mmss(segment.clipStart)}`,
          start: r1(start), end: r1(end), alignedBy: "audio",
          // NCC is bounded by 1; the unbounded peak/runner-up ratio stays in audio-report.json.
          confidence: Math.round(Math.min(1, segment.score) * 100) / 100,
        });
      }
      row(segments.length ? "aligned" : "unaligned", `audio: ${windows.filter((w) => w.accepted).length}/${windows.length} windows accepted; ${segments.length} cuts; ${audio.reason}`);
      continue;
    }
    const clipCues = parseSrt(srt);
    const spans = alignClip(sourceCues, clipCues);
    const covered = coverage(clipCues, spans);
    if (spans.length === 0 || covered < MIN_COVERAGE) {
      row("unaligned", `subtitles not found in the match commentary (coverage ${covered.toFixed(2)})`);
      continue;
    }

    if (PACKAGES.has(item.ID)) {
      for (const span of spans) {
        const start = clamp(span.clipStart + span.offset);
        const end = clamp(span.clipEnd + span.offset);
        if (end <= start) continue;
        clips.push({
          scoreplayId: item.ID,
          name: `${item.name} · cut at ${mmss(span.clipStart)}`,
          start: r1(start),
          end: r1(end),
          alignedBy: "subtitles",
          confidence: Math.round(span.confidence * 100) / 100,
        });
      }
      row("aligned", `${spans.length} cuts, coverage ${covered.toFixed(2)}`);
    } else {
      // A single-moment clip is one continuous cut, so its whole length maps through the best-supported offset.
      const best = spans.reduce((a, b) => (b.support > a.support ? b : a));
      const length = detail.video?.duration ?? clipCues.at(-1)!.end;
      const confidence = coverage(clipCues, [best]);
      clips.push({
        scoreplayId: item.ID,
        name: item.name,
        start: r1(clamp(best.offset)),
        end: r1(clamp(best.offset + length)),
        alignedBy: "subtitles",
        confidence: Math.round(confidence * 100) / 100,
      });
      row("aligned", `offset ${best.offset.toFixed(1)} s, ${best.support} trigrams agree, coverage ${confidence.toFixed(2)}`);
    }
  }
  return { clips, rows, candidates: media.length };
}

/** Cut-offs for ranking precision and recall. */
const RANK_KS = [5, 10, 15, 20];
const RANDOM_TRIALS = 2000;
const RANDOM_SEED = 20261022;

/** Links each ground-truth clip to the moment it overlaps most, scores recall, and measures the ranking at cut-offs. */
export function evaluate(groundTruth: GroundTruthClip[], moments: Moment[], context: { anchors: ClockAnchors; crowd: NonNullable<MatchAnalysis["crowd"]> }) {
  const linked = groundTruth.map((gt) => {
    const reference = { ...gt };
    delete reference.matchedMomentId;
    const moment = bestOverlap(reference, moments);
    return moment ? { ...reference, matchedMomentId: moment.id } : reference;
  });
  const matched = linked.filter((gt) => gt.matchedMomentId).length;
  // The three highlights packages and the single clips repeat the same moments; merging overlaps counts each once.
  const ranges = mergeRanges(groundTruth);
  const { anchors, crowd } = context;
  const ranked = moments.map((m) => ({ start: m.start, end: m.end, peak: m.peak, score: m.scores.total }));
  const atK = rankingAtK({
    moments: ranked,
    references: groundTruth,
    ks: RANK_KS,
    halves: [{ start: anchors.firstHalfKickoff, end: anchors.halfTime }, { start: anchors.secondHalfKickoff, end: anchors.fullTime }],
    crowd,
    trials: RANDOM_TRIALS,
    seed: RANDOM_SEED,
  });
  return {
    groundTruth: linked,
    eval: {
      matched,
      total: linked.length,
      recall: linked.length ? Math.round((matched / linked.length) * 1000) / 1000 : 0,
      mergedRanges: ranges.length,
      overlapMinSec: OVERLAP_MIN_SEC,
      clipsOnly: clipsOnlyAtK(ranked, groundTruth),
      atK,
    },
  };
}
