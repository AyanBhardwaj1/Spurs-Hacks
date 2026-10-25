import type { Moment, MomentKind } from "../../src/lib/studio/types";

// Every number in this file is hand-set from football sense and one look at
// this match. No calibration run exists: nothing has been fitted to the club's
// clips or to engagement data. The ground-truth recall in the output is the
// only check, and it tests which moments are found, not how they rank.

/** How the parts add up to `total`. */
const WEIGHTS = { importance: 0.45, emotion: 0.25, crowd: 0.2, social: 0.1 } as const;

/** What each kind of moment is worth before match state is considered. */
const KIND_BASE: Record<MomentKind, number> = {
  goal: 1,
  "disallowed-goal": 0.7,
  chance: 0.55,
  save: 0.5,
  card: 0.35,
  skill: 0.35,
  tackle: 0.35,
  celebration: 0.4,
  kickoff: 0.25,
  "full-time": 0.5,
  other: 0.2,
};
const RED_CARD_BASE = 0.85;

/** Added for a goal that changes who leads or levels the game, and for a red card. */
const SWING_BONUS = 0.15;
/** The studio cuts for Tottenham's channels, so the opponent's moments count for less. */
const TEAM_FACTOR: Record<Moment["team"], number> = { spurs: 1, neutral: 0.9, opponent: 0.85 };

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const round3 = (x: number) => Math.round(x * 1000) / 1000;

export function importance(input: {
  kind: MomentKind;
  red: boolean;
  /** Minutes of play, 0 to 90. */
  minute: number;
  /** The goal levelled the game or put the scorer's side ahead. */
  swing: boolean;
  team: Moment["team"];
}): number {
  const base = input.kind === "card" && input.red ? RED_CARD_BASE : KIND_BASE[input.kind];
  const late = 0.75 + 0.25 * (input.minute / 90);
  const bonus = input.swing || (input.kind === "card" && input.red) ? SWING_BONUS : 0;
  return round3(clamp01(base * late + bonus) * TEAM_FACTOR[input.team]);
}

/**
 * `louderThan` is the share of the match's seconds whose crowd rise is smaller
 * than the moment's. A rise no bigger than the median second scores 0, and the
 * biggest rise in the match scores 1: commentary and crowd share one mono mix,
 * so half the match shows some rise by chance.
 */
export function crowdScore(louderThan: number): number {
  return round3(clamp01((louderThan - 0.5) / 0.5));
}

/**
 * Social traction for a moment. Always 0 for now: this is where X API counts
 * (posts, quotes, views around the moment's time) would come in.
 */
export function socialScore(): number {
  return 0;
}

/**
 * What a visual confirmation from Twelve Labs adds to `total`: nothing, so
 * Twelve Labs hits show up only as evidence. A bonus of up to 0.03 was tried.
 * It was hand-set with no calibration run, and on this match it lowered
 * ranking precision at K=15 (0.80 to 0.733) and K=20 (0.75 to 0.70) against
 * the club's clips, swapping clipped moments out for near-ties that were not
 * clipped. Raise it only with a calibration run that shows it helps.
 */
export const VISUAL_BONUS = 0;

/**
 * The ranking score. `visual` is the strongest Twelve Labs confirmation (0 to
 * 1); it is not one of the contract's score parts, so it shows up in a
 * moment's evidence rather than in `scores`.
 */
export function total(scores: Omit<Moment["scores"], "total">, visual = 0): number {
  return round3(
    Math.min(
      1,
      WEIGHTS.importance * scores.importance +
        WEIGHTS.emotion * scores.emotion +
        WEIGHTS.crowd * scores.crowd +
        WEIGHTS.social * scores.social +
        VISUAL_BONUS * visual,
    ),
  );
}
