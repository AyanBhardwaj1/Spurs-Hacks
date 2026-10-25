import type { Clip, MatchAnalysis, StageRun } from "../../src/lib/studio/types";
import { readCache } from "./cache";

// What publish.ts rendered and uploaded, kept in .media/studio/publish.json.
// analyze.ts reads it too. An uploaded clip is fixed: it exists in ScorePlay as
// rendered, so each entry keeps the clip exactly as it was planned then, and
// that snapshot replaces whatever a later plan produces under the same ID. A
// re-plan can add clips but never changes or drops one already published.

export const PUBLISH_RECORD = "publish.json";

export type PublishedClip = {
  clipId: string;
  /** The clip as it was planned when rendered. */
  clip: Clip;
  file: string;
  renderMs: number;
  bytes: number;
  name: string;
  mediaId?: number;
  pendingCreation?: { clipId: string; attemptedAt: string; name: string };
  /** Candidate render; the published snapshot stays authoritative until this upload succeeds. */
  replacement?: PublishedClip;
  state?: "created" | "uploaded" | "completed" | "tagged";
  renderKey?: string;
  /** Previous upload retained in ScorePlay when an explicit replacement is published. */
  replacesMediaId?: number;
  uploadMs?: number;
  status?: string;
  scoreplayDurationSec?: number;
  scoreplayBytes?: number;
  /** Bytes sent in the original upload, kept when the local clip is rendered again. */
  uploadedBytes?: number;
  renderSource?: { mediaId: number; format: string; width: number; height: number; renditionId?: string };
};

export type PublishRecord = { eventId: number; clips: PublishedClip[] };

/** Reject changing an uploaded cut unless the operator selected its existing media ID. */
export function assertRenderChange(entry: PublishedClip | undefined, key: string, replace: boolean): void {
  if (entry?.mediaId && entry.renderKey !== key && !replace) {
    throw new Error(`Clip ${entry.clipId} has a changed render; use --replace-media=${entry.mediaId} to replace its published media`);
  }
}

/** Puts each uploaded clip, as published and with its ScorePlay media ID, into the plan, and adds the publish stage. */
export function applyPublished(analysis: Pick<MatchAnalysis, "clips" | "stages">, record = readCache<PublishRecord>(PUBLISH_RECORD)): void {
  if (!record) return;
  for (const published of record.clips) {
    if (!published.mediaId || (published.state !== undefined && published.state !== "tagged")) continue;
    if (!published.clip) throw new Error(`publish.json entry ${published.clipId} has no clip snapshot`);
    const fixed = { ...published.clip, scoreplayMediaId: published.mediaId };
    const at = analysis.clips.findIndex((c) => c.id === published.clipId);
    if (at === -1) analysis.clips.push(fixed);
    else analysis.clips[at] = fixed;
  }
  const uploaded = record.clips.filter((c) => c.mediaId && (c.state === undefined || c.state === "tagged"));
  const stage: StageRun = {
    id: "publish",
    label: "Render and send back to ScorePlay",
    detail: `${record.clips.length} clips rendered; ${uploaded.length} uploaded into event ${record.eventId} as media ${uploaded.map((c) => c.mediaId).join(", ")}`,
    durationMs: record.clips.reduce((sum, c) => sum + c.renderMs + (c.uploadMs ?? 0), 0),
  };
  analysis.stages = [...analysis.stages.filter((s) => s.id !== "publish"), stage];
}
