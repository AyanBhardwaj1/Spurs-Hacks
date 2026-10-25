import type { Evidence, Moment, MomentKind, Player } from "../../src/lib/studio/types";
import { normalise } from "./align";
import { askClaude, mapLimit } from "./claude";
import { matchClock, matchMinute, type ClockAnchors } from "./clock";
import { crowdScore, importance, round3, socialScore, total } from "./scores";
import type { Cue } from "./srt";

// Moments come from the commentary: Claude reads the timed subtitles in
// overlapping windows and lists what happens, quoting the lines it relied on.
// Code then checks every quote against the transcript, merges the copies that
// overlapping windows produce, and uses the crowd's noise floor to set where
// each moment starts and ends.

const KINDS: MomentKind[] = [
  "goal", "disallowed-goal", "chance", "save", "card", "skill", "tackle", "celebration", "kickoff", "full-time", "other",
];
/** When copies of one moment disagree on kind, the earlier kind in this list wins. */
const KIND_PRIORITY: MomentKind[] = [
  "goal", "disallowed-goal", "card", "chance", "save", "tackle", "skill", "celebration", "kickoff", "full-time", "other",
];

/**
 * Claude reports on ten-minute windows that do not overlap, so no stretch is
 * reported twice. Each window also shows the three minutes before it, read
 * only, because commentators discuss a red card or a goal for minutes
 * afterwards and a window that starts mid-discussion would report it as new;
 * and one minute after it, so a move that crosses the edge reads whole.
 */
const WINDOW_SEC = 600;
const CONTEXT_BEFORE_SEC = 180;
const CONTEXT_AFTER_SEC = 60;
const CONCURRENCY = 5;

export type RawEvent = {
  kind: MomentKind;
  peakSec: number;
  buildUpSec: number;
  players: { name: string; rosterId: number }[];
  team: Moment["team"];
  card: "red" | "yellow" | "none";
  intensity: number;
  title: string;
  summary: string;
  quotes: { at: number; text: string }[];
};

const EVENT_SCHEMA = {
  type: "object",
  properties: {
    events: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: KINDS },
          peakSec: { type: "number" },
          buildUpSec: { type: "number" },
          players: {
            type: "array",
            items: {
              type: "object",
              properties: { name: { type: "string" }, rosterId: { type: "integer" } },
              required: ["name", "rosterId"],
            },
          },
          team: { type: "string", enum: ["spurs", "opponent", "neutral"] },
          card: { type: "string", enum: ["red", "yellow", "none"] },
          intensity: { type: "number", minimum: 0, maximum: 1 },
          title: { type: "string" },
          summary: { type: "string" },
          quotes: {
            type: "array",
            items: {
              type: "object",
              properties: { at: { type: "number" }, text: { type: "string" } },
              required: ["at", "text"],
            },
          },
        },
        required: ["kind", "peakSec", "buildUpSec", "players", "team", "card", "intensity", "title", "summary", "quotes"],
      },
    },
  },
  required: ["events"],
};

const MATCH_CONTEXT = `The recording is Manchester United v Tottenham Hotspur, Premier League 2026-27, at Old Trafford. Tottenham ("Spurs") are the away side and the club you work for. The commentary is English TV commentary, transcribed by machine: lines are "[seconds] text", where seconds count from the first frame of the recording, and player names are often misspelt (for example "Berry Val" or "Berival" for Bergvall, "Lammies" for United's goalkeeper Lammens).`;

function extractionSystem(roster: Player[]): string {
  return `${MATCH_CONTEXT}

You list the match events in one excerpt of that commentary for Tottenham's social media team, who cut clips from them.

Rules:
- Report only what the commentary says is happening live in this excerpt. Leave out anything the commentators recall from earlier in the match, from other matches, or preview. A replay of an earlier event is not a new event.
- Every event needs at least one quote: a line copied exactly from the excerpt, with its seconds, that shows it happened. If no line supports it, leave it out.
- You get the excerpt to report on, plus the commentary just before and just after it for context. Report only events whose decisive line is inside the excerpt. Events in the earlier context have already been reported; when the excerpt discusses or replays one of them, it is not a new event.
- kind: goal, disallowed-goal (the ball goes in but it does not count), chance (a shot or a clear opening), save, card, skill, tackle, celebration, kickoff (first or second half), full-time, other (half-time whistle, VAR check, notable injury or substitution).
- peakSec: the seconds of the line where the decisive action happens: the shot, the save, the tackle, the card being shown, the whistle. Use a line's own seconds.
- buildUpSec: the seconds of the first line describing the move or incident that leads to it; equal to peakSec when there is none.
- players: everyone the event involves. rosterId is the ID from the Tottenham list below when the person is on it (match misspellings by sense), otherwise 0; give United players their correctly spelt name with rosterId 0.
- team: the side of the player at the centre of the event (the scorer, the shooter, the player booked, the tackler); neutral for officials and whistles.
- card: red or yellow for card events, otherwise none.
- intensity: how excited the commentary is, 0 to 1: 0.2 routine description, 0.5 animated, 0.8 shouting or exclamations, 1 the biggest call of the match.
- title: a headline of at most 60 characters in the present tense, such as "Solanke heads in a late equaliser".
- summary: one or two sentences on what happens, using only what the commentary says.

Tottenham people (ID, caption name, full name):
${roster.map((p) => `${p.id} ${p.shortName} (${p.name})`).join("\n")}`;
}

function transcriptLines(cues: Cue[]): string {
  return cues.map((c) => `[${c.start.toFixed(1)}] ${c.text}`).join("\n");
}

type Window = { from: number; to: number; before: Cue[]; report: Cue[]; after: Cue[] };

function windows(cues: Cue[]): Window[] {
  const last = cues.at(-1)?.start ?? 0;
  const out: Window[] = [];
  for (let from = 0; from <= last; from += WINDOW_SEC) {
    const to = from + WINDOW_SEC;
    const report = cues.filter((c) => c.start >= from && c.start < to);
    if (report.length === 0) continue;
    out.push({
      from,
      to,
      before: cues.filter((c) => c.start >= from - CONTEXT_BEFORE_SEC && c.start < from),
      report,
      after: cues.filter((c) => c.start >= to && c.start < to + CONTEXT_AFTER_SEC),
    });
  }
  return out;
}

function windowPrompt(w: Window, i: number, count: number): string {
  const part = (title: string, lines: Cue[]) => (lines.length ? `${title}\n${transcriptLines(lines)}\n\n` : "");
  return (
    part("Earlier commentary, for context only (already reported):", w.before) +
    part(`Excerpt ${i + 1} of ${count}, from ${w.from} s to ${w.to} s. Report the events in this part:`, w.report) +
    part("Later commentary, for context only (reported separately):", w.after)
  ).trim();
}

export async function extractEvents(cues: Cue[], roster: Player[]) {
  const system = extractionSystem(roster);
  const all = windows(cues);
  const results = await mapLimit(all, CONCURRENCY, (w, i) =>
    askClaude<{ events: RawEvent[] }>({
      name: `events-${String(i).padStart(2, "0")}`,
      system,
      prompt: windowPrompt(w, i, all.length),
      schema: EVENT_SCHEMA,
    }),
  );
  // An event belongs to the window whose own range holds its peak; one placed in a context stretch is dropped.
  const events: RawEvent[] = [];
  const outside: RawEvent[] = [];
  results.forEach((r, i) => {
    for (const e of r.value.events) (e.peakSec >= all[i].from && e.peakSec < all[i].to ? events : outside).push(e);
  });
  return { chunks: all.length, events, outside };
}

const ANCHOR_SCHEMA = {
  type: "object",
  properties: Object.fromEntries(
    ["firstHalfKickoff", "halfTime", "secondHalfKickoff", "fullTime"].map((k) => [
      k,
      { type: "object", properties: { sec: { type: "number" }, line: { type: "string" } }, required: ["sec", "line"] },
    ]),
  ),
  required: ["firstHalfKickoff", "halfTime", "secondHalfKickoff", "fullTime"],
};

type AnchorAnswer = Record<keyof ClockAnchors, { sec: number; line: string }>;

/** Asks Claude where the four whistles fall, from the whole transcript, and checks they are in order. */
export async function findClockAnchors(cues: Cue[]) {
  const { value, durationMs } = await askClaude<AnchorAnswer>({
    name: "clock-anchors",
    system: `${MATCH_CONTEXT}

You find when the four whistles happen in the recording: first-half kickoff, half-time, second-half kickoff and full-time. The recording includes pre-match and half-time studio talk. Commentators rarely say "kick-off"; the first line describing live play after the line-ups, and remarks such as "seven minutes in", "first half added time" or "eight minutes of added time", place the whistles. For each, give the seconds of the line closest to the whistle and copy that line exactly.`,
    prompt: transcriptLines(cues),
    schema: ANCHOR_SCHEMA,
  });
  const anchors: ClockAnchors = {
    firstHalfKickoff: value.firstHalfKickoff.sec,
    halfTime: value.halfTime.sec,
    secondHalfKickoff: value.secondHalfKickoff.sec,
    fullTime: value.fullTime.sec,
  };
  const order = [anchors.firstHalfKickoff, anchors.halfTime, anchors.secondHalfKickoff, anchors.fullTime];
  if (order.some((t, i) => i > 0 && t <= order[i - 1])) throw new Error(`Clock anchors out of order: ${JSON.stringify(value)}`);
  return { anchors, evidence: value, durationMs };
}

/** True when most of the quote's words appear in the transcript lines within 5 s of where it claims to be. */
function quoteIsReal(quote: { at: number; text: string }, cues: Cue[]): boolean {
  const words = normalise(quote.text);
  if (words.length === 0) return false;
  const nearby = new Set(cues.filter((c) => Math.abs(c.start - quote.at) <= 5).flatMap((c) => normalise(c.text)));
  return words.filter((w) => nearby.has(w)).length / words.length >= 0.8;
}

export type Rejected = { event: RawEvent; reason: string };

/** Drops events whose quotes are not in the transcript, snaps peaks to a real line, and drops unknown roster IDs. */
export function checkEvents(events: RawEvent[], cues: Cue[], roster: Player[]): { kept: RawEvent[]; rejected: Rejected[] } {
  const ids = new Set(roster.map((p) => p.id));
  const kept: RawEvent[] = [];
  const rejected: Rejected[] = [];
  for (const event of events) {
    const quotes = event.quotes.filter((q) => quoteIsReal(q, cues));
    if (quotes.length === 0) {
      rejected.push({ event, reason: "no quote found in the transcript" });
      continue;
    }
    const nearest = cues.reduce((a, b) => (Math.abs(b.start - event.peakSec) < Math.abs(a.start - event.peakSec) ? b : a));
    if (Math.abs(nearest.start - event.peakSec) > 3) {
      rejected.push({ event, reason: `peak ${event.peakSec} is not on a commentary line` });
      continue;
    }
    kept.push({
      ...event,
      peakSec: nearest.start,
      buildUpSec: Math.min(event.buildUpSec, nearest.start),
      quotes,
      players: event.players.map((p) => (ids.has(p.rosterId) ? p : { ...p, rosterId: 0 })),
    });
  }
  return { kept, rejected };
}

/** Goals and cards happen once per player in a passage of play, so a second report minutes later is the same event. */
const RARE = new Set<MomentKind>(["goal", "disallowed-goal", "card"]);
/** Commentators discuss a red card or goal for a minute or two after it; a window that starts mid-discussion reports it again. */
const RARE_SAME_EVENT_SEC = 150;

const playerKeys = (e: RawEvent) => new Set(e.players.map((p) => (p.rosterId ? `id:${p.rosterId}` : `name:${p.name.toLowerCase()}`)));
const sharePlayer = (a: RawEvent, b: RawEvent) => {
  const keys = playerKeys(a);
  return [...playerKeys(b)].some((k) => keys.has(k));
};

function sameMoment(a: RawEvent, b: RawEvent): boolean {
  const gap = Math.abs(a.peakSec - b.peakSec);
  if (a.kind === b.kind) return gap <= 25 || (RARE.has(a.kind) && gap <= RARE_SAME_EVENT_SEC && sharePlayer(a, b));
  const kinds = new Set([a.kind, b.kind]);
  if (kinds.has("kickoff") || kinds.has("full-time")) return false;
  const rare = RARE.has(a.kind) ? a : RARE.has(b.kind) ? b : undefined;
  const other = rare === a ? b : a;
  // The VAR check before a red card, or the celebration after a goal, belongs to it.
  if (rare && (other.kind === "other" || other.kind === "celebration") && gap <= 45) {
    return other.players.length === 0 || sharePlayer(rare, other);
  }
  return gap <= 10;
}

const rank = (e: RawEvent) => KIND_PRIORITY.indexOf(e.kind) * 10 - e.intensity - (e.card === "red" ? 1 : 0);
const leadOf = (group: RawEvent[]) => [...group].sort((a, b) => rank(a) - rank(b))[0];

/** Folds the copies that overlapping windows produce, and actions reported twice under different kinds, into one event each. */
export function mergeEvents(events: RawEvent[], onMerged?: (event: RawEvent, lead: RawEvent) => void): RawEvent[] {
  const sorted = [...events].sort((a, b) => a.peakSec - b.peakSec);
  const groups: RawEvent[][] = [];
  for (const event of sorted) {
    // Compare with each group's lead (its kind and peak, with everyone the group names), not with every member,
    // so a run of chances 20 s apart does not chain into one moment.
    const group = groups.find((g) => sameMoment({ ...leadOf(g), players: g.flatMap((e) => e.players) }, event));
    if (group) group.push(event);
    else groups.push([event]);
  }
  return groups.map((group) => {
    const lead = leadOf(group);
    for (const event of group) if (event !== lead) onMerged?.(event, lead);
    const players = new Map<string, RawEvent["players"][number]>();
    for (const p of group.flatMap((e) => e.players)) players.set(p.rosterId ? `id:${p.rosterId}` : `name:${p.name}`, p);
    const quotes = new Map<number, RawEvent["quotes"][number]>();
    for (const q of group.flatMap((e) => e.quotes)) quotes.set(q.at, q);
    return {
      ...lead,
      buildUpSec: Math.min(...group.map((e) => e.buildUpSec)),
      intensity: Math.max(...group.map((e) => e.intensity)),
      card: group.some((e) => e.card === "red") ? "red" : lead.card,
      players: [...players.values()],
      quotes: [...quotes.values()].sort((a, b) => a.at - b.at),
    };
  });
}

// How far each moment reaches either side of its peak, in seconds.
const PRE_ROLL: Partial<Record<MomentKind, number>> = { goal: 15, "disallowed-goal": 12, card: 12, kickoff: 3, "full-time": 5 };
const MIN_POST: Partial<Record<MomentKind, number>> = { goal: 20, "disallowed-goal": 12, kickoff: 10, "full-time": 15 };
/** A card can come a minute or more after the foul when VAR reviews it; the Bentancur red came 65 s after his tackle. */
const MAX_PRE: Partial<Record<MomentKind, number>> = { card: 80 };
const DEFAULT_MAX_PRE = 40;
const MAX_POST = 35;
/** The reaction is over when the crowd floor is back within this many dB of the build-up. */
const SETTLED_DB = 2;
/** The crowd before a moment: seconds before its start. */
const BASELINE = { from: 75, to: 5 };
/** The crowd's reaction: seconds around the peak, and after the build-up starts. */
const REACTION = { before: 8, after: 15 };
/** Pre-roll assumed when ranking a moment's rise against every second of the match. */
const TYPICAL_PRE_ROLL = 15;

const smooth = (series: number[], radius: number) =>
  series.map((_, i) => {
    const w = series.slice(Math.max(0, i - radius), i + radius + 1);
    return w.reduce((a, b) => a + b, 0) / w.length;
  });

const quantile = (values: number[], q: number) => {
  const s = [...values].sort((a, b) => a - b);
  return s[Math.floor((s.length - 1) * q)];
};

/** Turns checked events into moments: crowd-fused bounds, match clock, player IDs, evidence and scores. */
export function buildMoments(input: {
  events: RawEvent[];
  floorDb: number[];
  anchors: ClockAnchors;
  durationSec: number;
}): Moment[] {
  const { events, anchors, durationSec } = input;
  const floor = smooth(input.floorDb, 1);
  const at = (t: number) => floor[Math.min(floor.length - 1, Math.max(0, Math.round(t)))];
  const range = (from: number, to: number) => {
    const out: number[] = [];
    for (let t = Math.max(0, Math.round(from)); t <= Math.min(floor.length - 1, Math.round(to)); t++) out.push(t);
    return out;
  };
  const baselineFor = (start: number) => {
    const times = range(start - BASELINE.from, start - BASELINE.to);
    return times.length ? quantile(times.map(at), 0.5) : at(start);
  };
  // The 75th percentile of the window, not its loudest second: a maximum over 20-odd noisy seconds
  // sits a few dB above the baseline almost anywhere in the match.
  const reactionAt = (t: number) => quantile(range(t - REACTION.before, t + REACTION.after).map(at), 0.75);
  // Every second's rise, as if a moment peaked there, so a moment's rise can be ranked against the whole match.
  // A moment takes the larger of two reaction windows, so its rank leans slightly high.
  const reference: number[] = [];
  for (let t = BASELINE.from + TYPICAL_PRE_ROLL; t < durationSec - REACTION.after; t++) {
    reference.push(reactionAt(t) - baselineFor(t - TYPICAL_PRE_ROLL));
  }
  reference.sort((a, b) => a - b);

  // Score before each goal, to tell an equaliser or a go-ahead goal from the rest.
  const swingGoals = new Set<RawEvent>();
  const score = { spurs: 0, opponent: 0 };
  for (const e of [...events].filter((e) => e.kind === "goal" && e.team !== "neutral").sort((a, b) => a.peakSec - b.peakSec)) {
    const team = e.team as "spurs" | "opponent";
    const other = team === "spurs" ? "opponent" : "spurs";
    if (score[team] === score[other] || score[team] === score[other] - 1) swingGoals.add(e);
    score[team]++;
  }

  return events.map((e) => {
    const peak = e.peakSec;
    const startHint = Math.min(e.buildUpSec, peak - (PRE_ROLL[e.kind] ?? 8)) - 2;
    const start = Math.max(0, peak - (MAX_PRE[e.kind] ?? DEFAULT_MAX_PRE), startHint);
    const baseline = baselineFor(start);
    // The crowd may react to the foul rather than to the card, so the build-up gets a reaction window too.
    const reactions = [peak, Math.max(start + 2, e.buildUpSec)].map((t) => ({ t, level: reactionAt(t) }));
    const reaction = reactions.reduce((a, b) => (b.level > a.level ? b : a));
    const rise = reaction.level - baseline;
    const louderThan = reference.filter((r) => r < rise).length / reference.length;
    const loudest = range(reaction.t - REACTION.before, reaction.t + REACTION.after).reduce((a, b) => (at(b) > at(a) ? b : a));
    const settled = range(peak + (MIN_POST[e.kind] ?? 6), peak + MAX_POST).find((t) => at(t) <= baseline + SETTLED_DB);
    const end = Math.min(durationSec, settled ?? peak + MAX_POST);

    const minute = matchMinute(peak, anchors);
    const team = e.team;
    const scores = {
      importance: importance({ kind: e.kind, red: e.card === "red", minute, swing: swingGoals.has(e), team }),
      emotion: round3(Math.min(1, Math.max(0, e.intensity))),
      crowd: crowdScore(louderThan),
      social: socialScore(),
    };
    const evidence: Evidence[] = [
      ...e.quotes.map((q) => ({ source: "commentary" as const, detail: q.text, at: q.at, strength: scores.emotion })),
      {
        source: "crowd-audio",
        detail: `crowd ${rise >= 0 ? "+" : ""}${rise.toFixed(1)} dB over the minute before, a bigger rise than ${Math.round(louderThan * 100)}% of the match`,
        at: loudest,
        strength: scores.crowd,
      },
    ];
    const clock = matchClock(peak, anchors);
    return {
      id: `m-${String(Math.round(peak)).padStart(4, "0")}-${e.kind}`,
      kind: e.kind,
      title: e.title,
      summary: e.summary,
      start: round3(start),
      end: round3(end),
      peak: round3(peak),
      ...(clock ? { matchClock: clock } : {}),
      players: [...new Set(e.players.map((p) => p.rosterId).filter((id) => id > 0))],
      team,
      evidence,
      scores: { ...scores, total: total(scores) },
      focus: [],
    };
  });
}
