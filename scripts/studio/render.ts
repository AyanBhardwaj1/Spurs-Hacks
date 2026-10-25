import type { Clip, FocusKey } from "../../src/lib/studio/types";
import { hashOf } from "./cache";
import type { Graphics } from "./graphics";
import type { PublishedClip } from "./published";

/** `graphics` is Graphics.key; left out, the key matches renders made before clip graphics existed. */
export function renderKey(clip: Pick<Clip, "segments" | "format" | "title">, focus: Map<string, FocusKey[]>, source: NonNullable<PublishedClip["renderSource"]>, graphics?: string): string {
  return hashOf(JSON.stringify({
    segments: clip.segments,
    format: clip.format,
    title: clip.title,
    focus: clip.format === "16:9" ? [] : clip.segments.map((s) => segmentKeys(focus.get(s.momentId ?? "") ?? [], s.start, s.end)),
    source,
    ...(graphics ? { graphics } : {}),
  }));
}

// Builds the ffmpeg command for one planned clip. Every segment is read from
// the ScorePlay rendition by URL. Portrait and square clips crop around their
// moments' focus keys, with the crop's x driven by an expression in t, so the
// window pans with the play; 16:9 is scaled as is. The clip title is burned in.

export type RenderInput = {
  clip: Clip;
  url: string;
  /** Focus keys by moment ID; a segment without keys is cropped at the centre. */
  focus: Map<string, FocusKey[]>;
  fontFile: string;
  /**
   * By segment, the fraction of the source height to leave out at the top of a portrait or square crop,
   * such as the broadcast scorebug's band; the crop keeps its aspect, so it also narrows. Default none.
   */
  cropTop?: number[];
  /** Text escaping and line wrapping, from src/lib/rundown/render.ts. */
  escape: (text: string) => string;
  wrap: (text: string, width: number, fontSize: number) => string[];
  /** Captions, cards and the punch-in from graphics.ts, in place of the plain title. */
  graphics?: Graphics;
};

const OUTPUT = {
  "9:16": { width: 1080, height: 1920 },
  "16:9": { width: 1920, height: 1080 },
  "1:1": { width: 1080, height: 1080 },
} as const;
const FPS = 25;

/**
 * The keys that steer one segment, in seconds from the segment's start: the
 * crop's position at the segment's first and last frame (interpolated, or the
 * nearest key held), plus every key between.
 */
export function segmentKeys(keys: FocusKey[], start: number, end: number): FocusKey[] {
  if (keys.length === 0) return [{ t: 0, x: 0.5 }];
  const at = (t: number) => {
    if (t <= keys[0].t) return keys[0].x;
    if (t >= keys.at(-1)!.t) return keys.at(-1)!.x;
    const i = keys.findIndex((k) => k.t > t);
    const [a, b] = [keys[i - 1], keys[i]];
    return a.x + ((t - a.t) / (b.t - a.t)) * (b.x - a.x);
  };
  const inside = keys.filter((k) => k.t > start && k.t < end);
  const round = (k: FocusKey) => ({ t: Math.round(k.t * 100) / 100, x: Math.round(k.x * 1000) / 1000 });
  return [{ t: 0, x: at(start) }, ...inside.map((k) => ({ t: k.t - start, x: k.x })), { t: end - start, x: at(end) }].map(round);
}

/** An ffmpeg expression in `t` that interpolates linearly between the keys and holds the ends. */
function centreExpression(keys: FocusKey[]): string {
  if (keys.length === 1) return String(keys[0].x);
  const pieces = keys.slice(0, -1).map((a, i) => {
    const b = keys[i + 1];
    const slope = b.t > a.t ? (b.x - a.x) / (b.t - a.t) : 0;
    return `gte(t,${a.t})*lt(t,${b.t})*(${a.x}+(t-${a.t})*${slope.toFixed(5)})`;
  });
  const last = keys.at(-1)!;
  return `if(gte(t,${last.t}),${last.x},${pieces.join("+")})`;
}

export function ffmpegArgs(input: RenderInput, output: string): string[] {
  const { clip } = input;
  const { width, height } = OUTPUT[clip.format];
  const inputs = [
    ...clip.segments.flatMap((s) => ["-ss", s.start.toFixed(2), "-t", (s.end - s.start).toFixed(2), "-i", input.url]),
    ...(input.graphics?.inputs ?? []),
  ];
  const chains = clip.segments.map((s, i) => {
    const keep = 1 - (input.cropTop?.[i] ?? 0);
    const size = keep === 1
      ? `w=${clip.format === "9:16" ? "2*trunc(ih*9/32)" : "ih"}:h=ih:y=0`
      : `w=${clip.format === "9:16" ? `2*trunc(ih*${keep}*9/32)` : `2*trunc(ih*${keep}/2)`}:h=2*trunc(ih*${keep}/2):y=ih-oh`;
    const frame =
      clip.format !== "16:9"
        ? `crop=${size}:x='max(0,min(iw-ow,iw*(${centreExpression(segmentKeys(input.focus.get(s.momentId ?? "") ?? [], s.start, s.end))})-ow/2))'`
        : "null";
    return (
      `[${i}:v]setpts=PTS-STARTPTS,${frame},scale=${width}:${height},setsar=1,fps=${FPS},format=yuv420p[v${i}];` +
      `[${i}:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[a${i}];`
    );
  });
  const pairs = clip.segments.map((_, i) => `[v${i}][a${i}]`).join("");

  // The title: across the top of a vertical clip for its whole length, and over the first six seconds of the
  // recap in the lower part of the frame, clear of the broadcast scorebug in the top-left corner.
  const fontSize = Math.round(Math.min(width, height) * 0.06);
  const top = Math.round(height * (clip.format === "9:16" ? 0.1 : 0.8));
  const enable = clip.format === "9:16" ? "" : ":enable='lt(t,6)'";
  const texts = input.wrap(clip.title, width, fontSize).map(
    (line, i) =>
      `drawtext=fontfile='${input.fontFile}':text='${input.escape(line)}':fontsize=${fontSize}:fontcolor=white` +
      `:box=1:boxcolor=black@0.6:boxborderw=${Math.round(fontSize * 0.35)}` +
      `:x=(w-text_w)/2:y=${top + Math.round(i * fontSize * 1.35)}${enable}`,
  );
  const graph =
    chains.join("") +
    `${pairs}concat=n=${clip.segments.length}:v=1:a=1[vc][ac];[ac]loudnorm=I=-14:TP=-1.5:LRA=11[aout];` +
    (input.graphics ? input.graphics.graph("[vc]", "[vout]", clip.segments.length) : `[vc]${texts.length ? texts.join(",") : "null"}[vout]`);

  return [
    "-hide_banner", "-loglevel", "error", "-nostdin",
    ...inputs,
    "-filter_complex", graph,
    "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-profile:v", "high",
    "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
    "-movflags", "+faststart",
    "-t", clip.durationSec.toFixed(2),
    "-y", output,
  ];
}
