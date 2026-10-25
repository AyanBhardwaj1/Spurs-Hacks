import "server-only";

import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

// Cuts a piece from source renditions with ffmpeg: each segment is read by
// URL, cropped to the platform's shape around the action, joined, given the
// hook as burned-in text and loudness-normalised for phones. The working file
// lives in `.media/` only while the job runs, as AGENTS.md requires.

export type RenderSpec = {
  sources: { url: string; start: number; end: number }[];
  width: number;
  height: number;
  /** 0 to 1 across the source frame. Vertical crops centre here. */
  focusX?: number;
  hook?: string;
  /** Fraction of the height the platform covers at the top; the hook sits just below it. */
  safeTop: number;
  fontFile?: string;
};

const MEDIA_DIR = path.join(process.cwd(), ".media");
const FONT_CANDIDATES = [
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
];

let binary: string | null | undefined;

/** The ffmpeg to run, from `FFMPEG_PATH` or the PATH. Undefined when there is none. */
export function ffmpegBinary(): string | undefined {
  if (binary === undefined) {
    const candidate = process.env.FFMPEG_PATH || "ffmpeg";
    const probe = spawnSync(candidate, ["-version"], { stdio: "ignore" });
    binary = probe.status === 0 ? candidate : null;
  }
  return binary ?? undefined;
}

export function defaultFont() {
  return process.env.RUNDOWN_FONT || FONT_CANDIDATES.find((f) => existsSync(f));
}

/**
 * Makes text safe for `text='...'` in a filtergraph. ffmpeg unescapes three
 * times: the graph parser strips the quotes, the option parser treats `\` and
 * `:` as special, and drawtext expands `%`. Apostrophes become typographic
 * ones so no quote ever needs escaping.
 */
export function escapeDrawtext(text: string) {
  return text.replace(/\\/g, "").replace(/'/g, "\u2019").replace(/:/g, "\\:").replace(/%/g, "\\\\%");
}

/** Splits a hook into lines that fit the frame at the given font size. */
export function wrapHook(hook: string, width: number, fontSize: number, maxLines = 3) {
  const perLine = Math.max(8, Math.floor((width * 0.86) / (fontSize * 0.55)));
  const lines: string[] = [];
  for (const word of hook.trim().split(/\s+/)) {
    const last = lines.at(-1);
    if (last !== undefined && `${last} ${word}`.length <= perLine) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines.slice(0, maxLines);
}

/** The ffmpeg arguments for a spec. Pure, so the filtergraph can be checked without ffmpeg. */
export function ffmpegArgs(spec: RenderSpec, output: string): string[] {
  const { width: W, height: H } = spec;
  const aspect = (W / H).toFixed(5);
  const fx = Math.min(1, Math.max(0, spec.focusX ?? 0.5)).toFixed(3);
  const inputs = spec.sources.flatMap((s) => ["-ss", s.start.toFixed(2), "-t", (s.end - s.start).toFixed(2), "-i", s.url]);

  const chains = spec.sources.map((_, i) =>
    [
      `[${i}:v]crop=w='if(gt(a,${aspect}),ih*${aspect},iw)':h='if(gt(a,${aspect}),ih,iw/${aspect})'`,
      `:x='min(max(iw*${fx}-ow/2,0),iw-ow)':y='(ih-oh)/2',scale=${W}:${H},setsar=1,fps=30,format=yuv420p[v${i}];`,
      `[${i}:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS[a${i}];`,
    ].join(""),
  );
  const pairs = spec.sources.map((_, i) => `[v${i}][a${i}]`).join("");
  let graph = `${chains.join("")}${pairs}concat=n=${spec.sources.length}:v=1:a=1[vc][ac];[ac]loudnorm=I=-14:TP=-1.5:LRA=11[aout];`;

  const fontSize = Math.round(Math.min(W, H) * 0.06);
  const lines = spec.hook && spec.fontFile ? wrapHook(spec.hook, W, fontSize) : [];
  if (lines.length) {
    const top = Math.round(H * spec.safeTop + fontSize * 0.5);
    const texts = lines.map(
      (line, i) =>
        `drawtext=fontfile='${spec.fontFile}':text='${escapeDrawtext(line)}':fontsize=${fontSize}:fontcolor=white` +
        `:box=1:boxcolor=black@0.6:boxborderw=${Math.round(fontSize * 0.35)}` +
        `:x=(w-text_w)/2:y=${top + Math.round(i * fontSize * 1.35)}:enable='lt(t,2.8)'`,
    );
    graph += `[vc]${texts.join(",")}[vout]`;
  } else {
    graph += "[vc]null[vout]";
  }

  const total = spec.sources.reduce((sum, s) => sum + (s.end - s.start), 0);
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    ...inputs,
    "-filter_complex",
    graph,
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "21",
    "-profile:v",
    "high",
    "-c:a",
    "aac",
    "-b:a",
    "128k",
    "-movflags",
    "+faststart",
    "-t",
    total.toFixed(2),
    "-y",
    output,
  ];
}

/** Renders the spec and returns the MP4's bytes. The working file is deleted before this returns. */
export async function renderClip(spec: RenderSpec, timeoutMs = 180_000): Promise<Uint8Array> {
  const bin = ffmpegBinary();
  if (!bin) throw new Error("ffmpeg is not installed on this server; set FFMPEG_PATH or install it");
  await mkdir(MEDIA_DIR, { recursive: true });
  const file = path.join(MEDIA_DIR, `${randomUUID()}.mp4`);
  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(bin, ffmpegArgs(spec, file), { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderr = (stderr + chunk.toString()).slice(-2000);
      });
      const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
      child.on("error", reject);
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exited with ${code ?? "a timeout"}: ${stderr.trim().split("\n").at(-1) ?? ""}`));
      });
    });
    return new Uint8Array(await readFile(file));
  } finally {
    await rm(file, { force: true });
  }
}
