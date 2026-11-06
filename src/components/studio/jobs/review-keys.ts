"use client";

import { useEffect } from "react";

// Reviewing by keyboard: J and K move between clip cards in the order the page shows them, A approves,
// R rejects and U undoes. Keys typed into a field, or with a modifier held, are left alone.

export type ReviewAction = { move?: number; press?: "approve" | "reject" | "undo" };

/** What a key does, given the chosen card's index (-1 for none) and how many cards there are. */
export function reviewAction(key: string, at: number, count: number): ReviewAction | undefined {
  if (count === 0) return undefined;
  const clamp = (i: number) => Math.max(0, Math.min(count - 1, i));
  switch (key.toLowerCase()) {
    case "j":
      return { move: at < 0 ? 0 : clamp(at + 1) };
    case "k":
      return { move: at < 0 ? 0 : clamp(at - 1) };
    case "a":
      return at < 0 ? undefined : { press: "approve", move: clamp(at + 1) };
    case "r":
      return at < 0 ? undefined : { press: "reject", move: clamp(at + 1) };
    case "u":
      return at < 0 ? undefined : { press: "undo" };
    default:
      return undefined;
  }
}

/** Cards carry data-clip-card and their buttons data-shortcut="approve" | "reject" | "undo". */
export function useReviewKeys() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) return;
      if ((e.target as HTMLElement | null)?.closest("input, textarea, select, [contenteditable='true']")) return;
      const cards = [...document.querySelectorAll<HTMLElement>("[data-clip-card]")];
      const at = cards.findIndex((c) => c.contains(document.activeElement));
      const action = reviewAction(e.key, at, cards.length);
      if (!action) return;
      e.preventDefault();
      if (action.press) cards[at].querySelector<HTMLButtonElement>(`[data-shortcut="${action.press}"]:not(:disabled)`)?.click();
      if (action.move !== undefined) {
        const card = cards[action.move];
        card.focus({ preventScroll: true });
        const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
        card.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
}
