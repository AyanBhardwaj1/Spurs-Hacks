// The contract between the studio's analysis pipeline (scripts/studio) and the
// studio UI (src/app/studio). Times are seconds from the start of the source
// asset. Nothing here holds media: footage is referenced by ScorePlay ID and
// streamed from its ScorePlay rendition URL.

export type Player = {
  /** ScorePlay player ID. */
  id: number;
  name: string;
  /** The name a caption would use, such as "Solanke". */
  shortName: string;
  photoUrl?: string;
};

export type SourceAsset = {
  /** ScorePlay media ID. */
  id: number;
  name: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  /** ScorePlay's compressed rendition, playable in a <video> with range requests. */
  previewUrl: string;
  /** Players tagged on the asset in ScorePlay. */
  players: Player[];
  tags: string[];
};

export type MomentKind =
  | "goal"
  | "disallowed-goal"
  | "chance"
  | "save"
  | "card"
  | "skill"
  | "tackle"
  | "celebration"
  | "kickoff"
  | "full-time"
  | "other";

/** One observation that points at a moment, so the UI can show why it was picked. */
export type Evidence = {
  source: "commentary" | "crowd-audio" | "twelvelabs-search" | "twelvelabs-analysis" | "social";
  /** What was observed, such as a commentary line or "crowd 9 LU above baseline". */
  detail: string;
  /** Source second the observation refers to. */
  at: number;
  /** 0 to 1. */
  strength: number;
};

/** A focus point for reframing: at `t` seconds into the source, centre the crop at `x` (0 left, 1 right). */
export type FocusKey = { t: number; x: number };

/** Editorial estimates ported from MatchWatch's src/lib/jev.ts; independent of Rundown's ranking. */
export type Editorial = {
  importance: number | null;
  excitement: number | null;
  watchability: number | null;
  flags: string[];
  source: "matchwatch-jev";
};

export type Moment = {
  id: string;
  kind: MomentKind;
  /** Short headline, such as "Solanke heads in a late equaliser". */
  title: string;
  /** One or two sentences on what happens. */
  summary: string;
  start: number;
  end: number;
  /** The second the moment turns on: the shot, the save, the whistle. */
  peak: number;
  /** Match clock at the peak, such as "88'" or "45+2'". */
  matchClock?: string;
  /** ScorePlay player IDs involved. */
  players: number[];
  team: "spurs" | "opponent" | "neutral";
  evidence: Evidence[];
  /** Each 0 to 1. `total` is the ranking score; the UI shows the parts. */
  scores: {
    importance: number;
    emotion: number;
    crowd: number;
    social: number;
    total: number;
  };
  /** Empty when no reframing data exists yet; the UI then centres the crop. */
  focus: FocusKey[];
  /** Pegasus's description of the moment's footage, when it was analysed. */
  description?: string;
  /** Labels from the studio taxonomy (TAXONOMY in scripts/studio/taxonomy.ts), written to ScorePlay. */
  tags?: string[];
  editorial?: Editorial;
};

export type ClipFormat = "9:16" | "16:9" | "1:1";

/** One continuous range of the source inside a clip. */
export type ClipSegment = { start: number; end: number; momentId?: string };

/** A planned edit: an ordered list of source ranges plus its copy. Rendering is separate. */
/** The viewers an edit is cut for, from the Problem 1 brief. */
export type Audience = "match-fans" | "season-ticket-holder" | "sponsor" | "international";

export type Clip = {
  id: string;
  /** "asap" ships minutes after the moment; "post-match" is the considered edit. */
  lane: "asap" | "post-match";
  /** The edit's angle, such as "Goal", "Player focus", "Full recap". */
  variant: string;
  format: ClipFormat;
  title: string;
  caption: string;
  hashtags: string[];
  segments: ClipSegment[];
  durationSec: number;
  /** 0 to 1, how likely the clip is to travel on social. */
  viralScore: number;
  /** Why this edit, in one sentence. */
  rationale: string;
  /** Who the edit is for. Absent on clips planned before audiences existed. */
  audience?: Audience;
  /** ScorePlay media ID of the rendered clip, once it has been uploaded back to ScorePlay. */
  scoreplayMediaId?: number;
  /**
   * ScorePlay media ID of the same clip edited by Reel Studio (captions, player card, punch-ins), uploaded
   * as a separate media by scripts/studio/reelstudio.ts once ScorePlay has processed it. The plain render
   * stays at `scoreplayMediaId`.
   */
  reelStudioMediaId?: number;
};

/** A clip the club's own social team published, located inside the source. */
export type GroundTruthClip = {
  /** ScorePlay media ID of the club's published clip. */
  scoreplayId: number;
  name: string;
  start: number;
  end: number;
  alignedBy: "subtitles" | "audio";
  /** 0 to 1. */
  confidence: number;
  /** The studio moment that overlaps this clip, if any. */
  matchedMomentId?: string;
};

export type StageRun = {
  id: string;
  label: string;
  /** What the stage did, with counts, such as "1,619 commentary lines, 6,334 s of crowd audio". */
  detail: string;
  durationMs: number;
};

export type Rejected = {
  title: string;
  /** Source second the candidate refers to. */
  at: number;
  kind?: MomentKind;
  source: "commentary" | "twelvelabs-search" | "ranking";
  /** Why it was dropped, in one sentence a producer can argue with. */
  reason: string;
  /** Set when the candidate is a ranked moment that missed the clip cut-off. */
  momentId?: string;
};

export type MatchAnalysis = {
  source: SourceAsset;
  generatedAt: string;
  stages: StageRun[];
  /**
   * Candidates the pipeline considered and dropped, each with its reason, so a producer can catch
   * what the model missed. Includes commentary events it declined, visual hits matching no moment,
   * and ranked moments below the clip cut-off.
   */
  rejected: Rejected[];
  /** What the run wrote onto the source asset in ScorePlay. Absent until a writeback has run. */
  writeback?: {
    videoLogs: number;
    tags: string[];
    at: string;
    /** moments whose timecoded logs were read back from ScorePlay; absent on receipts recorded before this field */
    momentIds?: string[];
  };
  moments: Moment[];
  clips: Clip[];
  groundTruth: GroundTruthClip[];
  /** Crowd loudness across the whole source, one value per `stepSec`, scaled 0 to 1 within this match. */
  crowd?: { stepSec: number; values: number[] };
  eval: {
    /** Ground-truth clips with a matching moment, over all ground-truth clips. */
    matched: number;
    total: number;
    recall: number;
    /** Ground-truth ranges merged where they overlap; not a count of distinct football events. */
    mergedRanges: number;
    /** Minimum seconds of overlap required for a hit. */
    overlapMinSec: number;
    /** Precision against single-moment club clips, excluding the three highlights packages. */
    clipsOnly: { k: number; precision: number };
    /**
     * The ranking measured at cut-offs. Flagging every moment covers a large share of the match, so
     * overall recall flatters; these say how good the top of the list is. The random fields are the
     * same measure for K moments of the same lengths placed uniformly within the playing halves.
     * The loud-crowd baseline draws peak times uniformly from the loudest 10% of playing-half bins.
     */
    atK: {
      k: number;
      /** Share of the top K moments that overlap a club reference by overlapMinSec or more. */
      precision: number;
      /** Share of merged reference ranges overlapped by the top K. */
      recall: number;
      /** Minutes of source footage the top K span. */
      minutes: number;
      randomPrecision: number;
      randomRecall: number;
      loudCrowdPrecision: number;
    }[];
    pegasus?: {
      ranking: "confidence" | "provider-order";
      segments: number;
      atK: { k: number; count: number; precision: number; recall: number; minutes: number }[];
    };
  };
};
