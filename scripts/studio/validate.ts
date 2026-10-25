import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { MatchAnalysis } from "../../src/lib/studio/types";
import { TAXONOMY } from "./taxonomy";

// Runtime check that a JSON file matches MatchAnalysis and that its numbers
// make sense: every time inside the source, start <= peak <= end, scores in
// 0..1, IDs that point at something. Run directly to check the committed file:
//   bun scripts/studio/validate.ts [path]

const KINDS = ["goal", "disallowed-goal", "chance", "save", "card", "skill", "tackle", "celebration", "kickoff", "full-time", "other"];
const EVIDENCE = ["commentary", "crowd-audio", "twelvelabs-search", "twelvelabs-analysis", "social"];
const TAGS = [TAXONOMY.source, ...Object.values(TAXONOMY.kinds), TAXONOMY.redCard, TAXONOMY.yellowCard];

type Obj = Record<string, unknown>;

function validateAnalysis(data: unknown): string[] {
  const errors: string[] = [];
  const fail = (path: string, message: string) => errors.push(`${path}: ${message}`);
  const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
  const num = (v: unknown, path: string, min = -Infinity, max = Infinity) => {
    if (typeof v !== "number" || !Number.isFinite(v)) return fail(path, `expected a number, got ${JSON.stringify(v)}`);
    if (v < min || v > max) fail(path, `${v} is outside [${min}, ${max}]`);
  };
  const str = (v: unknown, path: string, allowed?: string[]) => {
    if (typeof v !== "string" || v === "") return fail(path, `expected a non-empty string, got ${JSON.stringify(v)}`);
    if (allowed && !allowed.includes(v)) fail(path, `"${v}" is not one of ${allowed.join(", ")}`);
  };
  const arr = (v: unknown, path: string): unknown[] => {
    if (!Array.isArray(v)) {
      fail(path, "expected an array");
      return [];
    }
    return v;
  };

  if (!isObj(data)) return ["root: expected an object"];
  const source = data.source;
  if (!isObj(source)) return ["source: expected an object"];
  num(source.id, "source.id", 1);
  str(source.name, "source.name");
  num(source.durationSec, "source.durationSec", 1);
  num(source.width, "source.width", 1);
  num(source.height, "source.height", 1);
  num(source.fps, "source.fps", 1);
  str(source.previewUrl, "source.previewUrl");
  arr(source.tags, "source.tags").forEach((t, i) => str(t, `source.tags[${i}]`));
  const playerIds = new Set<number>();
  arr(source.players, "source.players").forEach((p, i) => {
    if (!isObj(p)) return fail(`source.players[${i}]`, "expected an object");
    num(p.id, `source.players[${i}].id`, 1);
    str(p.name, `source.players[${i}].name`);
    str(p.shortName, `source.players[${i}].shortName`);
    if (p.photoUrl !== undefined) str(p.photoUrl, `source.players[${i}].photoUrl`);
    playerIds.add(p.id as number);
  });
  const duration = typeof source.durationSec === "number" ? source.durationSec : 0;
  const time = (v: unknown, path: string) => num(v, path, 0, duration);

  str(data.generatedAt, "generatedAt");
  if (typeof data.generatedAt === "string" && Number.isNaN(Date.parse(data.generatedAt))) fail("generatedAt", "not an ISO date");

  arr(data.stages, "stages").forEach((s, i) => {
    if (!isObj(s)) return fail(`stages[${i}]`, "expected an object");
    str(s.id, `stages[${i}].id`);
    str(s.label, `stages[${i}].label`);
    str(s.detail, `stages[${i}].detail`);
    num(s.durationMs, `stages[${i}].durationMs`, 0);
  });

  const momentIds = new Set<string>();
  arr(data.moments, "moments").forEach((m, i) => {
    const at = `moments[${i}]`;
    if (!isObj(m)) return fail(at, "expected an object");
    str(m.id, `${at}.id`);
    if (momentIds.has(m.id as string)) fail(`${at}.id`, `duplicate id ${m.id}`);
    momentIds.add(m.id as string);
    str(m.kind, `${at}.kind`, KINDS);
    str(m.title, `${at}.title`);
    str(m.summary, `${at}.summary`);
    if (m.description !== undefined) {
      str(m.description, `${at}.description`);
      if (!Array.isArray(m.evidence) || !m.evidence.some((e) => isObj(e) && e.source === "twelvelabs-analysis")) fail(`${at}.description`, "needs twelvelabs-analysis evidence");
    }
    if (m.tags !== undefined) {
      arr(m.tags, `${at}.tags`).forEach((tag, j) => str(tag, `${at}.tags[${j}]`, TAGS));
      if (!Array.isArray(m.tags) || !m.tags.includes(TAXONOMY.source) || m.tags.length !== 2) fail(`${at}.tags`, "needs Rundown and one moment label");
    }
    if (m.editorial !== undefined) {
      if (!isObj(m.editorial)) fail(`${at}.editorial`, "expected an object");
      else {
        for (const key of ["importance", "excitement", "watchability"]) {
          const value = m.editorial[key];
          if (value !== null) num(value, `${at}.editorial.${key}`, 0, 1);
        }
        arr(m.editorial.flags, `${at}.editorial.flags`).forEach((flag, j) => str(flag, `${at}.editorial.flags[${j}]`));
        str(m.editorial.source, `${at}.editorial.source`, ["matchwatch-jev"]);
      }
    }
    time(m.start, `${at}.start`);
    time(m.end, `${at}.end`);
    time(m.peak, `${at}.peak`);
    if (!((m.start as number) <= (m.peak as number) && (m.peak as number) <= (m.end as number))) fail(at, "needs start <= peak <= end");
    if (m.matchClock !== undefined && !/^\d{1,2}(\+\d{1,2})?'$/.test(String(m.matchClock))) fail(`${at}.matchClock`, `bad clock ${m.matchClock}`);
    arr(m.players, `${at}.players`).forEach((id, j) => {
      if (!playerIds.has(id as number)) fail(`${at}.players[${j}]`, `player ${id} is not in source.players`);
    });
    str(m.team, `${at}.team`, ["spurs", "opponent", "neutral"]);
    arr(m.evidence, `${at}.evidence`).forEach((e, j) => {
      if (!isObj(e)) return fail(`${at}.evidence[${j}]`, "expected an object");
      str(e.source, `${at}.evidence[${j}].source`, EVIDENCE);
      str(e.detail, `${at}.evidence[${j}].detail`);
      time(e.at, `${at}.evidence[${j}].at`);
      num(e.strength, `${at}.evidence[${j}].strength`, 0, 1);
    });
    if (!isObj(m.scores)) return fail(`${at}.scores`, "expected an object");
    for (const k of ["importance", "emotion", "crowd", "social", "total"]) num(m.scores[k], `${at}.scores.${k}`, 0, 1);
    arr(m.focus, `${at}.focus`).forEach((f, j) => {
      if (!isObj(f)) return fail(`${at}.focus[${j}]`, "expected an object");
      time(f.t, `${at}.focus[${j}].t`);
      num(f.x, `${at}.focus[${j}].x`, 0, 1);
    });
  });

  arr(data.clips, "clips").forEach((c, i) => {
    const at = `clips[${i}]`;
    if (!isObj(c)) return fail(at, "expected an object");
    str(c.id, `${at}.id`);
    str(c.lane, `${at}.lane`, ["asap", "post-match"]);
    str(c.variant, `${at}.variant`);
    if (c.audience !== undefined) str(c.audience, `${at}.audience`, ["match-fans", "season-ticket-holder", "sponsor", "international"]);
    str(c.format, `${at}.format`, ["9:16", "16:9", "1:1"]);
    str(c.title, `${at}.title`);
    str(c.caption, `${at}.caption`);
    arr(c.hashtags, `${at}.hashtags`).forEach((h, j) => str(h, `${at}.hashtags[${j}]`));
    let sum = 0;
    arr(c.segments, `${at}.segments`).forEach((s, j) => {
      if (!isObj(s)) return fail(`${at}.segments[${j}]`, "expected an object");
      time(s.start, `${at}.segments[${j}].start`);
      time(s.end, `${at}.segments[${j}].end`);
      if (!((s.start as number) < (s.end as number))) fail(`${at}.segments[${j}]`, "needs start < end");
      if (s.momentId !== undefined && !momentIds.has(s.momentId as string)) fail(`${at}.segments[${j}].momentId`, `unknown moment ${s.momentId}`);
      sum += (s.end as number) - (s.start as number);
    });
    num(c.durationSec, `${at}.durationSec`, 0);
    if (Math.abs((c.durationSec as number) - sum) > 0.5) fail(`${at}.durationSec`, `${c.durationSec} but segments add up to ${sum.toFixed(1)}`);
    num(c.viralScore, `${at}.viralScore`, 0, 1);
    if (c.scoreplayMediaId !== undefined) num(c.scoreplayMediaId, `${at}.scoreplayMediaId`, 1);
    if (c.reelStudioMediaId !== undefined) num(c.reelStudioMediaId, `${at}.reelStudioMediaId`, 1);
    str(c.rationale, `${at}.rationale`);
  });

  arr(data.rejected, "rejected").forEach((r, i) => {
    const at = `rejected[${i}]`;
    if (!isObj(r)) return fail(at, "expected an object");
    str(r.title, `${at}.title`);
    time(r.at, `${at}.at`);
    str(r.source, `${at}.source`, ["commentary", "twelvelabs-search", "ranking"]);
    str(r.reason, `${at}.reason`);
    if (r.kind !== undefined) str(r.kind, `${at}.kind`, KINDS);
    if (r.source === "ranking" || r.momentId !== undefined) {
      if (typeof r.momentId !== "string" || !momentIds.has(r.momentId)) fail(`${at}.momentId`, "needs an existing moment ID");
    }
  });
  if (data.writeback !== undefined) {
    if (!isObj(data.writeback)) fail("writeback", "expected an object");
    else {
      num(data.writeback.videoLogs, "writeback.videoLogs", 0);
      if (!Number.isInteger(data.writeback.videoLogs)) fail("writeback.videoLogs", "expected an integer count");
      arr(data.writeback.tags, "writeback.tags").forEach((tag, i) => str(tag, `writeback.tags[${i}]`, TAGS));
      if (data.writeback.momentIds !== undefined) arr(data.writeback.momentIds, "writeback.momentIds").forEach((id, i) => str(id, `writeback.momentIds[${i}]`));
      str(data.writeback.at, "writeback.at");
      if (typeof data.writeback.at === "string" && Number.isNaN(Date.parse(data.writeback.at))) fail("writeback.at", "not an ISO date");
    }
  }

  let matched = 0;
  const groundTruth = arr(data.groundTruth, "groundTruth");
  groundTruth.forEach((g, i) => {
    const at = `groundTruth[${i}]`;
    if (!isObj(g)) return fail(at, "expected an object");
    num(g.scoreplayId, `${at}.scoreplayId`, 1);
    str(g.name, `${at}.name`);
    time(g.start, `${at}.start`);
    time(g.end, `${at}.end`);
    if (!((g.start as number) < (g.end as number))) fail(at, "needs start < end");
    str(g.alignedBy, `${at}.alignedBy`, ["subtitles", "audio"]);
    num(g.confidence, `${at}.confidence`, 0, 1);
    if (g.matchedMomentId !== undefined) {
      matched++;
      if (!momentIds.has(g.matchedMomentId as string)) fail(`${at}.matchedMomentId`, `unknown moment ${g.matchedMomentId}`);
    }
  });

  if (data.crowd !== undefined) {
    if (!isObj(data.crowd)) fail("crowd", "expected an object");
    else {
      num(data.crowd.stepSec, "crowd.stepSec", 0.1);
      const values = arr(data.crowd.values, "crowd.values");
      values.forEach((v, i) => num(v, `crowd.values[${i}]`, 0, 1));
      const expected = Math.ceil(duration / (data.crowd.stepSec as number));
      if (Math.abs(values.length - expected) > 1) fail("crowd.values", `${values.length} values, expected about ${expected}`);
    }
  }

  if (!isObj(data.eval)) fail("eval", "expected an object");
  else {
    num(data.eval.matched, "eval.matched", 0);
    num(data.eval.total, "eval.total", 0);
    num(data.eval.recall, "eval.recall", 0, 1);
    if (data.eval.matched !== matched) fail("eval.matched", `${data.eval.matched} but ${matched} ground-truth clips have a matchedMomentId`);
    if (data.eval.total !== groundTruth.length) fail("eval.total", `${data.eval.total} but there are ${groundTruth.length} ground-truth clips`);
    num(data.eval.mergedRanges, "eval.mergedRanges", 0, groundTruth.length);
    num(data.eval.overlapMinSec, "eval.overlapMinSec", 0, duration);
    if (!isObj(data.eval.clipsOnly)) fail("eval.clipsOnly", "expected an object");
    else {
      num(data.eval.clipsOnly.k, "eval.clipsOnly.k", 1);
      num(data.eval.clipsOnly.precision, "eval.clipsOnly.precision", 0, 1);
    }
    arr(data.eval.atK, "eval.atK").forEach((row, i) => {
      if (!isObj(row)) return fail(`eval.atK[${i}]`, "expected an object");
      num(row.k, `eval.atK[${i}].k`, 1);
      num(row.minutes, `eval.atK[${i}].minutes`, 0, duration / 60);
      for (const key of ["precision", "recall", "randomPrecision", "randomRecall", "loudCrowdPrecision"]) num(row[key], `eval.atK[${i}].${key}`, 0, 1);
    });
    if (data.eval.pegasus !== undefined) {
      if (!isObj(data.eval.pegasus)) fail("eval.pegasus", "expected an object");
      else {
        str(data.eval.pegasus.ranking, "eval.pegasus.ranking", ["confidence", "provider-order"]);
        num(data.eval.pegasus.segments, "eval.pegasus.segments", 0);
        arr(data.eval.pegasus.atK, "eval.pegasus.atK").forEach((row, i) => {
          if (!isObj(row)) return fail(`eval.pegasus.atK[${i}]`, "expected an object");
          num(row.k, `eval.pegasus.atK[${i}].k`, 1); num(row.count, `eval.pegasus.atK[${i}].count`, 0);
          num(row.precision, `eval.pegasus.atK[${i}].precision`, 0, 1); num(row.recall, `eval.pegasus.atK[${i}].recall`, 0, 1); num(row.minutes, `eval.pegasus.atK[${i}].minutes`, 0);
        });
      }
    }
  }
  return errors;
}

/** Narrows to MatchAnalysis or throws with every problem found. */
export function assertAnalysis(data: unknown): asserts data is MatchAnalysis {
  const errors = validateAnalysis(data);
  if (errors.length) throw new Error(`MatchAnalysis check failed:\n${errors.join("\n")}`);
}

if (import.meta.main) {
  const path = process.argv[2] ?? join(import.meta.dir, "..", "..", "src", "lib", "studio", "data", "mnu-tot.json");
  assertAnalysis(JSON.parse(readFileSync(path, "utf8")));
  console.log(`${path} conforms to MatchAnalysis`);
}
