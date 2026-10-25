import type { Clip, Moment, Rejected } from "../../src/lib/studio/types";
import type { ClockAnchors } from "./clock";
import type { unmatched } from "./visual";

export function rankingReason(moment: Moment, rank: number): string {
  const visual = moment.evidence.some((e) => e.source === "twelvelabs-search");
  return `Ranked ${rank} with total ${moment.scores.total.toFixed(2)}, importance ${moment.scores.importance.toFixed(2)}, emotion ${moment.scores.emotion.toFixed(2)} and crowd ${moment.scores.crowd.toFixed(2)}; ${visual ? "visual search confirmation" : "no visual search confirmation"}, ${moment.team === "spurs" ? "Spurs involvement" : "no Spurs lead"}, but no segment selected for the clip plan.`;
}

export function rankedRejections(moments: Moment[], clips: Clip[]): Rejected[] {
  const used = new Set(clips.flatMap((c) => c.segments.map((s) => s.momentId)));
  return [...moments].sort((a, b) => b.scores.total - a.scores.total || a.peak - b.peak)
    .flatMap((m, i) => used.has(m.id) ? [] : [{ title: m.title, at: m.peak, kind: m.kind, source: "ranking" as const, reason: rankingReason(m, i + 1), momentId: m.id }]);
}

export function visualRejections(candidates: ReturnType<typeof unmatched>, anchors: ClockAnchors): Rejected[] {
  return candidates.map((hit) => ({
    title: hit.queries.join(" / "), at: hit.start, source: "twelvelabs-search",
    reason: hit.end < anchors.firstHalfKickoff
      ? `Pre-match visual hit for "${hit.queries.join(" / ")}" before kickoff at ${anchors.firstHalfKickoff.toFixed(1)} s, with no live commentary moment.`
      : `Visual search rank ${hit.bestRank} for "${hit.queries.join(" / ")}" has no commentary moment within the pipeline's 10-second overlap margin, so it remains unverified as a separate live event.`,
  }));
}
