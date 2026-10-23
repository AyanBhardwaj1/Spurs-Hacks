// Builds src/lib/studio/data/mnu-tot.json from ScorePlay data:
//   STUDIO_MODEL_TIER=real bun scripts/studio/analyze.ts
// Every fetch, the crowd-audio pass and every Claude answer are cached under
// .media/studio, so a rerun skips finished work. Delete a cache file to redo
// that step. Only the real tier (Opus) writes the demo file; the default test
// tier (Haiku) writes .media/studio/mnu-tot.test.json, so a test run never
// replaces what the UI shows. See claude.ts for the model and provider settings.
// STUDIO_CACHE_ONLY=1 stops at the first step that is not cached, before any
// external call and before anything is written.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { MatchAnalysis, Player, Rejected, StageRun } from "../../src/lib/studio/types";
import { audienceFor, planAudiences } from "./audiences";
import { describeMoments } from "./descriptions";
import { rankedRejections, visualRejections } from "./rejected";
import { tagsFor } from "./taxonomy";
import { applyWriteback, writeback, writebackDetail } from "./writeback";
import { cached, cacheMisses, cachePath, readCache, writeCache } from "./cache";
import { planClips } from "./clips";
import { mapLimit, modelConfig } from "./claude";
import { floorPerSecond, measureCrowdFrames } from "./crowd";
import { focusFor, mergeRefinedFocus } from "./focus";
import { renderSource } from "./render-source";
import { alignGroundTruth, evaluate } from "./ground-truth";
import { buildMoments, checkEvents, extractEvents, findClockAnchors, mergeEvents } from "./moments";
import { footballRoster, toPlayer } from "./roster";
import { englishSubtitles, getMedia, listPlayers } from "./scoreplay";
import { applyPublished } from "./published";
import { applyReelStudio, REELSTUDIO_RECORD, type ReelStudioRecord } from "./reelstudio-plan";
import { total } from "./scores";
import { evidenceFor, GENERIC_QUERIES, queriesFor, runQueries, unmatched } from "./visual";
import { parseSrt } from "./srt";
import { assertAnalysis } from "./validate";
import { segmentMatch, reviewMoments, segmentationAtK } from "./matchwatch-run";

const SOURCE_ID = 130852725;
const REAL = modelConfig().tier === "real";
const OUTPUT = REAL ? join(import.meta.dir, "..", "..", "src", "lib", "studio", "data", "mnu-tot.json") : cachePath("mnu-tot.test.json");
/** Stage durations are kept per tier, so a test run's timings never show up in the demo file. */
const STAGE_TIMES = REAL ? "stage-times.json" : "stage-times.test.json";
/** Seconds per value in the crowd timeline the UI draws. */
const CROWD_STEP_SEC = 5;

const stages: StageRun[] = [];
const stageTimes = readCache<Record<string, number>>(STAGE_TIMES) ?? {};

/** Runs a stage and records its duration: measured when it did uncached work, otherwise the last measured run. */
async function stage<T>(id: string, label: string, run: () => Promise<{ result: T; detail: string }>): Promise<T> {
  const before = cacheMisses();
  const started = performance.now();
  const { result, detail } = await run();
  const measured = Math.round(performance.now() - started);
  if (cacheMisses() > before || stageTimes[id] === undefined) stageTimes[id] = measured;
  stages.push({ id, label, detail, durationMs: stageTimes[id] });
  console.log(`[${id}] ${detail} (${stageTimes[id]} ms${cacheMisses() > before ? "" : ", cached"})`);
  return result;
}

const n = (x: number) => x.toLocaleString("en-GB");
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * p)];

const { media, roster, cues } = await stage("fetch", "Fetch from ScorePlay", async () => {
  const media = await getMedia(SOURCE_ID);
  const roster = footballRoster(await listPlayers());
  const srt = await englishSubtitles(media);
  if (!srt) throw new Error(`Media ${SOURCE_ID} has no english_subtitle.srt attachment`);
  if (!media.video?.proxy_medium) throw new Error(`Media ${SOURCE_ID} has no proxy_medium rendition`);
  const cues = parseSrt(srt);
  const tagged = (media.tags ?? []).filter((t) => t.player).length;
  return {
    result: { media, roster, cues },
    detail: `${media.name}, ${n(media.video.duration)} s; ${roster.length} squad players and staff, ${tagged} tagged on the match; ${n(cues.length)} commentary lines`,
  };
});
const video = media.video!;
const durationSec = video.duration;

const floorDb = await stage("crowd", "Measure crowd noise", async () => {
  const { value: frames } = await cached("crowd-frames.json", () => measureCrowdFrames(video.proxy_medium!, durationSec));
  const floor = floorPerSecond(frames);
  return {
    result: floor,
    detail: `${n(durationSec)} s of match audio streamed from the ScorePlay proxy into ${n(frames.rmsDb.length)} loudness frames; crowd floor from ${percentile(floor, 0.05).toFixed(0)} dB (quiet) to ${percentile(floor, 0.99).toFixed(0)} dB (loudest 1%)`,
  };
});

const { events, anchors, commentaryRejected } = await stage("commentary", "Read the commentary with Claude", async () => {
  const [clock, extracted] = await Promise.all([findClockAnchors(cues), extractEvents(cues, roster)]);
  const checked = checkEvents(extracted.events, cues, roster);
  const kept = checked.kept;
  const rejected = [...checked.rejected, ...extracted.outside.map((event) => ({ event, reason: "peak in a context stretch, outside its window" }))];
  const merged: { event: (typeof kept)[number]; lead: (typeof kept)[number] }[] = [];
  const events = mergeEvents(kept, (event, lead) => merged.push({ event, lead }));
  const commentaryRejected: Rejected[] = [
    ...rejected.map(({ event, reason }) => ({ title: event.title, at: event.peakSec, kind: event.kind, source: "commentary" as const, reason: `${reason[0].toUpperCase()}${reason.slice(1)}.` })),
    ...merged.map(({ event, lead }) => ({ title: event.title, at: event.peakSec, kind: event.kind, source: "commentary" as const, reason: `Merged into m-${String(Math.round(lead.peakSec)).padStart(4, "0")}-${lead.kind}, "${lead.title}", by the commentary proximity rule at a ${Math.abs(event.peakSec - lead.peakSec).toFixed(1)}-second gap instead of retained separately.` })),
  ];
  writeCache("report/rejected-events.json", commentaryRejected);
  writeCache("report/clock-anchors.json", clock.evidence);
  return {
    result: { events, anchors: clock.anchors, commentaryRejected },
    detail: `${n(cues.length)} lines read in ${extracted.chunks} ten-minute windows gave ${extracted.events.length + extracted.outside.length} events; ${rejected.length} failed quote/window checks and ${merged.length} duplicates merged; ${events.length} moments retained`,
  };
});

const moments = await stage("fuse", "Fuse with crowd noise and score", async () => {
  const moments = buildMoments({ events, floorDb, anchors, durationSec }).sort((a, b) => a.peak - b.peak);
  const loud = moments.filter((m) => m.scores.crowd >= 0.8).length;
  return {
    result: moments,
    detail: `${moments.length} moments bounded by the crowd's reaction; ${loud} with a crowd rise in the match's top 10%`,
  };
});

const topTen = () => [...moments].sort((a, b) => b.scores.total - a.scores.total || a.peak - b.peak).slice(0, 10).map((m) => m.id);

const visual = await stage("twelvelabs", "Confirm on video with Twelve Labs", async () => {
  const before = topTen();
  const queries = await queriesFor(moments);
  const { hits, dropped } = await runQueries([...[...queries.values()].flat(), ...GENERIC_QUERIES], durationSec);
  let confirmed = 0;
  for (const m of moments) {
    const found = evidenceFor(m, queries.get(m.id)!, hits);
    if (found.length) confirmed++;
    m.evidence.push(...found);
    m.scores.total = total(m.scores, Math.max(0, ...found.map((e) => e.strength)));
  }
  const after = topTen();
  const candidates = unmatched(
    hits.filter((h) => GENERIC_QUERIES.includes(h.query)),
    moments,
  );
  const report = { confirmed, moments: moments.length, before, after, candidates, dropped };
  writeCache("report/visual.json", report);
  const moved = after.filter((id, i) => before[i] !== id).length;
  return {
    result: report,
    detail: `${new Set([...queries.values()].flat()).size} visual searches for ${moments.length} moments plus ${GENERIC_QUERIES.length} generic ones; ${confirmed} moments confirmed on video; ${moved ? `${moved} places in the top 10 changed` : "top 10 order unchanged"}; ${candidates.length} visual hits match no moment`,
  };
});

// Crowd timeline: mean floor per step, scaled so the quietest 2% of the match is 0 and the loudest 0.5% is 1.
const steps: number[] = [];
for (let t = 0; t < durationSec; t += CROWD_STEP_SEC) {
  const window = floorDb.slice(t, Math.min(durationSec, t + CROWD_STEP_SEC));
  steps.push(window.reduce((a, b) => a + b, 0) / window.length);
}
const low = percentile(steps, 0.02);
const high = percentile(steps, 0.995);
const crowd = { stepSec: CROWD_STEP_SEC, values: steps.map((v) => Math.round(Math.min(1, Math.max(0, (v - low) / (high - low))) * 1000) / 1000) };

const { groundTruth, evalResult, alignmentRows } = await stage("ground-truth", "Check against the club's own clips", async () => {
  const aligned = await alignGroundTruth(cues, durationSec);
  const { groundTruth, eval: evalResult } = evaluate(aligned.clips, moments, { anchors, crowd });
  const count = (status: string) => aligned.rows.filter((r) => r.status === status).length;
  return {
    result: { groundTruth, evalResult, alignmentRows: aligned.rows },
    detail: `${aligned.candidates} club items: ${count("aligned")} located by subtitles or audio as ${groundTruth.length} source ranges, ${count("unaligned")} without a confident alignment, ${count("skipped")} not match footage; ${evalResult.matched} of ${evalResult.total} ranges overlap a moment`,
  };
});

const clips = await stage("clips", "Plan clips with Claude", async () => {
  const plan = await planClips(moments, roster, cues, durationSec);
  const asap = plan.clips.filter((c) => c.lane === "asap");
  const recap = plan.clips.find((c) => c.lane === "post-match");
  const formats = [...new Set(asap.map((c) => c.format))].join(" and ");
  return {
    result: plan.clips,
    detail: `${asap.length} ASAP clips (${formats}), ${plan.variations.length} moments with several variations; ${plan.searches} shot searches gave ${plan.shots.length} shots near those moments, ${plan.shotsUsed} used; a ${recap ? `${Math.round(recap.durationSec)} s` : "missing"} 16:9 recap from ${recap?.segments.length ?? 0} segments`,
  };
});

// Published ranges are fixed, so describe and classify the clips the producer will actually see.
if (REAL) {
  const published = { clips, stages };
  applyPublished(published);
  stages.splice(0, stages.length, ...published.stages);
}
const focusClips = [...clips];
for (const moment of moments) moment.tags = tagsFor(moment);
for (const clip of clips) clip.audience = audienceFor(clip.variant);
await stage("pegasus", "Describe footage with Pegasus 1.6", async () => {
  await describeMoments(moments, clips);
  return { result: undefined, detail: `${moments.filter((m) => m.description).length} moments described using source time ranges, with Twelve Labs analysis evidence` };
});
const audienceClips = await stage("audiences", "Plan sponsor and international edits", async () => {
  const result = await planAudiences(moments, durationSec);
  return { result, detail: "One sponsor plan and one international plan for producer approval; neither rendered nor uploaded" };
});
const rejected = [...commentaryRejected, ...visualRejections(visual.candidates, anchors), ...rankedRejections(moments, [...clips, ...audienceClips])];

await stage("focus", "Find where the crop should sit", async () => {
  const byMoment = new Map<string, { start: number; end: number }[]>();
  for (const c of focusClips) for (const seg of c.segments) if (seg.momentId) byMoment.set(seg.momentId, [...(byMoment.get(seg.momentId) ?? []), seg]);
  const targets = moments.filter((m) => byMoment.has(m.id));
  // A moment's own range, plus any segment of it far enough away to be a separate shot (a reaction or a replay).
  const ranges = targets.flatMap((m) => [
    { m, start: m.start, end: m.end },
    ...byMoment.get(m.id)!.filter((seg) => seg.start < m.start - 10 || seg.end > m.end + 10).map((seg) => ({ m, start: seg.start, end: seg.end })),
  ]);
  const results = await mapLimit(ranges, 4, async (r) => {
    const name = r.start === r.m.start && r.end === r.m.end ? r.m.id : `${r.m.id}@${r.start}`;
    const { value } = await cached(`focus/${r.m.id}-${r.start}-${r.end}.json`, () => focusFor(name, video.proxy_medium!, r.start, r.end));
    return { m: r.m, value };
  });
  for (const m of targets) {
    const keys = results.filter((r) => r.m === m).flatMap((r) => r.value.keys);
    m.focus = [...new Map(keys.sort((a, b) => a.t - b.t).map((k) => [k.t, k])).values()];
  }
  let refinementDetail = "";
  if (REAL) {
    // The 1 Hz path missed the cross before the header at 5822 s in the rendered goal clip.
    const start = 5819;
    const end = 5826;
    const moment = moments.find((m) => m.id === "m-5822-goal");
    if (!moment) throw new Error("Equaliser moment m-5822-goal is missing");
    const { value: refined } = await cached(`focus/refined-original-${moment.id}-${start}-${end}-4fps-ball.json`, async () => {
      const source = await renderSource(media.ID);
      return focusFor(`${moment.id}-refined-4fps`, source.url, start, end, 4);
    });
    moment.focus = mergeRefinedFocus(moment.focus, { start, end, keys: refined.keys });
    refinementDetail = `; equaliser ${start}-${end} s refined at 4 anchors/s, ${refined.anchors} anchors, ball visible in ${refined.ballSeen}`;
  }
  const sum = (pick: (r: (typeof results)[number]["value"]) => number) => results.reduce((total, r) => total + pick(r.value), 0);
  return {
    result: undefined,
    detail: `${targets.length} moments used by clips, ${ranges.length - targets.length} extra shots: ${modelConfig().model} placed the action in ${sum((r) => r.anchors)} frames (ball visible in ${sum((r) => r.ballSeen)}), camera pan carried it between them, ${sum((r) => r.keys.length)} focus keys${refinementDetail}`,
  };
});

const matchwatch = await stage("matchwatch-segmentation", "Detect soccer events with MatchWatch prompts", async () => {
  const result = await segmentMatch(moments, durationSec);
  return { result, detail: `${result.segments.length} segments; ${result.matchedSegments} overlap ${result.matchedMoments} moments; ${result.rejected.length} unmatched candidates` };
});
rejected.push(...matchwatch.rejected);
await stage("matchwatch-jev", "Review the top 20 with MatchWatch Jev", async () => {
  const reviewed = await reviewMoments(moments, durationSec);
  return { result: undefined, detail: `${reviewed} moments reviewed with nullable editorial estimates; ranking unchanged` };
});
const pegasusEval = segmentationAtK(matchwatch.segments, groundTruth, evalResult.atK.map((row) => row.k));
writeCache("report/matchwatch.json", { ...matchwatch, pegasusEval, ours: evalResult.atK });
console.table(pegasusEval);

// Players: everyone tagged on the match in ScorePlay, then anyone else a moment names.
const byId = new Map<number, Player>(roster.map((p) => [p.id, p]));
const players: Player[] = [];
for (const tag of media.tags ?? []) if (tag.player && !players.some((p) => p.id === tag.player!.ID)) players.push(toPlayer(tag.player));
for (const id of moments.flatMap((m) => m.players)) {
  const player = byId.get(id);
  if (!player) throw new Error(`Moment names player ${id}, who is not in the ScorePlay roster`);
  if (!players.some((p) => p.id === id)) players.push(player);
}

const analysis: MatchAnalysis = {
  source: {
    id: media.ID,
    name: media.name,
    durationSec,
    width: video.width,
    height: video.height,
    fps: video.fps,
    previewUrl: video.proxy_medium!,
    players,
    tags: (media.tags ?? []).flatMap((t) => (t.tag_option?.name ? [t.tag_option.name] : [])),
  },
  generatedAt: new Date().toISOString(),
  stages,
  rejected,
  moments,
  clips: [...clips, ...audienceClips],
  groundTruth,
  crowd,
  eval: { ...evalResult, pegasus: { ranking: matchwatch.segments.every((s) => s.confidence !== undefined) ? "confidence" : "provider-order", segments: matchwatch.segments.length, atK: pegasusEval } },
};

// After focus and descriptions are in: a Reel Studio receipt attaches only to the clip it was made from.
if (REAL) applyReelStudio(analysis.clips, readCache<ReelStudioRecord>(REELSTUDIO_RECORD), analysis);
assertAnalysis(analysis);
if (REAL) {
  const receipt = await stage("writeback", "Write proposals onto the ScorePlay source", async () => {
    const result = await writeback(moments);
    return { result, detail: writebackDetail(result, SOURCE_ID) };
  });
  applyWriteback(analysis, receipt);
}
assertAnalysis(analysis);
writeCache(STAGE_TIMES, stageTimes);
mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, `${JSON.stringify(analysis, null, 2)}\n`);
writeCache("report/alignment.json", alignmentRows);

console.log(`\nWrote ${OUTPUT}`);
console.log(`Visual confirmation: ${visual.confirmed} of ${visual.moments} moments; top 10 before ${visual.before.join(" ")}; after ${visual.after.join(" ")}`);
console.table(visual.candidates.map((c) => ({ start: Math.round(c.start), end: Math.round(c.end), bestRank: c.bestRank, queries: c.queries.join("; ") })));
console.table(clips.map((c) => ({ id: c.id, lane: c.lane, format: c.format, variant: c.variant, sec: c.durationSec, segs: c.segments.length, viral: c.viralScore, media: c.scoreplayMediaId ?? "" })));
console.log(`Recall ${evalResult.matched}/${evalResult.total} = ${evalResult.recall}; ${evalResult.mergedRanges} merged reference ranges`);
console.table(evalResult.atK);
console.table(alignmentRows.map((r) => ({ id: r.scoreplayId, name: r.name.slice(0, 48), status: r.status, detail: r.detail })));
console.table(
  groundTruth.map((g) => ({ id: g.scoreplayId, name: g.name.slice(0, 60), start: g.start, end: g.end, conf: g.confidence, moment: g.matchedMomentId ?? "-" })),
);
console.table(
  [...moments]
    .sort((a, b) => b.scores.total - a.scores.total)
    .map((m) => ({ peak: m.peak, clock: m.matchClock ?? "", kind: m.kind, title: m.title, total: m.scores.total, imp: m.scores.importance, emo: m.scores.emotion, crowd: m.scores.crowd })),
);
