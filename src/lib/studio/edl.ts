import type { Clip, ClipSegment, SourceAsset } from "./types";

// A planned clip as a CMX 3600 edit decision list, so an editor with the club's master can rebuild the cut
// in Premiere, Resolve or Avid. One event per segment: source timecode counts from the master's start, and
// record timecode starts at 01:00:00:00, the broadcast convention. The clip's format (9:16, 1:1) and its
// crop keyframes have no place in an EDL, so they are left out rather than written as comments some
// importers reject.

const REEL = "AX";
const TRACK = "AA/V";
const RECORD_START_SEC = 3600;

/** HH:MM:SS:FF, non-drop, from a frame count. */
export function frameTimecode(frames: number, fps: number): string {
  const ff = frames % fps;
  const totalSec = (frames - ff) / fps;
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(Math.floor(totalSec / 3600))}:${two(Math.floor(totalSec / 60) % 60)}:${two(totalSec % 60)}:${two(ff)}`;
}

/**
 * Each segment's in and out are rounded to the nearest frame, and the record side advances by out minus in
 * frames, so the cut never drifts and touching segments share a frame. A segment shorter than a frame is
 * dropped. Throws unless fps is a positive integer, since a non-drop EDL cannot express 29.97.
 */
export function clipEdl(clip: Pick<Clip, "title"> & { segments: Pick<ClipSegment, "start" | "end">[] }, source: Pick<SourceAsset, "name" | "fps">): string {
  const { fps } = source;
  if (!Number.isInteger(fps) || fps <= 0) throw new Error(`An EDL needs a whole frame rate; the source runs at ${fps} fps.`);
  const lines = [`TITLE: ${clip.title.replace(/\s*[\r\n]+\s*/g, " ")}`, "FCM: NON-DROP FRAME", ""];
  let record = RECORD_START_SEC * fps;
  let event = 0;
  for (const segment of clip.segments) {
    const srcIn = Math.round(segment.start * fps);
    const srcOut = Math.round(segment.end * fps);
    if (srcOut <= srcIn) continue;
    event += 1;
    const recordOut = record + (srcOut - srcIn);
    const times = [srcIn, srcOut, record, recordOut].map((f) => frameTimecode(f, fps)).join(" ");
    lines.push(`${String(event).padStart(3, "0")}  ${REEL.padEnd(8)} ${TRACK.padEnd(5)} ${"C".padEnd(8)} ${times}`);
    lines.push(`* FROM CLIP NAME: ${source.name}`);
    record = recordOut;
  }
  return `${lines.join("\n")}\n`;
}
