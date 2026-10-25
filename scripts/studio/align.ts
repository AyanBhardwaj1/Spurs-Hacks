import { OVERLAP_MIN_SEC } from "./rank-eval";
import type { Cue } from "./srt";

// Locates a club clip inside the full match by its commentary. The clip's
// subtitles and the match's subtitles are separate speech-to-text passes over
// the same commentary, so wording and spelling drift ("Lammies", "Lamens") and
// cue boundaries differ. Each word trigram the clip shares with the match
// votes for an offset (source time minus clip time); trigrams that agree on
// an offset form one continuous stretch of the source. A single-moment clip
// gives one stretch; a highlights package gives one per cut.

const GRAM = 3;
/** Seconds two votes may differ by and still describe the same cut; cue timings differ by a second or two between transcripts. */
const OFFSET_TOLERANCE = 3;
/** A trigram that recurs more often than this in the match ("it is a") cannot place a clip. */
const MAX_OCCURRENCES = 4;
/** Trigrams that must agree before a stretch counts. Two or three shared trigrams happen by chance in 100 minutes of commentary. */
const MIN_SUPPORT = 4;
/** A gap in clip time this long inside one offset group means two separate cuts that happen to share an offset. */
const MAX_CLIP_GAP = 20;

const FILLERS = new Set(["uh", "um", "er", "erm", "ah", "oh"]);

/** Lowercase ASCII words: accents stripped, apostrophes dropped, fillers removed. */
export function normalise(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !FILLERS.has(word));
}

type TimedWord = { word: string; t: number };

/** Words with a time each, spread evenly across their cue. */
function timedWords(cues: Cue[]): TimedWord[] {
  return cues.flatMap((cue) => {
    const words = normalise(cue.text);
    return words.map((word, i) => ({ word, t: cue.start + ((cue.end - cue.start) * (i + 0.5)) / words.length }));
  });
}

function grams(words: TimedWord[]): { key: string; t: number }[] {
  const out: { key: string; t: number }[] = [];
  for (let i = 0; i + GRAM <= words.length; i++) {
    out.push({
      key: words.slice(i, i + GRAM).map((w) => w.word).join(" "),
      t: (words[i].t + words[i + GRAM - 1].t) / 2,
    });
  }
  return out;
}

export type AlignedSpan = {
  /** Clip seconds covered by the agreeing trigrams. */
  clipStart: number;
  clipEnd: number;
  /** Source second = clip second + offset. */
  offset: number;
  /** Trigrams that agree on this offset. */
  support: number;
  /** Agreeing trigrams over all clip trigrams between clipStart and clipEnd. */
  confidence: number;
};

type Vote = { gram: number; clipT: number; offset: number };

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

/** Every stretch of the source the clip's commentary agrees with, ordered by clip time. */
export function alignClip(source: Cue[], clip: Cue[]): AlignedSpan[] {
  const sourceIndex = new Map<string, number[]>();
  for (const g of grams(timedWords(source))) {
    const times = sourceIndex.get(g.key);
    if (times) times.push(g.t);
    else sourceIndex.set(g.key, [g.t]);
  }

  const clipGrams = grams(timedWords(clip));
  const votes: Vote[] = [];
  clipGrams.forEach((g, gram) => {
    const times = sourceIndex.get(g.key);
    if (!times || times.length > MAX_OCCURRENCES) return;
    for (const t of times) votes.push({ gram, clipT: g.t, offset: t - g.t });
  });

  // Chain votes whose offsets sit within the tolerance of their neighbour.
  votes.sort((a, b) => a.offset - b.offset);
  const groups: Vote[][] = [];
  for (const vote of votes) {
    const last = groups.at(-1);
    if (last && vote.offset - last.at(-1)!.offset <= OFFSET_TOLERANCE) last.push(vote);
    else groups.push([vote]);
  }

  // A trigram that found several places in the match keeps only its vote in the best-supported group.
  const supportOf = (group: Vote[]) => new Set(group.map((v) => v.gram)).size;
  const ranked = groups.map((group) => ({ group, support: supportOf(group) })).sort((a, b) => b.support - a.support);
  const claimed = new Set<number>();
  const spans: AlignedSpan[] = [];
  for (const { group } of ranked) {
    const own = group.filter((v) => !claimed.has(v.gram));
    for (const part of splitByClipGap(own)) {
      const gramsInPart = new Set(part.map((v) => v.gram));
      if (gramsInPart.size < MIN_SUPPORT) continue;
      gramsInPart.forEach((g) => claimed.add(g));
      const clipStart = Math.min(...part.map((v) => v.clipT));
      const clipEnd = Math.max(...part.map((v) => v.clipT));
      const inRange = clipGrams.filter((g) => g.t >= clipStart && g.t <= clipEnd).length;
      spans.push({
        clipStart,
        clipEnd,
        offset: median(part.map((v) => v.offset)),
        support: gramsInPart.size,
        confidence: gramsInPart.size / inRange,
      });
    }
  }
  return spans.sort((a, b) => a.clipStart - b.clipStart);
}

function splitByClipGap(votes: Vote[]): Vote[][] {
  const sorted = [...votes].sort((a, b) => a.clipT - b.clipT);
  const parts: Vote[][] = [];
  for (const vote of sorted) {
    const last = parts.at(-1);
    if (last && vote.clipT - last.at(-1)!.clipT <= MAX_CLIP_GAP) last.push(vote);
    else parts.push([vote]);
  }
  return parts;
}

/** Share of the clip's trigrams that the given spans account for. */
export function coverage(clip: Cue[], spans: AlignedSpan[]): number {
  const total = grams(timedWords(clip)).length;
  return total ? spans.reduce((sum, s) => sum + s.support, 0) / total : 0;
}

type Range = { start: number; end: number };

function overlapSec(a: Range, b: Range): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

/** The moment that overlaps the range the longest; ties go to the moment whose peak is nearest the range's middle. */
export function bestOverlap<M extends Range & { id: string; peak: number }>(range: Range, moments: M[]): M | undefined {
  const middle = (range.start + range.end) / 2;
  let best: { moment: M; overlap: number } | undefined;
  for (const moment of moments) {
    const overlap = overlapSec(range, moment);
    if (overlap < OVERLAP_MIN_SEC) continue;
    if (
      !best ||
      overlap > best.overlap ||
      (overlap === best.overlap && Math.abs(moment.peak - middle) < Math.abs(best.moment.peak - middle))
    ) {
      best = { moment, overlap };
    }
  }
  return best?.moment;
}
