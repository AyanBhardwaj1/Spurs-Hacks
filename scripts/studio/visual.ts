import type { Evidence, Moment } from "../../src/lib/studio/types";
import { cached, hashOf } from "./cache";
import { askClaude, mapLimit } from "./claude";

// A second, independent look at each moment. Claude turns the moment into one
// or two descriptions of what the camera shows, Twelve Labs searches the
// indexed match for them, and a hit that overlaps the moment confirms it.
// Search uses the visual modality only: the audio modality matches the
// commentary, which already decided the moment, so it would confirm nothing.

/** The full match in the Twelve Labs index. */
export const TWELVE_LABS_VIDEO_ID = "6adb019e5beb2f1510570778";
const MODALITIES = ["visual"];
/** Results per query. Rank 1 is the best match in the whole match. */
const RESULTS = 10;
/** A hit this close to a moment's range still counts as showing it. */
export const OVERLAP_MARGIN = 10;
const CONCURRENCY = 4;

/** Generic searches over the whole match, for moments the commentary may have missed. */
export const GENERIC_QUERIES = [
  "players celebrating a goal",
  "goalkeeper diving to make a save",
  "referee showing a red card",
  "sliding tackle",
  "fans celebrating in the stands",
  "shot narrowly missing the goal",
];

export type Hit = { query: string; start: number; end: number; rank: number };

/** Strength of a hit from its rank: 1 for rank 1, falling by 0.1 a place, 0.1 at rank 10. */
export function rankStrength(rank: number): number {
  return Math.round(Math.max(0, 1 - (rank - 1) / RESULTS) * 1000) / 1000;
}

/** Keeps hits whose range lies inside the source and runs forward; counts the rest. */
export function insideSource(hits: Hit[], durationSec: number): { valid: Hit[]; dropped: number } {
  const valid = hits.filter((h) => Number.isFinite(h.start) && Number.isFinite(h.end) && h.start >= 0 && h.end <= durationSec && h.start < h.end);
  return { valid, dropped: hits.length - valid.length };
}

const near = (hit: { start: number; end: number }, range: { start: number; end: number }, margin: number) =>
  hit.end > range.start - margin && hit.start < range.end + margin;

/** One piece of evidence per query: its best-ranked hit that overlaps the moment, if any. */
export function evidenceFor(moment: Pick<Moment, "start" | "end">, queries: string[], hits: Hit[]): Evidence[] {
  return queries.flatMap((query) => {
    const best = hits
      .filter((h) => h.query === query && near(h, moment, OVERLAP_MARGIN))
      .sort((a, b) => a.rank - b.rank)[0];
    if (!best) return [];
    return [
      {
        source: "twelvelabs-search" as const,
        detail: `"${query}" found at ${best.start.toFixed(0)}-${best.end.toFixed(0)} s, rank ${best.rank} of the match`,
        at: Math.round(best.start * 10) / 10,
        strength: rankStrength(best.rank),
      },
    ];
  });
}

/** Hits that overlap no moment, merged where they overlap each other: what the commentary may have missed. */
export function unmatched(hits: Hit[], moments: Pick<Moment, "start" | "end">[]): { start: number; end: number; queries: string[]; bestRank: number }[] {
  const loose = hits.filter((h) => !moments.some((m) => near(h, m, OVERLAP_MARGIN))).sort((a, b) => a.start - b.start);
  const out: { start: number; end: number; queries: string[]; bestRank: number }[] = [];
  for (const h of loose) {
    const last = out.at(-1);
    if (last && h.start < last.end) {
      last.end = Math.max(last.end, h.end);
      if (!last.queries.includes(h.query)) last.queries.push(h.query);
      last.bestRank = Math.min(last.bestRank, h.rank);
    } else {
      out.push({ start: h.start, end: h.end, queries: [h.query], bestRank: h.rank });
    }
  }
  return out;
}

// The server clients load with a top-level await. Loading them lazily keeps the pure helpers above importable
// without them, and one shared promise matters: when concurrent callers each start their own import, bun can
// hand the later ones the module before it has finished initialising.
let clients: Promise<typeof import("./server-modules")> | undefined;
const serverModules = () => (clients ??= import("./server-modules"));

/** A visual-only search of the match, cached by query, with every range checked against the source. */
export async function searchMatch(query: string, durationSec: number): Promise<{ hits: Hit[]; dropped: number }> {
  const { value } = await cached(`twelvelabs/${hashOf(TWELVE_LABS_VIDEO_ID, query, String(RESULTS), MODALITIES.join())}.json`, async () =>
    (await (await serverModules()).twelvelabs.search({ query, limit: RESULTS, videoIds: [TWELVE_LABS_VIDEO_ID], modalities: MODALITIES })).map((c) => ({
      query,
      start: c.start,
      end: c.end,
      rank: c.rank,
    })),
  );
  const { valid, dropped } = insideSource(value, durationSec);
  return { hits: valid, dropped };
}

const QUERY_SYSTEM = `You write search queries for a video index of one football match broadcast (Manchester United v Tottenham Hotspur). The index matches what the camera shows, not what is said, and does not know player names. For each moment, write one or two short queries (at most eight words) describing what is on screen at that moment: the action, the players' movement, the ball, the goalkeeper, the referee, the crowd. Examples: "goalkeeper diving save low to his left", "players celebrating in front of away fans", "referee holding up a red card". Do not use names, team names or the match clock.`;

const QUERY_SCHEMA = {
  type: "object",
  properties: {
    moments: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, queries: { type: "array", items: { type: "string" } } },
        required: ["id", "queries"],
      },
    },
  },
  required: ["moments"],
};

const QUERY_BATCH = 20;

/** One or two visual queries per moment, written by Claude on the configured tier. */
export async function queriesFor(moments: Moment[]): Promise<Map<string, string[]>> {
  const batches: Moment[][] = [];
  for (let i = 0; i < moments.length; i += QUERY_BATCH) batches.push(moments.slice(i, i + QUERY_BATCH));
  const answers = await mapLimit(batches, CONCURRENCY, (batch, i) =>
    askClaude<{ moments: { id: string; queries: string[] }[] }>({
      name: `visual-queries-${i}`,
      system: QUERY_SYSTEM,
      prompt: `Moments:\n${batch.map((m) => JSON.stringify({ id: m.id, kind: m.kind, title: m.title, summary: m.summary })).join("\n")}\n\nGive queries for every moment, by id.`,
      schema: QUERY_SCHEMA,
    }),
  );
  const out = new Map<string, string[]>();
  for (const a of answers) for (const m of a.value.moments) out.set(m.id, m.queries.map((q) => q.trim()).filter(Boolean).slice(0, 2));
  const missing = moments.filter((m) => !out.get(m.id)?.length).map((m) => m.id);
  if (missing.length) throw new Error(`Claude wrote no visual queries for ${missing.join(", ")}`);
  return out;
}

/** Runs every query, cached, a few at a time. */
export async function runQueries(queries: string[], durationSec: number): Promise<{ hits: Hit[]; dropped: number }> {
  const unique = [...new Set(queries)];
  const results = await mapLimit(unique, CONCURRENCY, (q) => searchMatch(q, durationSec));
  return { hits: results.flatMap((r) => r.hits), dropped: results.reduce((sum, r) => sum + r.dropped, 0) };
}
