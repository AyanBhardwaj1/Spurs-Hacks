import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { cached, hashOf } from "./cache";
import { cueWords, editDistance, sayTime, type Word } from "./captions";

// The commentary SRT times whole lines, and its lines sit up to a few seconds
// off the audio: it starts "Mbeumo turns and scores!" 2.5 s before the
// commentator says it, as the shot goes in. Whisper, run on the clip's own
// audio, hears when each line is said. Its text is worse than the SRT's (it
// heard "Mbeumo" as "Pomo"), so the SRT keeps the words and whisper lends
// only its timings, matched word by word.
//
// Whisper's own per-word times from this build bunch up: six words of one
// line all started at 25.00 s. Its line (segment) boundaries are sound, so
// each heard line is split into words by length, as SRT lines are.

const MODEL = process.env.WHISPER_MODEL || join(homedir(), ".cache", "whisper", "ggml-small.en.bin");
const WHISPER = process.env.WHISPER_PATH || "whisper-cli";
/** The SRT drifts by up to about 2.5 s; the same word further away than this is a different utterance. */
const MAX_DRIFT_SEC = 4;

/** What word timing lacks, one line per problem: the whisper-cli binary and its model. */
export function whisperProblems(whisper = WHISPER, model = MODEL): string[] {
  return [
    ...(Bun.which(whisper) ? [] : [`whisper-cli not found as "${whisper}"; install whisper-cpp or set WHISPER_PATH`]),
    ...(existsSync(model) ? [] : [`whisper model ${model} is missing; download ggml-small.en.bin or set WHISPER_MODEL`]),
  ];
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Gives each SRT word the time whisper heard it, by the longest common
 * subsequence of the two word lists (case, accents and punctuation ignored;
 * words of five letters or more may differ by one edit).
 * Words whisper missed are said at a speaking pace just before the next
 * matched word, or just after the previous one at the end of the list,
 * squeezed evenly if the gap is too short. With no match at all, the SRT
 * times stand.
 */
export function alignWords(srt: Word[], heard: Word[]): Word[] {
  const a = srt.map((w) => fold(w.text));
  const b = heard.map((w) => fold(w.text));
  // Whisper often gets a name one letter off ("Tenali" for "Tonali"), so long words match within one edit.
  const alike = (x: string, y: string) => x === y || (x.length >= 5 && editDistance(x, y) <= 1);
  const same = (i: number, j: number) => a[i] !== "" && alike(a[i], b[j]) && Math.abs(srt[i].start - heard[j].start) < MAX_DRIFT_SEC;
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      table[i][j] = same(i, j) ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const match = new Array<number | undefined>(a.length);
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (same(i, j)) match[i++] = j++;
    else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  if (match.every((m) => m === undefined)) return srt;

  const out = srt.map((w, i) => (match[i] === undefined ? { ...w } : { text: w.text, start: heard[match[i]!].start, end: heard[match[i]!].end }));
  for (let i = 0; i < srt.length; ) {
    if (match[i] !== undefined) {
      i++;
      continue;
    }
    let n = i;
    while (n < srt.length && match[n] === undefined) n++;
    const run = out.slice(i, n);
    const pace = run.map((w) => sayTime(w.text.length));
    const total = pace.reduce((x, y) => x + y, 0);
    const from = i > 0 ? out[i - 1].end : -Infinity;
    const to = n < srt.length ? out[n].start : Infinity;
    // Before the next matched word; after the previous one when the run ends the list.
    let at = Number.isFinite(to) ? Math.max(to - total, Number.isFinite(from) ? from : -Infinity) : from;
    const scale = Number.isFinite(from) && Number.isFinite(to) ? Math.min(1, (to - from) / total) : 1;
    run.forEach((w, k) => {
      w.start = at;
      w.end = at + pace[k] * scale;
      at = w.end;
    });
    i = n;
  }
  return out;
}

/** Whisper's lines for a stretch of the source, in source seconds. The audio exists only in a temp file during the run. */
async function hear(url: string, start: number, end: number): Promise<{ text: string; start: number; end: number }[]> {
  const dir = mkdtempSync(join(tmpdir(), "rundown-whisper-"));
  try {
    const wav = join(dir, "audio.wav");
    const ffmpeg = Bun.spawn([process.env.FFMPEG_PATH || "ffmpeg", "-v", "error", "-nostdin", "-ss", start.toFixed(2), "-t", (end - start).toFixed(2), "-i", url, "-vn", "-ac", "1", "-ar", "16000", "-y", wav], { stdout: "ignore", stderr: "pipe" });
    const [ffmpegErr, ffmpegCode] = await Promise.all([new Response(ffmpeg.stderr).text(), ffmpeg.exited]);
    if (ffmpegCode !== 0) throw new Error(`ffmpeg exited ${ffmpegCode} reading audio: ${ffmpegErr.replaceAll(url, "[source URL]")}`);
    const out = join(dir, "lines");
    const whisper = Bun.spawn([WHISPER, "-m", MODEL, "-f", wav, "-oj", "-of", out, "-np", "-t", "4"], { stdout: "ignore", stderr: "pipe" });
    const [whisperErr, whisperCode] = await Promise.all([new Response(whisper.stderr).text(), whisper.exited]);
    if (whisperCode !== 0) throw new Error(`${WHISPER} exited ${whisperCode}: ${whisperErr.trim().split("\n").slice(-2).join(" | ")}`);
    const json = JSON.parse(readFileSync(`${out}.json`, "utf8")) as { transcription: { text: string; offsets: { from: number; to: number } }[] };
    return json.transcription.map((t) => ({ text: t.text.trim(), start: start + t.offsets.from / 1000, end: start + t.offsets.to / 1000 }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * SRT words around `start` to `end` (source seconds), timed by whisper.
 * Whisper's lines are cached by range, so a re-render does not run it again.
 */
async function timedWords(url: string, srt: Word[], start: number, end: number): Promise<Word[]> {
  const from = Math.max(0, start - 2);
  const to = end + 2;
  const { value: lines } = await cached(`whisper/${hashOf(MODEL, from.toFixed(2), to.toFixed(2))}.json`, () => hear(url, from, to));
  const heard = lines.flatMap((line, index) => cueWords({ index, ...line }));
  return alignWords(srt.filter((w) => w.end > from && w.start < to), heard);
}

/** The commentary words a clip's segments play, timed by whisper, in source seconds and without repeats. */
export async function clipWords(url: string, srt: Word[], segments: { start: number; end: number }[]): Promise<Word[]> {
  const byKey = new Map<string, Word>();
  for (const s of segments) {
    for (const w of await timedWords(url, srt, s.start, s.end)) byKey.set(`${w.text}@${w.start.toFixed(3)}`, w);
  }
  return [...byKey.values()].sort((a, b) => a.start - b.start);
}
