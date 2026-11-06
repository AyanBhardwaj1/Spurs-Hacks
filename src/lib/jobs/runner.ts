import "server-only";

import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PLACEMENTS } from "@/lib/rundown/platforms";
import { defaultFont } from "@/lib/rundown/render";
import { clipAss, captionEvents, fontFamily, logoPlacement, renderArgs } from "./captions";
import { anchorsFrom, ANCHOR_SCHEMA, ANCHOR_SYSTEM, isAnchorAnswer } from "./anchors";
import { coverArgs, coverAss, coverTime } from "./cover";
import { applyCopy, copyPrompt, COPY_SCHEMA, isCopyAnswer } from "./copy";
import { findPeaks, settleAfter } from "./energy";
import { cropShare, focusKeys, MOTION, motionSteps, type Anchor } from "./focus";
import { lastLine, runFfmpeg } from "./ffmpeg";
import { audioPieces, crowdFloor, motionFrames, probe, sampledJpegs, sceneCuts } from "./media";
import { fuseMoments, matchClock } from "./moments";
import { SPORT } from "./sports";
import { openaiConfigured, structured, transcribePiece } from "./openai";
import { clipSeconds, planClips } from "./planner";
import { dataDir, jobFile, jobWords, listJobs, setStage, updateJob } from "./store";
import type { Job, JobMoment, SourceInfo, StageId, Word } from "./types";

// Runs a job's stages in order, saving after each so the page can follow along. Jobs run one at a time:
// a render is a full ffmpeg encode, and a laptop or a single small server should not run two at once.
// Optional stages (the transcript, the model's copy) skip themselves with a reason; a failed clip render
// marks that clip and the rest carry on.

/** With no crowd or commentary signal at all, this many evenly spaced samples stand in for moments. */
const FALLBACK_SAMPLES = 6;

/** A job that a restart interrupts this many times is failed rather than run again: it may be what crashes. */
const MAX_ATTEMPTS = 2;

/** A full run of a job, or a render of some of its clips after a trim or an added platform. */
type Task = { id: string; clipIds?: string[]; writeCopy?: boolean };
type QueueState = { tasks: Task[]; busy: boolean; running?: string; recovered: Map<string, Promise<void>> };
const queue = globalThis as unknown as { rundownJobQueue?: QueueState };
const state: QueueState = (queue.rundownJobQueue ??= { tasks: [], busy: false, recovered: new Map() });

/** Whether this server process has the job in line or running. The saved status can outlive the process. */
export const isActive = (id: string) => state.running === id || state.tasks.some((t) => t.id === id);

/**
 * Puts a fully uploaded job in line. Safe to call twice: a job in line or running is not added again.
 * RUNDOWN_RUNNER=off takes uploads without running them, for tests or a server that only receives.
 */
export function enqueue(id: string) {
  if (!state.tasks.some((t) => t.id === id && !t.clipIds)) state.tasks.push({ id });
  if (process.env.RUNDOWN_RUNNER !== "off") void drain();
}

/** Puts a render of some clips in line, joining one already waiting for the same job. */
export function enqueueRender(id: string, clipIds: string[], { writeCopy = false } = {}) {
  const waiting = state.tasks.find((t) => t.id === id && t.clipIds);
  if (waiting) {
    waiting.clipIds = [...new Set([...waiting.clipIds!, ...clipIds])];
    waiting.writeCopy ||= writeCopy;
  } else state.tasks.push({ id, clipIds, writeCopy });
  if (process.env.RUNDOWN_RUNNER !== "off") void drain();
}

/** The job ids waiting to run, oldest first. */
export const queuedJobs = () => state.tasks.map((t) => t.id);

async function drain() {
  if (state.busy) return;
  state.busy = true;
  try {
    for (let task = state.tasks.shift(); task; task = state.tasks.shift()) {
      const { id } = task;
      state.running = id;
      try {
        await (task.clipIds ? runRender(id, task.clipIds, task.writeCopy) : runJob(id));
      } catch (err) {
        console.error(`[jobs] ${id} failed:`, err);
        await updateJob(id, (j) => ({ ...j, status: "failed", error: (err as Error).message })).catch((e) => console.error(`[jobs] ${id} could not be marked failed:`, e));
      } finally {
        state.running = undefined;
      }
    }
  } finally {
    state.busy = false;
  }
}

/**
 * Picks up after a restart, once per data folder: a job saved as queued or running that this process is
 * not running is started again from the top, until it has been interrupted MAX_ATTEMPTS times.
 */
export function recoverJobs(): Promise<void> {
  const key = dataDir();
  let done = state.recovered.get(key);
  if (!done) {
    done = (async () => {
      for (const job of await listJobs()) {
        if (isActive(job.id) || (job.status !== "queued" && job.status !== "running")) continue;
        const attempts = job.attempts ?? 0;
        if (job.status === "running" && attempts >= MAX_ATTEMPTS) {
          await updateJob(job.id, (j) => ({ ...j, status: "failed", error: `The server stopped during this job ${attempts} times; it was not started again.` }));
          continue;
        }
        await updateJob(job.id, (j) => ({
          ...j,
          status: "queued",
          attempts: j.status === "running" ? attempts + 1 : attempts,
          stages: j.stages.map((st) => (st.id === "upload" ? st : { id: st.id, label: st.label, state: "waiting" })),
        }));
        enqueue(job.id);
      }
    })();
    state.recovered.set(key, done);
  }
  return done;
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
    return { id: `m-${peak}-s${i + 1}`, peak, start: Math.max(0, peak - 15), end: Math.min(durationSec, peak + 10), score: 0.3, signals: [], title: `Sampled at ${matchClock(peak)}, no crowd or commentary to go on` };
  });
}

export async function runJob(id: string) {
  try {
    await runStages(id);
  } finally {
    // Audio pieces and per-clip folders go whether the job finished or failed.
    await rm(jobFile.work(id), { recursive: true, force: true });
  }
}

async function runStages(id: string) {
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
    let value = fuseMoments({ durationSec: info.durationSec, peaks: findPeaks(floor, SPORT[first.sport].gapSec), words, cuts, sport: first.sport });
    if (value.length === 0) value = samples(info.durationSec);
    // How long each roar lasted decides how long its cuts run on.
    value = value.map((m) => {
      const settle = m.signals.includes("crowd") ? settleAfter(floor, Math.round(m.peak)) : undefined;
      return settle === undefined ? m : { ...m, settle };
    });
    await updateJob(id, (j) => ({ ...j, moments: value }));
    const signal = value.some((m) => m.signals.length) ? "" : ", sampled evenly because nothing stood out";
    return { value, detail: `${value.length} moments${signal}` };
  });

  await stage(id, "plan", async (job) => {
    const plan = planClips({ moments, placements: job.placements, durationSec: info.durationSec, sport: job.sport, title: job.title, replay: job.replay });
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

  await stage(id, "focus", async (job) => {
    const windows = cropWindows(job, info);
    if (windows.size === 0) return { value: undefined, skipped: true, detail: "No clip crops the picture, so there is nothing to follow." };
    if (!openaiConfigured()) return { value: undefined, skipped: true, detail: "No OpenAI key on the server; vertical and square cuts are centred." };
    const { followed, failed } = await followMoments(id, source, windows);
    const missed = failed ? `; ${failed} kept a centred crop after the vision call failed` : "";
    return { value: undefined, detail: `Followed the play in ${followed} of ${windows.size} moments${missed}` };
  });

  await stage(id, "render", async (job) => {
    const ready = await renderClips(id, job.clips.map((c) => c.id), source, words, info.hasAudio);
    return { value: undefined, detail: `${ready} of ${job.clips.length} rendered` };
  });

  await updateJob(id, (j) => ({ ...j, status: "done" }));
}

/** Renders some clips of a finished job again: after a trim, or for platforms added later. */
async function runRender(id: string, clipIds: string[], writeCopy = false) {
  let job = await updateJob(id, (j) => ({ ...j, status: "running" }));
  const info = job.source;
  if (!info) throw new Error("The job has not been read yet, so its clips cannot be rendered.");
  const source = jobFile.source(id, job.upload.fileName);
  try {
    if (writeCopy && openaiConfigured()) {
      // Clips for a platform added later get the model's copy, like the ones planned in the first run.
      const fresh = job.clips.filter((c) => clipIds.includes(c.id));
      try {
        const { system, user } = copyPrompt(fresh, job.moments, job.sport, job.title);
        const answer = await structured({ name: "clip_copy", system, user, schema: COPY_SCHEMA, check: isCopyAnswer });
        const written = new Map(applyCopy(fresh, answer).map((c) => [c.id, c]));
        job = await updateJob(id, (j) => ({ ...j, clips: j.clips.map((c) => written.get(c.id) ?? c) }));
      } catch (err) {
        console.warn(`[jobs] ${id} copy for added clips failed, keeping rule copy:`, err);
      }
    }
    if (openaiConfigured()) {
      // Clips of a moment nobody has followed yet, such as one only a new platform uses, get followed now.
      const windows = cropWindows(job, info, (c) => clipIds.includes(c.id) && !job.moments.find((m) => m.id === c.momentId)?.focus);
      await followMoments(id, source, windows);
    }
    const words = job.services.transcript ? await jobWords(id) : [];
    await renderClips(id, clipIds, source, words, info.hasAudio);
  } finally {
    await rm(jobFile.work(id), { recursive: true, force: true });
  }
  await updateJob(id, (j) => ({ ...j, status: "done" }));
}

/** Follows the play for each window and saves the keys on its moment. A failed call leaves that moment centred. */
async function followMoments(id: string, source: string, windows: Map<string, { start: number; end: number; share: number }>) {
  let followed = 0;
  let failed = 0;
  for (const [momentId, w] of windows) {
    try {
      const keys = await followPlay(source, w.start, w.end, w.share);
      await updateJob(id, (j) => ({ ...j, moments: j.moments.map((m) => (m.id === momentId ? { ...m, focus: keys } : m)) }));
      followed += 1;
    } catch (err) {
      console.warn(`[jobs] ${id} focus for ${momentId} failed:`, err);
      failed += 1;
    }
  }
  return { followed, failed };
}

/** Renders the given clips one by one, recording each one's result. Returns how many are ready. */
async function renderClips(id: string, clipIds: string[], source: string, words: Word[], hasAudio: boolean) {
  const font = defaultFont();
  let ready = 0;
  for (const clipId of clipIds) {
    await updateJob(id, (j) => ({ ...j, clips: j.clips.map((c) => (c.id === clipId ? { ...c, render: { state: "rendering" } } : c)) }));
    const result = await renderOne(id, clipId, source, words, hasAudio, font).then(
      ({ file, cover }) => ({ state: "ready" as const, file, ...(cover && { cover }) }),
      (err: Error) => ({ state: "failed" as const, error: err.message }),
    );
    if (result.state === "ready") ready += 1;
    await updateJob(id, (j) => ({ ...j, clips: j.clips.map((c) => (c.id === clipId ? { ...c, render: result } : c)) }));
  }
  return ready;
}

/** The colour the word being said turns in burned-in captions. */
const CAPTION_HIGHLIGHT = "#FFD60A";

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
    captions: captionEvents(words, clip.segments, 3, { highlight: job.brand?.colour ?? CAPTION_HIGHLIGHT }),
    ...(clip.replay && { replayAt: { start: clipSeconds({ segments: clip.segments }), end: clipSeconds(clip) } }),
  });
  await writeFile(path.join(dir, "captions.ass"), captions);
  const focus = job.moments.find((m) => m.id === clip.momentId)?.focus;
  const logo = job.brand?.logo ? { file: jobFile.logo(id, job.brand.logo), ...logoPlacement(p.width, p.height, p.safeTop) } : undefined;
  const args = renderArgs({ source, segments: clip.segments, replay: clip.replay, logo, width: p.width, height: p.height, captions: "captions.ass", fontsDir: font ? path.dirname(font) : undefined, output, hasAudio, focus });
  const run = await runFfmpeg(args, { cwd: dir, timeoutMs: 900_000 });
  if (run.code !== 0) {
    await rm(dir, { recursive: true, force: true });
    throw new Error(`ffmpeg failed: ${lastLine(run.stderr)}`);
  }
  // A cover is a bonus: without one the clip still ships, and the page shows its first frame instead.
  const moment = job.moments.find((m) => m.id === clip.momentId);
  const coverFile = jobFile.cover(id, clip.id);
  await writeFile(path.join(dir, "cover.ass"), coverAss({ width: p.width, height: p.height, hook: clip.hook, font: font ? fontFamily(font) : "Arial" }));
  const coverRun = await runFfmpeg(
    coverArgs({ source, at: coverTime(moment, clip.segments), width: p.width, height: p.height, captions: "cover.ass", fontsDir: font ? path.dirname(font) : undefined, output: coverFile, focus, logo }),
    { cwd: dir, timeoutMs: 120_000 },
  );
  if (coverRun.code !== 0) console.warn(`[jobs] ${id} cover for ${clip.id} failed: ${lastLine(coverRun.stderr)}`);
  await rm(dir, { recursive: true, force: true });
  return { file: path.basename(output), cover: coverRun.code === 0 ? path.basename(coverFile) : undefined };
}

/** Vision marks one frame a second; the camera's pan is measured five times a second between them. */
const ANCHOR_FPS = 1;
const ANCHORS_PER_CALL = 20;

/** For each moment that a cropped clip uses: the stretch of source its cropped clips cover, and the narrowest crop. */
function cropWindows(job: Job, info: SourceInfo, include: (clip: Job["clips"][number]) => boolean = () => true) {
  const windows = new Map<string, { start: number; end: number; share: number }>();
  for (const clip of job.clips) {
    if (!include(clip)) continue;
    const share = cropShare(info, PLACEMENTS[clip.placement]);
    if (share >= 0.99 || clip.segments.length !== 1) continue;
    const [seg] = clip.segments;
    const w = windows.get(clip.momentId);
    windows.set(clip.momentId, w ? { start: Math.min(w.start, seg.start), end: Math.max(w.end, seg.end), share: Math.min(w.share, share) } : { ...seg, share });
  }
  return windows;
}

/** Focus keys for one window: the model marks the play on sampled frames, the measured camera pan fills in. */
async function followPlay(source: string, start: number, end: number, share: number) {
  const [frames, jpegs] = await Promise.all([motionFrames(source, start, end, MOTION.fps), sampledJpegs(source, start, end, ANCHOR_FPS)]);
  const anchors: Anchor[] = [];
  for (let from = 0; from < jpegs.length; from += ANCHORS_PER_CALL) {
    const batch = jpegs.slice(from, from + ANCHORS_PER_CALL);
    const answer = await structured({
      name: "play_position",
      system: ANCHOR_SYSTEM,
      user: `Give x for each of the ${batch.length} frames that follow, numbered 0 to ${batch.length - 1}.`,
      schema: ANCHOR_SCHEMA,
      check: isAnchorAnswer,
      images: batch,
    });
    anchors.push(...anchorsFrom(answer, batch.length));
  }
  return focusKeys(motionSteps(frames), anchors, start, MOTION.fps, ANCHOR_FPS, share);
}
