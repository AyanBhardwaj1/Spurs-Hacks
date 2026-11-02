import { readFileSync, rmSync } from "node:fs";
import { parseRmsPrint, type CrowdFrames } from "../../src/lib/jobs/energy";
import { cachePath, writeCache } from "./cache";

export { floorPerSecond, type CrowdFrames } from "../../src/lib/jobs/energy";

// Crowd loudness from the broadcast audio. The proxy's audio is dual mono, so
// commentary cannot be removed by cancelling the centre channel. Crowd noise
// is continuous while speech has gaps, so a low percentile of short frames
// (the noise floor) follows the crowd and mostly ignores the commentators.
// On the Mbeumo goal the floor rises from about -30 dB to -21 dB within three
// seconds of the commentator's call.

const FRAME_SEC = 0.1;

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
