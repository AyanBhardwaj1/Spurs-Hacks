import { PLACEMENTS } from "@/lib/rundown/platforms";
import { cutRange } from "./planner";
import type { JobClip, JobMoment } from "./types";

// Which clip to post first on each platform. A rule a producer can check, not a prediction: each point is
// a piece of evidence the job has about the clip, and the card lists them. The moment's own score is half.

export type Strength = { score: number; reasons: string[] };

const HOOK_FALLBACK = "Listen to this crowd";

export function clipStrength(clip: JobClip, moment: JobMoment | undefined): Strength {
  const reasons: string[] = [];
  let score = Math.round((moment?.score ?? 0) * 50);
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(reason);
  };
  if (moment?.signals.includes("crowd") && moment.signals.includes("commentary")) add(15, "The crowd and the commentary both picked it.");
  if (clip.hook !== HOOK_FALLBACK) add(10, "The hook quotes the commentary.");
  if (moment?.settle !== undefined) add(10, "It ends as the crowd settles.");
  if (PLACEMENTS[clip.placement].aspect === "16:9") add(10, "Wide, so nothing is cropped out.");
  else if (moment?.focus?.length) add(10, "The crop follows the play.");
  const range = cutRange(clip.placement);
  const sec = clip.segments.reduce((n, s) => n + s.end - s.start, 0);
  if (range && sec <= (range.min + range.max) / 2) add(5, "Short enough to watch twice.");
  return { score: Math.min(100, score), reasons };
}

/** Each clip's place in its platform's posting order, 1 first, with its strength. */
export function postOrder(clips: JobClip[], moments: JobMoment[]): Map<string, Strength & { rank: number }> {
  const byId = new Map(moments.map((m) => [m.id, m]));
  const groups = new Map<string, { clip: JobClip; strength: Strength; peak: number }[]>();
  for (const clip of clips) {
    const moment = byId.get(clip.momentId);
    const group = groups.get(clip.placement) ?? [];
    group.push({ clip, strength: clipStrength(clip, moment), peak: moment?.peak ?? clip.segments[0].start });
    groups.set(clip.placement, group);
  }
  const order = new Map<string, Strength & { rank: number }>();
  for (const group of groups.values()) {
    group.sort((a, b) => b.strength.score - a.strength.score || a.peak - b.peak);
    group.forEach((g, i) => order.set(g.clip.id, { ...g.strength, rank: i + 1 }));
  }
  return order;
}
