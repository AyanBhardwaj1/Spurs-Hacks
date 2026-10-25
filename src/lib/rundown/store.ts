import "server-only";

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Run } from "./types";

// Runs live in memory and are mirrored to `.rundown/` as JSON so a restart
// or a demo replay does not cost another round of API calls. Only IDs,
// timecodes and text are written. Media never touches the disk.

const DIR = process.env.RUNDOWN_DATA_DIR ?? path.join(process.cwd(), ".rundown");

const memory = globalThis as unknown as { rundownRuns?: Map<string, Run> };
const runs = (memory.rundownRuns ??= new Map<string, Run>());

async function writeJson(file: string, value: unknown) {
  try {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value));
  } catch {
    // Read-only filesystems, such as a serverless deploy, keep memory only.
  }
}

async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

export function saveRun(run: Run) {
  runs.set(run.id, run);
  return writeJson(path.join(DIR, "runs", `${run.id}.json`), run);
}

export async function getRun(id: string): Promise<Run | undefined> {
  if (!/^[\w-]+$/.test(id)) return undefined;
  const hit = runs.get(id);
  if (hit) return hit;
  const run = await readJson<Run>(path.join(DIR, "runs", `${id}.json`));
  if (run) runs.set(id, run);
  return run;
}

export async function listRuns(): Promise<Run[]> {
  try {
    for (const file of await readdir(path.join(DIR, "runs"))) {
      const id = file.replace(/\.json$/, "");
      if (!runs.has(id)) await getRun(id);
    }
  } catch {}
  return [...runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Memoises an expensive API answer on disk, keyed by its inputs. */
export async function cached<T>(namespace: string, key: unknown, fn: () => Promise<T>): Promise<T> {
  const hash = createHash("sha1").update(JSON.stringify(key)).digest("hex").slice(0, 16);
  const file = path.join(DIR, "cache", namespace, `${hash}.json`);
  const hit = await readJson<{ value: T }>(file);
  if (hit) return hit.value;
  const value = await fn();
  await writeJson(file, { key, value });
  return value;
}
