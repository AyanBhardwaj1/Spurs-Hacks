import type { Clip, ClipFormat, FocusKey, MatchAnalysis, Moment, Player } from "../../src/lib/studio/types";
import type { PublishedClip, PublishRecord } from "./published";
import { hashOf } from "./cache";
import { segmentKeys } from "./render";

// What scripts/studio/reelstudio.ts hands Reel Studio for one clip, worked out
// from the analysis alone. The shapes mirror Reel Studio's project.json
// (ai/src/project.ts SecondsRange and MatchBrief on branch spurs/match-edits).

export const REELSTUDIO_RECORD = "reelstudio.json";

/** The match this analysis covers. Constants for event 1536147, like EVENT_ID in publish.ts. */
export const MATCH: Readonly<Record<"home" | "away" | "competition" | "venue" | "team" | "opponent", string>> = {
  home: "Manchester United",
  away: "Tottenham Hotspur",
  competition: "Premier League",
  venue: "Old Trafford",
  /** The club the account posts for. */
  team: "Tottenham Hotspur",
  opponent: "Manchester United",
};

/**
 * Names the commentary uses that the ScorePlay roster (Spurs only) lacks, read off the broadcast's
 * subtitles (ScorePlay media 130852725): "Stuart Attwell is today's referee" and "Stuart Attwell for
 * Jarred Gillett in VAR". United's are the names the commentary spells right or the same way every
 * time; names it garbles ("Lammies", "Lamons") are left out, so nothing corrects a caption to a guess.
 */
export const OFFICIALS = ["Referee: Stuart Attwell", "VAR: Jarred Gillett"];
export const OPPONENT_NAMES = [
  "Bryan Mbeumo", "Cunha", "Shaw", "Maguire", "Lisandro Martínez", "Leny Yoro", "Kobbie Mainoo", "Amad Diallo",
  "Zirkzee", "Dalot", "Bruno Fernandes", "Marcus Rashford", "Mason Mount", "Ayden Heaven", "Michael Carrick (head coach)",
];

/**
 * The broadcast scorebug's box in the 1920x1080 source, as fractions, measured on frames at 77:42 and
 * 96:55 with a margin: x 58 to 690 px with the added-time box, y 56 to 116 px.
 */
export const SCOREBUG = { right: 0.365, bottom: 0.112 };

/** Width of a crop as a fraction of the 16:9 source's width, as render.ts cuts it. */
const CROP_WIDTH: Record<Exclude<ClipFormat, "16:9">, number> = { "9:16": (2 * Math.trunc(1080 * 9 / 32)) / 1920, "1:1": 1080 / 1920 };

/**
 * How much of the top a segment's crop leaves out: the scorebug's band when the full-height crop
 * would show part of the scorebug at any point (it pans linearly between keys, so the keys decide),
 * otherwise nothing. Cropping below it beats painting over it: Reel Studio's punch-ins scale the
 * footage and would scale a painted bar with it.
 */
export function scorebugTop(keys: FocusKey[], segment: { start: number; end: number }, format: Exclude<ClipFormat, "16:9">): number {
  const width = CROP_WIDTH[format];
  const left = (x: number) => Math.min(Math.max(x - width / 2, 0), 1 - width);
  return segmentKeys(keys, segment.start, segment.end).some((k) => left(k.x) < SCOREBUG.right) ? SCOREBUG.bottom : 0;
}

export type SecondsRange = { source: string; start: number; end: number };

export type BriefPlayer = { name: string; team: string; role?: string; image?: string };

export type MatchBrief = {
  kind: "match";
  officials?: string[];
  squads?: { team: string; names: string[] }[];
  match: string;
  team: string;
  opponent?: string;
  moment: string;
  minute?: string;
  score?: string;
  players: BriefPlayer[];
  description?: string;
  title?: string;
  caption?: string;
  hashtags?: string[];
  facts?: string[];
};

/** A Reel Studio upload: a publish receipt plus what the editor wrote. */
export type ReelStudioClip = PublishedClip & {
  /** editKey() of the inputs that made this edit; an upload is reused and attached only for the same inputs. */
  editKey?: string;
  /** The player card design the edit used (CARD_DESIGN). Absent on receipts keyed before the card was part of the key. */
  cardDesign?: number;
  model?: string;
  /** Reel Studio's commit on spurs/match-edits that made the edit. */
  reelStudioCommit?: string;
  /** The editor's own summary of what it put on screen. */
  summary?: string;
  post?: { caption: string; hashtags: string[] };
  /** Seconds of the rendered file, checked against ScorePlay's once it is processed. */
  renderedDurationSec?: number;
};

export type ReelStudioRecord = Omit<PublishRecord, "clips"> & {
  clips: ReelStudioClip[];
  /** Uploads a later edit of the same clip replaced (--replace). Their media stay in ScorePlay. */
  replaced?: ReelStudioClip[];
};

/**
 * The clip's segments on the clock of the cut file, which plays them back to
 * back: one seconds range per segment, so Reel Studio keeps every frame and
 * the editor can still see where one segment ends.
 */
export function cutRanges(clip: Pick<Clip, "segments">, source = "s1"): SecondsRange[] {
  let at = 0;
  return clip.segments.map((s) => {
    const range = { source, start: round(at), end: round(at + s.end - s.start) };
    at += s.end - s.start;
    return range;
  });
}

const round = (x: number) => Math.round(x * 1000) / 1000;

/**
 * The clip with every segment edge on the cut's frame grid. Off the grid, a segment's picture rounds
 * to whole frames while its sound keeps the exact length, so the cut file's sound jumps at each
 * boundary and Reel Studio's render came out 80 ms short of the picture on a three-segment clip.
 */
export function onFrameGrid<T extends Pick<Clip, "segments" | "durationSec">>(clip: T, fps: number): T {
  const snap = (t: number) => Math.round(Math.round(t * fps) / fps * 1000) / 1000;
  const segments = clip.segments.map((s) => ({ ...s, start: snap(s.start), end: snap(s.end) }));
  return { ...clip, segments, durationSec: round(segments.reduce((sum, s) => sum + s.end - s.start, 0)) };
}

/** The moments a clip's segments come from, in order, without repeats. */
export function clipMoments(clip: Pick<Clip, "segments">, moments: Moment[]): Moment[] {
  const ids = [...new Set(clip.segments.flatMap((s) => (s.momentId ? [s.momentId] : [])))];
  return ids.map((id) => {
    const moment = moments.find((m) => m.id === id);
    if (!moment) throw new Error(`Clip segment names unknown moment ${id}`);
    return moment;
  });
}

/**
 * The score once `moment` has happened, counting goal moments (not disallowed
 * ones) up to its peak. The analysis records a goal's side as "spurs" or
 * "opponent"; a neutral goal would make the count unreliable, so it throws.
 */
export function scoreAfter(moment: Pick<Moment, "peak">, moments: Pick<Moment, "kind" | "peak" | "team" | "id">[]): string {
  let spurs = 0;
  let opponent = 0;
  for (const m of moments) {
    if (m.kind !== "goal" || m.peak > moment.peak) continue;
    if (m.team === "spurs") spurs++;
    else if (m.team === "opponent") opponent++;
    else throw new Error(`Goal moment ${m.id} has no side`);
  }
  const [home, away] = MATCH.home === MATCH.team ? [spurs, opponent] : [opponent, spurs];
  return `${MATCH.home} ${home}-${away} ${MATCH.away}`;
}

const ROLE: Partial<Record<Moment["kind"], string>> = {
  goal: "scorer",
  "disallowed-goal": "scored the disallowed goal",
  card: "shown the card",
  save: "made the save",
  chance: "had the chance",
  skill: "the skill",
  tackle: "made the tackle",
};

/**
 * The brief for one clip. Players are the clip's moments' players on the club's
 * roster, the first of the first moment as the key player; `images` maps a
 * player ID to the Library path of their card, for those that have one.
 */
export function buildBrief(clip: Clip, analysis: Pick<MatchAnalysis, "moments" | "source">, images: Map<number, string>): MatchBrief {
  const moments = clipMoments(clip, analysis.moments);
  const main = moments[0];
  if (!main) throw new Error(`Clip ${clip.id} has no moment`);
  const roster = new Map<number, Player>(analysis.source.players.map((p) => [p.id, p]));
  const ids = [...new Set(moments.flatMap((m) => m.players))];
  const players = ids.flatMap((id, i): BriefPlayer[] => {
    const p = roster.get(id);
    if (!p) return [];
    // the moment's role (scorer, shown the card) is the first player's only when the moment is the club's:
    // in an opponent's goal the roster's players are the ones defending it
    const role = main.team !== "spurs" ? "involved" : i === 0 && main.players[0] === id ? ROLE[main.kind] ?? "key player" : "in the move";
    const image = images.get(id);
    return [{ name: p.shortName, team: MATCH.team, role, ...(image ? { image } : {}) }];
  });
  return {
    kind: "match",
    match: `${MATCH.home} v ${MATCH.away}, ${MATCH.competition}, ${MATCH.venue}`,
    team: MATCH.team,
    opponent: MATCH.opponent,
    moment: `${main.title}. ${main.summary}`,
    ...(main.matchClock ? { minute: main.matchClock } : {}),
    score: scoreAfter(main, analysis.moments),
    players,
    officials: OFFICIALS,
    squads: [
      { team: MATCH.team, names: analysis.source.players.map((p) => p.shortName) },
      { team: MATCH.opponent, names: OPPONENT_NAMES },
    ],
    ...(main.description ? { description: main.description } : {}),
    title: clip.title,
    caption: clip.caption,
    hashtags: clip.hashtags,
    facts: [
      `This clip is the "${clip.variant}" edit: ${clip.rationale}`,
      ...main.evidence.filter((e) => e.source === "commentary").slice(0, 4).map((e) => `Commentary: "${e.detail}"`),
    ],
  };
}

/**
 * Names the speech model should spell our way: every roster player's caption name, the venue, and the
 * names the clip's moments mention, which is where opponents appear ("Mbeumo", "Martínez"): capitalised
 * words of four letters or more that do not start a sentence.
 */
export function vocabulary(players: Player[], moments: Pick<Moment, "summary">[]): string[] {
  const named = moments.flatMap((m) => [...m.summary.matchAll(/(?<![.!?]\s|^)\b(\p{Lu}[\p{L}'-]{3,})/gu)].map((x) => x[1]));
  const officials = OFFICIALS.map((o) => o.replace(/^[^:]+: /, ""));
  const opponents = OPPONENT_NAMES.map((n) => n.replace(/ \(.*\)$/, ""));
  return [...new Set([...players.map((p) => p.shortName), ...opponents, ...officials, MATCH.venue, ...named])];
}

/** The cut's frame rate, render.ts's. */
export const CUT_FPS = 25;
/** The player card's look (reelstudio.ts playerCard). Bump it when the card changes, so waiting exports with
 * the old card are edited again. */
export const CARD_DESIGN = 2;

/** Everything about one clip's edit that the analysis decides: the cut, its crop, the cards and the brief. */
export function editPlan(clip: Clip, analysis: Pick<MatchAnalysis, "moments" | "source">) {
  if (clip.format === "16:9") throw new Error(`Clip ${clip.id} is 16:9; Reel Studio edits 9:16 and 1:1 posts`);
  const format = clip.format;
  const plain: Clip = onFrameGrid({ ...clip, format, title: "" }, CUT_FPS);
  const focus = new Map(analysis.moments.map((m) => [m.id, m.focus]));
  const keysOf = (s: Clip["segments"][number]) => focus.get(s.momentId ?? "") ?? [];
  const focusKeys = plain.segments.map((s) => segmentKeys(keysOf(s), s.start, s.end));
  const cropTop = plain.segments.map((s) => scorebugTop(keysOf(s), s, format));
  const cards = [...new Set(clipMoments(clip, analysis.moments).flatMap((m) => m.players))].flatMap((id) => {
    const player = analysis.source.players.find((p) => p.id === id);
    return player?.photoUrl ? [{ id, player, file: `${player.shortName} (${MATCH.team}).png` }] : [];
  });
  const brief = buildBrief(clip, analysis, new Map(cards.map((c) => [c.id, `Library/Images/${c.file}`])));
  return { format, plain, focus, focusKeys, cropTop, cards, brief };
}

/** How an edit was made, beyond what the analysis decides. */
export type Production = { source: EditInput["source"]; reelStudio: string; model: string; card?: number };

/** The edit key of a clip as the analysis plans it now, made the way `production` says. */
export function clipEditKey(clip: Clip, plan: ReturnType<typeof editPlan>, production: Production): string {
  return editKey({
    clip: { segments: plan.plain.segments, format: plan.format, title: clip.title }, brief: plan.brief, focus: plan.focusKeys, cropTop: plan.cropTop,
    source: production.source, reelStudio: production.reelStudio, model: production.model, ...(production.card !== undefined ? { card: production.card } : {}),
  });
}

/**
 * Records each Reel Studio upload that ScorePlay finished processing on its clip, as reelStudioMediaId, but
 * only when the clip as the analysis plans it now would make the same edit: its key, from the current
 * analysis and the receipt's own source rendition, Reel Studio commit, model and card, must equal the
 * receipt's. A re-planned clip (other segments, title, brief, focus or crop) gets no media ID; the
 * mismatch is reported through `warn`.
 */
export function applyReelStudio(clips: Clip[], record: ReelStudioRecord | undefined, analysis: Pick<MatchAnalysis, "moments" | "source">, warn: (message: string) => void = console.warn): void {
  if (!record) return;
  for (const entry of record.clips) {
    if (!entry.mediaId || entry.state !== "tagged" || entry.status !== "DONE") continue;
    const clip = clips.find((c) => c.id === entry.clipId);
    if (!clip) continue;
    const made = entry.renderSource && entry.reelStudioCommit && entry.model
      ? clipEditKey(clip, editPlan(clip, analysis), { source: entry.renderSource, reelStudio: entry.reelStudioCommit, model: entry.model, card: entry.cardDesign })
      : undefined;
    if (made !== undefined && made === entry.editKey) {
      clip.reelStudioMediaId = entry.mediaId;
    } else {
      delete clip.reelStudioMediaId;
      warn(`Reel Studio media ${entry.mediaId} not recorded on ${clip.id}: the clip's plan differs from the one that edit was made from`);
    }
  }
}

/** Everything that decides what a Reel Studio edit of a clip looks like. */
export type EditInput = {
  clip: Pick<Clip, "segments" | "format" | "title">;
  brief: MatchBrief;
  /** The focus keys each segment's crop follows, in segment time. */
  focus: FocusKey[][];
  cropTop: number[];
  source: NonNullable<PublishedClip["renderSource"]>;
  /** Reel Studio's commit, with "-dirty" when its tree has uncommitted changes. */
  reelStudio: string;
  model: string;
  /** The player card design's version (CARD_DESIGN); absent in keys made before it was part of them. */
  card?: number;
};

export function editKey(input: EditInput): string {
  return hashOf(JSON.stringify(input));
}

/**
 * What to do with a clip's journal entry, given the key of the edit the current inputs would make:
 * "edit" makes a new edit; "reuse" uploads the waiting export; "resume" carries on with an upload
 * already made from these inputs; "replace" uploads a new edit beside an uploaded one. An upload made
 * from other inputs (a re-planned clip, another source or Reel Studio) is never reused or recorded on
 * the clip: that fails unless `replace` asks for a new media.
 */
export function reuseOf(entry: ReelStudioClip | undefined, key: string, options: { replace: boolean; again: boolean; exportExists: boolean }): "edit" | "reuse" | "resume" | "replace" {
  if (!entry) return "edit";
  if (entry.mediaId || entry.pendingCreation) {
    if (options.replace && entry.state === "tagged") return "replace";
    if (entry.editKey === key) return "resume";
    if (options.replace) throw new Error(`Clip ${entry.clipId}: media ${entry.mediaId ?? "(pending)"} is mid-upload; finish or reconcile it before replacing it`);
    throw new Error(`Clip ${entry.clipId} was uploaded as media ${entry.mediaId ?? "(pending)"} from other inputs; pass --replace to upload a new edit as a new media`);
  }
  return !options.again && entry.editKey === key && options.exportExists ? "reuse" : "edit";
}
