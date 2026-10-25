import { readFileSync, rmSync } from "node:fs";
import { cachePath, writeCache } from "./cache";

// Crowd loudness from the broadcast audio. The proxy's audio is dual mono, so
// commentary cannot be removed by cancelling the centre channel. Crowd noise
// is continuous while speech has gaps, so a low percentile of short frames
// (the noise floor) follows the crowd and mostly ignores the commentators.
// On the Mbeumo goal the floor rises from about -30 dB to -21 dB within three
// seconds of the commentator's call.

/** Length of one RMS frame. */
const FRAME_SEC = 0.1;
/** Frames around each second that the floor percentile is taken over. */
const FLOOR_WINDOW_SEC = 3;
const FLOOR_PERCENTILE = 0.2;
/** Stand-in for digital silence, which astats reports as -inf. */
const SILENCE_DB = -90;

export type CrowdFrames = { frameSec: number; durationSec: number; rmsDb: number[] };

/** Per-second crowd floor in dB: the 20th percentile of the frames in a window centred on each second. */
export function floorPerSecond(frames: CrowdFrames): number[] {
  const perSec = Math.round(1 / frames.frameSec);
  const half = Math.round((FLOOR_WINDOW_SEC * perSec) / 2);
  const seconds = Math.ceil(frames.rmsDb.length / perSec);
  const out: number[] = [];
  for (let s = 0; s < seconds; s++) {
    const centre = s * perSec + Math.floor(perSec / 2);
    const window = frames.rmsDb.slice(Math.max(0, centre - half), centre + half).sort((a, b) => a - b);
    out.push(window.length ? window[Math.floor(window.length * FLOOR_PERCENTILE)] : SILENCE_DB);
  }
  return out;
}

/** Streams the rendition's audio through ffmpeg and returns 100 ms RMS frames. Nothing but numbers touches disk. */
export async function measureCrowdFrames(url: string, durationSec: number): Promise<CrowdFrames> {
  const sampleRate = 16000;
  const samplesPerFrame = Math.round(sampleRate * FRAME_SEC);
  // ametadata can only print to a file; the file holds frame timestamps and RMS values.
  const printFile = "crowd-rms.txt";
  const filter = [
    "[0:a:0]pan=mono|c0=0.5*c0+0.5*c1",
    `aresample=${sampleRate}`,
    `asetnsamples=n=${samplesPerFrame}:p=0`,
    "astats=metadata=1:reset=1:measure_overall=RMS_level:measure_perchannel=none",
    `ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=${printFile}[out]`,
  ].join(",");
  const cmd = [
    "ffmpeg", "-v", "error", "-nostdin",
    "-reconnect", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "10",
    "-i", url, "-vn", "-filter_complex", filter, "-map", "[out]", "-f", "null", "-",
  ];
  writeCache(printFile, "");
  const proc = Bun.spawn(cmd, { cwd: cachePath(""), stdout: "ignore", stderr: "pipe" });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`ffmpeg exited ${code}: ${await new Response(proc.stderr).text()}`);
  const text = readFileSync(cachePath(printFile), "utf8");
  rmSync(cachePath(printFile));
  return { frameSec: FRAME_SEC, durationSec, rmsDb: parseRmsPrint(text, FRAME_SEC, durationSec) };
}

/** Parses ametadata print output into one RMS value per frame slot, placed by pts_time. */
function parseRmsPrint(text: string, frameSec: number, durationSec: number): number[] {
  const slots = Math.ceil(durationSec / frameSec);
  const out = new Array<number>(slots).fill(SILENCE_DB);
  let slot = -1;
  for (const line of text.split("\n")) {
    const pts = /pts_time:([\d.]+)/.exec(line);
    if (pts) {
      slot = Math.round(Number(pts[1]) / frameSec);
      continue;
    }
    const rms = /RMS_level=(\S+)/.exec(line);
    if (rms && slot >= 0 && slot < slots) {
      const db = Number(rms[1]);
      out[slot] = Number.isFinite(db) ? Math.max(SILENCE_DB, db) : SILENCE_DB;
    }
  }
  return out;
}
