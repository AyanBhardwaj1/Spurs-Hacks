import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

type RecordedHit = { query: string; start: number; end: number; rank: number };

const inputDir = join(process.cwd(), ".media/studio/twelvelabs");
const outputPath = join(process.cwd(), "src/lib/studio/data/search-recorded.json");

const files = (await readdir(inputDir)).filter((file) => file.endsWith(".json")).sort();
const entries = new Map<string, Map<string, Omit<RecordedHit, "query">>>();
for (const file of files) {
  const parsed: unknown = JSON.parse(await readFile(join(inputDir, file), "utf8"));
  if (!Array.isArray(parsed)) continue;
  for (const value of parsed) {
    if (!value || typeof value !== "object") continue;
    const hit = value;
    if (!("query" in hit) || !("start" in hit) || !("end" in hit) || !("rank" in hit)) continue;
    if (typeof hit.query !== "string" || typeof hit.start !== "number" || typeof hit.end !== "number" || typeof hit.rank !== "number") continue;
    if (!hit.query.trim() || !Number.isFinite(hit.start) || !Number.isFinite(hit.end) || hit.start < 0 || hit.end <= hit.start || !Number.isInteger(hit.rank) || hit.rank < 1) throw new Error(`Invalid search hit in ${file}`);
    const hits = entries.get(hit.query) ?? new Map();
    const key = `${hit.start}:${hit.end}:${hit.rank}`;
    hits.set(key, { start: hit.start, end: hit.end, rank: hit.rank });
    entries.set(hit.query, hits);
  }
}

const output = [...entries.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([query, hits]) => ({
  query,
  hits: [...hits.values()].sort((a, b) => a.rank - b.rank || a.start - b.start),
}));
await mkdir(join(process.cwd(), "src/lib/studio/data"), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`);
console.log(`Wrote ${output.length} recorded queries to ${outputPath}`);
