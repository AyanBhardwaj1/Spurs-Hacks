// Render every planned clip from the 1080p ScorePlay source, then upload only
// unpublished clips. --render-only leaves outputs for inspection. A completed
// publish removes them after checking live receipts. Upload errors stop the run.
// --replace-media=id,id selects existing uploads to replace with new media,
// retaining the originals in ScorePlay and their IDs in the publish record.
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Clip } from "../../src/lib/studio/types";
import { cachePath, readCache } from "./cache";
import { graphicsJob } from "./graphics-job";
import { applyPublished, assertRenderChange, PUBLISH_RECORD, type PublishRecord } from "./published";
import { ffmpegArgs, renderKey } from "./render";
import { rundownRender, scoreplay } from "./server-modules";
import { assertAnalysis } from "./validate";
import { renderSource } from "./render-source";
import { getPublishedMedia } from "./scoreplay";
import { publishUpload } from "./upload";

const { findOrCreateTagOption } = scoreplay;
const { defaultFont, escapeDrawtext, wrapHook } = rundownRender;

/** The match's "Full Match" event, which holds the source. */
const EVENT_ID = 1536147;
const TAG = { name: "rundown-generated", label: "Rundown: generated clip" };
/** Same raw tags Bryan's writeback puts on rendered clips, so one search finds everything Rundown made. */
const RAW_TAGS = ["rundown", "rundown-render"];
/** Stop if ScorePlay has not finished processing within ten minutes. */
const PROCESSING_WAIT_MS = 10 * 60_000;

const ANALYSIS = join(import.meta.dir, "..", "..", "src", "lib", "studio", "data", "mnu-tot.json");
const OUT_DIR = join(import.meta.dir, "out");

/** Same variable Bryan's renderer reads. The title needs drawtext, which some builds (Homebrew's default) leave out. */
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";
const filters = Bun.spawnSync([FFMPEG, "-hide_banner", "-filters"]).stdout.toString();
if (!/ drawtext /.test(filters)) throw new Error(`${FFMPEG} has no drawtext filter (built without libfreetype); set FFMPEG_PATH to an ffmpeg that has it`);

const analysis: unknown = JSON.parse(readFileSync(ANALYSIS, "utf8"));
assertAnalysis(analysis);
const fontFile = defaultFont();
if (!fontFile) throw new Error("No bold font found for the burned-in title; set RUNDOWN_FONT");
// Portrait and square clips get captions, cards and a punch-in (graphics.ts); this checks their tools before any network call.
const graphicsRun = graphicsJob(analysis, FFMPEG);
process.on("exit", graphicsRun.dispose);

const record: PublishRecord = readCache<PublishRecord>(PUBLISH_RECORD) ?? { eventId: EVENT_ID, clips: [] };
if (record.eventId !== EVENT_ID) throw new Error(`Publish record event ${record.eventId} differs from ${EVENT_ID}`);
for (const clip of analysis.clips) {
  const entry = record.clips.find((c) => c.clipId === clip.id);
  if (clip.scoreplayMediaId && entry?.mediaId !== clip.scoreplayMediaId && entry?.replacesMediaId !== clip.scoreplayMediaId) {
    throw new Error(`Published ID mismatch for ${clip.id}; reconcile publish.json before uploading`);
  }
}
const replacementArg = process.argv.find((arg) => arg.startsWith("--replace-media="));
const replacementIds = new Set(replacementArg?.slice("--replace-media=".length).split(",").map(Number) ?? []);
for (const id of replacementIds) {
  if (!Number.isSafeInteger(id) || id < 1) throw new Error(`Invalid replacement media ID ${id}`);
  if (!record.clips.some((entry) => entry.mediaId === id || entry.replacesMediaId === id)) {
    throw new Error(`Replacement media ${id} is not in publish.json`);
  }
}
const replacementClipIds = new Set(record.clips
  .filter((entry) => [entry.mediaId, entry.replacesMediaId].some((id) => id !== undefined && replacementIds.has(id)))
  .map((entry) => entry.clipId));
const chosen = replacementArg ? analysis.clips.filter((clip) => replacementClipIds.has(clip.id)) : analysis.clips;
const source = await renderSource(analysis.source.id);
console.log(`Rendering ${chosen.length} clips from ${source.metadata.format} at ${source.metadata.width}x${source.metadata.height}`);
const save = () => {
  const path = cachePath(PUBLISH_RECORD);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(record, null, 1));
  renameSync(`${path}.tmp`, path);
};
const focus = new Map(analysis.moments.map((m) => [m.id, m.focus]));
mkdirSync(OUT_DIR, { recursive: true });

for (const clip of chosen) {
  const published = record.clips.find((c) => c.clipId === clip.id);
  let entry = published?.replacement ?? published;
  const replacing = replacementClipIds.has(clip.id);
  // Recovery uses the saved upload snapshot even if the plan or local render has since changed.
  if (!process.argv.includes("--render-only") && entry?.mediaId && entry.state !== undefined && entry.state !== "tagged") continue;
  const file = join(OUT_DIR, `${clip.id}.mp4`);
  const graphics = await graphicsRun.forClip(clip, source.url);
  const key = renderKey(clip, focus, source.metadata, graphics?.key);
  // A promoted replacement still matches its original target on retries, including after processing failures.
  if (published?.mediaId && published.renderKey === key && published.replacesMediaId !== undefined && replacementIds.has(published.replacesMediaId)) continue;
  assertRenderChange(published, key, replacing);
  if (published?.mediaId && !replacing && published.renderKey === key) continue;
  if (!process.argv.includes("--render-only") && published?.replacement?.mediaId) continue;
  if (entry?.pendingCreation && entry.renderKey !== key) throw new Error(`Clip ${clip.id} has a pending creation; reconcile it before changing its render`);
  if (entry?.pendingCreation) {
    if (process.argv.includes("--render-only")) throw new Error(`Clip ${clip.id} has a pending creation; reconcile it before rendering again`);
    continue;
  }
  if (entry?.renderKey !== key || !existsSync(file) || (replacing && published?.mediaId && !published.replacement)) {
    if (entry?.mediaId && entry.state !== undefined && entry.state !== "tagged") {
      throw new Error(`Reconcile unfinished media ${entry.mediaId} before changing its render`);
    }
    const started = performance.now();
    const temporary = join(OUT_DIR, `${clip.id}.rendering.mp4`);
    const args = ffmpegArgs({ clip, url: source.url, focus, fontFile, escape: escapeDrawtext, wrap: wrapHook, graphics }, temporary);
    try {
      const proc = Bun.spawn([FFMPEG, ...args], { stdout: "ignore", stderr: "pipe" });
      const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
      if (code !== 0) throw new Error(`ffmpeg exited ${code} rendering ${clip.id}: ${stderr.replaceAll(source.url, "[source URL]").trim().split("\n").slice(-3).join(" | ")}`);
      renameSync(temporary, file);
    } finally {
      rmSync(temporary, { force: true });
    }
    const name = `Rundown · ${clip.title} (${clip.format})${published?.mediaId && replacing ? ` · ${key}` : ""}.mp4`;
    const planned: Clip = { ...clip };
    delete planned.scoreplayMediaId;
    entry = {
      ...(published?.mediaId && replacing ? {} : entry),
      replacesMediaId: published?.mediaId && replacing ? published.mediaId : entry?.replacesMediaId,
      renderSource: source.metadata,
      renderKey: key,
      clipId: clip.id,
      clip: planned,
      file,
      renderMs: Math.round(performance.now() - started),
      bytes: statSync(file).size,
      name,
    };
    if (published?.mediaId && replacing) published.replacement = entry;
    else record.clips = [...record.clips.filter((c) => c.clipId !== clip.id), entry];
    save();
    console.log(`${clip.id}: rendered ${(entry.bytes / 1e6).toFixed(1)} MB in ${(entry.renderMs / 1000).toFixed(1)} s`);
  }
}

if (process.argv.includes("--render-only")) process.exit(0);
if (process.env.STUDIO_NO_WRITES === "1" || process.env.STUDIO_CACHE_ONLY === "1") throw new Error("Studio writes are disabled");

const tag = await findOrCreateTagOption(TAG.name, TAG.label);
for (const clip of chosen) {
  const published = record.clips.find((c) => c.clipId === clip.id)!;
  const entry = published.replacement ?? published;
  const started = performance.now();
  const players = [...new Set(entry.clip.segments.flatMap((s) => analysis.moments.find((m) => m.id === s.momentId)?.players ?? []))];
  await publishUpload(entry, {
    eventId: EVENT_ID,
    description: `${entry.clip.caption} ${entry.clip.hashtags.join(" ")}`,
    rawTags: RAW_TAGS,
    tagIds: [tag.ID],
    players,
    replace: false,
  }, save);
  if (published.replacement) record.clips = record.clips.map((c) => c === published ? entry : c);
  entry.uploadMs = (entry.uploadMs ?? 0) + Math.round(performance.now() - started);
  save();
  console.log(`${clip.id}: media ${entry.mediaId}, ${entry.state}`);
}

// Wait for ScorePlay to finish processing, then record what it reports.
const deadline = Date.now() + PROCESSING_WAIT_MS;
for (const entry of record.clips.filter((c) => c.mediaId)) {
  for (;;) {
    const media = await getPublishedMedia(entry.mediaId!);
    entry.status = media.status;
    entry.scoreplayDurationSec = media.video?.duration;
    entry.scoreplayBytes = Number(media.video?.file_size);
    save();
    if (media.status === "DONE") {
      if (media.event_id !== EVENT_ID || media.name !== entry.name) throw new Error(`Media ${entry.mediaId} has the wrong event or name`);
      if (!Number.isFinite(entry.scoreplayDurationSec) || Math.abs(entry.scoreplayDurationSec! - entry.clip.durationSec) > 1) {
        throw new Error(`Media ${entry.mediaId} duration ${entry.scoreplayDurationSec} differs from plan ${entry.clip.durationSec}`);
      }
      if (entry.scoreplayBytes !== entry.uploadedBytes) throw new Error(`Media ${entry.mediaId} size ${entry.scoreplayBytes} differs from upload ${entry.uploadedBytes}`);
      break;
    }
    if (media.status === "FAILED" || Date.now() > deadline) throw new Error(`Media ${entry.mediaId} is ${media.status}; processing did not complete`);
    await Bun.sleep(10_000);
  }
  console.log(`media ${entry.mediaId}: ${entry.status}, ${entry.scoreplayDurationSec ?? "?"} s, ${entry.scoreplayBytes} bytes`);
}
save();

applyPublished(analysis, record);
assertAnalysis(analysis);
writeFileSync(ANALYSIS, `${JSON.stringify(analysis, null, 2)}\n`);
console.log(`Recorded ${record.clips.filter((c) => c.mediaId).length} ScorePlay media IDs in ${ANALYSIS}`);

for (const clip of chosen) {
  const file = join(OUT_DIR, `${clip.id}.mp4`);
  if (existsSync(file)) unlinkSync(file);
}
console.log("Removed verified temporary renders");
