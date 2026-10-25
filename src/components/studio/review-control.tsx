"use client";

import { Suspense, useId, useState } from "react";
import { CheckIcon } from "@/components/landing/icons";
import type { Review } from "@/lib/studio/review-tags";
import type { Clip } from "@/lib/studio/types";
import { useExtras } from "./extras";
import { useSharedReview } from "./review-store";

type Props = { clip: Clip; className?: string };

// "The system proposes, a person approves." The decision is written onto the clip's uploaded media in
// ScorePlay through /api/studio/review, and what the control shows is what ScorePlay returned.
export function ReviewControl({ clip, className = "" }: Props) {
  if (!clip.scoreplayMediaId) {
    return <p className={`text-caption text-secondary ${className}`}>Planned, not rendered: there is no file in ScorePlay to approve yet.</p>;
  }
  return (
    <Suspense fallback={<p className={`h-8 text-caption text-secondary ${className}`}>Reading the decision from ScorePlay…</p>}>
      <ReviewForm mediaId={clip.scoreplayMediaId} title={clip.title} className={className} />
    </Suspense>
  );
}

function ReviewForm({ mediaId, title, className }: { mediaId: number; title: string; className: string }) {
  const { rendered, missing } = useExtras();
  const loaded = rendered[mediaId]?.review;
  const shared = useSharedReview(mediaId);
  const written = shared.written;
  const [mode, setMode] = useState<"idle" | "reason">("idle");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reasonId = useId();

  const review: Review | null = written ?? (loaded && !("error" in loaded) ? loaded : null);
  // A clip ScorePlay did not return still takes a decision; it cannot show the current one, and the clips
  // section says why once rather than on every card.
  const unread = !written && !loaded && Boolean(missing.uploads);
  const readError =
    !written && loaded && "error" in loaded ? loaded.error : !loaded && !unread ? "ScorePlay did not return this clip." : null;

  async function save(decision: Review["decision"], why?: string) {
    // Another control for this clip may be writing; its result arrives through the shared store.
    if (shared.pending) return;
    shared.setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/studio/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaId, decision, reason: why }),
        // The server gives ScorePlay 15 s; this covers a server or network that never answers at all.
        signal: AbortSignal.timeout(20_000),
      });
      const body = (await res.json()) as Review | { error: string };
      if (!res.ok || "error" in body) throw new Error("error" in body ? body.error : `The server answered ${res.status}.`);
      shared.record(body);
      setReason("");
      setMode("idle");
    } catch (err) {
      const e = err as Error;
      setError(e.name === "TimeoutError" ? "The studio server did not answer within 20 s. Reload to see what ScorePlay holds." : e.message);
    } finally {
      shared.setPending(false);
    }
  }

  const saving = shared.pending;
  const button = "press inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-caption font-semibold disabled:opacity-40";

  return (
    <div className={className} data-review={review?.conflict ? "conflict" : (review?.decision ?? "none")}>
      {review?.conflict ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-footnote text-tally">ScorePlay holds both approved and rejected on this clip.</p>
          <button type="button" disabled={saving} onClick={() => save(null)} className="press rounded-md text-caption font-semibold text-tint hover:underline disabled:opacity-40">
            Clear both
          </button>
        </div>
      ) : review?.decision === "approved" ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="flex items-center gap-1.5 text-footnote font-semibold text-go">
            <CheckIcon className="size-4" />
            Approved, tagged in ScorePlay
          </p>
          <button type="button" disabled={saving} onClick={() => save(null)} className="press rounded-md text-caption font-semibold text-tint hover:underline disabled:opacity-40">
            Undo
          </button>
        </div>
      ) : review?.decision === "rejected" ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <p className="min-w-0 text-footnote">
            <span className="font-semibold text-label">Rejected</span>
            <span className="text-secondary">{review.reason ? `: ${review.reason}` : ", no reason given"}</span>
          </p>
          <button type="button" disabled={saving} onClick={() => save(null)} className="press rounded-md text-caption font-semibold text-tint hover:underline disabled:opacity-40">
            Undo
          </button>
        </div>
      ) : mode === "reason" ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            save("rejected", reason);
          }}
        >
          <label htmlFor={reasonId} className="text-caption text-secondary">
            Why reject it? Optional, saved with the clip in ScorePlay.
          </label>
          <input
            id={reasonId}
            autoFocus
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setMode("idle")}
            placeholder="Too similar to the goal edit"
            className="h-9 w-full rounded-lg bg-fill px-3 text-footnote text-label placeholder:text-secondary/70"
          />
          <div className="flex gap-2">
            <button type="submit" disabled={saving} className={`${button} bg-label text-page`}>
              Reject clip
            </button>
            <button type="button" onClick={() => setMode("idle")} className={`${button} text-secondary hover:bg-fill hover:text-label`}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={saving}
            onClick={() => save("approved")}
            aria-label={`Approve ${title}`}
            className={`${button} bg-button text-white hover:bg-button-hover`}
          >
            <CheckIcon className="size-3.5" />
            Approve
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => setMode("reason")}
            aria-label={`Reject ${title}`}
            className={`${button} bg-fill text-label hover:bg-separator`}
          >
            Reject
          </button>
        </div>
      )}
      {saving && (
        <p role="status" className="mt-1.5 text-caption text-secondary">
          Writing to ScorePlay…
        </p>
      )}
      {(error || readError) && (
        <p role="alert" className="mt-1.5 text-caption text-tally">
          {error ?? `Could not read the decision: ${readError}`}
        </p>
      )}
    </div>
  );
}
