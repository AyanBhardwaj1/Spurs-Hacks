import { PLACEMENTS } from "@/lib/rundown/platforms";
import { JOB_PLACEMENTS, SPORTS, type JobClip, type JobPlacement, type JobSport } from "./types";

// What the job routes accept, checked at the boundary. Pure, so every rule has a test.

/**
 * One upload chunk. Next's proxy buffers a request body in memory up to 10 MB, so a match goes up in
 * 8 MiB pieces that each stay under it; see proxyClientMaxBodySize in node_modules/next/dist/docs.
 */
export const CHUNK_BYTES = 8 * 1024 * 1024;
/** A two-hour 1080p broadcast is a few GB; the cap can be raised with RUNDOWN_MAX_UPLOAD_GB. */
const maxUploadBytes = () => Number(process.env.RUNDOWN_MAX_UPLOAD_GB || 12) * 1024 ** 3;
const VIDEO_FILE = /\.(mp4|mov|m4v|mkv|webm|mts|ts)$/i;
const TITLE_MAX = 120;

export type NewJob = { title: string; sport: JobSport; placements: JobPlacement[]; fileName: string; size: number; replay?: boolean };
type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseNewJob(body: unknown): Parsed<NewJob> {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Send a JSON body." };
  const { title, sport, placements, fileName, size, replay } = body as Record<string, unknown>;
  if (typeof title !== "string" || !title.trim() || title.trim().length > TITLE_MAX) return { ok: false, error: `Give the match a title of 1 to ${TITLE_MAX} characters.` };
  if (!SPORTS.includes(sport as JobSport)) return { ok: false, error: `sport must be one of ${SPORTS.join(", ")}.` };
  if (!Array.isArray(placements) || placements.length === 0 || !placements.every((p) => JOB_PLACEMENTS.includes(p as JobPlacement))) {
    return { ok: false, error: `Pick at least one platform from ${JOB_PLACEMENTS.join(", ")}.` };
  }
  if (typeof fileName !== "string" || !VIDEO_FILE.test(fileName)) return { ok: false, error: "Upload a video file: mp4, mov, m4v, mkv, webm or ts." };
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0) return { ok: false, error: "size must be the file's size in bytes." };
  if (size > maxUploadBytes()) return { ok: false, error: `The file is over the ${maxUploadBytes() / 1024 ** 3} GB upload limit.` };
  if (replay !== undefined && typeof replay !== "boolean") return { ok: false, error: "replay must be true or false." };
  return { ok: true, value: { title: title.trim(), sport: sport as JobSport, placements: [...new Set(placements as JobPlacement[])], fileName, size, ...(replay && { replay }) } };
}

type ChunkCheck = { ok: true } | { ok: false; status: 400 | 409 | 413; received?: number; error?: string };

/** A chunk must start exactly where the upload left off; a 409 tells the browser where to resume. */
export function checkChunk(upload: { received: number; size: number }, offset: number, length: number): ChunkCheck {
  if (length === 0) return { ok: false, status: 400, error: "The chunk is empty." };
  if (length > CHUNK_BYTES) return { ok: false, status: 413, error: `Send chunks of at most ${CHUNK_BYTES} bytes.` };
  if (offset !== upload.received) return { ok: false, status: 409, received: upload.received };
  if (offset + length > upload.size) return { ok: false, status: 400, error: "The chunk runs past the file's size." };
  return { ok: true };
}

/** A single `bytes=` range for a file of `size` bytes, null when there is none to honour. */
export function parseRange(header: string | null, size: number): { start: number; end: number } | "unsatisfiable" | null {
  const m = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!m || (m[1] === "" && m[2] === "")) return null;
  if (size === 0) return "unsatisfiable";
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (suffix === 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(m[1]);
  if (start >= size) return "unsatisfiable";
  const end = m[2] === "" ? size - 1 : Math.min(size - 1, Number(m[2]));
  return end < start ? "unsatisfiable" : { start, end };
}

/** The shortest a trimmed clip may be; anything shorter is not a clip anyone posts. */
const MIN_CLIP_SEC = 3;

/** New edges for a single-segment clip: inside the video, at least 3 s, at most the platform's limit. */
export function parseTrim(body: unknown, clip: Pick<JobClip, "placement" | "segments">, durationSec: number): Parsed<{ start: number; end: number }[]> {
  if (clip.segments.length !== 1) return { ok: false, error: "Only a single-moment clip can be trimmed; a highlights cut is made of several." };
  const { start, end } = (body ?? {}) as Record<string, unknown>;
  if (typeof start !== "number" || typeof end !== "number" || !Number.isFinite(start) || !Number.isFinite(end)) return { ok: false, error: "start and end must be source seconds." };
  if (start < 0 || end > durationSec) return { ok: false, error: `Keep the clip inside the video, 0 to ${Math.floor(durationSec)} s.` };
  const max = PLACEMENTS[clip.placement].maxSeconds;
  if (end - start < MIN_CLIP_SEC || end - start > max) return { ok: false, error: `A clip here runs ${MIN_CLIP_SEC} to ${max} s.` };
  return { ok: true, value: [{ start: Math.round(start * 1000) / 1000, end: Math.round(end * 1000) / 1000 }] };
}

/** Platforms to add to a finished job: known ones it does not have yet. */
export function parseAddPlacements(body: unknown, current: JobPlacement[]): Parsed<JobPlacement[]> {
  const placements = (body as { placements?: unknown } | null)?.placements;
  if (!Array.isArray(placements) || placements.length === 0 || !placements.every((p) => JOB_PLACEMENTS.includes(p as JobPlacement))) {
    return { ok: false, error: `Pick at least one platform from ${JOB_PLACEMENTS.join(", ")}.` };
  }
  const fresh = [...new Set(placements as JobPlacement[])].filter((p) => !current.includes(p));
  if (fresh.length === 0) return { ok: false, error: "The job already has those platforms." };
  return { ok: true, value: fresh };
}
