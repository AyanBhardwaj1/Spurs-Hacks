import type { FocusKey } from "@/lib/studio/types";
import { assDocument, assText, colourTag, type AssEvent, type AssStyle } from "./ass";
import { focusExpr } from "./focus";
import type { Word } from "./types";

// Burned-in captions and the ffmpeg command that cuts a clip. Phones play social video muted, so every
// short cut carries the commentary as two or three words at a time, above the platform's own buttons,
// with the hook under the top bar for the first seconds.

/** A pause longer than this starts a new caption, so a chunk never spans a silence. */
const PAUSE_SEC = 0.6;
const HOOK_SEC = 2.8;
/** A replay plays this many times slower than real time. */
export const REPLAY_SLOWDOWN = 2;

type Segment = { start: number; end: number };
const round = (t: number) => Math.round(t * 1000) / 1000;

/**
 * Caption chunks in clip time: segments play back to back, and words outside every segment are dropped.
 * With a highlight colour, a chunk becomes one event per word, the word being said in that colour.
 */
export function captionEvents(words: Word[], segments: Segment[], maxWords = 3, { highlight }: { highlight?: string } = {}): { start: number; end: number; text: string }[] {
  const events: { start: number; end: number; text: string }[] = [];
  let offset = 0;
  for (const seg of segments) {
    let chunk: Word[] = [];
    const flush = () => {
      if (chunk.length === 0) return;
      if (highlight) {
        const said = chunk.map((w) => assText(w.text).toUpperCase());
        const end = Math.min(chunk.at(-1)!.end, seg.end);
        chunk.forEach((w, i) => {
          const until = i + 1 < chunk.length ? chunk[i + 1].start : end;
          events.push({
            start: round(w.start - seg.start + offset),
            end: round(until - seg.start + offset),
            text: said.map((t, j) => (j === i ? `{\\c${colourTag(highlight)}}${t}{\\c${colourTag("#FFFFFF")}}` : t)).join(" "),
          });
        });
        chunk = [];
        return;
      }
      events.push({
        start: round(chunk[0].start - seg.start + offset),
        end: round(Math.min(chunk.at(-1)!.end, seg.end) - seg.start + offset),
        text: assText(chunk.map((w) => w.text).join(" ")).toUpperCase(),
      });
      chunk = [];
    };
    for (const w of words) {
      if (w.start < seg.start || w.start >= seg.end) continue;
      const last = chunk.at(-1);
      if (chunk.length >= maxWords || (last && w.start - last.end > PAUSE_SEC)) flush();
      chunk.push(w);
    }
    flush();
    offset += seg.end - seg.start;
  }
  return events;
}

type ClipAss = {
  width: number;
  height: number;
  safeTop: number;
  safeBottom: number;
  hook: string;
  font: string;
  captions: { start: number; end: number; text: string }[];
  /** When the slow-motion replay plays, in clip time, so it can be labelled. */
  replayAt?: { start: number; end: number };
};

/** The ASS document for one clip: captions above the bottom safe zone, the hook below the top one. */
export function clipAss({ width, height, safeTop, safeBottom, hook, font, captions, replayAt }: ClipAss): string {
  const base = Math.min(width, height);
  const styles: AssStyle[] = [
    { name: "Caption", font, size: Math.round(base * 0.075), colour: "#FFFFFF", outline: { colour: "#000000", width: Math.round(base * 0.006) }, alignment: 2, marginH: Math.round(width * 0.06), marginV: Math.round(height * safeBottom) },
    { name: "Hook", font, size: Math.round(base * 0.06), colour: "#FFFFFF", box: { colour: "#000000", opacity: 0.65, padding: Math.round(base * 0.02) }, alignment: 8, marginH: Math.round(width * 0.07), marginV: Math.round(height * safeTop + base * 0.03) },
  ];
  const events: AssEvent[] = [
    ...captions.map((c) => ({ ...c, style: "Caption" })),
    ...(hook.trim() ? [{ start: 0, end: HOOK_SEC, style: "Hook", text: assText(hook), layer: 1 }] : []),
    ...(replayAt ? [{ ...replayAt, style: "Hook", text: "REPLAY", layer: 1 }] : []),
  ];
  return assDocument(width, height, styles, events);
}

/** The family a font file names itself by, near enough for libass: "Arial Bold.ttf" is Arial. */
export const fontFamily = (file: string) =>
  (file.split("/").at(-1) ?? "Arial").replace(/\.(ttf|otf|ttc)$/i, "").replace(/[-\s]?(Bold|Regular|Book|Medium)$/i, "") || "Arial";

/** Escapes a value inside a filtergraph option: ffmpeg reads `:` as the next option and `'` and `\` as quoting. */
export const escapeFilterValue = (value: string) => value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/:/g, "\\:");

/** A logo's size and corner, in output pixels: top right, under the band the app covers, 14% of the short side. */
export function logoPlacement(width: number, height: number, safeTop: number): { width: number; x: number; y: number } {
  const base = Math.min(width, height);
  const w = Math.round(base * 0.14);
  const margin = Math.round(base * 0.04);
  return { width: w, x: width - w - margin, y: Math.round(height * safeTop) + margin };
}

export type Logo = { file: string; width: number; x: number; y: number };

/** The filter that lays a logo input over [in], slightly see-through, as [out]. */
export const logoFilter = (input: number, logo: Logo, from: string, to: string) =>
  `[${input}:v]scale=${logo.width}:-1,format=rgba,colorchannelmixer=aa=0.9[logo];[${from}][logo]overlay=${logo.x}:${logo.y}[${to}]`;

type Render = {
  source: string;
  segments: Segment[];
  width: number;
  height: number;
  /** The ASS file's name, relative to the folder ffmpeg runs in, so it needs no escaping. */
  captions: string;
  fontsDir?: string;
  output: string;
  /** Source seconds replayed at half speed after the segments. */
  replay?: Segment;
  /** A source with no audio gets a silent track, so every clip plays the same way. */
  hasAudio?: boolean;
  /** Where a narrow crop centres, in source seconds. Without it the crop is centred. */
  focus?: FocusKey[];
  /** A club logo laid over every frame. */
  logo?: Logo;
};

/** ffmpeg arguments that cut, crop, join, caption and loudness-level one clip. Pure, so it can be tested. */
export function renderArgs({ source, segments, replay, width: W, height: H, captions, fontsDir, output, hasAudio = true, focus = [], logo }: Render): string[] {
  const aspect = (W / H).toFixed(5);
  // The replay is one more input, played at half speed after the segments.
  const parts = replay ? [...segments, replay] : segments;
  const slow = (i: number) => replay !== undefined && i === segments.length;
  const total = parts.reduce((n, s, i) => n + (s.end - s.start) * (slow(i) ? REPLAY_SLOWDOWN : 1), 0);
  const inputs = parts.flatMap((s) => ["-ss", s.start.toFixed(3), "-t", (s.end - s.start).toFixed(3), "-i", source]);
  const silent = hasAudio ? [] : ["-f", "lavfi", "-t", total.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo"];
  const video = parts.map(
    (seg, i) =>
      `[${i}:v]crop=w='if(gt(a,${aspect}),ih*${aspect},iw)':h='if(gt(a,${aspect}),ih,iw/${aspect})':x='${focusExpr(focus.filter((k) => k.t >= seg.start - 2 && k.t <= seg.end + 2), seg.start)}':y='(ih-oh)/2',` +
      `${slow(i) ? `setpts=${REPLAY_SLOWDOWN}*PTS,` : ""}scale=${W}:${H},setsar=1,fps=30,format=yuv420p[v${i}];`,
  );
  const fonts = fontsDir ? `:fontsdir=${escapeFilterValue(fontsDir)}` : "";
  let graph: string;
  if (hasAudio) {
    const audio = parts.map((_, i) => `[${i}:a]${slow(i) ? `atempo=${1 / REPLAY_SLOWDOWN},` : ""}aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}];`);
    const pairs = parts.map((_, i) => `[v${i}][a${i}]`).join("");
    graph = `${video.join("")}${audio.join("")}${pairs}concat=n=${parts.length}:v=1:a=1[vc][ac];[ac]loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000[aout];`;
  } else {
    graph = `${video.join("")}${parts.map((_, i) => `[v${i}]`).join("")}concat=n=${parts.length}:v=1:a=0[vc];[${parts.length}:a]anull[aout];`;
  }
  // The logo is the last input: after the cuts and, for a silent source, the silent track.
  const logoInput = parts.length + (hasAudio ? 0 : 1);
  graph += logo ? `${logoFilter(logoInput, logo, "vc", "vl")};[vl]ass=${captions}${fonts}[vout]` : `[vc]ass=${captions}${fonts}[vout]`;
  return [
    "-v", "error", ...inputs, ...silent, ...(logo ? ["-i", logo.file] : []),
    "-filter_complex", graph, "-map", "[vout]", "-map", "[aout]",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-profile:v", "high",
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", "-shortest", "-y", output,
  ];
}
