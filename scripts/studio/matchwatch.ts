import type { Evidence, Moment, Rejected } from "../../src/lib/studio/types";

export const MATCHWATCH_EVENT_PROMPTS = ["Goal scored", "Shot on target", "Foul or penalty", "Crowd celebration"] as const;

export type PegasusSegment = { start: number; end: number; label: string; confidence?: number };

export function overlapSeconds(a: { start: number; end: number }, b: { start: number; end: number }) {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

export function mapSegments(segments: PegasusSegment[], moments: Pick<Moment, "id" | "start" | "end">[]) {
  const rejected: Rejected[] = [];
  const matched = new Map<string, Evidence[]>();
  for (const segment of segments) {
    const candidates = moments
      .map((moment) => ({ moment, overlap: overlapSeconds(segment, moment) }))
      .filter((x) => x.overlap > 0)
      .sort((a, b) => b.overlap - a.overlap || a.moment.start - b.moment.start);
    const best = candidates[0];
    if (!best) {
      rejected.push({ title: segment.label, at: segment.start, source: "twelvelabs-search", reason: `Pegasus segment ${segment.start.toFixed(1)}-${segment.end.toFixed(1)} s matched no existing moment.` });
      continue;
    }
    const evidence: Evidence = {
      source: "twelvelabs-analysis",
      detail: `Pegasus segmentation (MatchWatch prompts): ${segment.label}`,
      at: (Math.max(segment.start, best.moment.start) + Math.min(segment.end, best.moment.end)) / 2,
      strength: Math.max(0, Math.min(1, segment.confidence ?? Math.min(1, best.overlap / Math.max(1, best.moment.end - best.moment.start)))),
    };
    matched.set(best.moment.id, [...(matched.get(best.moment.id) ?? []), evidence]);
  }
  return { matched, rejected };
}

export type JevScores = { importance: number | null; excitement: number | null; watchability: number | null };

/** MatchWatch Jev's 50/30/20 utility, renormalized over known values. */
export function jevUtility(scores: JevScores) {
  const factors: [number | null, number][] = [[scores.importance, 0.5], [scores.excitement, 0.3], [scores.watchability, 0.2]];
  let total = 0;
  let weight = 0;
  for (const [value, factor] of factors) if (value !== null) { total += value * factor; weight += factor; }
  return weight ? total / weight : 0;
}

export function parsePegasusSegments(value: unknown, durationSec: number): PegasusSegment[] {
  if (!isRecord(value) || !Array.isArray(value.events)) throw new Error("Pegasus segmentation: expected events array");
  return value.events.map((item, i) => {
    if (!isRecord(item) || !isRecord(item.metadata)) throw new Error(`Pegasus segment ${i}: missing metadata`);
    const { start_time: start, end_time: end, metadata } = item;
    if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > durationSec) throw new Error(`Pegasus segment ${i}: invalid source range`);
    if (typeof metadata.label !== "string" || !metadata.label.trim()) throw new Error(`Pegasus segment ${i}: missing label`);
    if (metadata.confidence !== undefined && (typeof metadata.confidence !== "number" || !Number.isFinite(metadata.confidence) || metadata.confidence < 0 || metadata.confidence > 1)) throw new Error(`Pegasus segment ${i}: invalid confidence`);
    return { start, end, label: metadata.label, ...(metadata.confidence !== undefined ? { confidence: metadata.confidence } : {}) };
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
