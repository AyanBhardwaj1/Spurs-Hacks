import { PLACEMENTS, type Placement } from "@/lib/rundown/platforms";
import { fit } from "./planner";
import type { JobClip, JobMoment, JobSport } from "./types";

/** A placement as the general type, so optional limits such as titleLimit can be read on any of them. */
const spec = (p: keyof typeof PLACEMENTS): Placement => PLACEMENTS[p];

// The model's one job in a run: write each clip's hook, caption and title for its platform. It sees the
// moment, what was said and the platform's limits; it cannot move a cut, add a clip or change hashtags,
// and anything it returns that breaks a limit is cut to fit here, not trusted.

export type CopyAnswer = { clips: { id: string; hook: string; caption: string; title: string }[] };

export const COPY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["clips"],
  properties: {
    clips: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "hook", "caption", "title"],
        properties: { id: { type: "string" }, hook: { type: "string" }, caption: { type: "string" }, title: { type: "string" } },
      },
    },
  },
} as const;

export function isCopyAnswer(value: unknown): value is CopyAnswer {
  if (typeof value !== "object" || value === null || !Array.isArray((value as CopyAnswer).clips)) return false;
  return (value as CopyAnswer).clips.every(
    (c) => typeof c === "object" && c !== null && ["id", "hook", "caption", "title"].every((k) => typeof (c as Record<string, unknown>)[k] === "string"),
  );
}

const HOOK_MAX = 60;

/** New clips with the model's copy where it gave usable copy, each field cut to its platform's limit. */
export function applyCopy(clips: JobClip[], answer: CopyAnswer): JobClip[] {
  const byId = new Map(answer.clips.map((c) => [c.id, c]));
  return clips.map((clip) => {
    const got = byId.get(clip.id);
    if (!got) return clip;
    const p = spec(clip.placement);
    const tags = clip.hashtags.map((h) => `#${h}`).join(" ");
    const room = p.captionLimit - (tags ? tags.length + 1 : 0);
    const use = (text: string, max: number, fallback: string) => (text.trim() ? fit(text.trim(), max) : fallback);
    return {
      ...clip,
      hook: use(got.hook, HOOK_MAX, clip.hook),
      caption: use(got.caption, room, clip.caption),
      title: use(got.title, p.titleLimit ?? 100, clip.title),
    };
  });
}

/** The system and user messages for one copy call. */
export function copyPrompt(clips: JobClip[], moments: JobMoment[], sport: JobSport, jobTitle: string) {
  const byId = new Map(moments.map((m) => [m.id, m]));
  const system = [
    "You write social video copy for a sports club's content team. For each clip, write a hook (the text burned",
    "on screen for the first seconds, at most 60 characters), a caption for that platform, and a title.",
    "Write like the platform: TikTok and Reels casual and punchy, X short and newsy, YouTube descriptive.",
    "Use only what the moment and its quote say happened. Never invent a score, a player's name or a result.",
    "Leave hashtags out; they are added separately. Answer for every clip id you are given and no others.",
  ].join(" ");
  const user = JSON.stringify({
    match: jobTitle,
    sport,
    clips: clips.map((c) => {
      const m = byId.get(c.momentId);
      return { id: c.id, platform: spec(c.placement).platform, placement: spec(c.placement).placement, captionLimit: spec(c.placement).captionLimit, moment: m?.title, said: m?.quote?.slice(0, 600) };
    }),
  });
  return { system, user };
}
