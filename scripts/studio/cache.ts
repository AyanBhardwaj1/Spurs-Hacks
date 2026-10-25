import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

// Everything the pipeline fetches or derives is cached under .media/studio
// (gitignored), so a rerun only redoes the steps whose cache file is missing.
// Only metadata, subtitle text and numbers land here, never video or audio.
const CACHE_DIR = join(import.meta.dir, "..", "..", ".media", "studio");
const WRITE_JOURNALS = new Set(["publish.json", "writeback.json", "reelstudio.json"]);

export function cachePath(name: string): string {
  return join(CACHE_DIR, name);
}

export function readCache<T>(name: string): T | undefined {
  const path = cachePath(name);
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, "utf8");
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    if (WRITE_JOURNALS.has(name)) {
      throw new Error(`Malformed Studio write journal ${name}; reconcile it before continuing`);
    }
    console.warn(`Ignoring unparseable Studio cache ${name}: ${error.message}`);
    return undefined;
  }
}

export function writeCache(name: string, value: unknown): void {
  const path = cachePath(name);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, typeof value === "string" ? value : JSON.stringify(value, null, 1), { flag: "wx" });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

type Meta = { durationMs: number; computedAt: string };

let misses = 0;
/** How many cache misses this process has computed so far; lets a stage tell whether it did real work. */
export const cacheMisses = () => misses;

/**
 * Returns the cached JSON value for `name`, computing and storing it on a miss.
 * `durationMs` is how long the compute took when it last ran, so a cached
 * rerun still reports real stage times.
 */
export async function cached<T>(
  name: string,
  compute: () => Promise<T>,
): Promise<{ value: T; hit: boolean; durationMs: number }> {
  const hit = readCache<T>(name);
  if (hit !== undefined) return { value: hit, hit: true, durationMs: readCache<Meta>(`${name}.meta`)?.durationMs ?? 0 };
  // For reruns that must not call Claude, Twelve Labs, ScorePlay or ffmpeg: stop at the first step that would.
  if (process.env.STUDIO_CACHE_ONLY === "1") throw new Error(`STUDIO_CACHE_ONLY is set and ${name} is not cached`);
  misses++;
  const started = performance.now();
  const value = await compute();
  const durationMs = Math.round(performance.now() - started);
  writeCache(name, value);
  writeCache(`${name}.meta`, { durationMs, computedAt: new Date().toISOString() } satisfies Meta);
  return { value, hit: false, durationMs };
}

export function hashOf(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 16);
}
