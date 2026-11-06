import type { Peak } from "./energy";
import { callsFor, SPORT } from "./sports";
import type { JobMoment, JobSport, Signal, Word } from "./types";

// A job's moments, from the crowd's roars and the commentators' calls. Either alone can find a moment;
// both together rank it higher, the same rule the hackathon run used ("two independent hits on one
// moment outrank one strong hit"). Rules only: the model may retitle moments later, never invent them.

/** Calls closer together than this are one call. */
const CALL_GAP_SEC = 8;
/** A call this far before a roar, or a little after it, is about the same moment. */
const AGREE_BEFORE_SEC = 12;
const AGREE_AFTER_SEC = 5;
const LEAD_SEC = 15;
const TAIL_SEC = 10;
/** How far an edge may move to land on a camera cut. */
const SNAP_SEC = 3;

const CROWD_WEIGHT = 0.7;
const AGREE_BONUS = 0.3;
const CALL_ONLY_SCORE = 0.45;
const TITLE_WORDS = 6;

/** Lower case, letters in any alphabet kept, punctuation but the apostrophe dropped: "INCREÍBLE!" is "increíble". */
const norm = (text: string) => text.toLowerCase().normalize("NFC").replace(/[^\p{L}\p{N}' ]/gu, "");

/** Source seconds where a commentator makes one of the sport's calls, one per burst. */
export function excitedCalls(words: Word[], sport: JobSport = "other"): { at: number }[] {
  const phrases = callsFor(sport).map((c) => c.split(" "));
  const tokens = words.map((w) => norm(w.text));
  const calls: { at: number }[] = [];
  for (let i = 0; i < words.length; i++) {
    const hit = phrases.some((phrase) => phrase.every((p, j) => tokens[i + j] === p));
    if (!hit) continue;
    const last = calls.at(-1);
    if (last && words[i].start - last.at < CALL_GAP_SEC) continue;
    calls.push({ at: words[i].start });
  }
  return calls;
}

/** m:ss of match time, minutes running past 60 the way a match clock does. */
export function matchClock(sec: number) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function snap(edge: number, cuts: number[], allowed: (t: number) => boolean) {
  let best = edge;
  let gap = SNAP_SEC + 1e-9;
  for (const c of cuts) {
    if (Math.abs(c - edge) <= gap && allowed(c)) {
      best = c;
      gap = Math.abs(c - edge);
    }
  }
  return best;
}

const spoken = (words: Word[], from: number, to: number, limit = Infinity) =>
  words
    .filter((w) => w.start >= from && w.start <= to)
    .slice(0, limit)
    .map((w) => w.text)
    .join(" ");

type Fuse = { durationSec: number; peaks: Peak[]; words: Word[]; cuts: number[]; sport?: JobSport };

export function fuseMoments({ durationSec, peaks, words, cuts, sport = "other" }: Fuse): JobMoment[] {
  const calls = excitedCalls(words, sport);
  // Two moments closer than the sport's gap between plays are one play, as the crowd's roars are.
  const mergeSec = SPORT[sport].gapSec;
  const used = new Set<number>();
  const raw: { peak: number; start: number; end: number; score: number; signals: Signal[] }[] = [];

  for (const p of peaks) {
    // A shot and then a goal call are both about this roar: every call in its window counts for it.
    let agreed = false;
    calls.forEach((c, i) => {
      if (c.at >= p.peak - AGREE_BEFORE_SEC && c.at <= p.peak + AGREE_AFTER_SEC) {
        used.add(i);
        agreed = true;
      }
    });
    raw.push({ ...p, score: CROWD_WEIGHT * p.score + (agreed ? AGREE_BONUS : 0), signals: agreed ? ["crowd", "commentary"] : ["crowd"] });
  }
  calls.forEach((c, i) => {
    if (used.has(i)) return;
    raw.push({ peak: c.at, start: Math.max(0, c.at - LEAD_SEC), end: Math.min(durationSec, c.at + TAIL_SEC), score: CALL_ONLY_SCORE, signals: ["commentary"] });
  });

  // Strongest first, and anything within the gap of a stronger moment is the same play.
  raw.sort((a, b) => b.score - a.score || a.peak - b.peak);
  const kept = raw.filter((m, i) => raw.slice(0, i).every((k) => Math.abs(k.peak - m.peak) >= mergeSec));
  const ids = new Set<string>();
  return kept
    .map((m) => {
      const start = snap(m.start, cuts, (t) => t < m.peak);
      const end = snap(m.end, cuts, (t) => t > m.peak && t <= durationSec);
      const quote = spoken(words, start, end);
      const said = spoken(words, m.peak - AGREE_BEFORE_SEC + 4, m.peak + 3, TITLE_WORDS);
      let id = `m-${Math.round(m.peak)}`;
      for (let n = 2; ids.has(id); n++) id = `m-${Math.round(m.peak)}-${n}`;
      ids.add(id);
      return {
        id,
        peak: m.peak,
        start,
        end,
        score: Math.round(m.score * 1000) / 1000,
        signals: m.signals,
        title: said ? `“${said}” at ${matchClock(m.peak)}` : `Crowd erupts at ${matchClock(m.peak)}`,
        ...(quote && { quote }),
      };
    })
    .sort((a, b) => b.score - a.score || a.peak - b.peak);
}

/** A moment a producer picks on the timeline: their second is the play, and their pick outranks the rules. */
export function pickedMoment(at: number, words: Word[], durationSec: number, taken: Set<string>): JobMoment {
  const start = Math.max(0, at - LEAD_SEC);
  const end = Math.min(durationSec, at + TAIL_SEC);
  let id = `m-${Math.round(at)}`;
  for (let n = 2; taken.has(id); n++) id = `m-${Math.round(at)}-${n}`;
  const quote = spoken(words, start, end);
  // Titled like a found moment, so the hook quotes the commentary when there is some.
  const said = spoken(words, at - AGREE_BEFORE_SEC + 4, at + 3, TITLE_WORDS);
  return { id, peak: at, start, end, score: 1, signals: ["producer"], title: said ? `“${said}” at ${matchClock(at)}` : `Picked at ${matchClock(at)}`, ...(quote && { quote }) };
}
