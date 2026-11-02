import "server-only";

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PLACEMENTS } from "@/lib/rundown/platforms";
import { defaultFont } from "@/lib/rundown/render";
import { clipAss, captionEvents, fontFamily, renderArgs } from "./captions";
import { applyCopy, copyPrompt, COPY_SCHEMA, isCopyAnswer } from "./copy";
import { findPeaks } from "./energy";
import { lastLine, runFfmpeg } from "./ffmpeg";
import { audioPieces, crowdFloor, probe, sceneCuts } from "./media";
import { fuseMoments, matchClock } from "./moments";
import { openaiConfigured, structured, transcribePiece } from "./openai";
import { planClips } from "./planner";
import { jobFile, setStage, updateJob } from "./store";
import type { Job, JobMoment, StageId, Word } from "./types";

// Runs a job's stages in order, saving after each so the page can follow along. Jobs run one at a time:
// a render is a full ffmpeg encode, and a laptop or a single small server should not run two at once.
// Optional stages (the transcript, the model's copy) skip themselves with a reason; a failed clip render
// marks that clip and the rest carry on.

/** With no crowd or commentary signal at all, this many evenly spaced samples stand in for moments. */
const FALLBACK_SAMPLES = 6;

const queue = globalThis as unknown as { rundownJobQueue?: { ids: string[]; busy: boolean } };
const state = (queue.rundownJobQueue ??= { ids: [], busy: false });

/** Puts a fully uploaded job in line. Safe to call twice: a job in line or running is not added again. */
export function enqueue(id: string) {
  if (!state.ids.includes(id)) state.ids.push(id);
  void drain();
}

async function drain() {
  if (state.busy) return;
  state.busy = true;
  try {
    for (let id = state.ids.shift(); id; id = state.ids.shift()) {
      try {
        await runJob(id);
      } catch (err) {
        console.error(`[jobs] ${id} failed:`, err);
        await updateJob(id, (j) => ({ ...j, status: "failed", error: (err as Error).message })).catch(() => undefined);
      }
    }
  } finally {
    state.busy = false;
  }
}

const now = () => new Date().toISOString();

async function stage<T>(id: string, stageId: StageId, work: (job: Job) => Promise<{ value: T; detail?: string; skipped?: boolean }>): Promise<T> {
  const job = await updateJob(id, (j) => ({ ...j, status: "running", stages: setStage(j.stages, stageId, { state: "running", startedAt: now() }) }));
  try {
    const { value, detail, skipped } = await work(job);
    await updateJob(id, (j) => ({ ...j, stages: setStage(j.stages, stageId, { state: skipped ? "skipped" : "done", detail, endedAt: now() }) }));
    return value;
  } catch (err) {
    await updateJob(id, (j) => ({ ...j, stages: setStage(j.stages, stageId, { state: "failed", detail: (err as Error).message, endedAt: now() }) }));
    throw err;
  }
}

/** Evenly spaced windows, labelled as such, for a video with no crowd or commentary to go on. */
function samples(durationSec: number): JobMoment[] {
  return Array.from({ length: FALLBACK_SAMPLES }, (_, i) => {
    const peak = Math.round((durationSec * (i + 1)) / (FALLBACK_SAMPLES + 1));
    return { id: `m-${peak}`, peak, start: Math.max(0, peak - 15), end: Math.min(durationSec, peak + 10), score: 0.3, signals: [], title: `Sampled at ${matchClock(peak)}, no crowd or commentary to go on` };
  });
}

export async function runJob(id: string) {
  const first = await updateJob(id, (j) => j);
  const source = jobFile.source(id, first.upload.fileName);
  const work = jobFile.work(id);
  await mkdir(work, { recursive: true });

  const info = await stage(id, "probe", async () => {
    const value = await probe(source);
    await updateJob(id, (j) => ({ ...j, source: value }));
    return { value, detail: `${matchClock(value.durationSec)} at ${value.width}×${value.height}, ${value.hasAudio ? "with" : "no"} audio` };
  });

  const floor = await stage(id, "audio", async () => {
    if (!info.hasAudio) return { value: [] as number[], skipped: true, detail: "The video has no audio track." };
    const value = await crowdFloor(source, info.durationSec, work);
    return { value, detail: `${value.length} seconds measured` };
  });

  const words = await stage(id, "transcript", async () => {
    if (!info.hasAudio) return { value: [] as Word[], skipped: true, detail: "No audio to transcribe." };
    if (!openaiConfigured()) return { value: [] as Word[], skipped: true, detail: "No OpenAI key on the server; moments come from the crowd alone." };
    try {
      const pieces = await audioPieces(source, info.durationSec, work);
      const value: Word[] = [];
      for (const piece of pieces) {
        value.push(...(await transcribePiece(piece.file, piece.offset)));
        await rm(piece.file, { force: true });
      }
      await writeFile(jobFile.transcript(id), JSON.stringify(value));
      await updateJob(id, (j) => ({ ...j, services: { ...j.services, transcript: true } }));
      return { value, detail: `${value.length} words` };
    } catch (err) {
      // The transcript sharpens the picks and captions the clips; without it the job still has the crowd.
      console.warn(`[jobs] ${id} transcript failed:`, err);
      return { value: [] as Word[], skipped: true, detail: `Transcription failed, so moments come from the crowd alone: ${(err as Error).message}` };
    }
  });

  const moments = await stage(id, "moments", async () => {
    const cuts = await sceneCuts(source, work);
    let value = fuseMoments({ durationSec: info.durationSec, peaks: findPeaks(floor), words, cuts });
    if (value.length === 0) value = samples(info.durationSec);
    await updateJob(id, (j) => ({ ...j, moments: value }));
    const signal = value.some((m) => m.signals.length) ? "" : ", sampled evenly because nothing stood out";
    return { value, detail: `${value.length} moments${signal}` };
  });

  await stage(id, "plan", async (job) => {
    const plan = planClips({ moments, placements: job.placements, durationSec: info.durationSec, sport: job.sport, title: job.title });
    const { skipped } = plan;
    let { clips } = plan;
    let detail = `${clips.length} clips across ${job.placements.length} platforms`;
    if (openaiConfigured() && clips.length > 0) {
      try {
        const { system, user } = copyPrompt(clips, moments, job.sport, job.title);
        clips = applyCopy(clips, await structured({ name: "clip_copy", system, user, schema: COPY_SCHEMA, check: isCopyAnswer }));
        await updateJob(id, (j) => ({ ...j, services: { ...j.services, model: true } }));
        detail += ", copy written by the model";
      } catch (err) {
        console.warn(`[jobs] ${id} copy failed:`, err);
        detail += `, rule copy because the model failed: ${(err as Error).message}`;
      }
    }
    await updateJob(id, (j) => ({ ...j, clips, skipped }));
    return { value: undefined, detail };
  });

  await stage(id, "render", async (job) => {
    const font = defaultFont();
    let ready = 0;
    for (const clip of job.clips) {
      await updateJob(id, (j) => ({ ...j, clips: j.clips.map((c) => (c.id === clip.id ? { ...c, render: { state: "rendering" } } : c)) }));
      const result = await renderOne(id, clip.id, source, words, info.hasAudio, font).then(
        (file) => ({ state: "ready" as const, file }),
        (err: Error) => ({ state: "failed" as const, error: err.message }),
      );
      if (result.state === "ready") ready += 1;
      await updateJob(id, (j) => ({ ...j, clips: j.clips.map((c) => (c.id === clip.id ? { ...c, render: result } : c)) }));
    }
    return { value: undefined, detail: `${ready} of ${job.clips.length} rendered` };
  });

  await rm(work, { recursive: true, force: true });
  await updateJob(id, (j) => ({ ...j, status: "done" }));
}

async function renderOne(id: string, clipId: string, source: string, words: Word[], hasAudio: boolean, font: string | undefined) {
  const job = await updateJob(id, (j) => j);
  const clip = job.clips.find((c) => c.id === clipId);
  if (!clip) throw new Error(`No clip ${clipId}.`);
  const p = PLACEMENTS[clip.placement];
  const output = jobFile.clip(id, clip.id);
  const dir = path.join(jobFile.work(id), clip.id);
  await mkdir(dir, { recursive: true });
  await mkdir(path.dirname(output), { recursive: true });
  const captions = clipAss({
    width: p.width,
    height: p.height,
    safeTop: p.safeTop,
    safeBottom: p.safeBottom,
    hook: clip.hook,
    font: font ? fontFamily(font) : "Arial",
    captions: captionEvents(words, clip.segments),
  });
  await writeFile(path.join(dir, "captions.ass"), captions);
  const args = renderArgs({ source, segments: clip.segments, width: p.width, height: p.height, captions: "captions.ass", fontsDir: font ? path.dirname(font) : undefined, output, hasAudio });
  const run = await runFfmpeg(args, { cwd: dir, timeoutMs: 900_000 });
  await rm(dir, { recursive: true, force: true });
  if (run.code !== 0) throw new Error(`ffmpeg failed: ${lastLine(run.stderr)}`);
  return path.basename(output);
}
