import "server-only";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import ffmpegStatic from "ffmpeg-static";
import { isFeedSegmentUrl, LIVE_PLAYLIST_URL, parsePlaylist, segmentUrl, type FeedSegment } from "./live";
import { HISTORY_SEGMENTS, parseRmsFrames, segmentFloorDb, segmentsToMeasure, type SegmentReading } from "./live-signal";
import { limiter, settledBy, sharedInFlight } from "./live-work";

// The server half of the live crowd meter. Each request measures a few feed segments the browser does
// not have yet: the segment is fetched into memory and piped through ffmpeg, which reports 100 ms RMS
// levels; only those numbers leave this file. Nothing is written to disk.
//
// On Vercel each request may land on a fresh instance, so no request relies on an earlier one. The
// browser keeps the history and runs the spike test. Within one instance, requests share work: a segment
// already being measured is not measured twice, and at most FFMPEG_AT_ONCE ffmpeg processes run.

/**
 * Segments one request asks for. New segments come first; the rest backfill the browser's history, so a
 * fresh page has its 90 s in about half a minute of polls.
 */
const BUDGET = { total: 3, forward: 2, history: HISTORY_SEGMENTS };
/** ffmpeg processes per instance, across all requests. One takes about 0.35 s on a 2 s segment. */
const FFMPEG_AT_ONCE = 2;
/**
 * Time limits. A request answers within REQUEST_MS with whatever finished, inside the route's
 * maxDuration of 10 s. The playlist read gets PLAYLIST_MS of that; a measurement, from joining the queue
 * to ffmpeg's exit, gets MEASURE_MS, so work a request started ends by PLAYLIST_MS + MEASURE_MS = 7.5 s.
 */
const REQUEST_MS = 8000;
const PLAYLIST_MS = 2500;
const MEASURE_MS = 5000;
const PLAYLIST_TTL_MS = 1000;
/** A feed segment is about 0.8 MB; anything past this is not a segment. */
const MAX_SEGMENT_BYTES = 5 * 1024 * 1024;
const CACHE_SIZE = 120;

export type LiveSignal =
  | { readings: SegmentReading[]; playlist: FeedSegment[]; edgeSeq: number }
  | { unavailable: string; playlist: FeedSegment[]; edgeSeq: number };

/** ffmpeg could not be started at all, as opposed to failing on one segment. */
class FfmpegUnavailable extends Error {}

/**
 * FFMPEG_PATH when set; otherwise the binary ffmpeg-static ships for this platform (the one Vercel's
 * functions get, through outputFileTracingIncludes in next.config.ts); otherwise ffmpeg on the PATH.
 */
function ffmpegBinary(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  if (ffmpegStatic && existsSync(ffmpegStatic)) return ffmpegStatic;
  return "ffmpeg";
}

let playlist: { at: number; segments: Promise<FeedSegment[]> } | undefined;

function readPlaylist(): Promise<FeedSegment[]> {
  if (!playlist || Date.now() - playlist.at > PLAYLIST_TTL_MS) {
    const segments = fetch(LIVE_PLAYLIST_URL, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(PLAYLIST_MS) }).then(async (res) => {
      if (!res.ok) throw new Error(`The live playlist answered ${res.status}`);
      return parsePlaylist(await res.text());
    });
    const entry = { at: Date.now(), segments };
    playlist = entry;
    segments.catch(() => {
      if (playlist === entry) playlist = undefined;
    });
  }
  return playlist.segments;
}

/** The segment's bytes, refusing other hosts, redirects and anything larger than a segment. */
async function fetchSegment(url: string, signal: AbortSignal): Promise<Buffer> {
  if (!isFeedSegmentUrl(url)) throw new Error(`not a ScorePlay CDN segment URL: ${url}`);
  const res = await fetch(url, { redirect: "error", signal });
  if (!res.ok || !res.body) throw new Error(`segment answered ${res.status}`);
  if (Number(res.headers.get("content-length")) > MAX_SEGMENT_BYTES) throw new Error("segment is larger than 5 MB");
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_SEGMENT_BYTES) {
      await reader.cancel();
      throw new Error("segment is larger than 5 MB");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** 100 ms RMS frames of a segment's audio, piped through ffmpeg. Aborting `signal` kills ffmpeg. */
function rmsFrames(bytes: Buffer, signal: AbortSignal): Promise<number[]> {
  const filter = [
    "[0:a:0]pan=mono|c0=0.5*c0+0.5*c1",
    "aresample=16000",
    "asetnsamples=n=1600:p=0",
    "astats=metadata=1:reset=1:measure_overall=RMS_level:measure_perchannel=none",
    // "-" is ffmpeg's own stdout pipe. /dev/stdout doesn't exist inside a Vercel function
    // ("Could not open /dev/stdout: No such device or address"), so the meter failed there.
    "ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=-[out]",
  ].join(",");
  return new Promise((resolve, reject) => {
    // The binary reaches the function through outputFileTracingIncludes, so the spawn needs no tracing,
    // which would otherwise pull the whole project into this route.
    const proc = spawn(
      /*turbopackIgnore: true*/ ffmpegBinary(),
      ["-v", "error", "-nostdin", "-f", "mpegts", "-i", "pipe:0", "-vn", "-filter_complex", filter, "-map", "[out]", "-f", "null", "-"],
      { signal, killSignal: "SIGKILL" },
    );
    let out = "";
    let err = "";
    proc.stdout.on("data", (chunk) => (out += chunk));
    proc.stderr.on("data", (chunk) => (err += chunk));
    proc.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "ENOENT" || e.code === "EACCES") reject(new FfmpegUnavailable(`ffmpeg cannot run here (${e.code})`));
      else if (e.name === "AbortError") reject(new Error(`ffmpeg was stopped at the ${MEASURE_MS} ms limit`));
      else reject(e);
    });
    proc.on("close", (code, killed) => {
      if (killed) return reject(new Error(`ffmpeg was stopped (${killed})`));
      if (code !== 0) return reject(new Error(`ffmpeg exited ${code}: ${err.trim().slice(0, 200)}`));
      resolve(parseRmsFrames(out));
    });
    // ffmpeg may exit before reading all of stdin (a bad segment); "close" reports that.
    proc.stdin.on("error", () => {});
    proc.stdin.end(bytes);
  });
}

const ffmpegSlot = limiter(FFMPEG_AT_ONCE);
const inFlight = sharedInFlight<string, number>();
/** Measured floors by sequence number. The segment number is kept so a restarted feed never reuses one. */
const cache = new Map<number, { n: number; floorDb: number }>();

/** The segment's crowd floor. Shared with any request already measuring it; bounded by MEASURE_MS. */
function floorOf(seg: FeedSegment): Promise<number> {
  const hit = cache.get(seg.seq);
  if (hit && hit.n === seg.n) return Promise.resolve(hit.floorDb);
  return inFlight(`${seg.seq}:${seg.n}`, async () => {
    const signal = AbortSignal.timeout(MEASURE_MS);
    const floorDb = await ffmpegSlot(async () => segmentFloorDb(await rmsFrames(await fetchSegment(seg.url, signal), signal)), signal);
    cache.set(seg.seq, { n: seg.n, floorDb });
    if (cache.size > CACHE_SIZE) cache.delete(Math.min(...cache.keys()));
    return floorDb;
  });
}

/**
 * Readings for the segments this request should measure, given the newest and oldest the browser holds.
 * Answers by REQUEST_MS with what finished; a segment still running is left out and asked for again.
 */
export async function liveSignal(have: { after?: number; before?: number }): Promise<LiveSignal> {
  const deadline = AbortSignal.timeout(REQUEST_MS);
  const segments = await readPlaylist();
  const edge = segments[segments.length - 1];
  if (!edge) throw new Error("The live playlist lists no segments");
  if (!isFeedSegmentUrl(edge.url)) throw new Error(`The live playlist lists a segment off ScorePlay's CDN: ${edge.url}`);

  const wanted = segmentsToMeasure(edge.seq, have, BUDGET).flatMap((seq): FeedSegment[] => {
    const listed = segments.find((s) => s.seq === seq);
    if (listed) return [listed];
    const n = edge.n - (edge.seq - seq);
    // Before the loop restarted at segment 0 there is no number to fetch by.
    if (n < 0) return [];
    return [{ seq, n, url: segmentUrl(edge.url, n), airsAt: edge.airsAt - (edge.seq - seq) * edge.durationSec * 1000, durationSec: edge.durationSec }];
  });

  const results = await settledBy(wanted.map(floorOf), deadline);
  const unavailable = results.find((r) => r?.status === "rejected" && r.reason instanceof FfmpegUnavailable);
  if (unavailable?.status === "rejected") {
    console.warn(`[studio live] ${(unavailable.reason as Error).message}`);
    return { unavailable: (unavailable.reason as Error).message, playlist: segments, edgeSeq: edge.seq };
  }
  const readings = results.flatMap((r, i): SegmentReading[] => {
    const seg = wanted[i];
    const base = { seq: seg.seq, n: seg.n, airsAt: seg.airsAt };
    if (!r) return [];
    if (r.status === "fulfilled") return [{ ...base, floorDb: r.value }];
    console.warn(`[studio live] segment ${seg.n}: ${(r.reason as Error).message}`);
    return [{ ...base, error: (r.reason as Error).message }];
  });
  return { readings, playlist: segments, edgeSeq: edge.seq };
}
