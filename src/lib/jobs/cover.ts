import type { FocusKey } from "@/lib/studio/types";
import { assDocument, assText, type AssStyle } from "./ass";
import { escapeFilterValue, logoFilter, type Logo } from "./captions";
import { focusExpr } from "./focus";

// A cover image for each clip, the frame a feed shows before anyone presses play: the moment's play,
// cropped the way the clip is, with the hook across the middle in large type.

type Segment = { start: number; end: number };

/** The source second to take the cover from: the moment's play, or the clip's middle without one. */
export function coverTime(moment: { peak: number } | undefined, segments: Segment[]): number {
  const [first] = segments;
  if (!moment) return Math.round(((first.start + first.end) / 2) * 1000) / 1000;
  const seg = segments.find((s) => moment.peak >= s.start && moment.peak < s.end) ?? first;
  return Math.min(Math.max(moment.peak, seg.start), seg.end - 0.1);
}

/** The cover's text layer: the hook in capitals, centred, on a dark band so any frame reads. */
export function coverAss({ width, height, hook, font }: { width: number; height: number; hook: string; font: string }): string {
  const base = Math.min(width, height);
  const styles: AssStyle[] = [
    { name: "Cover", font, size: Math.round(base * 0.1), colour: "#FFFFFF", box: { colour: "#000000", opacity: 0.6, padding: Math.round(base * 0.03) }, alignment: 5, marginH: Math.round(width * 0.08), marginV: 0 },
  ];
  return assDocument(width, height, styles, hook.trim() ? [{ start: 0, end: 10, style: "Cover", text: assText(hook).toUpperCase(), layer: 1 }] : []);
}

type Cover = { source: string; at: number; width: number; height: number; captions: string; fontsDir?: string; output: string; focus?: FocusKey[]; logo?: Logo };

/** ffmpeg arguments for one cover: seek to the play, crop and scale like the clip, burn in the hook. */
export function coverArgs({ source, at, width: W, height: H, captions, fontsDir, output, focus = [], logo }: Cover): string[] {
  const aspect = (W / H).toFixed(5);
  const near = focus.filter((k) => k.t >= at - 2 && k.t <= at + 2);
  const fonts = fontsDir ? `:fontsdir=${escapeFilterValue(fontsDir)}` : "";
  const picture =
    `crop=w='if(gt(a,${aspect}),ih*${aspect},iw)':h='if(gt(a,${aspect}),ih,iw/${aspect})':x='${focusExpr(near, at)}':y='(ih-oh)/2',` +
    `scale=${W}:${H},setsar=1`;
  const head = ["-v", "error", "-ss", at.toFixed(3), "-i", source];
  const tail = ["-frames:v", "1", "-q:v", "3", "-y", output];
  if (!logo) return [...head, "-vf", `${picture},ass=${captions}${fonts}`, ...tail];
  const graph = `[0:v]${picture}[base];${logoFilter(1, logo, "base", "vl")};[vl]ass=${captions}${fonts}[v]`;
  return [...head, "-i", logo.file, "-filter_complex", graph, "-map", "[v]", ...tail];
}
