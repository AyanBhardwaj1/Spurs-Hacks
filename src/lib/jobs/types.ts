import type { PLACEMENTS } from "@/lib/rundown/platforms";

// A job is one uploaded match video and everything Rundown makes from it. It is written to
// RUNDOWN_DATA_DIR/jobs/<id>/job.json after every stage, so the page can poll it and a restart does
// not lose finished work. The video is the uploader's own; it stays in the job's folder until the job
// is deleted.

export type PlacementId = keyof typeof PLACEMENTS;

/** The placements a job can target. Club-app and partner deliveries are hackathon extras, left out. */
export const JOB_PLACEMENTS = ["tiktok", "instagram-reel", "youtube-short", "x-video", "x-square", "youtube-video"] as const satisfies readonly PlacementId[];
export type JobPlacement = (typeof JOB_PLACEMENTS)[number];

export const SPORTS = ["soccer", "basketball", "american-football", "other"] as const;
export type JobSport = (typeof SPORTS)[number];

export type StageId = "upload" | "probe" | "audio" | "transcript" | "moments" | "plan" | "render";
export type StageState = "waiting" | "running" | "done" | "skipped" | "failed";
export type JobStage = { id: StageId; label: string; state: StageState; detail?: string; startedAt?: string; endedAt?: string };

export type SourceInfo = { durationSec: number; width: number; height: number; fps: number; hasAudio: boolean };

/** A timed word from the transcript, in source seconds. */
export type Word = { text: string; start: number; end: number };

/** Where a moment's evidence came from. */
export type Signal = "crowd" | "commentary" | "model";

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
  render: { state: "waiting" | "rendering" | "ready" | "failed"; file?: string; error?: string };
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
  /** Runs started for this job; a restart mid-run starts another, up to a limit. */
  attempts?: number;
  error?: string;
  upload: { fileName: string; size: number; received: number };
  source?: SourceInfo;
  stages: JobStage[];
  /** Which optional services ran, so the page can say what the picks were based on. */
  services: { transcript: boolean; model: boolean };
  moments: JobMoment[];
  clips: JobClip[];
  skipped: JobSkip[];
};
