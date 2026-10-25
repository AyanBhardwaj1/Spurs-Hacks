// Edit planned clips with Reel Studio and upload each edit to ScorePlay as a
// new media beside the plain render.
//
//   bun scripts/studio/reelstudio.ts <clipId>... [--model opus|haiku] [--render-only] [--again] [--replace]
//
// For each clip: cut and frame its segments from the 1080p source (the same
// ffmpeg graph as publish.ts, below the broadcast scorebug, without the burned
// title) into a temporary folder, make a Reel Studio project there around it
// (the segments as seconds ranges, the match brief, player cards from ScorePlay
// headshots), run Reel Studio's first edit headless with Claude Code, and copy
// the export to scripts/studio/out/<clip>.reelstudio.mp4 (gitignored, the
// temporary render area). The temporary folder, with its footage, is deleted
// whatever happens. Clips are cut 9:16, or 1:1 when planned square.
//
// --render-only stops there and leaves the export in scripts/studio/out/ for
// review; delete it after looking. Otherwise the export is uploaded through
// the receipt machinery publish.ts uses, into its own journal
// (.media/studio/reelstudio.json), ScorePlay's processing is checked, the
// export is deleted (also when the upload fails), and reelStudioMediaId is
// recorded on the clip in mnu-tot.json.
//
// A journal entry is reused only for the inputs that made it (editKey: the
// segments, format, title, brief, focus keys, crop, source rendition, Reel
// Studio commit and model). A waiting export from other inputs is edited
// again; an upload from other inputs fails closed. --again edits a clip again
// even when its waiting export matches. --replace uploads a new edit of an
// uploaded clip as a new media named "... · v2" (v3, ...); the old receipt
// moves to `replaced` and the old media stays in ScorePlay.
//
// The editor's log, project.json and transcript (no footage) stay in
// .media/studio/reelstudio/ for inspection.
//
// Reel Studio lives in REELSTUDIO_DIR (default: Sam's spurs-match worktree on
// branch spurs/match-edits, with ai/ built and engine/.venv installed). Every
// child process runs without the API keys bun loads from .env.local
// (child-env.ts); Claude Code reaches Claude through ANTHROPIC_BASE_URL and
// ANTHROPIC_AUTH_TOKEN (the Reel Studio CLI's --claude-proxy).
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { Clip } from "../../src/lib/studio/types";
import { cachePath, readCache } from "./cache";
import { childEnv } from "./child-env";
import { ffmpegArgs } from "./render";
import { renderSource } from "./render-source";
import { getPublishedMedia } from "./scoreplay";
import { rundownRender, scoreplay } from "./server-modules";
import { publishUpload } from "./upload";
import { assertAnalysis } from "./validate";
import {
  applyReelStudio, CARD_DESIGN, clipEditKey, clipMoments, CUT_FPS, cutRanges, editPlan, MATCH, REELSTUDIO_RECORD, reuseOf, vocabulary,
  type ReelStudioClip, type ReelStudioRecord,
} from "./reelstudio-plan";

const EVENT_ID = 1536147;
const TAG = { name: "rundown-generated", label: "Rundown: generated clip" };
const RAW_TAGS = ["rundown", "rundown-render", "rundown-reelstudio"];
const PROCESSING_WAIT_MS = 10 * 60_000;


const ANALYSIS = join(import.meta.dir, "..", "..", "src", "lib", "studio", "data", "mnu-tot.json");
/** Exports, until they are uploaded or reviewed: the gitignored temporary render area publish.ts uses. */
const OUT_DIR = join(import.meta.dir, "out");
/** Logs and project metadata, never footage. */
const LOG_DIR = cachePath("reelstudio");

const RS = process.env.REELSTUDIO_DIR ?? join(homedir(), "Programming Projects", "reel-studio-app-wt", "spurs-match");
const RS_PYTHON = process.env.REELSTUDIO_PYTHON ?? join(RS, "engine", ".venv", "bin", "python");
const RS_CLI = join(RS, "ai", "dist", "cli.js");
// The engine burns captions with libass, which the app's own ffmpeg has.
const APP_FFMPEG = "/Applications/Reel Studio.app/Contents/Resources/ffmpeg";
const RS_FFMPEG = process.env.REELENGINE_FFMPEG ?? join(APP_FFMPEG, "ffmpeg");
const RS_FFPROBE = process.env.REELENGINE_FFPROBE ?? join(APP_FFMPEG, "ffprobe");
const RS_MODELS = process.env.REELENGINE_MODELS ?? join(homedir(), "Library", "Application Support", "Reel Studio", "models");
/** Reel Studio's own bold face, so the card's name matches the edit's type. */
const CARD_FONT = join(RS, "engine", "reelengine", "fonts", "Inter_700Bold.ttf");
/** Cutting needs no text; the player card's name needs drawtext. */
const FFMPEG = process.env.FFMPEG_PATH || "ffmpeg";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const MODEL = option("model") ?? "opus";
const RENDER_ONLY = flag("render-only");
const clipIds = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--model");
if (!clipIds.length) throw new Error("Name the clip IDs to edit");
for (const path of [RS_CLI, RS_PYTHON, RS_FFMPEG, RS_FFPROBE, join(RS_MODELS, "small.en"), CARD_FONT]) {
  if (!existsSync(path)) throw new Error(`Reel Studio is not ready: ${path} is missing (build ai/ and install engine/.venv)`);
}
if (!process.env.ANTHROPIC_BASE_URL || !process.env.ANTHROPIC_AUTH_TOKEN) {
  throw new Error("Set ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN for Claude Code");
}
if (!/ drawtext /.test(Bun.spawnSync([FFMPEG, "-hide_banner", "-filters"], { env: childEnv() }).stdout.toString())) {
  throw new Error(`${FFMPEG} has no drawtext filter; set FFMPEG_PATH to an ffmpeg that has it`);
}
if (!RENDER_ONLY && (process.env.STUDIO_NO_WRITES === "1" || process.env.STUDIO_CACHE_ONLY === "1")) throw new Error("Studio writes are disabled");

const parsed: unknown = JSON.parse(readFileSync(ANALYSIS, "utf8"));
assertAnalysis(parsed);
const analysis = parsed;
const clips = clipIds.map((id) => {
  const clip = analysis.clips.find((c) => c.id === id);
  if (!clip) throw new Error(`No clip ${id} in the analysis`);
  return clip;
});

const record: ReelStudioRecord = readCache<ReelStudioRecord>(REELSTUDIO_RECORD) ?? { eventId: EVENT_ID, clips: [] };
if (record.eventId !== EVENT_ID) throw new Error(`Reel Studio record event ${record.eventId} differs from ${EVENT_ID}`);
const save = () => {
  const path = cachePath(REELSTUDIO_RECORD);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, JSON.stringify(record, null, 1));
  renameSync(`${path}.tmp`, path);
};
const git = (...gitArgs: string[]) => Bun.spawnSync(["git", "-C", RS, ...gitArgs], { env: childEnv() }).stdout.toString().trim();
const reelStudio = `${git("rev-parse", "--short", "HEAD")}${git("status", "--porcelain") ? "-dirty" : ""}`;

/** Runs a process to the end, without API keys in its environment; a failure names its last stderr lines,
 * with any URL hidden. With `log`, stderr goes to that file as it comes (the editor's progress). */
async function run(cmd: string[], options: { cwd?: string; env?: Record<string, string>; hide?: string; label: string; log?: string }): Promise<string> {
  const proc = Bun.spawn(cmd, { cwd: options.cwd, env: options.env ?? childEnv(), stdout: "pipe", stderr: options.log ? Bun.file(options.log) : "pipe" });
  const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  const stderr = options.log ? readFileSync(options.log, "utf8") : await new Response(proc.stderr as ReadableStream).text();
  const clean = (s: string) => (options.hide ? s.replaceAll(options.hide, "[source URL]") : s);
  if (code !== 0) throw new Error(`${options.label} exited ${code}: ${clean(stderr).trim().split("\n").slice(-6).join(" | ")}`);
  return stdout;
}

/** The environment Reel Studio's engine and CLI run in. */
const reelStudioEnv = (root: string) => childEnv({ REELENGINE_FFMPEG: RS_FFMPEG, REELENGINE_FFPROBE: RS_FFPROBE, REELENGINE_MODELS: RS_MODELS, REELENGINE_ROOT: root });

/**
 * A player card: the caption name on a white band at the top, the ScorePlay headshot below on the club's
 * navy. The name is on top because a full-frame card in a square clip put the band where captions sit.
 * Bump CARD_DESIGN (reelstudio-plan.ts) when the card's look changes.
 */
async function playerCard(photoUrl: string, name: string, out: string, work: string): Promise<void> {
  const response = await fetch(photoUrl);
  if (!response.ok) throw new Error(`Headshot ${photoUrl} returned ${response.status}`);
  const photo = join(work, `${crypto.randomUUID()}.png`);
  writeFileSync(photo, new Uint8Array(await response.arrayBuffer()));
  const text = rundownRender.escapeDrawtext(name.toUpperCase());
  // Inter Bold capitals run about 0.72 em wide: fit the name in 648 of the card's 720 px ("MATEUS FERNANDES" overflowed at 82)
  const size = Math.min(82, Math.floor(648 / (0.72 * name.length)));
  const club = rundownRender.escapeDrawtext(MATCH.team.toUpperCase());
  const graph = "[1:v]scale=640:-1[p];[0:v][p]overlay=x=(W-w)/2:y=196,"
    + "drawbox=x=0:y=0:w=iw:h=196:color=white:t=fill,"
    + `drawtext=fontfile='${CARD_FONT}':text='${text}':fontsize=${size}:fontcolor=0x132257:x=(w-text_w)/2:y=${76 - Math.round(size / 2)},`
    + `drawtext=fontfile='${CARD_FONT}':text='${club}':fontsize=30:fontcolor=0x132257@0.75:x=(w-text_w)/2:y=142[out]`;
  await run([FFMPEG, "-hide_banner", "-loglevel", "error", "-nostdin",
    "-f", "lavfi", "-i", "color=c=0x132257:s=720x900", "-i", photo,
    "-filter_complex", graph, "-map", "[out]", "-frames:v", "1", "-y", out], { label: `player card for ${name}` });
}

/** Engine command, JSON lines on stdout; returns the done event's result. */
async function engine(command: string, cmdArgs: string[], root: string): Promise<unknown> {
  const stdout = await run([RS_PYTHON, "-m", "reelengine", command, ...cmdArgs], { cwd: join(RS, "engine"), env: reelStudioEnv(root), label: `reelengine ${command}` });
  for (const line of stdout.split("\n").reverse()) {
    if (!line.trim().startsWith("{")) continue;
    const event: unknown = JSON.parse(line);
    if (typeof event === "object" && event !== null && "event" in event && event.event === "done") return "result" in event ? event.result : undefined;
  }
  throw new Error(`reelengine ${command} printed no result`);
}

async function probeDuration(file: string): Promise<number> {
  const out = await run([RS_FFPROBE, "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { label: "ffprobe" });
  const seconds = Number(out.trim());
  if (!Number.isFinite(seconds)) throw new Error(`No duration for ${file}`);
  return seconds;
}

type Source = Awaited<ReturnType<typeof renderSource>>;

/** Makes the Reel Studio edit of one clip and returns its export in OUT_DIR. Its footage only ever lives in a
 * temporary folder, deleted on every path. */
async function editClip(clip: Clip, source: Source, plan: ReturnType<typeof editPlan>): Promise<{ file: string; summary: string; post: { caption: string; hashtags: string[] }; ms: number; stages: Record<string, number> }> {
  const started = performance.now();
  const stages: Record<string, number> = {};
  const lap = (name: string, from: number) => { stages[name] = Math.round(performance.now() - from); return performance.now(); };
  const work = mkdtempSync(join(tmpdir(), `rundown-rs-${clip.id}-`));
  const target = join(OUT_DIR, `${clip.id}.reelstudio.mp4`);
  try {
    const root = join(work, "root");
    const images = join(root, "Library", "Images");
    mkdirSync(images, { recursive: true });
    mkdirSync(join(root, "Library", "Music"), { recursive: true });

    // 1. The footage: the clip's segments, framed around their focus keys below the scorebug, no title.
    let t = performance.now();
    const cut = join(work, `${clip.id}.mp4`);
    console.log(`${clip.id}: ${plan.format}, scorebug band left out of ${plan.cropTop.filter(Boolean).length} of ${plan.cropTop.length} segments`);
    const cutArgs = ffmpegArgs({ clip: plan.plain, url: source.url, focus: plan.focus, fontFile: CARD_FONT, escape: (s) => s, wrap: () => [], cropTop: plan.cropTop }, cut);
    // Reel Studio encodes again, so this pass keeps more detail than a final render would.
    const crf = cutArgs.indexOf("-crf");
    cutArgs.splice(crf, 2, "-crf", "14");
    // Reel Studio sets the loudness itself. loudnorm here left a three-segment cut's sound 60 ms short of
    // its packets' length, which put the edit's sound 80 ms behind the picture by the end.
    const graph = cutArgs.indexOf("-filter_complex") + 1;
    if (!cutArgs[graph].includes("loudnorm=")) throw new Error("render.ts's audio chain changed; recheck the cut pass");
    cutArgs[graph] = cutArgs[graph].replace(/loudnorm=[^\[]*/, "anull");
    await run([FFMPEG, ...cutArgs], { hide: source.url, label: `ffmpeg cutting ${clip.id}` });
    t = lap("cut", t);

    // 2. Player cards for the clip's players that ScorePlay has a headshot of.
    for (const card of plan.cards) await playerCard(card.player.photoUrl!, card.player.shortName, join(images, card.file), work);
    t = lap("cards", t);

    // 3. The project: the cut file, its segments as seconds ranges, the brief, no music.
    const project = join(work, "project");
    await engine("init", ["--project", project, "--title", clip.title, cut], root);
    const file = join(project, "project.json");
    const p = JSON.parse(readFileSync(file, "utf8"));
    p.format = { ...p.format, width: 1080, height: plan.format === "1:1" ? 1080 : 1920, fps: CUT_FPS };
    p.cut = { ...p.cut, keep: cutRanges(plan.plain, p.sources[0].id), source: "rundown" };
    p.music = { ...p.music, enabled: false, track: null };
    p.captions = { ...p.captions, vocabulary: vocabulary(analysis.source.players, clipMoments(clip, analysis.moments)) };
    p.brief = plan.brief;
    writeFileSync(file, JSON.stringify(p, null, 2));
    t = lap("project", t);

    // 4. The edit, headless: transcription, Claude's first edit, the final render.
    mkdirSync(LOG_DIR, { recursive: true });
    const out = await run(["node", RS_CLI, "first-edit", "--project", project,
      "--provider", "claude-cli", "--model", MODEL, "--claude-proxy", "--session",
      "--engine-cwd", join(RS, "engine"), "--python", RS_PYTHON, "--root", root, "--settings", join(work, "settings")],
    { env: reelStudioEnv(root), label: `Reel Studio first edit of ${clip.id}`, log: join(LOG_DIR, `${clip.id}.log`) });
    lap("edit", t);
    copyFileSync(file, join(LOG_DIR, `${clip.id}.project.json`));
    copyFileSync(join(project, "work", "transcript.json"), join(LOG_DIR, `${clip.id}.transcript.json`));
    const result = JSON.parse(out.slice(out.indexOf("{")));
    if (typeof result?.version !== "number") throw new Error(`Reel Studio returned no version for ${clip.id}`);
    if (result.notice) throw new Error(`Reel Studio stopped early on ${clip.id}: ${JSON.stringify(result.notice)}`);
    const edited = JSON.parse(readFileSync(file, "utf8"));
    mkdirSync(OUT_DIR, { recursive: true });
    copyFileSync(join(project, "versions", `v${result.version}`, "export.mp4"), `${target}.tmp`);
    renameSync(`${target}.tmp`, target);
    return {
      file: target,
      summary: String(result.summary ?? ""),
      post: { caption: String(edited.post?.caption ?? ""), hashtags: Array.isArray(edited.post?.hashtags) ? edited.post.hashtags.map(String) : [] },
      ms: Math.round(performance.now() - started),
      stages,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
    rmSync(`${target}.tmp`, { force: true });
  }
}

/** Uploads an edit, waits for ScorePlay to process it and checks what it reports. */
async function upload(entry: ReelStudioClip, tagId: number): Promise<void> {
  if (entry.state !== "tagged") {
    const started = performance.now();
    const players = [...new Set(clipMoments(entry.clip, analysis.moments).flatMap((m) => m.players))];
    const caption = entry.post?.caption || entry.clip.caption;
    const hashtags = entry.post?.hashtags.length ? entry.post.hashtags : entry.clip.hashtags;
    await publishUpload(entry, { eventId: EVENT_ID, description: `${caption} ${hashtags.join(" ")}`, rawTags: RAW_TAGS, tagIds: [tagId], players, replace: false }, save);
    entry.uploadMs = (entry.uploadMs ?? 0) + Math.round(performance.now() - started);
    save();
    console.log(`${entry.clipId}: media ${entry.mediaId}, ${entry.state}`);
  }
  const deadline = Date.now() + PROCESSING_WAIT_MS;
  for (;;) {
    const media = await getPublishedMedia(entry.mediaId!);
    entry.status = media.status;
    entry.scoreplayDurationSec = media.video?.duration;
    entry.scoreplayBytes = Number(media.video?.file_size);
    save();
    if (media.status === "DONE") {
      if (media.event_id !== EVENT_ID || media.name !== entry.name) throw new Error(`Media ${entry.mediaId} has the wrong event or name`);
      const expected = entry.renderedDurationSec ?? entry.clip.durationSec;
      if (!Number.isFinite(entry.scoreplayDurationSec) || Math.abs(entry.scoreplayDurationSec! - expected) > 1) {
        throw new Error(`Media ${entry.mediaId} duration ${entry.scoreplayDurationSec} differs from the render's ${expected}`);
      }
      if (entry.scoreplayBytes !== entry.uploadedBytes) throw new Error(`Media ${entry.mediaId} size ${entry.scoreplayBytes} differs from upload ${entry.uploadedBytes}`);
      break;
    }
    if (media.status === "FAILED" || Date.now() > deadline) throw new Error(`Media ${entry.mediaId} is ${media.status}; processing did not complete`);
    await Bun.sleep(10_000);
  }
  console.log(`media ${entry.mediaId}: ${entry.status}, ${entry.scoreplayDurationSec ?? "?"} s, ${entry.scoreplayBytes} bytes`);
}

const source = await renderSource(analysis.source.id);
const tag = RENDER_ONLY ? undefined : await scoreplay.findOrCreateTagOption(TAG.name, TAG.label);
for (const clip of clips) {
  const plan = editPlan(clip, analysis);
  const key = clipEditKey(clip, plan, { source: source.metadata, reelStudio, model: MODEL, card: CARD_DESIGN });
  let entry = record.clips.find((c) => c.clipId === clip.id);
  const action = reuseOf(entry, key, { replace: flag("replace"), again: flag("again"), exportExists: !!entry && existsSync(entry.file) });
  if (action === "replace" && entry) {
    record.replaced = [...(record.replaced ?? []), entry];
    record.clips = record.clips.filter((c) => c !== entry);
    save();
    console.log(`${clip.id}: replacing media ${entry.mediaId}, which stays in ScorePlay`);
  }
  const exported = join(OUT_DIR, `${clip.id}.reelstudio.mp4`);
  // Only a --render-only run that finished keeps its export, for review; every other path deletes it.
  let keep = false;
  try {
    if (action === "edit" || action === "replace") {
      if (entry && !entry.mediaId) rmSync(entry.file, { force: true });
      const made = await editClip(clip, source, plan);
      const earlier = (record.replaced ?? []).filter((c) => c.clipId === clip.id);
      const planned: Clip = { ...clip };
      delete planned.scoreplayMediaId;
      delete planned.reelStudioMediaId;
      entry = {
        clipId: clip.id,
        clip: planned,
        file: made.file,
        renderMs: made.ms,
        bytes: statSync(made.file).size,
        name: `Rundown × Reel Studio · ${clip.title} (${plan.format})${earlier.length ? ` · v${earlier.length + 1}` : ""}.mp4`,
        renderSource: source.metadata,
        editKey: key,
        cardDesign: CARD_DESIGN,
        model: MODEL,
        reelStudioCommit: reelStudio,
        ...(earlier.length ? { replacesMediaId: earlier.at(-1)!.mediaId } : {}),
        summary: made.summary,
        post: made.post,
        renderedDurationSec: await probeDuration(made.file),
      };
      record.clips = [...record.clips.filter((c) => c.clipId !== clip.id), entry];
      save();
      console.log(`${clip.id}: edited in ${(made.ms / 1000).toFixed(0)} s (${Object.entries(made.stages).map(([k, v]) => `${k} ${(v / 1000).toFixed(0)} s`).join(", ")})`);
      console.log(`  ${made.summary}`);
    }
    if (RENDER_ONLY) {
      if (entry && !entry.mediaId) {
        keep = true;
        console.log(`${clip.id}: export left in ${entry.file} for review (gitignored); delete it after looking`);
      }
      continue;
    }
    await upload(entry!, tag!.ID);
  } finally {
    if (!keep) {
      rmSync(exported, { force: true });
      if (entry?.file) rmSync(entry.file, { force: true });
    }
  }
}

if (!RENDER_ONLY) {
  applyReelStudio(analysis.clips, record, analysis);
  assertAnalysis(analysis);
  writeFileSync(ANALYSIS, `${JSON.stringify(analysis, null, 2)}\n`);
  console.log(`Recorded reelStudioMediaId on ${analysis.clips.filter((c) => c.reelStudioMediaId).length} clips in ${ANALYSIS}`);
}
