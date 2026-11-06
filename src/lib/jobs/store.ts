import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { NewJob } from "./requests";
import type { Job, JobStage, StageId, Word } from "./types";

// Jobs live in RUNDOWN_DATA_DIR/jobs/<id>/: job.json, the uploaded video, the transcript and the rendered
// clips. The video is the uploader's own and stays until the job is deleted. Every path is built here from
// a checked id and an allow-listed name, never from a raw request value.

export const dataDir = () => process.env.RUNDOWN_DATA_DIR ?? path.join(process.cwd(), ".rundown");
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CLIP_ID = /^[a-z0-9-]{1,80}$/;

export const isJobId = (id: string) => JOB_ID.test(id);
export const isClipId = (id: string) => CLIP_ID.test(id);

export function jobDir(id: string) {
  if (!isJobId(id)) throw new Error(`Not a job id: ${id}`);
  return path.join(dataDir(), "jobs", id);
}

/** The files a job may hold, by name. Anything else is not served. */
export const jobFile = {
  json: (id: string) => path.join(jobDir(id), "job.json"),
  partial: (id: string) => path.join(jobDir(id), "source.part"),
  source: (id: string, fileName: string) => path.join(jobDir(id), `source${path.extname(fileName).toLowerCase()}`),
  transcript: (id: string) => path.join(jobDir(id), "transcript.json"),
  work: (id: string) => path.join(jobDir(id), "work"),
  clip: (id: string, clipId: string) => {
    if (!isClipId(clipId)) throw new Error(`Not a clip id: ${clipId}`);
    return path.join(jobDir(id), "clips", `${clipId}.mp4`);
  },
  logo: (id: string, type: "png" | "jpg") => path.join(jobDir(id), `logo.${type}`),
  cover: (id: string, clipId: string) => {
    if (!isClipId(clipId)) throw new Error(`Not a clip id: ${clipId}`);
    return path.join(jobDir(id), "clips", `${clipId}.jpg`);
  },
};

const STAGES: { id: StageId; label: string }[] = [
  { id: "upload", label: "Upload the video" },
  { id: "probe", label: "Read the video" },
  { id: "audio", label: "Measure the crowd" },
  { id: "transcript", label: "Transcribe the commentary" },
  { id: "moments", label: "Find the moments" },
  { id: "plan", label: "Plan a cut for each platform" },
  { id: "focus", label: "Follow the play" },
  { id: "render", label: "Render the clips" },
];

// One process holds the jobs it runs; the JSON on disk is what a reload or a restart reads back.
const memory = globalThis as unknown as { rundownJobs?: Map<string, Job> };
const jobs = (memory.rundownJobs ??= new Map<string, Job>());

export async function saveJob(job: Job) {
  const file = jobFile.json(job.id);
  // No mkdir: createJob makes the folder, so a save that lands after a delete fails instead of bringing
  // the job back. Write then rename, so a poll never reads half a file.
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(job, null, 2));
  await rename(tmp, file);
  jobs.set(job.id, job);
}

export async function createJob(input: NewJob): Promise<Job> {
  const job: Job = {
    id: randomUUID(),
    title: input.title,
    sport: input.sport,
    placements: input.placements,
    ...(input.replay && { replay: true }),
    ...(input.colour && { brand: { colour: input.colour } }),
    createdAt: new Date().toISOString(),
    status: "uploading",
    upload: { fileName: input.fileName, size: input.size, received: 0 },
    stages: STAGES.map((s) => ({ ...s, state: s.id === "upload" ? "running" : "waiting" })),
    services: { transcript: false, model: false },
    moments: [],
    clips: [],
    skipped: [],
  };
  await mkdir(jobDir(job.id), { recursive: true });
  await saveJob(job);
  return job;
}

export async function getJob(id: string): Promise<Job | undefined> {
  if (!isJobId(id)) return undefined;
  const hit = jobs.get(id);
  if (hit) return hit;
  try {
    // Job folders are run-time data under RUNDOWN_DATA_DIR, not code to trace into the build.
    const job = JSON.parse(await readFile(/*turbopackIgnore: true*/ jobFile.json(id), "utf8")) as Job;
    jobs.set(id, job);
    return job;
  } catch {
    return undefined;
  }
}

export async function listJobs(): Promise<Job[]> {
  let ids: string[] = [];
  try {
    ids = (await readdir(path.join(dataDir(), "jobs"))).filter(isJobId);
  } catch {
    // No jobs folder yet means no jobs.
  }
  const all = await Promise.all(ids.map(getJob));
  return all.filter((j): j is Job => Boolean(j)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Deletes the job's folder under its lock, so no chunk or decision is half-written into it. */
export function deleteJob(id: string) {
  return withJob(id, async () => {
    jobs.delete(id);
    await rm(jobDir(id), { recursive: true, force: true });
  });
}

/** Appends a checked chunk to the partial upload and moves the file into place once it is whole. */
export async function appendChunk(job: Job, bytes: Uint8Array): Promise<Job> {
  // Written at the chunk's own offset and cut there, so a chunk repeated after a crash between this write
  // and the save below overwrites itself instead of piling up past `received`.
  const offset = job.upload.received;
  const received = offset + bytes.byteLength;
  const handle = await open(/*turbopackIgnore: true*/ jobFile.partial(job.id), offset === 0 ? "w" : "r+");
  try {
    await handle.write(bytes, 0, bytes.byteLength, offset);
    await handle.truncate(received);
  } finally {
    await handle.close();
  }
  const done = received === job.upload.size;
  if (done) {
    const partial = jobFile.partial(job.id);
    const size = (await stat(/*turbopackIgnore: true*/ partial)).size;
    if (size !== job.upload.size) throw new Error(`The upload holds ${size} bytes, not the ${job.upload.size} announced.`);
    await rename(partial, jobFile.source(job.id, job.upload.fileName));
  }
  const next: Job = {
    ...job,
    upload: { ...job.upload, received },
    status: done ? "queued" : "uploading",
    stages: done ? setStage(job.stages, "upload", { state: "done", endedAt: new Date().toISOString() }) : job.stages,
  };
  await saveJob(next);
  return next;
}

export function setStage(stages: JobStage[], id: StageId, patch: Partial<JobStage>): JobStage[] {
  return stages.map((s) => (s.id === id ? { ...s, ...patch } : s));
}

// Read-modify-write on one job runs one at a time: an upload chunk, a stage finishing and a producer's
// decision can all arrive together, and each must see the others' writes. The lock lives in this server
// process, which is enough for the one machine the app runs on.
const locks = new Map<string, Promise<unknown>>();

export function withJob<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const before = locks.get(id) ?? Promise.resolve();
  const run = before.then(fn, fn);
  const settled = run.then(
    () => undefined,
    () => undefined,
  );
  locks.set(id, settled);
  void settled.then(() => {
    if (locks.get(id) === settled) locks.delete(id);
  });
  return run;
}

/** Applies `change` to the job's latest saved state under its lock and saves the result. */
export function updateJob(id: string, change: (job: Job) => Job | Promise<Job>): Promise<Job> {
  return withJob(id, async () => {
    const job = await getJob(id);
    if (!job) throw new Error(`No job ${id}.`);
    const next = await change(job);
    await saveJob(next);
    return next;
  });
}

/** Marks a job whose source was written on the server, not uploaded, as ready to run. */
export function adoptSource(id: string, size: number, detail: string): Promise<Job> {
  return updateJob(id, (j) => ({
    ...j,
    status: "queued",
    upload: { ...j.upload, size, received: size },
    stages: setStage(j.stages, "upload", { state: "done", detail, endedAt: new Date().toISOString() }),
  }));
}

/** The job's saved transcript, or none when it had no transcript or the file cannot be read. */
export async function jobWords(id: string): Promise<Word[]> {
  try {
    return JSON.parse(await readFile(/*turbopackIgnore: true*/ jobFile.transcript(id), "utf8")) as Word[];
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.warn(`[jobs] ${id} transcript unreadable:`, err);
    return [];
  }
}
