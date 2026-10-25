"use client";

import { createContext, use, useCallback, useMemo, useState, type ReactNode } from "react";
import type { Review } from "@/lib/studio/review-tags";

// One clip can have an approve control in the grid, in its moment row and in "Back in ScorePlay". Every
// control for a media ID reads the decision ScorePlay last returned, and whether a write is in flight,
// from here: a write in one place shows in all of them, and none can start a second write meanwhile.
type Store = {
  written: ReadonlyMap<number, Review>;
  pending: ReadonlySet<number>;
  record: (mediaId: number, review: Review) => void;
  setPending: (mediaId: number, on: boolean) => void;
};

const ReviewStore = createContext<Store | null>(null);

export function ReviewStoreProvider({ children }: { children: ReactNode }) {
  const [written, setWritten] = useState<ReadonlyMap<number, Review>>(() => new Map());
  const [pending, setPendingSet] = useState<ReadonlySet<number>>(() => new Set());
  const record = useCallback((mediaId: number, review: Review) => setWritten((prev) => new Map(prev).set(mediaId, review)), []);
  const setPending = useCallback(
    (mediaId: number, on: boolean) =>
      setPendingSet((prev) => {
        const next = new Set(prev);
        if (on) next.add(mediaId);
        else next.delete(mediaId);
        return next;
      }),
    [],
  );
  const value = useMemo(() => ({ written, pending, record, setPending }), [written, pending, record, setPending]);
  return <ReviewStore value={value}>{children}</ReviewStore>;
}

/** This media's shared review state: the last decision ScorePlay returned here, and whether a write is in flight. */
export function useSharedReview(mediaId: number) {
  const store = use(ReviewStore);
  if (!store) throw new Error("useSharedReview needs a ReviewStoreProvider above it");
  return {
    written: store.written.get(mediaId) ?? null,
    pending: store.pending.has(mediaId),
    record: (review: Review) => store.record(mediaId, review),
    setPending: (on: boolean) => store.setPending(mediaId, on),
  };
}
