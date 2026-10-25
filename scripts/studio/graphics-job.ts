import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Clip, MatchAnalysis } from "../../src/lib/studio/types";
import { cachePath, readCache } from "./cache";
import { cueWords } from "./captions";
import type { CrowdFrames } from "./crowd";
import { clipGraphics, graphicsToolProblems, type Graphics } from "./graphics";
import { parseSrt } from "./srt";
import { clipWords, whisperProblems } from "./word-timing";

/**
 * Everything a render run needs to draw clip graphics. Call it before
 * resolving the source or rendering: it checks the ffmpeg build, fonts,
 * whisper-cli, the whisper model and the cached commentary and crowd frames,
 * and throws one error naming everything missing. It keeps one temp
 * directory for the ASS files until `dispose`.
 */
export function graphicsJob(analysis: MatchAnalysis, ffmpeg: string) {
  const subtitlesName = `scoreplay/subtitles-${analysis.source.id}.json`;
  const subtitles = readCache<{ text: string }>(subtitlesName);
  const crowd = readCache<CrowdFrames>("crowd-frames.json");
  const problems = [
    ...graphicsToolProblems(ffmpeg),
    ...whisperProblems(),
    ...(subtitles ? [] : [`cached commentary ${cachePath(subtitlesName)} is missing; run analyze.ts`]),
    ...(crowd ? [] : [`cached ${cachePath("crowd-frames.json")} is missing; run analyze.ts`]),
  ];
  if (problems.length || !subtitles || !crowd) throw new Error(`Clip graphics cannot run:\n- ${problems.join("\n- ")}`);

  const srtWords = parseSrt(subtitles.text).flatMap(cueWords);
  const focus = new Map(analysis.moments.map((m) => [m.id, m.focus]));
  const dir = mkdtempSync(join(tmpdir(), "rundown-gfx-"));
  return {
    /** Graphics for a portrait or square clip; undefined for 16:9, which keeps the plain title. */
    async forClip(clip: Clip, sourceUrl: string): Promise<Graphics | undefined> {
      if (clip.format === "16:9") return undefined;
      const words = await clipWords(sourceUrl, srtWords, clip.segments);
      return clipGraphics({ sourceId: analysis.source.id, clip, moments: analysis.moments, players: analysis.source.players, words, focus, crowd, dir });
    },
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  };
}
