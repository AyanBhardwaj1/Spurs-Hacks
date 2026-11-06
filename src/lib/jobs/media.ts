import "server-only";

import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { FRAME_SEC, floorPerSecond, parseRmsPrint } from "./energy";
import { MOTION } from "./focus";
import { lastLine, runFfmpeg } from "./ffmpeg";
import { parseCopyTime, parseProbe, parseSceneCuts } from "./probe";
import type { SourceInfo } from "./types";

// What the job engine reads from an uploaded video with ffmpeg. Every call takes the file's path and a
// working folder inside the job, and leaves nothing behind but the files it says it writes.

export async function probe(file: string): Promise<SourceInfo> {
  // With no output file ffmpeg exits 1 after printing the banner, which is all this needs.
  const { stderr } = await runFfmpeg(["-i", file], { timeoutMs: 60_000 });
  const info = parseProbe(stderr);
  if (info.durationSec > 0) return info;
  // No length in the header: copy every packet to nowhere, which reads the whole file without decoding it.
  const pass = await runFfmpeg(["-v", "info", "-i", file, "-map", "0", "-c", "copy", "-f", "null", "-"], { timeoutMs: 30 * 60_000 });
  const durationSec = parseCopyTime(pass.stderr);
  if (durationSec <= 0) throw new Error("The file has no length ffmpeg can measure; it may be cut off.");
  return { ...info, durationSec };
}

/** The per-second crowd floor in dB, from 100 ms RMS frames of the audio mixed to mono. */
export async function crowdFloor(file: string, durationSec: number, workDir: string): Promise<number[]> {
  const sampleRate = 16000;
  // ametadata can only print to a file; it holds frame timestamps and RMS values, nothing else.
  const printFile = "rms.txt";
  const filter = [
    "[0:a:0]aformat=channel_layouts=mono",
    `aresample=${sampleRate}`,
    `asetnsamples=n=${Math.round(sampleRate * FRAME_SEC)}:p=0`,
    "astats=metadata=1:reset=1:measure_overall=RMS_level:measure_perchannel=none",
    `ametadata=mode=print:key=lavfi.astats.Overall.RMS_level:file=${printFile}[out]`,
  ].join(",");
  // Decoding a two-hour match's audio takes minutes, not seconds; the default 10 minutes is too tight.
  const run = await runFfmpeg(["-v", "error", "-i", file, "-vn", "-filter_complex", filter, "-map", "[out]", "-f", "null", "-"], { cwd: workDir, timeoutMs: 1_800_000 });
  const printed = path.join(workDir, printFile);
  try {
    if (run.code !== 0) throw new Error(`Measuring the crowd failed: ${lastLine(run.stderr)}`);
    const rmsDb = parseRmsPrint(await readFile(printed, "utf8"), FRAME_SEC, durationSec);
    return floorPerSecond({ frameSec: FRAME_SEC, durationSec, rmsDb });
  } finally {
    await rm(printed, { force: true });
  }
}

/** The audio as 16 kHz mono MP3 pieces of `pieceSec` each, small enough for a speech-to-text upload. */
export async function audioPieces(file: string, durationSec: number, workDir: string, pieceSec = 600): Promise<{ file: string; offset: number }[]> {
  const pieces: { file: string; offset: number }[] = [];
  for (let offset = 0; offset < durationSec; offset += pieceSec) {
    const out = path.join(workDir, `audio-${String(pieces.length).padStart(3, "0")}.mp3`);
    const run = await runFfmpeg(["-v", "error", "-ss", String(offset), "-t", String(pieceSec), "-i", file, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "32k", "-y", out]);
    if (run.code !== 0) throw new Error(`Extracting audio failed: ${lastLine(run.stderr)}`);
    pieces.push({ file: out, offset });
  }
  return pieces;
}

/** Source seconds where the picture cuts to another shot, so a clip can start on a cut instead of mid-shot. */
export async function sceneCuts(file: string, workDir: string): Promise<number[]> {
  // A small, low-rate copy of the picture is enough to see a cut and keeps a two-hour match fast. The cut
  // times go to a file, since a long match prints more than the runner keeps of stderr.
  const printFile = "cuts.txt";
  const filter = `fps=5,scale=160:-2,scdet=threshold=12,metadata=mode=print:key=lavfi.scd.time:file=${printFile}`;
  const printed = path.join(workDir, printFile);
  try {
    const run = await runFfmpeg(["-v", "error", "-i", file, "-an", "-vf", filter, "-f", "null", "-"], { cwd: workDir, timeoutMs: 1_800_000 });
    if (run.code !== 0) return [];
    return parseSceneCuts(await readFile(printed, "utf8"));
  } catch (err) {
    // Cuts only tidy a clip's edges; without them the clip keeps its timed edges.
    console.warn("[jobs] scene detection failed:", err);
    return [];
  } finally {
    await rm(printed, { force: true });
  }
}

/** Small RGB frames of one window, for measuring the camera's pan and finding cuts. */
export async function motionFrames(file: string, start: number, end: number, fps: number): Promise<Uint8Array[]> {
  const run = await runFfmpeg([
    "-v", "error", "-ss", start.toFixed(2), "-t", (end - start).toFixed(2), "-i", file,
    "-an", "-vf", `fps=${fps},scale=${MOTION.width}:${MOTION.height}:flags=area`, "-pix_fmt", "rgb24", "-f", "rawvideo", "-",
  ], { timeoutMs: 300_000 });
  if (run.code !== 0) throw new Error(`Reading frames failed: ${lastLine(run.stderr)}`);
  const size = MOTION.width * MOTION.height * 3;
  const frames: Uint8Array[] = [];
  for (let at = 0; at + size <= run.stdout.length; at += size) frames.push(new Uint8Array(run.stdout.subarray(at, at + size)));
  return frames;
}

/** Sampled JPEGs of one window as base64; ffmpeg's MJPEG frames each start with an SOI marker, where the stream is split. */
export async function sampledJpegs(file: string, start: number, end: number, fps: number, width = 512): Promise<string[]> {
  const run = await runFfmpeg([
    "-v", "error", "-ss", start.toFixed(2), "-t", (end - start).toFixed(2), "-i", file,
    "-an", "-vf", `fps=${fps},scale=${width}:-2`, "-q:v", "5", "-f", "image2pipe", "-c:v", "mjpeg", "-",
  ], { timeoutMs: 300_000 });
  if (run.code !== 0) throw new Error(`Sampling frames failed: ${lastLine(run.stderr)}`);
  const bytes = run.stdout;
  const starts: number[] = [];
  for (let i = 0; i + 2 < bytes.length; i++) if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) starts.push(i);
  return starts.map((s, k) => bytes.subarray(s, starts[k + 1] ?? bytes.length).toString("base64"));
}
