import type { MatchAnalysis } from "./types";

// The club check's numbers, read in one place and turned from shares into counts the room can follow.

export type Cutoff = {
  k: number;
  /** Of our top K moments, how many overlap a club clip. */
  hits: number;
  /** The same count expected from same-length picks placed at random in the playing halves. */
  random: number;
  /** The same count expected from picks sampled from the loudest crowd moments. */
  loudCrowd: number;
  /** Share of the stretches the club clipped that the top K cover. */
  recall: number;
  randomRecall: number;
  minutes: number;
};

export type ClubCheck = {
  cutoffs: Cutoff[];
  /** The cut-off the headline uses: K = 10 when measured. */
  head: Cutoff;
  /** Stretches of the match the club clipped, with overlapping club ranges merged. */
  stretches: number;
  overlapMinSec: number;
  clipsOnly: { k: number; hits: number };
  matched: number;
  total: number;
  recall: number;
};

const times = (share: number, k: number) => Math.round(share * k * 10) / 10;

export function clubCheck(e: MatchAnalysis["eval"]): ClubCheck {
  const cutoffs = [...e.atK]
    .sort((a, b) => a.k - b.k)
    .map((r) => ({
      k: r.k,
      hits: Math.round(r.precision * r.k),
      random: times(r.randomPrecision, r.k),
      loudCrowd: times(r.loudCrowdPrecision, r.k),
      recall: r.recall,
      randomRecall: r.randomRecall,
      minutes: r.minutes,
    }));
  const head = cutoffs.find((c) => c.k === 10) ?? cutoffs[0];
  if (!head) throw new Error("The analysis has no ranking cut-offs in eval.atK");
  return {
    cutoffs,
    head,
    stretches: e.mergedRanges,
    overlapMinSec: e.overlapMinSec,
    clipsOnly: { k: e.clipsOnly.k, hits: Math.round(e.clipsOnly.precision * e.clipsOnly.k) },
    matched: e.matched,
    total: e.total,
    recall: e.recall,
  };
}
