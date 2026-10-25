// Extract the selected reference/match frame pairs to a new temporary directory for human inspection.
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { GroundTruthClip } from "../../src/lib/studio/types";
import analysis from "../../src/lib/studio/data/mnu-tot.json";
import { alignClip } from "./align";
import { writeCache } from "./cache";
import { isHit, isSingleMomentClip } from "./rank-eval";
import { englishSubtitles, getMedia } from "./scoreplay";
import { parseSrt } from "./srt";

const source = await getMedia(analysis.source.id);
const sourceSrt = await englishSubtitles(source);
if (!sourceSrt || !source.video?.proxy_medium) throw new Error("Source subtitles or proxy missing");
const sourceCues = parseSrt(sourceSrt);
const directory = mkdtempSync("/tmp/studio-eval-");

async function frame(url: string, second: number, path: string) {
  const proc = Bun.spawn(["ffmpeg", "-v", "error", "-nostdin", "-ss", String(second), "-i", url,
    "-frames:v", "1", "-vf", "scale=960:-2", "-q:v", "2", path], { stdout: "ignore", stderr: "pipe" });
  const error = await new Response(proc.stderr).text();
  if (await proc.exited !== 0) throw new Error(`Frame extraction failed: ${error}`);
}

const rows = [];
try {
  const top = [...analysis.moments].sort((a, b) => b.scores.total - a.scores.total || a.peak - b.peak).slice(0, 10);
  for (const [i, moment] of top.entries()) {
    const hits = analysis.groundTruth.filter((reference) => isHit(moment, reference));
    const singles = hits.filter(isSingleMomentClip);
    const key = hits.filter((reference) => reference.scoreplayId === 130852723);
    // The key package omits the disallowed goal; Sam approved the extended package for that hit.
    const eligible = singles.length ? singles : key.length ? key : moment.id === "m-3633-disallowed-goal"
      ? hits.filter((reference) => reference.scoreplayId === 130852724) : [];
    const overlap = (reference: Pick<GroundTruthClip, "start" | "end">) => Math.min(moment.end, reference.end) - Math.max(moment.start, reference.start);
    const reference = eligible.sort((a, b) => overlap(b) - overlap(a) || a.start - b.start)[0];
    if (!reference) {
      if (hits.length) throw new Error(`No approved visual reference for ${moment.id}`);
      rows.push({ rank: i + 1, momentId: moment.id, title: moment.title, hit: false });
      continue;
    }
    const club = await getMedia(reference.scoreplayId);
    const srt = await englishSubtitles(club);
    if (!srt || !club.video?.proxy_medium) throw new Error(`Reference ${club.ID} subtitles or proxy missing`);
    const spans = alignClip(sourceCues, parseSrt(srt));
    const span = isSingleMomentClip(reference)
      ? spans.reduce((a, b) => b.support > a.support ? b : a)
      : spans.find((span) => Math.abs(Math.max(0, span.clipStart + span.offset) - reference.start) <= 0.051 && Math.abs(span.clipEnd + span.offset - reference.end) <= 0.051);
    if (!span) throw new Error(`Cannot recover subtitle offset for ${reference.name}`);
    const matchSecond = (reference.start + reference.end) / 2;
    const clubSecond = matchSecond - span.offset;
    if (clubSecond < 0 || clubSecond > club.video.duration) throw new Error(`Reference midpoint outside clip ${club.ID}`);
    const clubFrame = join(directory, `${i + 1}-club.jpg`);
    const matchFrame = join(directory, `${i + 1}-match.jpg`);
    await frame(club.video.proxy_medium, clubSecond, clubFrame);
    await frame(source.video.proxy_medium, matchSecond, matchFrame);
    rows.push({ rank: i + 1, momentId: moment.id, title: moment.title, hit: true, scoreplayId: club.ID,
      referenceStart: reference.start, referenceEnd: reference.end, offset: span.offset, matchSecond, clubSecond, clubFrame, matchFrame });
    console.log(`Rank ${i + 1}: ${club.ID} @ ${clubSecond.toFixed(3)} s / match ${matchSecond.toFixed(3)} s`);
  }
  writeCache("report/visual-check-plan.json", { directory, rows });
  console.log(`Inspect ${directory}; delete the directory after recording judgments`);
} catch (error) {
  rmSync(directory, { recursive: true });
  throw error;
}
