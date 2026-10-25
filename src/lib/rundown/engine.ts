import "server-only";

import { randomUUID } from "node:crypto";
import { getEvent, searchMedia, scoreplayConfigured, type SpEvent, type SpMedia } from "../scoreplay";
import {
  getIndex,
  getIndexedAsset,
  listIndexedAssets,
  search,
  twelvelabsConfigured,
  type TlClip,
  type TlIndexedAsset,
} from "../twelvelabs";
import { alignMatchLog, broadcastOffset, matchTimeAt, type Alignment } from "./align";
import { analyzeMoment, findQuotes, type MatchContext } from "./analyze";
import { demoRun } from "./demo";
import { clusterHits, overlap, type Hit } from "./moments";
import { fanPostToQuery, probesFor } from "./probes";
import { propose, spike } from "./propose";
import { cached, saveRun } from "./store";
import { STAGE_NAMES, type Asset, type AssetRole, type MomentKind, type Run, type RunInput, type Spike, type StageName } from "./types";

// The pipeline: pull the match from ScorePlay, find the Twelve Labs copy of
// each video, search it for moments, line up the match log, ask Pegasus about
// the strongest moments, then rank proposals and spikes. Each stage saves the
// run so the workspace can show progress while it works.

export function liveConfigured() {
  return scoreplayConfigured() && twelvelabsConfigured();
}

/**
 * Creates a run and returns it with the work still going. Callers hand
 * `done` to `after()` so the pipeline outlives the response.
 */
export async function startRun(input: RunInput): Promise<{ run: Run; done: Promise<void> }> {
  if (!liveConfigured()) {
    const run = demoRun(input);
    await saveRun(run);
    return { run, done: Promise.resolve() };
  }
  const run: Run = {
    id: randomUUID().slice(0, 8),
    input,
    source: "live",
    status: "running",
    createdAt: new Date().toISOString(),
    stages: STAGE_NAMES.map((name) => ({ name, status: "pending" })),
    assets: [],
    partners: [],
    moments: [],
    proposals: [],
    spikes: [],
    storage: [],
  };
  await saveRun(run);
  return { run, done: execute(run) };
}

/** Internal state that does not belong in the saved run. */
type Ctx = {
  run: Run;
  event?: SpEvent;
  /** Twelve Labs video `_id` to its `asset_id`, which Pegasus needs. */
  tlAsset: Map<string, string>;
  modalities: string[];
  hits: Hit[];
  match: MatchContext;
  /** The match log lined up with this broadcast video, once the match-log stage has run. */
  alignment?: Alignment & { videoId: string };
};

async function execute(run: Run) {
  const ctx: Ctx = {
    run,
    tlAsset: new Map(),
    modalities: ["visual", "audio"],
    hits: [],
    match: { sport: run.input.sport, matchName: "the match", roster: [], partners: [] },
  };
  try {
    await stage(ctx, "pull", () => pull(ctx));
    await stage(ctx, "map", () => mapToIndex(ctx));
    await stage(ctx, "probe", () => probe(ctx));
    await stage(ctx, "match-log", () => matchLog(ctx));
    await stage(ctx, "fans", () => fans(ctx));
    await stage(ctx, "press", () => press(ctx));
    await stage(ctx, "merge", async () => {
      run.moments = clusterHits(ctx.hits);
      const log = run.input.matchLog;
      const aligned = ctx.alignment;
      if (log && aligned) {
        for (const m of run.moments) {
          if (m.primary.videoId === aligned.videoId) m.matchTime = matchTimeAt(log, aligned, m.primary.start);
        }
      }
      return `${ctx.hits.length} hits became ${run.moments.length} moments`;
    });
    await stage(ctx, "analyze", () => analyzeTop(ctx));
    const duplicates: Spike[] = [];
    await stage(ctx, "angles", () => findAngles(ctx, duplicates));
    await stage(ctx, "archive", () => archive(ctx));
    await stage(ctx, "propose", async () => {
      const result = propose(run.moments, { assets: run.assets, partners: run.partners, now: new Date().toISOString() });
      run.proposals = result.proposals;
      run.spikes = [...duplicates, ...result.spikes];
      run.storage = result.storage;
      return `${run.proposals.length} proposals, ${run.spikes.length} spiked`;
    });
    run.status = "done";
  } catch (err) {
    run.status = "failed";
    run.error = err instanceof Error ? err.message : String(err);
  }
  await saveRun(run);
}

async function stage(ctx: Ctx, name: StageName, fn: () => Promise<string | false>) {
  // startRun creates one entry for every name in STAGE_NAMES.
  const s = ctx.run.stages.find((x) => x.name === name)!;
  s.status = "running";
  s.startedAt = new Date().toISOString();
  await saveRun(ctx.run);
  try {
    const detail = await fn();
    s.status = detail === false ? "skipped" : "done";
    if (detail) s.detail = detail;
  } catch (err) {
    s.status = "failed";
    s.detail = err instanceof Error ? err.message : String(err);
    // Without assets or the index there is nothing to work on.
    if (name === "pull" || name === "map") throw err;
  } finally {
    s.finishedAt = new Date().toISOString();
    await saveRun(ctx.run);
  }
}

// --- pull ------------------------------------------------------------------

const titleCase = (s: string) => s.replace(/\b\p{L}/gu, (c) => c.toUpperCase());

function roleOf(m: SpMedia): AssetRole {
  if (m.type === "photo") return "photo";
  const text = `${m.name} ${m.description ?? ""} ${(m.raw_tags ?? []).join(" ")}`.toLowerCase();
  if (/press|conference|interview|presser/.test(text)) return "press";
  if (/\biso\b|camera|cam\b|angle/.test(text)) return "iso";
  if (/highlight|edit|youtube|social|reel|recap|package/.test(text)) return "published-edit";
  if (/broadcast|full (match|game)|world feed|program/.test(text) || (m.duration ?? 0) > 45 * 60) return "broadcast";
  return "other";
}

function toAsset(m: SpMedia): Asset {
  return {
    id: String(m.ID),
    kind: m.type === "photo" ? "photo" : "video",
    role: roleOf(m),
    name: m.name,
    durationSec: m.duration,
    createdAt: m.date ? new Date(m.date * 1000).toISOString() : undefined,
    thumbnailUrl: m.thumbnail_url,
    previewUrl: m.proxy_medium ?? m.streaming_url,
    players: (m.tags ?? []).flatMap((t) => (t.player ? [titleCase(t.player.full_name)] : [])),
    tags: (m.tags ?? []).flatMap((t) => (t.tag_option ? [t.tag_option.label || t.tag_option.name] : t.name ? [t.name] : [])),
  };
}

async function pull(ctx: Ctx) {
  const { run } = ctx;
  const event = await getEvent(run.input.eventId);
  if (!event) throw new Error(`ScorePlay has no event ${run.input.eventId}`);
  ctx.event = event;
  run.event = { id: event.ID, name: event.name, date: event.date };
  const media = await searchMedia({ event_id: event.ID });
  if (!media.length) throw new Error(`Event ${event.name} has no media`);
  run.companyId = media[0].company_id;
  run.assets = media.map(toAsset);

  const sponsorNames = new Set<string>();
  for (const s of event.sponsors ?? []) sponsorNames.add(s.label || s.name);
  for (const m of media) for (const t of m.tags ?? []) if (t.sponsor) sponsorNames.add(t.sponsor.label || t.sponsor.name);
  run.partners = [...sponsorNames];
  ctx.match = {
    sport: run.input.sport,
    matchName: event.name,
    roster: (event.players ?? []).map((p) => titleCase(p.full_name)),
    partners: run.partners,
  };
  const videos = run.assets.filter((a) => a.kind === "video").length;
  return `${event.name}: ${videos} videos, ${run.assets.length - videos} photos`;
}

// --- map -------------------------------------------------------------------

type TlEntry = Pick<TlIndexedAsset, "_id" | "asset_id" | "system_metadata" | "user_metadata"> & { hlsUrl?: string };

/** Every indexed video with its metadata, cached until the index changes size. */
async function indexEntries(): Promise<{ entries: TlEntry[]; modalities: string[] }> {
  const index = await getIndex();
  const modalities = (index.models[0]?.model_options ?? ["visual", "audio"]).filter((m) =>
    ["visual", "audio", "transcription"].includes(m),
  );
  const entries = await cached("index", { id: index._id, count: index.video_count }, async () => {
    const list = await listIndexedAssets();
    return mapLimit(list, 6, async (v): Promise<TlEntry> => {
      const full = await getIndexedAsset(v._id);
      return {
        _id: v._id,
        asset_id: full.asset_id ?? v.asset_id,
        system_metadata: full.system_metadata ?? v.system_metadata,
        user_metadata: full.user_metadata,
        hlsUrl: full.hls?.video_url,
      };
    });
  });
  return { entries, modalities };
}

const normalise = (s: string) => s.toLowerCase().replace(/\.[a-z0-9]{2,4}$/, "").replace(/[^a-z0-9]+/g, "");

/** The ScorePlay ID an indexed video carries, wherever the uploader put it. */
function scoreplayIdOf(entry: TlEntry, ids: Set<string>): string | undefined {
  const key = process.env.TWELVELABS_SCOREPLAY_ID_KEY;
  const meta = entry.user_metadata ?? {};
  const values = key ? [meta[key]] : Object.values(meta);
  for (const v of values.flat()) {
    if ((typeof v === "string" || typeof v === "number") && ids.has(String(v))) return String(v);
  }
  return undefined;
}

async function mapToIndex(ctx: Ctx) {
  const { run } = ctx;
  const { entries, modalities } = await indexEntries();
  ctx.modalities = modalities.length ? modalities : ["visual"];
  const videos = run.assets.filter((a) => a.kind === "video");
  const ids = new Set(videos.map((a) => a.id));
  const byName = new Map(videos.map((a) => [normalise(a.name), a]));
  let byFilename = 0;
  for (const entry of entries) {
    const scoreplayId = scoreplayIdOf(entry, ids);
    let asset = scoreplayId ? videos.find((a) => a.id === scoreplayId) : undefined;
    if (!asset && entry.system_metadata?.filename) {
      asset = byName.get(normalise(entry.system_metadata.filename));
      if (asset) byFilename++;
    }
    if (!asset) continue;
    asset.videoId = entry._id;
    asset.durationSec ??= entry.system_metadata?.duration;
    asset.previewUrl ??= entry.hlsUrl;
    if (entry.asset_id) ctx.tlAsset.set(entry._id, entry.asset_id);
  }
  const mapped = videos.filter((a) => a.videoId).length;
  if (!mapped) throw new Error(`None of the ${videos.length} videos are in Twelve Labs index ${process.env.TWELVELABS_INDEX_ID}`);
  return `${mapped} of ${videos.length} videos found in the index${byFilename ? ` (${byFilename} by filename)` : ""}`;
}

// --- search ----------------------------------------------------------------

/** Marengo returns a rank, not a score. Rank 1 keeps the full weight. */
const rankStrength = (weight: number, rank: number) => weight * Math.pow(0.93, Math.max(0, rank - 1));

function assetForVideo(ctx: Ctx, videoId: string) {
  return ctx.run.assets.find((a) => a.videoId === videoId);
}

function clipToHit(ctx: Ctx, clip: TlClip, hit: Omit<Hit, "assetId" | "videoId" | "start" | "end">): Hit | undefined {
  const asset = assetForVideo(ctx, clip.video_id);
  if (!asset) return undefined;
  return { ...hit, assetId: asset.id, videoId: clip.video_id, start: clip.start, end: clip.end, thumbnailUrl: clip.thumbnail_url ?? asset.thumbnailUrl };
}

const searchable = (ctx: Ctx, roles: AssetRole[]) =>
  ctx.run.assets.filter((a) => a.videoId && roles.includes(a.role)).map((a) => a.videoId as string);

const FOOTAGE: AssetRole[] = ["broadcast", "iso", "other"];

async function probe(ctx: Ctx) {
  const videoIds = searchable(ctx, FOOTAGE);
  if (!videoIds.length) return false;
  const probes = probesFor(ctx.run.input.sport);
  const results = await mapLimit(probes, 4, async (p) => {
    const clips = await search({ query: p.query, videoIds, modalities: ctx.modalities, limit: 10 });
    return clips.flatMap((clip) => {
      const hit = clipToHit(ctx, clip, {
        kind: p.kind,
        label: p.label,
        signal: { source: "footage", label: p.label, query: p.query, strength: rankStrength(p.weight, clip.rank) },
      });
      return hit ? [hit] : [];
    });
  });
  const hits = results.flat();
  ctx.hits.push(...hits);
  return `${probes.length} searches, ${hits.length} hits`;
}

const LOG_KINDS: Record<string, { kind: MomentKind; strength: number; before: number; after: number }> = {
  goal: { kind: "goal", strength: 0.95, before: 10, after: 20 },
  "red-card": { kind: "card", strength: 0.8, before: 15, after: 15 },
  "yellow-card": { kind: "card", strength: 0.35, before: 10, after: 8 },
};

async function matchLog(ctx: Ctx) {
  const log = ctx.run.input.matchLog;
  if (!log?.length) return false;
  const broadcast = ctx.run.assets
    .filter((a) => a.role === "broadcast" && a.videoId)
    .sort((a, b) => (b.durationSec ?? 0) - (a.durationSec ?? 0))[0];
  if (!broadcast) return "No broadcast asset to align against";
  const goalHits = ctx.hits
    .filter((h) => h.kind === "goal" && h.videoId === broadcast.videoId)
    .map((h) => ({ start: h.start, strength: h.signal.strength }));
  const alignment = alignMatchLog(log, goalHits);
  if (!alignment) return `Could not line up the ${log.filter((e) => e.kind === "goal").length} logged goals with the footage`;
  ctx.alignment = { ...alignment, videoId: broadcast.videoId as string };

  let placed = 0;
  for (const e of log) {
    const spec = LOG_KINDS[e.kind];
    if (!spec) continue;
    const at = broadcastOffset(log, alignment, e);
    if (at === undefined || at < 0) continue;
    const label = e.text ? e.text.split(".")[0] : `${e.kind} ${e.players[0] ?? ""}`.trim();
    ctx.hits.push({
      assetId: broadcast.id,
      videoId: broadcast.videoId as string,
      start: Math.max(0, at - spec.before),
      end: Math.min(broadcast.durationSec ?? Infinity, at + spec.after),
      kind: spec.kind,
      label,
      signal: { source: "match-log", label, ref: e.id, strength: spec.strength },
    });
    placed++;
  }
  return `Aligned on ${alignment.matched} goals; placed ${placed} logged events`;
}

async function fans(ctx: Ctx) {
  const posts = (ctx.run.input.fanPosts ?? []).map((p) => p.trim()).filter(Boolean).slice(0, 40);
  if (!posts.length) return false;
  const videoIds = searchable(ctx, FOOTAGE);
  const results = await mapLimit(posts, 4, async (post) => {
    const query = fanPostToQuery(post);
    if (query.length < 4) return [];
    const clips = await search({ query, videoIds, modalities: ctx.modalities, limit: 3 });
    const label = post.length > 90 ? `${post.slice(0, 87)}...` : post;
    return clips.flatMap((clip) => {
      const hit = clipToHit(ctx, clip, {
        kind: "other",
        label,
        signal: { source: "fans", label, query, strength: rankStrength(0.75, clip.rank) },
      });
      return hit ? [hit] : [];
    });
  });
  const hits = results.flat();
  ctx.hits.push(...hits);
  return `${posts.length} posts, ${hits.length} hits`;
}

async function press(ctx: Ctx) {
  const assets = ctx.run.assets.filter((a) => a.role === "press" && a.videoId && (a.durationSec ?? 0) <= 3600);
  if (!assets.length) return false;
  let found = 0;
  await mapLimit(assets.slice(0, 4), 2, async (a) => {
    const tlAssetId = ctx.tlAsset.get(a.videoId as string);
    if (!tlAssetId) return;
    const quotes = await findQuotes(tlAssetId, ctx.match);
    for (const q of quotes) {
      const label = `${q.speaker || "Press"}: "${q.quote.length > 70 ? `${q.quote.slice(0, 67)}...` : q.quote}"`;
      ctx.hits.push({
        assetId: a.id,
        videoId: a.videoId as string,
        start: q.start,
        end: q.end,
        kind: "press",
        label,
        signal: { source: "footage", label: `Quote on ${q.topic}`, query: q.quote, strength: 0.45 + 0.45 * Math.min(1, q.strength) },
      });
      found++;
    }
  });
  return `${found} quotes from ${assets.length} press assets`;
}

// --- analyze ---------------------------------------------------------------

async function analyzeTop(ctx: Ctx) {
  const { run } = ctx;
  const limit = run.input.analyzeLimit ?? 12;
  const top = run.moments.slice(0, limit);
  const errors: string[] = [];
  await mapLimit(top, 3, async (m) => {
    const tlAssetId = ctx.tlAsset.get(m.primary.videoId as string);
    if (!tlAssetId) return;
    try {
      const duration = run.assets.find((a) => a.id === m.primary.assetId)?.durationSec;
      const { analysis, kind } = await analyzeMoment(m, tlAssetId, ctx.match, duration);
      m.analysis = analysis;
      m.kind = kind;
      if (kind === "press") m.title = analysis.hook || m.title;
    } catch (err) {
      // One bad window should not sink the run; the moment is ranked on its search score alone.
      errors.push(err instanceof Error ? err.message : String(err));
    }
    await saveRun(run);
  });
  const described = `Pegasus described ${top.length - errors.length} of ${top.length} moments`;
  return errors.length ? `${described}. First error: ${errors[0]}` : described;
}

/** Looks for each strong moment on the other cameras, and folds duplicates into it. */
async function findAngles(ctx: Ctx, duplicates: Spike[]) {
  const { run } = ctx;
  const footage = searchable(ctx, ["iso", "broadcast", "other"]);
  const candidates = run.moments.filter((m) => m.analysis && m.kind !== "press").slice(0, 6);
  let found = 0;
  for (const m of candidates) {
    if (!run.moments.includes(m)) continue;
    const others = footage.filter((id) => id !== m.primary.videoId);
    if (!others.length) break;
    const [best] = await search({ query: (m.analysis?.description ?? m.title).slice(0, 300), videoIds: others, modalities: ctx.modalities, limit: 1 });
    const asset = best && assetForVideo(ctx, best.video_id);
    if (!asset) continue;
    m.angles.push({ assetId: asset.id, videoId: best.video_id, start: best.start, end: best.end, note: asset.name });
    found++;
    for (const other of [...run.moments]) {
      if (other === m || other.primary.videoId !== best.video_id) continue;
      if (overlap(other.primary, best) < 1) continue;
      run.moments = run.moments.filter((x) => x !== other);
      m.signals.push(...other.signals.filter((s) => s.source !== "footage"));
      duplicates.push(spike(other, "duplicate", `Same moment as "${m.title}", seen from ${asset.name}. Kept as a second angle instead.`, m.id));
    }
  }
  return `${found} second angles, ${duplicates.length} duplicates folded in`;
}

async function archive(ctx: Ctx) {
  const { run, event } = ctx;
  if (!run.input.includeArchive || !event?.players?.length) return false;
  const before = event.date ? event.date - 86400 : undefined;
  const older = await searchMedia({ media_type: "video", any_players: event.players.map((p) => p.ID), end_date: before }, 60);
  const ids = new Set(run.assets.map((a) => a.id));
  const archiveAssets = older.filter((m) => !ids.has(String(m.ID))).map((m) => ({ ...toAsset(m), role: "archive" as const }));
  const { entries } = await indexEntries();
  const archiveIds = new Set(archiveAssets.map((a) => a.id));
  for (const entry of entries) {
    const id = scoreplayIdOf(entry, archiveIds);
    const asset = archiveAssets.find((a) => a.id === id);
    if (asset) asset.videoId = entry._id;
  }
  const searchableArchive = archiveAssets.filter((a) => a.videoId);
  if (!searchableArchive.length) return `${archiveAssets.length} older assets, none in the index`;
  run.assets.push(...searchableArchive);

  const targets = run.moments.filter((m) => m.analysis && ["goal", "skill", "celebration"].includes(m.kind)).slice(0, 3);
  let paired = 0;
  for (const m of targets) {
    const [best] = await search({
      query: m.signals.find((s) => s.source === "footage")?.query ?? m.title,
      videoIds: searchableArchive.map((a) => a.videoId as string),
      modalities: ctx.modalities,
      limit: 1,
    });
    const asset = best && assetForVideo(ctx, best.video_id);
    if (!asset) continue;
    m.archive = { assetId: asset.id, videoId: best.video_id, start: best.start, end: best.end, note: asset.name };
    m.signals.push({ source: "archive", label: `Archive: ${asset.name}`, strength: 0.5 });
    paired++;
  }
  return `${searchableArchive.length} archive videos searched; ${paired} then-and-now pairs`;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}
