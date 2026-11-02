import { MOTION, focusKeys, motionSteps } from "../../src/lib/jobs/focus";
import { askClaude, type PromptImage } from "./claude";

export { CROP_WIDTH, cameraShift, focusKeys, limitPan, mergeRefinedFocus, pathFromAnchors, type Step } from "../../src/lib/jobs/focus";

// The hackathon's focus pass: frames from a ScorePlay rendition, anchors from Claude, and the shared pan
// and cut rules in src/lib/jobs/focus.ts, which explains the approach. Frames reach ffmpeg's stdout and
// Claude's stdin only.

/** Default sampling; a refinement can use four anchors a second. */
const ANCHOR = { width: 960, perCall: 40 };
const W = MOTION.width;
const H = MOTION.height;

async function ffmpegStdout(args: string[]): Promise<Uint8Array> {
  const proc = Bun.spawn([process.env.FFMPEG_PATH || "ffmpeg", "-v", "error", "-nostdin", ...args, "-"], { stdout: "pipe", stderr: "pipe" });
  const [bytes, stderr, code] = await Promise.all([
    new Response(proc.stdout).arrayBuffer(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (code !== 0) throw new Error(`ffmpeg exited ${code}: ${stderr}`);
  return new Uint8Array(bytes);
}

async function motionFrames(url: string, start: number, end: number, fps: number): Promise<Uint8Array[]> {
  const bytes = await ffmpegStdout([
    "-ss", start.toFixed(2), "-t", (end - start).toFixed(2), "-i", url,
    "-an", "-vf", `fps=${fps},scale=${W}:${H}:flags=area`, "-pix_fmt", "rgb24", "-f", "rawvideo",
  ]);
  const size = W * H * 3;
  const frames: Uint8Array[] = [];
  for (let at = 0; at + size <= bytes.length; at += size) frames.push(bytes.subarray(at, at + size));
  return frames;
}

/** Sampled JPEGs; ffmpeg's MJPEG frames start with an SOI marker, which is where the stream is split. */
async function anchorFrames(url: string, start: number, end: number, fps: number): Promise<string[]> {
  const bytes = await ffmpegStdout([
    "-ss", start.toFixed(2), "-t", (end - start).toFixed(2), "-i", url,
    "-an", "-vf", `fps=${fps},scale=${ANCHOR.width}:-2`, "-q:v", "4", "-f", "image2pipe", "-c:v", "mjpeg",
  ]);
  const starts: number[] = [];
  for (let i = 0; i + 2 < bytes.length; i++) if (bytes[i] === 0xff && bytes[i + 1] === 0xd8 && bytes[i + 2] === 0xff) starts.push(i);
  return starts.map((s, k) => Buffer.from(bytes.subarray(s, starts[k + 1] ?? bytes.length)).toString("base64"));
}

const ANCHOR_SYSTEM = `You locate the action in frames from a football broadcast so that a vertical 9:16 crop can follow it. For each frame, give x: the horizontal position, from 0 (left edge) to 1 (right edge), where the crop should be centred. Use the ball when you can see it. Otherwise use the players contesting the ball or the space the ball is heading into. In a close-up, use the player in focus. In a crowd or bench shot, use the person or group the shot is about. Ignore the scoreboard graphic and on-screen text.`;

const ANCHOR_SCHEMA = {
  type: "object",
  properties: {
    frames: {
      type: "array",
      items: {
        type: "object",
        properties: { frame: { type: "integer" }, x: { type: "number", minimum: 0, maximum: 1 }, ballVisible: { type: "boolean" } },
        required: ["frame", "x", "ballVisible"],
      },
    },
  },
  required: ["frames"],
};

type AnchorAnswer = { frames: { frame: number; x: number; ballVisible: boolean }[] };

async function anchorsFor(name: string, url: string, start: number, end: number, fps: number): Promise<{ x: number; ballVisible: boolean }[]> {
  const jpegs = await anchorFrames(url, start, end, fps);
  const out: { x: number; ballVisible: boolean }[] = [];
  for (let from = 0; from < jpegs.length; from += ANCHOR.perCall) {
    const batch = jpegs.slice(from, from + ANCHOR.perCall);
    const images: PromptImage[] = batch.map((jpegBase64, i) => ({ label: `Frame ${i}`, jpegBase64 }));
    const { value } = await askClaude<AnchorAnswer>({
      name: `focus-${name}-${from}`,
      system: ANCHOR_SYSTEM,
      prompt: `Give x for each of the ${batch.length} frames above, numbered 0 to ${batch.length - 1}.`,
      schema: ANCHOR_SCHEMA,
      images,
    });
    const byFrame = new Map(value.frames.map((f) => [f.frame, f]));
    batch.forEach((_, i) => {
      const answer = byFrame.get(i);
      if (!answer) throw new Error(`Opus gave no position for frame ${i} of ${name} (batch from ${from})`);
      out.push({ x: answer.x, ballVisible: answer.ballVisible });
    });
  }
  return out;
}

/** Focus keys for one stretch of the source, and how many anchors saw the ball. */
export async function focusFor(name: string, url: string, start: number, end: number, anchorFps: 1 | 4 = 1) {
  // Four anchors a second need an integer number of motion frames between them.
  const motionFps = MOTION.fps * anchorFps;
  const [frames, anchors] = await Promise.all([
    motionFrames(url, start, end, motionFps), anchorsFor(name, url, start, end, anchorFps),
  ]);
  const motion = motionSteps(frames);
  return {
    keys: focusKeys(motion, anchors, start, motionFps, anchorFps),
    anchors: anchors.length,
    ballSeen: anchors.filter((a) => a.ballVisible).length,
    cuts: motion.filter((m, i) => i > 0 && m.cut).length,
  };
}
