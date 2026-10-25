// The decision tags on a clip's ScorePlay media, and the tag changes that move it to a new decision. Kept
// apart from review.ts, which talks to ScorePlay, so the rules can be tested on their own.

export type Decision = "approved" | "rejected";

/**
 * `conflict` is both tags at once, which two writes racing can leave behind. It reads as no decision, and
 * clearing the decision removes both.
 */
export type Review = { decision: Decision | null; reason?: string; conflict?: true };

export const DECISION_TAGS: Record<Decision, { name: string; label: string }> = {
  approved: { name: "rundown-approved", label: "Rundown: approved" },
  rejected: { name: "rundown-rejected", label: "Rundown: rejected" },
};

/** The decision tags among a media item's tag names. */
export function decisionTagsIn(tagNames: Iterable<string | undefined>) {
  const names = new Set(tagNames);
  return (Object.keys(DECISION_TAGS) as Decision[]).filter((d) => names.has(DECISION_TAGS[d].name));
}

/** What a set of decision tags means. */
export function decisionOf(present: Decision[]): Pick<Review, "decision" | "conflict"> {
  if (present.length > 1) return { decision: null, conflict: true };
  return { decision: present[0] ?? null };
}

/** The tags to remove and add so the media carries exactly `decision`'s tag, or none for null. */
export function tagChanges(present: Decision[], decision: Decision | null) {
  return {
    remove: present.filter((d) => d !== decision),
    add: decision && !present.includes(decision) ? [decision] : [],
  };
}
