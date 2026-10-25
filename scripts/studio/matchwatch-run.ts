import type { Editorial, GroundTruthClip, Moment } from "../../src/lib/studio/types";
import { cached, hashOf, readCache, writeCache } from "./cache";
import { PEGASUS_ASSET } from "./descriptions";
import { jevPrompt, jevSchemaFor } from "./matchwatch-jev";
import { isRecord, MATCHWATCH_EVENT_PROMPTS, mapSegments, parsePegasusSegments, type PegasusSegment } from "./matchwatch";
import { isHit, mergeRanges } from "./rank-eval";

export async function segmentMatch(moments: Moment[], durationSec: number) {
  const responseFormat = {
    type: "segment_definitions",
    segment_definitions: [{
      id: "events",
      description: `Identify each soccer event matching these MatchWatch prompts: ${MATCHWATCH_EVENT_PROMPTS.join("; ")}. Include the action and its immediate reaction. Omit unrelated play and studio footage.`,
      fields: [
        { name: "label", type: "string", enum: [...MATCHWATCH_EVENT_PROMPTS], description: "The soccer event label observed in this segment." },
        { name: "confidence", type: "number", description: "Confidence in this event identification, from 0 to 1. This is an estimate, not a calibrated probability." },
      ],
    }],
  };
  const key = `matchwatch/segments-${hashOf(PEGASUS_ASSET, "pegasus1.6", JSON.stringify(responseFormat))}.json`;
  const { value } = await cached(key, async () => {
    requirePegasus16();
    const { twelvelabs } = await import("./server-modules");
    return twelvelabs.analyze<unknown>({
      assetId: PEGASUS_ASSET, prompt: "", schema: {}, temperature: 0,
      analysisMode: "time_based_metadata", maxTokens: "unlimited", responseFormat,
      resumeTaskId: readCache<{ taskId: string }>(`${key}.task`)?.taskId,
      onTaskCreated: (taskId) => { writeCache(`${key}.task`, { taskId }); console.log(`[matchwatch-segmentation] task ${taskId}`); },
    });
  });
  const segments = parsePegasusSegments(value, durationSec);
  const mapped = mapSegments(segments, moments);
  for (const m of moments) m.evidence.push(...(mapped.matched.get(m.id) ?? []));
  return { segments, rejected: mapped.rejected, matchedSegments: segments.length - mapped.rejected.length, matchedMoments: mapped.matched.size };
}

export function parseEditorial(value: unknown, ids: string[]): Map<string, Editorial> {
  if (!isRecord(value) || !Array.isArray(value.reviews) || value.reviews.length !== ids.length) throw new Error("Jev: expected one review per candidate");
  const result = new Map<string, Editorial>();
  const score = (value: unknown): number | null => {
    if (value === null || typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1) return value;
    throw new Error("Jev: estimates must be null or finite numbers in 0..1");
  };
  for (const r of value.reviews) {
    if (!isRecord(r) || typeof r.candidate_id !== "string" || !ids.includes(r.candidate_id) || result.has(r.candidate_id)) throw new Error("Jev: unknown or duplicate candidate ID");
    if (typeof r.needs_review !== "boolean" || typeof r.recommend_include !== "boolean" || typeof r.reason !== "string" || !r.reason.trim()) throw new Error("Jev: missing review decision or evidence reason");
    if (r.duplicate_of !== null && (typeof r.duplicate_of !== "string" || r.duplicate_of === r.candidate_id || !ids.includes(r.duplicate_of))) throw new Error("Jev: invalid duplicate reference");
    const importance = score(r.importance_estimate);
    const excitement = score(r.excitement_estimate);
    const watchability = score(r.watchability_estimate);
    const flags = [
      ...(r.needs_review || [importance, excitement, watchability].every((s) => s === null) ? ["needs-review"] : []),
      ...(!r.recommend_include ? ["not-recommended"] : []),
      ...(r.duplicate_of !== null ? [`duplicate-of:${r.duplicate_of}`] : []),
      `Evidence: ${r.reason}`,
    ];
    result.set(r.candidate_id, { importance, excitement, watchability, flags, source: "matchwatch-jev" });
  }
  return result;
}

export async function reviewMoments(moments: Moment[], durationSec: number) {
  const top = [...moments].sort((a, b) => b.scores.total - a.scores.total || a.peak - b.peak).slice(0, 20);
  const candidates = top.map((m) => ({ id: m.id, label: m.title, start: m.start, end: m.end }));
  if (!top.length) return 0;
  const prompt = jevPrompt(candidates);
  const schema = jevSchemaFor(candidates);
  const start = Math.max(0, Math.min(...top.map((m) => m.start)) - 10);
  const end = Math.min(durationSec, Math.max(...top.map((m) => m.end)) + 15);
  const key = `matchwatch/jev-${hashOf(PEGASUS_ASSET, "pegasus1.6", prompt, JSON.stringify(schema), String(start), String(end))}.json`;
  const { value } = await cached(key, async () => {
    requirePegasus16();
    const { twelvelabs } = await import("./server-modules");
    return twelvelabs.analyze<unknown>({ assetId: PEGASUS_ASSET, prompt, schema, start, end, temperature: 0, maxTokens: 8192,
      resumeTaskId: readCache<{ taskId: string }>(`${key}.task`)?.taskId,
      onTaskCreated: (taskId) => { writeCache(`${key}.task`, { taskId }); console.log(`[matchwatch-jev] task ${taskId}`); },
    });
  });
  const reviews = parseEditorial(value, top.map((m) => m.id));
  for (const m of top) m.editorial = reviews.get(m.id)!;
  return reviews.size;
}

function requirePegasus16() {
  if (process.env.TWELVELABS_PEGASUS_MODEL && process.env.TWELVELABS_PEGASUS_MODEL !== "pegasus1.6") throw new Error("MatchWatch stages require pegasus1.6");
}

/** Uses rank-eval's three-second hit and merged-reference recall without random placement baselines. */
export function segmentationAtK(segments: PegasusSegment[], references: GroundTruthClip[], ks: number[]) {
  const ordered = segments.every((s) => s.confidence !== undefined)
    ? [...segments].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))
    : segments;
  const merged = mergeRanges(references);
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return ks.map((k) => {
    const picked = ordered.slice(0, k);
    return {
      k, count: picked.length,
      precision: picked.length ? round(picked.filter((s) => references.some((r) => isHit(s, r))).length / picked.length) : 0,
      recall: merged.length ? round(merged.filter((r) => picked.some((s) => isHit(s, r))).length / merged.length) : 0,
      minutes: Math.round(mergeRanges(picked).reduce((sum, r) => sum + r.end - r.start, 0) / 6) / 10,
    };
  });
}
