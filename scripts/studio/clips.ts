import type { Clip, ClipFormat, Moment, Player } from "../../src/lib/studio/types";
import { askClaude, mapLimit } from "./claude";
import type { Cue } from "./srt";
import { searchMatch } from "./visual";

// Claude plans the edits and writes the copy; code picks which moments get
// clips, then checks every plan against the source and the moments. A plan
// that breaks a rule goes back once with the list of problems, and a second
// failure stops the run.
//
// The top moments get several variations, which need shots beyond the action
// itself: reactions, the away end, replays from another angle. Claude cannot
// call Twelve Labs from inside the headless CLI, so this runs in two passes on
// either provider: Claude proposes searches for each top moment, the pipeline
// runs them and keeps hits that lie inside the source and near the moment,
// and Claude plans the edits with those shots listed.

/** Moments that get several variations each. */
const VARIATION_MOMENTS = 3;
const MIN_VARIATIONS = 3;
/** Moments after those that get one ASAP clip each. */
const SINGLE_MOMENTS = 3;
const ASAP_FORMATS: ClipFormat[] = ["9:16", "1:1"];
/** Where a shot for a moment can be: from just before it to the replays and reactions that follow. */
const SHOT_WINDOW = { before: 30, after: 150 };
/** How far a segment may stray outside a fetched shot, for rounding. */
const SHOT_SLACK = 0.5;
const ASAP_SEC = { min: 15, max: 35 };
const RECAP_SEC = { min: 240, max: 360 };
/** How far outside its moment a segment may reach. */
const SEGMENT_SLACK = 10;
/** Kinds that make an ASAP clip on their own. */
const CLIPPABLE = new Set<Moment["kind"]>(["goal", "disallowed-goal", "chance", "save", "card", "skill", "tackle", "celebration"]);

/** A range Twelve Labs returned for one of a moment's shot searches. */
export type Shot = { id: string; momentId: string; angle: string; query: string; start: number; end: number; rank: number };

/** What Claude returns: a clip before its ID and length are set. The schema makes every segment name its moment. */
type PlannedClip = Omit<Clip, "id" | "durationSec" | "segments"> & { segments: { start: number; end: number; momentId: string }[] };

const SEGMENT = {
  type: "object",
  properties: { start: { type: "number" }, end: { type: "number" }, momentId: { type: "string" } },
  required: ["start", "end", "momentId"],
};

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    clips: {
      type: "array",
      items: {
        type: "object",
        properties: {
          lane: { type: "string", enum: ["asap", "post-match"] },
          variant: { type: "string" },
          format: { type: "string", enum: ["9:16", "16:9", "1:1"] },
          title: { type: "string" },
          caption: { type: "string" },
          hashtags: { type: "array", items: { type: "string" } },
          segments: { type: "array", items: SEGMENT },
          viralScore: { type: "number", minimum: 0, maximum: 1 },
          rationale: { type: "string" },
        },
        required: ["lane", "variant", "format", "title", "caption", "hashtags", "segments", "viralScore", "rationale"],
      },
    },
  },
  required: ["clips"],
};

const SYSTEM = `You plan social video edits for Tottenham Hotspur's media team from one match: Manchester United 1-1 Spurs at Old Trafford, Premier League 2026-27. You get the match's moments, each with its id, its source range in seconds (start, peak, end), a title and summary, and scores. An edit is an ordered list of source ranges ("segments"), each tied to the moment it shows. Rendering and reframing happen later.

Rules for every edit:
- Each segment lies inside its moment's start and end, or at most ${SEGMENT_SLACK} s outside them, or inside one of the extra shots listed for that moment (it may use part of a shot). Either way it names that moment's id. A segment showing the moment's action includes its peak.
- Copy speaks for Tottenham in British English: short, confident, no emoji. Every fact in a title or caption must appear in the moment's summary or its commentary lines; leave out anything they do not say, including scores, minutes, time remaining, quotes and statistics.
- hashtags: two to four, each starting with #, such as #COYS and #MUNTOT.
- viralScore: 0 to 1, your estimate of how far the clip would travel on social.
- rationale: one sentence on why this edit.`;

function momentLines(moments: Moment[], names: Map<number, string>): string {
  return moments
    .map((m) =>
      JSON.stringify({
        id: m.id,
        kind: m.kind,
        clock: m.matchClock ?? null,
        start: m.start,
        peak: m.peak,
        end: m.end,
        team: m.team,
        players: m.players.map((id) => names.get(id) ?? String(id)),
        title: m.title,
        summary: m.summary,
        total: m.scores.total,
      }),
    )
    .join("\n");
}

/** Commentary to write the copy from: every line from a moment's start until 60 s after its end, where replays get described. */
function commentaryFor(moment: Moment, cues: Cue[]): string {
  const lines = cues.filter((c) => c.start >= moment.start && c.start <= moment.end + 60);
  return `${moment.id}:\n${lines.map((c) => `  [${c.start.toFixed(1)}] ${c.text}`).join("\n")}`;
}

const SHOT_QUERY_SYSTEM = `You find extra shots in a football match broadcast for social edits of its biggest moments. A video index of the match matches what the camera shows, not what is said, and does not know player names. For each moment, write two to four short searches (at most eight words) for shots that would make different versions of a clip: the players' reaction, the away fans, a replay from another angle, a close-up of the player at the centre, the manager on the touchline. Give each an angle label (Reaction, Fans, Replay, Close-up, Touchline). Do not use names, team names or the match clock.`;

const SHOT_QUERY_SCHEMA = {
  type: "object",
  properties: {
    moments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          searches: {
            type: "array",
            items: { type: "object", properties: { angle: { type: "string" }, query: { type: "string" } }, required: ["angle", "query"] },
          },
        },
        required: ["id", "searches"],
      },
    },
  },
  required: ["moments"],
};

/** Shots for each moment from the searches Claude proposed, kept only when they lie in the source and near the moment. */
async function findShots(moments: Moment[], durationSec: number): Promise<{ shots: Shot[]; searches: number; dropped: number }> {
  const { value } = await askClaude<{ moments: { id: string; searches: { angle: string; query: string }[] }[] }>({
    name: "clip-shot-searches",
    system: SHOT_QUERY_SYSTEM,
    prompt: moments.map((m) => JSON.stringify({ id: m.id, kind: m.kind, title: m.title, summary: m.summary })).join("\n"),
    schema: SHOT_QUERY_SCHEMA,
  });
  const searches = value.moments.flatMap((a) => {
    const moment = moments.find((m) => m.id === a.id);
    return moment ? a.searches.slice(0, 4).map((q) => ({ moment, ...q })) : [];
  });
  const results = await mapLimit(searches, 4, async (q) => ({ q, result: await searchMatch(q.query, durationSec) }));
  const shots: Shot[] = [];
  let dropped = 0;
  for (const { q, result } of results) {
    dropped += result.dropped;
    for (const hit of result.hits) {
      const near = hit.end > q.moment.start - SHOT_WINDOW.before && hit.start < q.moment.end + SHOT_WINDOW.after;
      if (!near || shots.some((s) => s.momentId === q.moment.id && s.start === hit.start && s.end === hit.end)) continue;
      shots.push({
        id: `shot-${shots.length + 1}`,
        momentId: q.moment.id,
        angle: q.angle,
        query: q.query,
        start: round1(hit.start),
        end: round1(hit.end),
        rank: hit.rank,
      });
    }
  }
  return { shots, searches: searches.length, dropped };
}

function request(moments: Moment[], variations: Moment[], singles: Moment[], shots: Shot[], names: Map<number, string>, cues: Cue[]): string {
  const shotLines = variations
    .map((m) => {
      const own = shots.filter((s) => s.momentId === m.id);
      return `${m.id}:\n${own.length ? own.map((s) => `  ${JSON.stringify({ start: s.start, end: s.end, angle: s.angle, query: s.query, rank: s.rank })}`).join("\n") : "  (none found)"}`;
    })
    .join("\n");
  return `Moments, highest total score first:
${momentLines(moments, names)}

Commentary for the moments that get ASAP clips:
${[...variations, ...singles].map((m) => commentaryFor(m, cues)).join("\n\n")}

Extra shots found by searching the match video for each of the top moments (source seconds; rank 1 is the best match in the whole match, so a high rank number is a weaker match):
${shotLines}

Plan exactly these edits:
1. For each of ${variations.map((m) => m.id).join(", ")}: at least ${MIN_VARIATIONS} ASAP clips, lane "asap", ${ASAP_SEC.min} to ${ASAP_SEC.max} s each, one to four segments, each a different angle with the angle as its variant: "Goal" (or "Moment" when it is not a goal: the action and the immediate reaction), "Player focus" (built around the player at the centre of it), "Reaction" (the action, then the players, bench or fans reacting), "Build-up" (the move that leads to it, ending on the peak). Use the extra shots where they fit. Give each of these moments at least one clip in format "9:16" and at least one in format "1:1".
2. For each of ${singles.map((m) => m.id).join(", ")}: one ASAP clip, lane "asap", format "9:16", one segment, ${ASAP_SEC.min} to ${ASAP_SEC.max} s, variant "Moment".
3. One post-match recap, lane "post-match", format "16:9", variant "Full recap", ${RECAP_SEC.min} to ${RECAP_SEC.max} s in total: segments in match order, no two overlapping, telling the story of the match through its moments. Use as many moments as the length needs.`;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const segLength = (c: PlannedClip) => c.segments.reduce((sum, s) => sum + (s.end - s.start), 0);

/** Every broken rule in a plan, as sentences Claude can act on; empty when the plan is good. */
export function checkPlan(
  plan: PlannedClip[],
  context: { moments: Moment[]; variations: Moment[]; singles: Moment[]; shots: Shot[]; durationSec: number },
): string[] {
  const { moments, variations, singles, shots, durationSec } = context;
  const byId = new Map(moments.map((m) => [m.id, m]));
  const errors: string[] = [];
  plan.forEach((clip, i) => {
    const label = `clip ${i + 1} ("${clip.variant}", ${clip.lane})`;
    if (clip.segments.length === 0) errors.push(`${label} has no segments`);
    for (const s of clip.segments) {
      const m = byId.get(s.momentId);
      if (!(s.start < s.end) || s.start < 0 || s.end > durationSec) errors.push(`${label}: segment ${s.start}-${s.end} is empty or outside the source`);
      if (!m) {
        errors.push(`${label}: segment ${s.start}-${s.end} names unknown moment ${s.momentId}`);
        continue;
      }
      const nearMoment = s.start >= m.start - SEGMENT_SLACK && s.end <= m.end + SEGMENT_SLACK;
      const inShot = shots.some((shot) => shot.momentId === m.id && s.start >= shot.start - SHOT_SLACK && s.end <= shot.end + SHOT_SLACK);
      if (!nearMoment && !inShot) {
        errors.push(`${label}: segment ${s.start}-${s.end} is neither within ${SEGMENT_SLACK} s of ${m.id} (${m.start}-${m.end}) nor inside one of its extra shots`);
      }
    }
    if (!clip.hashtags.every((h) => h.startsWith("#"))) errors.push(`${label}: every hashtag must start with #`);
    const length = segLength(clip);
    if (clip.lane === "asap") {
      if (!ASAP_FORMATS.includes(clip.format)) errors.push(`${label} must be ${ASAP_FORMATS.join(" or ")}`);
      if (length < ASAP_SEC.min || length > ASAP_SEC.max) errors.push(`${label} is ${length.toFixed(1)} s; ASAP clips run ${ASAP_SEC.min}-${ASAP_SEC.max} s`);
    }
  });
  const recaps = plan.filter((c) => c.lane === "post-match");
  if (recaps.length !== 1) errors.push(`expected one post-match recap, got ${recaps.length}`);
  for (const recap of recaps) {
    const length = segLength(recap);
    if (recap.format !== "16:9") errors.push("the recap must be 16:9");
    if (length < RECAP_SEC.min || length > RECAP_SEC.max) errors.push(`the recap is ${length.toFixed(1)} s; it must run ${RECAP_SEC.min}-${RECAP_SEC.max} s`);
    recap.segments.forEach((s, i) => {
      if (i > 0 && s.start < recap.segments[i - 1].end) errors.push(`recap segment ${i + 1} starts before segment ${i} ends`);
    });
  }
  const asapFor = (id: string) => plan.filter((c) => c.lane === "asap" && c.segments.some((s) => s.momentId === id));
  for (const m of variations) {
    const own = asapFor(m.id);
    if (new Set(own.map((c) => `${c.variant}|${c.format}`)).size < MIN_VARIATIONS) errors.push(`${m.id} needs at least ${MIN_VARIATIONS} different ASAP variations`);
    for (const format of ASAP_FORMATS) if (!own.some((c) => c.format === format)) errors.push(`${m.id} needs at least one ${format} clip`);
  }
  for (const m of singles) if (asapFor(m.id).length === 0) errors.push(`no ASAP clip for ${m.id}`);
  return errors;
}

export async function planClips(moments: Moment[], roster: Player[], cues: Cue[], durationSec: number) {
  const ranked = [...moments].sort((a, b) => b.scores.total - a.scores.total);
  const clippable = ranked.filter((m) => CLIPPABLE.has(m.kind));
  const variations = clippable.slice(0, VARIATION_MOMENTS);
  const singles = clippable.slice(VARIATION_MOMENTS, VARIATION_MOMENTS + SINGLE_MOMENTS);
  const names = new Map(roster.map((p) => [p.id, p.shortName]));
  const found = await findShots(variations, durationSec);
  const prompt = request(ranked, variations, singles, found.shots, names, cues);
  const context = { moments, variations, singles, shots: found.shots, durationSec };

  let plan: PlannedClip[] = [];
  let errors: string[] = [];
  for (const attempt of [1, 2]) {
    const retry = attempt === 1 ? "" : `\n\nYour previous plan broke these rules; fix them:\n${errors.map((e) => `- ${e}`).join("\n")}\n\nPrevious plan:\n${JSON.stringify(plan)}`;
    const answer = await askClaude<{ clips: PlannedClip[] }>({ name: `clips-${attempt}`, system: SYSTEM, prompt: prompt + retry, schema: PLAN_SCHEMA });
    plan = answer.value.clips.map((c) => ({ ...c, segments: c.segments.map((s) => ({ ...s, start: round1(s.start), end: round1(s.end) })) }));
    errors = checkPlan(plan, context);
    if (errors.length === 0) break;
  }
  if (errors.length) throw new Error(`Clip plan still breaks the rules after a retry:\n${errors.join("\n")}`);

  const score = new Map(moments.map((m) => [m.id, m.scores.total]));
  const mainMoment = (c: PlannedClip) =>
    c.segments.map((s) => s.momentId).reduce((a, b) => ((score.get(b) ?? 0) > (score.get(a) ?? 0) ? b : a));
  const used = new Set<string>();
  const clips: Clip[] = plan.map((c) => {
    const format = c.format === "1:1" ? "-square" : "";
    const base = c.lane === "post-match" ? `c-recap-${slug(c.variant)}` : `c-${mainMoment(c)}-${slug(c.variant)}${format}`;
    let id = base;
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
    used.add(id);
    return { id, ...c, format: c.format as ClipFormat, durationSec: round1(segLength(c)), viralScore: Math.round(c.viralScore * 100) / 100 };
  });
  // Shots a clip actually reached for: a segment inside the shot that the moment's own range would not have allowed.
  const byId = new Map(moments.map((m) => [m.id, m]));
  const shotsUsed = found.shots.filter((shot) => {
    const m = byId.get(shot.momentId)!;
    return clips.some((c) =>
      c.segments.some(
        (s) =>
          s.momentId === shot.momentId &&
          s.start >= shot.start - SHOT_SLACK &&
          s.end <= shot.end + SHOT_SLACK &&
          !(s.start >= m.start - SEGMENT_SLACK && s.end <= m.end + SEGMENT_SLACK),
      ),
    );
  }).length;
  return { clips, variations, singles, shots: found.shots, searches: found.searches, droppedHits: found.dropped, shotsUsed };
}

const round1 = (x: number) => Math.round(x * 10) / 10;
