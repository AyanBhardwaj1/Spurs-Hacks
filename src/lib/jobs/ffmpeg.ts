import "server-only";

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import ffmpegStatic from "ffmpeg-static";

/** FFMPEG_PATH when set, else the binary ffmpeg-static ships for this platform, else ffmpeg on the PATH. */
export function ffmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  if (ffmpegStatic && existsSync(ffmpegStatic)) return ffmpegStatic;
  return "ffmpeg";
}

export type FfmpegResult = { code: number; stdout: Buffer; stderr: string };

/**
 * Runs ffmpeg with an argument list (never a shell string) and collects its output. stderr keeps only
 * its last 64 KB, which is enough for the banner `-i` prints and for the error line of a failed render.
 */
export function runFfmpeg(args: string[], { timeoutMs = 600_000, cwd }: { timeoutMs?: number; cwd?: string } = {}): Promise<FfmpegResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath(), ["-hide_banner", "-nostdin", ...args], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => out.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-65_536);
    });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? -1, stdout: Buffer.concat(out), stderr });
    });
  });
}

/** The last line ffmpeg printed, which is where it says what went wrong. */
export const lastLine = (stderr: string) => stderr.trim().split("\n").at(-1) ?? "";
