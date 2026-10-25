export type Cue = { index: number; start: number; end: number; text: string };

const TIMING = /^(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})/;

/** "01:17:47,640" or "01:17:47.64" to seconds. */
export function parseTimecode(timecode: string): number {
  const match = /^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/.exec(timecode.trim());
  if (!match) throw new Error(`Not an SRT timecode: "${timecode}"`);
  const [, h, m, s, frac] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(frac.padEnd(3, "0")) / 1000;
}

/** Parses SRT text into cues. Multi-line cue text is joined with spaces; blocks without a timing line throw. */
export function parseSrt(text: string): Cue[] {
  const blocks = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split(/\n\s*\n/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.trim() !== "");
    if (lines.length === 0) continue;
    const timingAt = lines.findIndex((line) => TIMING.test(line));
    if (timingAt === -1) throw new Error(`SRT block without a timing line: "${lines.join(" / ")}"`);
    const [, from, to] = TIMING.exec(lines[timingAt])!;
    const index = timingAt > 0 ? Number(lines[0]) : cues.length + 1;
    cues.push({
      index,
      start: parseTimecode(from),
      end: parseTimecode(to),
      text: lines.slice(timingAt + 1).join(" ").trim(),
    });
  }
  return cues;
}
