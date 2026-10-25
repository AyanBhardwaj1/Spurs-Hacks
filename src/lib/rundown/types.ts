// The data contract between the Rundown engine and the producer workspace.
// Times are seconds from the start of the source asset. Nothing here holds
// media: assets are referenced by ScorePlay ID and streamed by URL.

export type Sport = "soccer" | "basketball";

export type AssetRole =
  | "broadcast"
  | "iso"
  | "press"
  | "published-edit"
  | "archive"
  | "photo"
  | "other";

export type Asset = {
  /** ScorePlay asset ID. Twelve Labs carries it as the video's custom ID. */
  id: string;
  kind: "video" | "photo";
  role: AssetRole;
  name: string;
  durationSec?: number;
  createdAt?: string;
  thumbnailUrl?: string;
  /** Compressed rendition, streamed straight from ScorePlay. */
  previewUrl?: string;
  /** Twelve Labs video ID in the shared index, when the asset is a video. */
  videoId?: string;
  players: string[];
  tags: string[];
};

export type SignalSource = "footage" | "match-log" | "fans" | "archive";

/** One reason the engine looked at a moment. */
export type Signal = {
  source: SignalSource;
  label: string;
  /** The Marengo query or fan post that surfaced the moment. */
  query?: string;
  /** The match-log event ID, for `match-log` signals. */
  ref?: string;
  /** 0 to 1. */
  strength: number;
};

export type MomentKind =
  | "goal"
  | "chance"
  | "celebration"
  | "crowd"
  | "away-end"
  | "silence"
  | "bench"
  | "coach"
  | "card"
  | "confrontation"
  | "skill"
  | "sponsor"
  | "press"
  | "other";

/** A stretch of one asset. Cuts are built from these. */
export type Segment = {
  assetId: string;
  videoId?: string;
  start: number;
  end: number;
  note?: string;
};

/** What Pegasus said about a moment. */
export type MomentAnalysis = {
  description: string;
  players: string[];
  emotion: "elation" | "tension" | "anger" | "despair" | "humour" | "calm";
  intensity: number;
  isReplay: boolean;
  sponsorsVisible: string[];
  crowdAudible: boolean;
  quality: "good" | "usable" | "poor";
  brandSafe: boolean;
  brandSafetyNote?: string;
  hook: string;
  /** One caption per audience, written for that audience. */
  captions: Partial<Record<Audience, string>>;
  /** Tighter in and out points Pegasus suggests, in source seconds. */
  bestStart?: number;
  bestEnd?: number;
  /** Where the action is across the frame, 0 at the left edge to 1 at the right. Vertical crops centre on it. */
  focusX?: number;
};

/** When a moment happened in the match, as the match log tells time. */
export type MatchTime = {
  /** UTC. */
  wallclock: string;
  period: number;
  /** The minute a broadcast caption shows; 45+2' is minute 45, stoppage 2. */
  minute: number;
  stoppage: number;
};

export type Moment = {
  id: string;
  kind: MomentKind;
  title: string;
  /** Set for moments on the broadcast once the match log is lined up with it. */
  matchTime?: MatchTime;
  /** The best-scoring segment. */
  primary: Segment;
  /** The same moment on other assets, such as an ISO camera. */
  angles: Segment[];
  signals: Signal[];
  thumbnailUrl?: string;
  analysis?: MomentAnalysis;
  /** Name of a published club edit that already shows this moment. */
  publishedIn?: string;
  /** An older clip of the same kind of moment, for a then-and-now piece. */
  archive?: Segment;
  /** 0 to 1, after merging signals. */
  score: number;
};

export type Audience =
  | "season-ticket"
  | "first-time-abroad"
  | "partner"
  | "social-native"
  | "player-fans"
  | "family";

export type Aspect = "9:16" | "1:1" | "16:9";

export type Platform = "Instagram" | "TikTok" | "X" | "YouTube" | "Club app" | "Partner";

export type FormatKind =
  | "clip"
  | "reaction"
  | "explainer"
  | "quote"
  | "then-and-now";

export type Format = {
  kind: FormatKind;
  aspect: Aspect;
  lengthSec: number;
};

export type CheckResult = {
  rule: string;
  ok: boolean;
  /** What failed and by how much, or what passed. */
  detail: string;
};

export type RenderStatus = "queued" | "rendering" | "uploading" | "ready" | "failed" | "unavailable";

/**
 * Everything needed to post an approved piece: the rendered clip on
 * ScorePlay, the copy for the platform and the checks it passed.
 */
export type SocialPackage = {
  id: string;
  platform: Platform;
  /** The slot on that platform, such as a Reel or a Short. */
  placement: string;
  aspect: Aspect;
  width: number;
  height: number;
  durationSec: number;
  render: {
    status: RenderStatus;
    /** The rendered clip, uploaded into the match's event on ScorePlay. */
    mediaId?: string;
    /** ScorePlay's own preview of the approved range, used when no render is possible. */
    previewUrl?: string;
    error?: string;
    startedAt?: string;
    finishedAt?: string;
  };
  /** Title for platforms that have one, such as YouTube. */
  title?: string;
  caption: string;
  hashtags: string[];
  altText: string;
  checks: CheckResult[];
  /** When the piece stops being worth posting; absent when it does not go stale. */
  freshUntil?: string;
  handoff?: { at: string; simulated?: boolean };
  /** True in demo runs, where nothing is rendered or sent to ScorePlay. */
  simulated?: boolean;
};

/** The workspace queue's states. */
export type Status = "review" | "approved" | "spiked";

export type ScoreParts = {
  /** How strong the moment is on its own, from Marengo and Pegasus. */
  moment: number;
  /** Extra weight from fans, the match log and repeated hits. */
  signal: number;
  /** How well this format suits the audience. */
  fit: number;
  /** Lower when the club has already published this moment. */
  novelty: number;
};

export type Proposal = {
  id: string;
  momentId: string;
  title: string;
  audience: Audience;
  platform: Platform;
  format: Format;
  cut: Segment[];
  hook: string;
  caption: string;
  /** Why this should exist now, in one or two sentences. */
  why: string;
  signals: Signal[];
  score: number;
  scoreParts: ScoreParts;
  partner?: string;
  /** The match-log event this piece is built around, if any. */
  matchEventId?: string;
  /** One of the five to show first: the best piece from each of the five strongest moments. */
  shortlist: boolean;
  /** When Rundown finished the proposal. */
  readyAt: string;
  /** Minutes after `readyAt` that the piece stays worth posting; null when it does not go stale. */
  freshForMinutes: number | null;
  status: Status;
  /** Proposals are only ever spiked by a producer; Rundown's own rejections are `Spike`s. */
  spikedBy?: "producer";
  spikeReason?: string;
  /** The spike this proposal was rescued from. */
  rescuedFrom?: string;
  writeback?: Writeback;
  /** Built when the proposal is approved. */
  package?: SocialPackage;
};

export type SpikeReason =
  | "duplicate"
  | "already-published"
  | "replay"
  | "weak"
  | "brand-safety"
  | "quality"
  | "rights"
  | "cut-for-time";

/** A moment Rundown looked at and passed on. */
export type Spike = {
  id: string;
  momentId: string;
  title: string;
  kind: MomentKind;
  segment: Segment;
  /** The match-log event the moment is, if any. */
  matchEventId?: string;
  reason: SpikeReason;
  /** One sentence a producer can argue with. */
  detail: string;
  /** The moment that won instead, for duplicates and replays. */
  supersededBy?: string;
  status: "spiked" | "rescued";
  /** The proposal a producer rescued this into. */
  rescuedAs?: string;
  writeback?: Writeback;
};

/** What the engine thinks a source asset is worth keeping on hot storage. */
export type StorageVerdict = {
  assetId: string;
  verdict: "keep" | "cold-storage";
  reason: string;
};

/** What Rundown wrote onto the ScorePlay asset for a decision. */
export type Writeback = {
  at: string;
  assetIds: string[];
  tags: string[];
  ok: boolean;
  /** True in demo runs, where nothing is sent to ScorePlay. */
  simulated?: boolean;
  error?: string;
};

/** Pipeline stages in the order they run. */
export const STAGE_NAMES = [
  "pull",
  "map",
  "probe",
  "match-log",
  "fans",
  "press",
  "merge",
  "analyze",
  "angles",
  "archive",
  "propose",
] as const;

export type StageName = (typeof STAGE_NAMES)[number];

export type Stage = {
  name: StageName;
  status: "pending" | "running" | "done" | "failed" | "skipped";
  detail?: string;
  startedAt?: string;
  finishedAt?: string;
};

/** A key event from the match log, shaped like `MatchEvent` in the workspace. */
export type MatchLogEvent = {
  id: string;
  kind: string;
  period: number;
  clock?: string;
  /** UTC time the event happened. */
  wallclock: string;
  players: string[];
  text: string;
};

export type RunInput = {
  /** ScorePlay event ID of the match. */
  eventId: number;
  sport: Sport;
  /** Key events for the match. Rundown aligns them to the broadcast and searches around them. */
  matchLog?: MatchLogEvent[];
  /** Fan posts to react to. Pasted in, never fetched from a live network. */
  fanPosts?: string[];
  /** Search older assets of the same players for then-and-now pieces. */
  includeArchive?: boolean;
  /** Most moments to send to Pegasus, to bound analysis cost. */
  analyzeLimit?: number;
};

export type Run = {
  id: string;
  input: RunInput;
  source: "live" | "demo";
  status: "running" | "done" | "failed";
  error?: string;
  createdAt: string;
  event?: { id: number; name: string; date?: number };
  /** ScorePlay company that owns the assets. Every video log write needs it. */
  companyId?: number;
  stages: Stage[];
  assets: Asset[];
  /** Sponsor names the club has a deal with, from ScorePlay. */
  partners: string[];
  moments: Moment[];
  proposals: Proposal[];
  spikes: Spike[];
  storage: StorageVerdict[];
};
