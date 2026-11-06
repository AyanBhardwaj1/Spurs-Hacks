import type { PLACEMENTS } from "@/lib/rundown/platforms";
import type { FocusKey } from "@/lib/studio/types";

// A job is one uploaded match video and everything Rundown makes from it. It is written to
// RUNDOWN_DATA_DIR/jobs/<id>/job.json after every stage, so the page can poll it and a restart does
// not lose finished work. The video is the uploader's own; it stays in the job's folder until the job
// is deleted.

export type PlacementId = keyof typeof PLACEMENTS;

/** The placements a job can target. Club-app and partner deliveries are hackathon extras, left out. */
export const JOB_PLACEMENTS = ["tiktok", "instagram-reel", "youtube-short", "x-video", "x-square", "vertical-recap", "youtube-video"] as const satisfies readonly PlacementId[];
export type JobPlacement = (typeof JOB_PLACEMENTS)[number];
/** What each placement is called on the page. */
export const PLACEMENT_LABEL: Record<JobPlacement, string> = {
  tiktok: "TikTok",
  "instagram-reel": "Instagram Reels",
  "youtube-short": "YouTube Shorts",
  "x-video": "X",
  "x-square": "X, square",
  "vertical-recap": "Vertical recap",
  "youtube-video": "YouTube highlights",
};
/** What a new job is cut for unless someone picks otherwise: the four short-form feeds. */
export const DEFAULT_PLACEMENTS: JobPlacement[] = ["tiktok", "instagram-reel", "youtube-short", "x-video"];

export const SPORTS = [
  "soccer", "basketball", "american-football", "ice-hockey", "baseball", "tennis", "cricket", "rugby", "volleyball", "combat", "motorsport", "esports", "other",
] as const;
export type JobSport = (typeof SPORTS)[number];

export type StageId = "upload" | "probe" | "audio" | "transcript" | "moments" | "plan" | "focus" | "render";
export type StageState = "waiting" | "running" | "done" | "skipped" | "failed";
export type JobStage = { id: StageId; label: string; state: StageState; detail?: string; startedAt?: string; endedAt?: string };

export type SourceInfo = { durationSec: number; width: number; height: number; fps: number; hasAudio: boolean };

/** A timed word from the transcript, in source seconds. */
export type Word = { text: string; start: number; end: number };

/** Where a moment's evidence came from. */
export type Signal = "crowd" | "commentary" | "model" | "producer";

export type JobMoment = {
  id: string;
  /** Source second of the loudest instant, the one a hook-first cut starts near. */
  peak: number;
  start: number;
  end: number;
  /** 0 to 1, how strongly the signals agree that this is worth a clip. */
  score: number;
  signals: Signal[];
  title: string;
  /** The words spoken across the moment, if there is a transcript. */
  quote?: string;
  /** Seconds after the peak until the crowd settled, when the audio showed it. Sets how long a cut runs on. */
  settle?: number;
  /** Where a narrow crop centres over time, in source seconds; absent means centred. */
  focus?: FocusKey[];
};

export type ClipDecision = "approved" | "rejected";

export type JobClip = {
  id: string;
  /** The moment the clip is cut around; a highlights cut lists its first. */
  momentId: string;
  placement: JobPlacement;
  /** Source ranges in play order. One for a single moment, several for a highlights cut. */
  segments: { start: number; end: number }[];
  title: string;
  hook: string;
  caption: string;
  hashtags: string[];
  /** Why this cut suits this platform, in one sentence a producer can argue with. */
  why: string;
  /** cover is the clip's cover image, made after the clip; a clip can be ready without one. */
  render: { state: "waiting" | "rendering" | "ready" | "failed"; file?: string; cover?: string; error?: string };
  /** Other hooks a producer can swap in, the first being the one the rules chose. */
  hooks?: string[];
  /** Source seconds replayed at half speed after the segments, when the job asked for replays. */
  replay?: { start: number; end: number };
  /** YouTube chapters for a highlights cut: where each moment starts, in seconds into the cut. */
  chapters?: { at: number; label: string }[];
  decision?: { value: ClipDecision; reason?: string; at: string };
};

/** A moment that did not become a clip on a platform, with the reason. */
export type JobSkip = { momentId: string; placement: JobPlacement; reason: string };

export type Job = {
  id: string;
  title: string;
  sport: JobSport;
  placements: JobPlacement[];
  createdAt: string;
  status: "uploading" | "queued" | "running" | "done" | "failed";
  /** The club's colour for the caption word being said, and whether a logo was uploaded to lay over every clip. */
  brand?: { colour?: string; logo?: "png" | "jpg" };
  /** Whether short clips end with a slow-motion replay of their play. */
  replay?: boolean;
  /** Runs started for this job; a restart mid-run starts another, up to a limit. */
  attempts?: number;
  error?: string;
  upload: { fileName: string; size: number; received: number };
  source?: SourceInfo;
  stages: JobStage[];
  /** Which optional services ran, so the page can say what the picks were based on. */
  services: { transcript: boolean; model: boolean };
  /** The crowd's loudness across the match, for the page to draw: one dB value per stepSec seconds. */
  energy?: { stepSec: number; db: number[] };
  moments: JobMoment[];
  clips: JobClip[];
  skipped: JobSkip[];
};
