import type { MatchLogEvent, MatchTime } from "./types";

// The match log gives each event a UTC wallclock. The broadcast asset only
// has offsets from its first frame, and nobody tells us when that was. Goals
// are easy for Marengo to find, so we try goal hits as anchors and keep the
// shifts that line up the most goals. Each half gets its own shift, since a
// full-match recording often drops some or all of the half-time break, but a
// half can never start before the previous one has ended.

/** How close a predicted offset has to land to a hit to count as a match. */
const TOLERANCE = 45;
/** Slack for a recording that starts a little before the first logged event. */
const LEAD_IN = 60;

export type GoalHit = { start: number; strength: number };

export type Alignment = {
  /** Broadcast offset of an event = seconds since its period's first event + shift. */
  shiftByPeriod: Record<number, number>;
  /** Logged goals that landed within tolerance of a goal hit. */
  matched: number;
};

type Period = { period: number; start: number; length: number; goals: number[] };

type Score = { matched: number; strength: number; error: number };
type Plan = Score & { shifts: Record<number, number> };

const toSeconds = (wallclock: string) => Date.parse(wallclock) / 1000;

const better = (a: Score, b: Score | undefined) =>
  !b || a.matched > b.matched || (a.matched === b.matched && (a.strength > b.strength || (a.strength === b.strength && a.error < b.error)));

function periodsOf(events: MatchLogEvent[]): Period[] {
  const numbers = [...new Set(events.map((e) => e.period))].sort((a, b) => a - b);
  return numbers.map((period) => {
    const times = events.filter((e) => e.period === period).map((e) => toSeconds(e.wallclock));
    const start = Math.min(...times);
    return {
      period,
      start,
      length: Math.max(...times) - start,
      goals: events.filter((e) => e.period === period && e.kind === "goal").map((e) => toSeconds(e.wallclock) - start),
    };
  });
}

function scoreShift(goals: number[], hits: GoalHit[], shift: number): Score {
  const score = { matched: 0, strength: 0, error: 0 };
  for (const g of goals) {
    let nearest: GoalHit | undefined;
    for (const h of hits) if (!nearest || Math.abs(h.start - (g + shift)) < Math.abs(nearest.start - (g + shift))) nearest = h;
    const miss = nearest ? Math.abs(nearest.start - (g + shift)) : Infinity;
    if (nearest && miss <= TOLERANCE) {
      score.matched++;
      score.strength += nearest.strength;
      score.error += miss;
    }
  }
  return score;
}

/**
 * Tries every goal hit as an anchor for each period, keeping the periods in
 * order, and returns the plan that lines up the most goals.
 */
function search(periods: Period[], hits: GoalHit[], i: number, earliest: number, latest: (p: Period) => number): Plan {
  if (i === periods.length) return { shifts: {}, matched: 0, strength: 0, error: 0 };
  const p = periods[i];
  const hi = latest(p);
  // Leave this period unanchored: the next one may start once this one could have ended.
  let best: Plan = search(periods, hits, i + 1, earliest + p.length, latest);
  const shifts = new Set(p.goals.flatMap((g) => hits.map((h) => h.start - g)));
  for (const shift of shifts) {
    if (shift < earliest || shift > hi) continue;
    const here = scoreShift(p.goals, hits, shift);
    if (here.matched === 0) continue;
    const rest = search(periods, hits, i + 1, shift + p.length, (q) => shift + (q.start - p.start) + LEAD_IN);
    const plan = {
      shifts: { ...rest.shifts, [p.period]: shift },
      matched: here.matched + rest.matched,
      strength: here.strength + rest.strength,
      error: here.error + rest.error,
    };
    if (better(plan, best)) best = plan;
  }
  return best;
}

/**
 * Works out where each period of the match log sits in the broadcast.
 * `goalHits` are Marengo goal hits on that broadcast. Returns undefined when
 * no logged goal could be lined up with a hit.
 */
export function alignMatchLog(events: MatchLogEvent[], goalHits: GoalHit[]): Alignment | undefined {
  const periods = periodsOf(events);
  const plan = search(periods, goalHits, 0, -LEAD_IN, () => Infinity);
  if (plan.matched === 0) return undefined;

  // A period with no anchor borrows the nearest anchored one and assumes the
  // recording ran straight through between them.
  const shiftByPeriod = { ...plan.shifts };
  const anchored = periods.filter((p) => p.period in plan.shifts);
  for (const p of periods) {
    if (p.period in shiftByPeriod) continue;
    const ref = anchored.reduce((a, b) => (Math.abs(b.start - p.start) < Math.abs(a.start - p.start) ? b : a));
    shiftByPeriod[p.period] = plan.shifts[ref.period] + (p.start - ref.start);
  }
  return { shiftByPeriod, matched: plan.matched };
}

/** Where an event should be in the broadcast, or undefined if its period is not in the log. */
export function broadcastOffset(events: MatchLogEvent[], alignment: Alignment, event: MatchLogEvent) {
  const shift = alignment.shiftByPeriod[event.period];
  const period = periodsOf(events).find((p) => p.period === event.period);
  if (shift === undefined || !period) return undefined;
  return toSeconds(event.wallclock) - period.start + shift;
}

/** Where each period sits on the match clock: 45-minute halves, then 15-minute periods of extra time. */
const CLOCK: Record<number, { base: number; length: number }> = {
  1: { base: 0, length: 45 },
  2: { base: 45, length: 45 },
  3: { base: 90, length: 15 },
  4: { base: 105, length: 15 },
};

/** Slack after a period's last logged event, for play that runs on past it. */
const RUN_ON = 60;

/**
 * The inverse of `broadcastOffset`: the match time of a point in the
 * broadcast, or undefined when it falls outside every period, such as
 * before kickoff or during the half-time break.
 */
export function matchTimeAt(events: MatchLogEvent[], alignment: Alignment, offset: number): MatchTime | undefined {
  for (const p of periodsOf(events)) {
    const shift = alignment.shiftByPeriod[p.period];
    const clock = CLOCK[p.period];
    if (shift === undefined || !clock) continue;
    const elapsed = offset - shift;
    if (elapsed < 0 || elapsed > p.length + RUN_ON) continue;
    // A broadcast shows 18' from 17:00 to 17:59 into the half.
    const played = Math.floor(elapsed / 60) + 1;
    return {
      wallclock: new Date((p.start + elapsed) * 1000).toISOString(),
      period: p.period,
      minute: clock.base + Math.min(played, clock.length),
      stoppage: Math.max(0, played - clock.length),
    };
  }
  return undefined;
}
