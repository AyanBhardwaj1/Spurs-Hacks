import { PLACEMENTS, type Placement } from "@/lib/rundown/platforms";
import { matchClock } from "./moments";
import type { JobClip, JobMoment, JobPlacement, JobSkip, JobSport } from "./types";

/** A placement as the general type, so optional limits such as titleLimit can be read on any of them. */
const spec = (p: keyof typeof PLACEMENTS): Placement => PLACEMENTS[p];

// How each platform gets its own cut of a moment. Rules, so a producer can read why a clip looks the way
// it does and the tests can pin it. The model may rewrite the copy later; it never moves a cut.
//
// lead: seconds before the roar the cut opens. The play comes before the crowd, so every short cut opens
// on the build-up and lands the roar inside the first few seconds people watch.

/** tail is used when the roar's length is unknown; otherwise the cut runs one second past the crowd settling, held to minTail..maxTail. */
type Style = { name: string; count: number; lead: number; tail: number; minTail: number; maxTail: number; why: (sec: number, lead: number) => string };

const STYLE: Record<Exclude<JobPlacement, "youtube-video">, Style> = {
  tiktok: {
    name: "TikTok",
    count: 5,
    lead: 8,
    tail: 10,
    minTail: 6,
    maxTail: 18,
    why: (sec, lead) => `TikTok decides in the first seconds, so this ${sec} s cut opens ${lead} s before the roar and ends while it is still loud.`,
  },
  "instagram-reel": {
    name: "Instagram Reels",
    count: 4,
    lead: 9,
    tail: 9,
    minTail: 6,
    maxTail: 12,
    why: (sec, lead) => `Reels loop, so this ${sec} s cut is short enough to watch twice and opens ${lead} s before the roar.`,
  },
  "youtube-short": {
    name: "YouTube Shorts",
    count: 4,
    lead: 14,
    tail: 14,
    minTail: 8,
    maxTail: 30,
    why: (sec) => `Shorts give a moment more room: ${sec} s with the build-up, the roar and the reaction after it.`,
  },
  "x-video": {
    name: "X",
    count: 3,
    lead: 10,
    tail: 5,
    minTail: 4,
    maxTail: 10,
    why: (sec) => `X moves fast: ${sec} s of the play and the roar, posted while people are still talking about it.`,
  },
  "x-square": {
    name: "X (square)",
    count: 3,
    lead: 10,
    tail: 5,
    minTail: 4,
    maxTail: 10,
    why: (sec) => `The same ${sec} s X cut in square, which fills more of a phone's timeline than widescreen.`,
  },
};

/** Moments under this score are noise for every platform. */
const MIN_SCORE = 0.3;
/** The highlights cut takes this many of the top moments, at most. */
const HIGHLIGHTS_MOMENTS = 8;
const HOOK_MAX = 60;

const SPORT_TAGS: Record<JobSport, string[]> = {
  soccer: ["football", "soccer", "goal", "matchday", "highlights"],
  basketball: ["basketball", "nba", "hoops", "highlights", "buckets"],
  "american-football": ["nfl", "football", "touchdown", "gameday", "highlights"],
  other: ["sports", "highlights", "gameday", "replay", "clip"],
};

function ordinal(n: number) {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : ({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th";
  return `${n}${suffix}`;
}

/** Cuts text at a word boundary to fit `max` characters, with an ellipsis when it had to cut. */
export function fit(text: string, max: number) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** The words a moment's title quotes, or a plain line when nothing was said. */
const hookOf = (m: JobMoment) => fit(/“(.+)”/.exec(m.title)?.[1] ?? "Listen to this crowd", HOOK_MAX);

function copy(placement: JobPlacement, hook: string, jobTitle: string, sport: JobSport, when: number) {
  const p = spec(placement);
  const hashtags = SPORT_TAGS[sport].slice(0, p.hashtagLimit);
  const tags = hashtags.map((h) => `#${h}`).join(" ");
  const room = p.captionLimit - (tags ? tags.length + 1 : 0);
  return { hashtags, caption: fit(`${hook} · ${matchClock(when)} · ${jobTitle}`, room) };
}

const clamp = (t: number, durationSec: number) => Math.min(durationSec, Math.max(0, t));
const round = (t: number) => Math.round(t * 1000) / 1000;

type Plan = { moments: JobMoment[]; placements: JobPlacement[]; durationSec: number; sport: JobSport; title: string };

export function planClips({ moments, placements, durationSec, sport, title }: Plan): { clips: JobClip[]; skipped: JobSkip[] } {
  const ranked = [...moments].sort((a, b) => b.score - a.score || a.peak - b.peak);
  const strong = ranked.filter((m) => m.score >= MIN_SCORE);
  const clips: JobClip[] = [];
  const skipped: JobSkip[] = [];

  for (const placement of placements) {
    for (const m of ranked) {
      if (m.score < MIN_SCORE) skipped.push({ momentId: m.id, placement, reason: `Scored ${m.score.toFixed(2)}, under the ${MIN_SCORE.toFixed(2)} floor for a clip.` });
    }
    if (placement === "youtube-video") {
      const top = strong.slice(0, HIGHLIGHTS_MOMENTS).sort((a, b) => a.peak - b.peak);
      if (top.length === 0) continue;
      // In match order, a window that overlaps the one before extends it, so no footage plays twice.
      const segments: { start: number; end: number }[] = [];
      for (const m of top) {
        const seg = { start: round(clamp(m.start, durationSec)), end: round(clamp(m.end, durationSec)) };
        const last = segments.at(-1);
        if (last && seg.start <= last.end) last.end = Math.max(last.end, seg.end);
        else if (seg.end > seg.start) segments.push(seg);
      }
      const sec = Math.round(segments.reduce((n, s) => n + s.end - s.start, 0));
      clips.push({
        id: `${placement}-highlights`,
        momentId: top[0].id,
        placement,
        segments,
        title: fit(`${title}: highlights`, spec(placement).titleLimit ?? 100),
        hook: fit(title, HOOK_MAX),
        ...copy(placement, `${title}: the ${top.length} biggest moments`, title, sport, top[0].peak),
        why: `One ${sec} s highlights cut of the top ${top.length} moments in match order, for viewers who missed the game.`,
        render: { state: "waiting" },
      });
      strong.slice(HIGHLIGHTS_MOMENTS).forEach((m, i) =>
        skipped.push({ momentId: m.id, placement, reason: `Ranked ${ordinal(HIGHLIGHTS_MOMENTS + i + 1)}; the highlights cut takes the top ${HIGHLIGHTS_MOMENTS}.` }),
      );
      continue;
    }

    const style = STYLE[placement];
    const max = spec(placement).maxSeconds;
    strong.forEach((m, i) => {
      if (i >= style.count) {
        skipped.push({ momentId: m.id, placement, reason: `Ranked ${ordinal(i + 1)}; ${style.name} takes the top ${style.count}.` });
        return;
      }
      const tail = m.settle === undefined ? style.tail : Math.min(style.maxTail, Math.max(style.minTail, m.settle + 1));
      const start = clamp(m.peak - style.lead, durationSec);
      const end = Math.min(clamp(m.peak + tail, durationSec), start + max);
      const hook = hookOf(m);
      clips.push({
        id: `${placement}-${m.id}`,
        momentId: m.id,
        placement,
        segments: [{ start: round(start), end: round(end) }],
        title: fit(m.title, spec(placement).titleLimit ?? 100),
        hook,
        ...copy(placement, hook, title, sport, m.peak),
        why: m.settle === undefined ? style.why(Math.round(end - start), Math.round(m.peak - start)) : `${style.why(Math.round(end - start), Math.round(m.peak - start)).replace(/ and ends while it is still loud/, "")} It ends a second after the crowd settles.`,
        render: { state: "waiting" },
      });
    });
  }
  return { clips, skipped };
}
