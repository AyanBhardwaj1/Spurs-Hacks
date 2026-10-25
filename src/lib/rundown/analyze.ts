import "server-only";

import { analyze } from "../twelvelabs";
import { cached } from "./store";
import type { Audience, Moment, MomentAnalysis, MomentKind, Sport } from "./types";

// Pegasus prompts and the JSON schemas that keep its answers parseable.
// Twelve Labs ignores `description` in a schema and rejects maxLength,
// maxItems and additionalProperties, so every instruction lives in the prompt.

/** Seconds of context on either side of a moment. */
const PAD = 6;

const KINDS: MomentKind[] = [
  "goal", "chance", "celebration", "crowd", "away-end", "silence", "bench",
  "coach", "card", "confrontation", "skill", "sponsor", "press", "other",
];

const CAPTION_KEYS: Record<Audience, string> = {
  "season-ticket": "caption_season_ticket",
  "first-time-abroad": "caption_first_time_abroad",
  partner: "caption_partner",
  "social-native": "caption_social",
  "player-fans": "caption_player_fans",
  family: "caption_family",
};

const str = { type: "string" };
const num = { type: "number" };
const bool = { type: "boolean" };
const strings = { type: "array", items: str };

const MOMENT_SCHEMA = {
  type: "object",
  properties: {
    description: str,
    kind: { type: "string", enum: KINDS },
    players: strings,
    emotion: { type: "string", enum: ["elation", "tension", "anger", "despair", "humour", "calm"] },
    intensity: num,
    is_replay: bool,
    sponsors_visible: strings,
    crowd_audible: bool,
    quality: { type: "string", enum: ["good", "usable", "poor"] },
    brand_safe: bool,
    brand_safety_note: str,
    hook: str,
    best_start: num,
    best_end: num,
    focus_x: num,
    ...Object.fromEntries(Object.values(CAPTION_KEYS).map((k) => [k, str])),
  },
  required: [
    "description", "kind", "players", "emotion", "intensity", "is_replay", "sponsors_visible",
    "crowd_audible", "quality", "brand_safe", "brand_safety_note", "hook", "best_start", "best_end", "focus_x",
    ...Object.values(CAPTION_KEYS),
  ],
};

type RawMoment = Record<string, unknown> & {
  description: string;
  kind: MomentKind;
  players: string[];
  emotion: MomentAnalysis["emotion"];
  intensity: number;
  is_replay: boolean;
  sponsors_visible: string[];
  crowd_audible: boolean;
  quality: MomentAnalysis["quality"];
  brand_safe: boolean;
  brand_safety_note: string;
  hook: string;
  best_start: number;
  best_end: number;
  focus_x: number;
};

export type MatchContext = {
  sport: Sport;
  matchName: string;
  roster: string[];
  partners: string[];
};

function momentPrompt(m: Moment, ctx: MatchContext, windowLength: number) {
  return [
    `You are a match-day producer's assistant for ${ctx.matchName} (${ctx.sport}).`,
    `A search flagged this clip as: "${m.title}". Watch it and describe what actually happens.`,
    `Players on the club's roster: ${ctx.roster.slice(0, 40).join(", ") || "unknown"}. Name a player only if you can see a shirt number, a name or a caption that identifies them.`,
    `The club's partners are: ${ctx.partners.join(", ") || "unknown"}. List only sponsor logos you can actually read in frame.`,
    "Field rules:",
    "- kind: the closest category for what happens. Use 'other' if none fits.",
    "- intensity: 0 to 1, how much a fan would want to see this again.",
    "- is_replay: true if this is a slow-motion or broadcast replay rather than live action.",
    "- quality: 'poor' only if the action is blurred, blocked or cut off.",
    "- brand_safe: false for injuries, violence, crowd trouble, offensive gestures or anything a club would not post. Explain in brand_safety_note; leave it empty otherwise.",
    "- hook: the on-screen text for the first second of a vertical video, at most 8 words, no hashtags or emoji.",
    `- best_start and best_end: the tightest in and out points for the action, in seconds from the start of this ${Math.round(windowLength)}-second clip.`,
    "- focus_x: where the main action sits across the frame, from 0 at the left edge to 1 at the right. A vertical crop will centre on it.",
    "- Each caption is one or two sentences for that audience:",
    "  caption_season_ticket: someone who was in the stadium; speak to the shared memory.",
    "  caption_first_time_abroad: someone new to the club; give the context they need (who, the score, why it matters).",
    "  caption_partner: a sponsor-safe line that could run with the partner's logo.",
    "  caption_social: a punchy line for a fast-scrolling feed.",
    "  caption_player_fans: fans of the player involved; centre the player.",
    "  caption_family: young fans and families; warm and simple.",
    "Use plain language. Do not invent the score, minute or names you cannot see.",
  ].join("\n");
}

/** Pegasus on a padded window around the moment. Cached per window so reruns are free. */
export async function analyzeMoment(m: Moment, tlAssetId: string, ctx: MatchContext, duration?: number) {
  const start = Math.max(0, m.primary.start - PAD);
  const end = Math.min(duration ?? Infinity, m.primary.end + PAD);
  const raw = await cached("moment", { tlAssetId, start, end, v: 2 }, () =>
    analyze<RawMoment>({ assetId: tlAssetId, prompt: momentPrompt(m, ctx, end - start), schema: MOMENT_SCHEMA, start, end }),
  );
  const clamp = (n: number) => Math.min(end, Math.max(start, start + n));
  const bestStart = clamp(Number(raw.best_start) || 0);
  const bestEnd = clamp(Number(raw.best_end) || end - start);
  const captions: MomentAnalysis["captions"] = {};
  for (const [audience, key] of Object.entries(CAPTION_KEYS) as [Audience, string][]) {
    if (typeof raw[key] === "string" && raw[key]) captions[audience] = raw[key] as string;
  }
  const analysis: MomentAnalysis = {
    description: raw.description,
    players: raw.players ?? [],
    emotion: raw.emotion,
    intensity: Math.min(1, Math.max(0, Number(raw.intensity) || 0)),
    isReplay: Boolean(raw.is_replay),
    sponsorsVisible: raw.sponsors_visible ?? [],
    crowdAudible: Boolean(raw.crowd_audible),
    quality: raw.quality,
    brandSafe: raw.brand_safe !== false,
    brandSafetyNote: raw.brand_safety_note || undefined,
    hook: raw.hook,
    captions,
    ...(bestEnd - bestStart >= 2 ? { bestStart, bestEnd } : {}),
    ...(Number.isFinite(raw.focus_x) ? { focusX: Math.min(1, Math.max(0, raw.focus_x)) } : {}),
  };
  return { analysis, kind: KINDS.includes(raw.kind) ? raw.kind : m.kind };
}

const QUOTES_SCHEMA = {
  type: "object",
  properties: {
    quotes: {
      type: "array",
      items: {
        type: "object",
        properties: { start: num, end: num, speaker: str, quote: str, topic: str, strength: num },
        required: ["start", "end", "speaker", "quote", "topic", "strength"],
      },
    },
  },
  required: ["quotes"],
};

export type Quote = { start: number; end: number; speaker: string; quote: string; topic: string; strength: number };

/** The answers worth cutting from a press conference or interview. */
export async function findQuotes(tlAssetId: string, ctx: MatchContext): Promise<Quote[]> {
  const prompt = [
    `This is a press conference or interview after ${ctx.matchName}.`,
    "Pick up to five answers a social editor would cut into a 20-second quote clip.",
    "Prefer answers that are emotional, funny, surprising or about a moment fans are discussing.",
    "For each: start and end in seconds from the start of the video covering the full answer, the speaker's name if shown or said, the key line quoted word for word, the topic in a few words, and strength from 0 to 1.",
  ].join("\n");
  const res = await cached("quotes", { tlAssetId, v: 1 }, () =>
    analyze<{ quotes: Quote[] }>({ assetId: tlAssetId, prompt, schema: QUOTES_SCHEMA, maxTokens: 4096 }),
  );
  return (res.quotes ?? []).filter((q) => q.end > q.start);
}
