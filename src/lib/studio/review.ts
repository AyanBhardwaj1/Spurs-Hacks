import "server-only";
import { addMediaTags, addVideoLogs, findOrCreateTagOption, getMedia, listVideoLogs, ScorePlayError, type SpMedia } from "@/lib/scoreplay";
import type { MediaWithVideo } from "./library";
import { DECISION_TAGS, decisionOf, decisionTagsIn, tagChanges, type Decision, type Review } from "./review-tags";

// A producer's decision on a clip lives in ScorePlay, on the clip's uploaded media: a tag says approved or
// rejected, and a rejection's reason is a video log comment carrying the same tag. Reading the media back
// is the only source of state, so a reload shows what ScorePlay holds.

export type { Decision, Review } from "./review-tags";

const TAGS = DECISION_TAGS;

const optionIds = new Map<Decision, Promise<number>>();
function tagOption(decision: Decision) {
  let id = optionIds.get(decision);
  if (!id) {
    id = findOrCreateTagOption(TAGS[decision].name, TAGS[decision].label).then((o) => o.ID);
    // A failed lookup is retried next time rather than cached.
    id.catch(() => optionIds.delete(decision));
    optionIds.set(decision, id);
  }
  return id;
}

/**
 * Removes tags from a media item. ScorePlay's API has this call (DELETE /media/{id}/tags) but
 * src/lib/scoreplay.ts has no helper for it yet; this mirrors that file's request conventions.
 */
async function removeMediaTags(id: number, tagOptionIds: number[]) {
  const key = process.env.SCOREPLAY_API_KEY;
  if (!key) throw new ScorePlayError(0, `/media/${id}/tags`, "SCOREPLAY_API_KEY is not set");
  const base = (process.env.SCOREPLAY_API_URL ?? "https://media.scoreplay.io/v1").replace(/\/$/, "");
  const res = await fetch(`${base}/media/${id}/tags`, {
    method: "DELETE",
    headers: { "X-ScorePlay-Api-Key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ tag_option_ids: tagOptionIds }),
    cache: "no-store",
  });
  if (!res.ok) throw new ScorePlayError(res.status, `/media/${id}/tags`, (await res.text()).slice(0, 300));
}

/** The decision tags a media record carries. */
const decisionTags = (media: SpMedia) => decisionTagsIn((media.tags ?? []).map((t) => t.tag_option?.name));

// Every rejection writes a log, so the newest one belongs to the current rejection; one without a reason
// carries this comment instead of leaving an older rejection's reason as the newest.
const NO_REASON = "Rejected in Rundown without a reason";

/** The comment on the newest rejection log for a media item: a reason, the NO_REASON marker, or undefined. */
async function latestRejectionComment(mediaId: number) {
  const { items } = await listVideoLogs(mediaId);
  // A log lists its tags by label ("Rundown: rejected"), next to every tag the media itself carries.
  const marked = (tags: string[]) => tags.includes(TAGS.rejected.label) || tags.includes(TAGS.rejected.name);
  return items.filter((l) => marked(l.tags)).sort((a, b) => b.id - a.id)[0]?.comment;
}

async function rejectionReason(mediaId: number) {
  const comment = await latestRejectionComment(mediaId);
  return comment && comment !== NO_REASON ? comment : undefined;
}

/** The review state of an already-fetched media record; reads the reason only for a rejection. */
export async function reviewOf(media: SpMedia): Promise<Review> {
  const read = decisionOf(decisionTags(media));
  return read.decision === "rejected" ? { ...read, reason: await rejectionReason(media.ID) } : read;
}

export async function readReview(mediaId: number) {
  return reviewOf(await getMedia(mediaId));
}

/**
 * Sets the decision on a clip's media, or clears it with null, and returns what ScorePlay holds afterwards.
 * Throws unless ScorePlay then holds exactly this decision and, for a rejection, this reason.
 */
export async function writeReview(mediaId: number, decision: Decision | null, reason?: string): Promise<Review> {
  const [approvedId, rejectedId] = await Promise.all([tagOption("approved"), tagOption("rejected")]);
  const ids = { approved: approvedId, rejected: rejectedId };
  const media = (await getMedia(mediaId)) as MediaWithVideo;
  const present = decisionTags(media);
  const current = decisionOf(present).decision;

  // A rejection's log goes before its tag. If the tag write then fails, a retry finds no tag and writes both
  // again, and the newest log still carries this reason. With the tag already there, a log is written only
  // when the newest one does not already say this.
  if (decision === "rejected") {
    const wanted = reason || NO_REASON;
    if (current !== "rejected" || (await latestRejectionComment(mediaId)) !== wanted) {
      const logged = await addVideoLogs(media.company_id, [
        {
          media_id: mediaId,
          start_offset: 0,
          end_offset: media.video?.duration ?? media.duration ?? 0,
          comment: wanted,
          raw_tags: [TAGS.rejected.name],
        },
      ]);
      if (logged !== true) throw new Error(`ScorePlay did not confirm the rejection log on media ${mediaId}`);
    }
  }
  // Clearing removes every decision tag, so Undo also mends a conflict two racing writes left behind.
  const { remove, add } = tagChanges(present, decision);
  if (remove.length > 0) await removeMediaTags(mediaId, remove.map((d) => ids[d]));
  if (add.length > 0) await addMediaTags(mediaId, { tag_option_ids: add.map((d) => ids[d]) });

  const after = await readReview(mediaId);
  if (after.conflict || after.decision !== decision) {
    throw new Error(
      `ScorePlay holds ${after.conflict ? "both decisions" : (after.decision ?? "no decision")} on media ${mediaId} after writing ${decision ?? "no decision"}`,
    );
  }
  if (decision === "rejected" && after.reason !== (reason || undefined)) {
    throw new Error(`ScorePlay holds the reason "${after.reason ?? "none"}" on media ${mediaId}, not "${reason ?? "none"}"`);
  }
  return after;
}
