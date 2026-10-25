// Checks a parsed analysis file against the fields the studio reads, so a file from an older or half-written
// pipeline run fails at load with the field named, instead of rendering NaN or throwing inside a component.
// It checks types, not meaning; src/lib/studio/types.ts stays the contract.

type Kind = "number" | "string" | "array" | "object";
interface Fields {
  [key: string]: Kind | Fields;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

const is: Record<Kind, (v: unknown) => boolean> = {
  number: (v) => typeof v === "number" && Number.isFinite(v),
  string: (v) => typeof v === "string",
  array: Array.isArray,
  object: isObject,
};

const SOURCE: Fields = {
  id: "number",
  name: "string",
  durationSec: "number",
  width: "number",
  height: "number",
  fps: "number",
  previewUrl: "string",
  players: "array",
  tags: "array",
};
const EVAL: Fields = {
  matched: "number",
  total: "number",
  recall: "number",
  mergedRanges: "number",
  overlapMinSec: "number",
  clipsOnly: { k: "number", precision: "number" },
  atK: "array",
};
const ITEMS: Record<string, Fields> = {
  stages: { id: "string", label: "string", detail: "string", durationMs: "number" },
  moments: {
    id: "string",
    kind: "string",
    title: "string",
    summary: "string",
    team: "string",
    start: "number",
    end: "number",
    peak: "number",
    players: "array",
    evidence: "array",
    focus: "array",
    scores: { importance: "number", emotion: "number", crowd: "number", social: "number", total: "number" },
  },
  clips: {
    id: "string",
    lane: "string",
    variant: "string",
    format: "string",
    title: "string",
    caption: "string",
    rationale: "string",
    hashtags: "array",
    segments: "array",
    durationSec: "number",
    viralScore: "number",
  },
  groundTruth: { scoreplayId: "number", name: "string", start: "number", end: "number", confidence: "number", alignedBy: "string" },
  rejected: { title: "string", source: "string", reason: "string", at: "number" },
};
const CUTOFF: Fields = {
  k: "number",
  precision: "number",
  recall: "number",
  minutes: "number",
  randomPrecision: "number",
  randomRecall: "number",
  loudCrowdPrecision: "number",
};
const SEGMENT: Fields = { start: "number", end: "number" };

function check(value: unknown, fields: Fields, path: string, out: string[]) {
  const obj = value as Record<string, unknown> | null | undefined;
  for (const [key, want] of Object.entries(fields)) {
    const v = obj?.[key];
    if (typeof want === "string") {
      if (!is[want](v)) out.push(`${path}${key}`);
    } else if (!is.object(v)) {
      out.push(`${path}${key}`);
    } else {
      check(v, want, `${path}${key}.`, out);
    }
  }
}

/** Checks each item of an array, and reports only the first bad one so a systematic fault reads as one line. */
function checkEach(items: unknown, fields: Fields, path: string, out: string[]) {
  if (!Array.isArray(items)) return;
  for (let i = 0; i < items.length; i++) {
    const found: string[] = [];
    check(items[i], fields, `${path}[${i}].`, found);
    if (found.length > 0) {
      out.push(...found);
      return;
    }
  }
}

/** The fields that are missing or of the wrong type, as dotted paths; empty when the file is usable. */
export function analysisProblems(value: unknown): string[] {
  const out: string[] = [];
  if (!isObject(value)) return ["(the file is not a JSON object)"];
  const a = value;

  check(a, { source: SOURCE, generatedAt: "string", eval: EVAL }, "", out);
  if (typeof a.generatedAt === "string" && Number.isNaN(Date.parse(a.generatedAt))) out.push("generatedAt (not a date)");

  for (const [key, fields] of Object.entries(ITEMS)) {
    if (!is.array(a[key])) out.push(key);
    else checkEach(a[key], fields, key, out);
  }
  const clips = (Array.isArray(a.clips) ? a.clips : []) as { segments?: unknown }[];
  const empty = clips.findIndex((c) => Array.isArray(c?.segments) && c.segments.length === 0);
  if (empty >= 0) out.push(`clips[${empty}].segments (empty)`);
  clips.some((c, i) => {
    const found: string[] = [];
    checkEach(c?.segments, SEGMENT, `clips[${i}].segments`, found);
    out.push(...found);
    return found.length > 0;
  });

  const atK = (a.eval as { atK?: unknown } | undefined)?.atK;
  if (Array.isArray(atK) && atK.length === 0) out.push("eval.atK (empty)");
  checkEach(atK, CUTOFF, "eval.atK", out);

  if (a.crowd !== undefined) check(a.crowd, { stepSec: "number", values: "array" }, "crowd.", out);
  if (a.writeback !== undefined) check(a.writeback, { videoLogs: "number", tags: "array", at: "string" }, "writeback.", out);
  return out;
}
