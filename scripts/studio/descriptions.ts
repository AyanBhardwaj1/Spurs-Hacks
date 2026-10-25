import type { Clip, Moment } from "../../src/lib/studio/types";
import { cached, hashOf, writeCache } from "./cache";
import { mapLimit } from "./claude";
import type { AnalyzeOptions } from "../../src/lib/twelvelabs";

export const PEGASUS_ASSET = "6adb0155c3de3d218f82d2d4";
const SCHEMA = { type: "object", properties: { sentences: { type: "array", items: { type: "string" } } }, required: ["sentences"] };

type Description = { sentences: string[] };
type Analyzer = (options: AnalyzeOptions) => Promise<Description>;

const analyze: Analyzer = async (options) => {
  const { twelvelabs } = await import("./server-modules");
  return twelvelabs.analyze<Description>(options);
};

export async function describeMoments(moments: Moment[], clips: Clip[], analyzer: Analyzer = analyze, wait: (ms: number) => Promise<unknown> = Bun.sleep): Promise<void> {
  const used = new Set(clips.flatMap((c) => c.segments.map((s) => s.momentId)));
  const ranked = [...moments].sort((a, b) => b.scores.total - a.scores.total);
  const targets = [...moments.filter((m) => used.has(m.id))];
  for (const m of ranked) if (targets.length < 16 && !targets.includes(m)) targets.push(m);
  // Four calls at once bounds provider pressure; this limit has no fresh timing measurement yet.
  const results = await mapLimit(targets, 4, async (m) => {
    const prompt = `Describe only what is visibly happening between source seconds ${m.start} and ${m.end} of this football broadcast. Return exactly two concise sentences in the sentences array. Describe action, camera views and visible reactions. Use player names only if visibly identifiable from the footage, otherwise describe kit or role. Do not infer names, score, intent or match context from commentary. Do not describe footage outside this time range.`;
    const key = `pegasus/${m.id}-${hashOf(PEGASUS_ASSET, "pegasus1.6", String(m.start), String(m.end), prompt, JSON.stringify(SCHEMA))}.json`;
    const { value } = await cached<Description>(key, async () => {
      if (process.env.TWELVELABS_PEGASUS_MODEL && process.env.TWELVELABS_PEGASUS_MODEL !== "pegasus1.6") throw new Error("Studio descriptions require pegasus1.6");
      // Three retries cap rate-limit recovery at four attempts, with 1/2/4-second backoff.
      for (let attempt = 0; ; attempt++) {
        try {
          return await analyzer({ assetId: PEGASUS_ASSET, start: m.start, end: m.end, prompt, schema: SCHEMA, maxTokens: 512 });
        } catch (error) {
          if (!(error instanceof Error) || !("status" in error) || error.status !== 429 || attempt === 3) throw error;
          await wait(1000 * 2 ** attempt);
        }
      }
    });
    if (!Array.isArray(value.sentences) || value.sentences.length === 0 || value.sentences.some((s) => typeof s !== "string" || !s.trim())) throw new Error(`Pegasus ${m.id}: expected non-empty sentences`);
    const sentences = value.sentences.join(" ").match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [];
    if (sentences.length < 2) throw new Error(`Pegasus ${m.id}: fewer than two sentences`);
    return sentences.slice(0, 2).map((s) => s.trim()).join(" ");
  });
  const rows = targets.map((m, i) => {
    m.description = results[i];
    m.evidence.push({ source: "twelvelabs-analysis", at: m.peak, strength: 1, detail: `Pegasus 1.6, asset ${PEGASUS_ASSET}, start_time=${m.start}, end_time=${m.end}: ${m.description}` });
    console.log(`[pegasus] ${m.id}: ${m.description}`);
    return { momentId: m.id, start: m.start, end: m.end, description: m.description };
  });
  writeCache("report/pegasus.json", { method: "analyze with start_time/end_time request parameters and explicit source seconds in the prompt", assetId: PEGASUS_ASSET, model: "pegasus1.6", rows });
}
