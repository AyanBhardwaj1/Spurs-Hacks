import type { Clip, Editorial, Evidence, GroundTruthClip, MatchAnalysis, Moment, Player } from "./types";

export type ScoreParts = Omit<Moment["scores"], "total">;

export const SCORE_PARTS: { key: keyof ScoreParts; label: string }[] = [
  { key: "importance", label: "Importance" },
  { key: "emotion", label: "Emotion" },
  { key: "crowd", label: "Crowd" },
  { key: "social", label: "Social" },
];

/** Clips from most to least likely to travel. Ties keep the pipeline's order. */
export function rankClips(clips: Clip[]) {
  return clips
    .map((clip, i) => ({ clip, i }))
    .sort((a, b) => b.clip.viralScore - a.clip.viralScore || a.i - b.i)
    .map(({ clip }) => clip);
}

/** The moments a clip's segments point at, once each, in edit order. */
export function linkedMoments(clip: Clip, byId: Map<string, Moment>) {
  const seen = new Set<string>();
  const out: Moment[] = [];
  for (const seg of clip.segments) {
    if (!seg.momentId || seen.has(seg.momentId)) continue;
    seen.add(seg.momentId);
    const moment = byId.get(seg.momentId);
    if (!moment) throw new Error(`Clip ${clip.id} points at moment ${seg.momentId}, which the analysis does not contain`);
    out.push(moment);
  }
  return out;
}

/** The mean of the linked moments' score parts, or undefined when the clip links no moment. */
export function scoreBreakdown(moments: Moment[]): ScoreParts | undefined {
  if (moments.length === 0) return undefined;
  const sum = { importance: 0, emotion: 0, crowd: 0, social: 0 };
  for (const m of moments) {
    for (const { key } of SCORE_PARTS) sum[key] += m.scores[key];
  }
  for (const { key } of SCORE_PARTS) sum[key] /= moments.length;
  return sum;
}

/** The club's clip that each moment matched, keyed by moment ID. */
export function clubMatches(groundTruth: GroundTruthClip[]) {
  const out = new Map<string, GroundTruthClip[]>();
  for (const gt of groundTruth) {
    if (!gt.matchedMomentId) continue;
    out.set(gt.matchedMomentId, [...(out.get(gt.matchedMomentId) ?? []), gt]);
  }
  return out;
}

/** The post-match "Full recap" edit, if the plan has one. */
export function findRecap(clips: Clip[]) {
  const postMatch = clips.filter((c) => c.lane === "post-match");
  return (
    postMatch.find((c) => c.variant.toLowerCase() === "full recap") ??
    postMatch.find((c) => /recap/i.test(c.variant))
  );
}

export function playersFor(ids: number[], roster: Player[]) {
  const byId = new Map(roster.map((p) => [p.id, p]));
  const out: Player[] = [];
  for (const id of new Set(ids)) {
    const p = byId.get(id);
    if (p) out.push(p);
  }
  return out;
}

// When one club video yields several source ranges, the pipeline names each "<file> · cut at m:ss", the
// time being where the range sits in the club's video.
const CUT_SUFFIX = / · cut at (\d+:\d{2})$/;

/** The club's file name without the cut suffix or the file extension, for display. */
export function clubClipName(name: string) {
  return name.replace(CUT_SUFFIX, "").trim().replace(/\.(mp4|mov|mxf)$/i, "");
}

export type ClubRange = GroundTruthClip & { cutAt?: string };
export type ClubVideo = { scoreplayId: number; name: string; ranges: ClubRange[] };

/** The club's ranges grouped by the video they came from: most ranges first, each video's ranges in source order. */
export function clubVideos(groundTruth: GroundTruthClip[]): ClubVideo[] {
  const byId = new Map<number, ClubVideo>();
  for (const g of groundTruth) {
    const video = byId.get(g.scoreplayId) ?? { scoreplayId: g.scoreplayId, name: clubClipName(g.name), ranges: [] };
    video.ranges.push({ ...g, cutAt: CUT_SUFFIX.exec(g.name)?.[1] });
    byId.set(g.scoreplayId, video);
  }
  const videos = [...byId.values()];
  for (const v of videos) v.ranges.sort((a, b) => a.start - b.start);
  return videos.sort((a, b) => b.ranges.length - a.ranges.length || a.ranges[0].start - b.ranges[0].start);
}

/** Minutes of source the moments cover, counting overlapping moments once. */
export function coveredMinutes(moments: Pick<Moment, "start" | "end">[]) {
  const sorted = [...moments].sort((a, b) => a.start - b.start);
  let total = 0;
  let from = -Infinity;
  let to = -Infinity;
  for (const m of sorted) {
    if (m.start > to) {
      if (to > from) total += to - from;
      from = m.start;
      to = m.end;
    } else {
      to = Math.max(to, m.end);
    }
  }
  if (to > from) total += to - from;
  return total / 60;
}

/**
 * IDs of the moments whose logs the writeback read back from ScorePlay. Only the pipeline knows which
 * moments it logged, so without its `writeback.momentIds` the answer is none rather than a guess from the
 * current ranking, which a later run can reorder.
 */
export function writtenMomentIds(analysis: Pick<MatchAnalysis, "writeback">) {
  return new Set(analysis.writeback?.momentIds ?? []);
}

/**
 * MatchWatch's editorial lens on a moment (Jev scores, each 0 to 1 or null when unknown), shown beside the
 * ranking and never changing it.
 */
export type EditorialLens = Omit<Editorial, "source">;

export function editorialOf(moment: Moment): EditorialLens | undefined {
  const e = moment.editorial;
  if (!e || e.source !== "matchwatch-jev") return undefined;
  const score = (v: number | null) => (v !== null && v >= 0 && v <= 1 ? v : null);
  return {
    importance: score(e.importance),
    excitement: score(e.excitement),
    watchability: score(e.watchability),
    flags: e.flags,
  };
}

/** Evidence from MatchWatch's Pegasus segmentation prompts, which the pipeline writes as Twelve Labs analysis. */
export const isSegmentation = (e: Evidence) =>
  e.source === "twelvelabs-analysis" && /segmentation/i.test(e.detail) && /matchwatch prompts/i.test(e.detail);

/** Whether any part of this run came from MatchWatch's work, so the run view can credit it. */
export const usesMatchWatch = (moments: Moment[]) => moments.some((m) => editorialOf(m) || m.evidence.some(isSegmentation));

/** Evidence from Twelve Labs: the moment was found by searching the match video itself. */
export const onCamera = (e: Evidence) => e.source === "twelvelabs-search" || e.source === "twelvelabs-analysis";

/** True when a Twelve Labs search or analysis of the video confirmed the moment. */
export const seenOnCamera = (m: Moment) => m.evidence.some(onCamera);

export type MomentGroup = { moment: Moment; clips: Clip[] };

/**
 * Clips that cut only one moment, grouped by that moment when it has more than one edit, so the variants
 * of a moment sit together. Groups keep the order of their best clip in `ranked`; `others` are the rest,
 * also in ranked order.
 */
export function momentGroups(ranked: Clip[], byId: Map<string, Moment>) {
  const single = (c: Clip) => {
    const ids = new Set(c.segments.map((s) => s.momentId));
    return ids.size === 1 ? [...ids][0] : undefined;
  };
  const byMoment = new Map<string, Clip[]>();
  for (const clip of ranked) {
    const id = single(clip);
    if (id) byMoment.set(id, [...(byMoment.get(id) ?? []), clip]);
  }
  const groups: MomentGroup[] = [];
  const grouped = new Set<string>();
  for (const [id, clips] of byMoment) {
    if (clips.length < 2) continue;
    const moment = byId.get(id);
    if (!moment) throw new Error(`Clips point at moment ${id}, which the analysis does not contain`);
    groups.push({ moment, clips });
    for (const c of clips) grouped.add(c.id);
  }
  return { groups, others: ranked.filter((c) => !grouped.has(c.id)) };
}

/**
 * ScorePlay media ID of the clip's Reel Studio edit, when the Reel Studio lane has uploaded one. The field is
 * being added to the contract on that lane's branch, so it is read here without assuming it yet.
 */
export function reelStudioId(clip: Clip): number | undefined {
  const id = (clip as Clip & { reelStudioMediaId?: unknown }).reelStudioMediaId;
  return typeof id === "number" ? id : undefined;
}

export type PublishedClip = Clip & { scoreplayMediaId: number };

/** Clips rendered and uploaded back into ScorePlay, best first, the long post-match edit last. */
export function publishedClips(ranked: Clip[]): PublishedClip[] {
  const out = ranked.filter((c): c is PublishedClip => typeof c.scoreplayMediaId === "number");
  return [...out.filter((c) => c.lane === "asap"), ...out.filter((c) => c.lane !== "asap")];
}

/** Everything the project view derives once from an analysis. */
export function indexAnalysis(analysis: MatchAnalysis) {
  const momentsById = new Map(analysis.moments.map((m) => [m.id, m]));
  return {
    momentsById,
    ranked: rankClips(analysis.clips),
    matches: clubMatches(analysis.groundTruth),
    recap: findRecap(analysis.clips),
    published: publishedClips(rankClips(analysis.clips)),
  };
}
