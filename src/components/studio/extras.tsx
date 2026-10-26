"use client";

import { createContext, Suspense, use, type ReactNode } from "react";
import type { ExtrasPart, MissingReason, SourceExtras } from "@/lib/studio/library";
import { spriteFrame } from "@/lib/studio/sprites";

// What the studio reads from ScorePlay on top of the analysis: the source's sprite sheets and the club's
// clip thumbnails. The server starts the request and passes the promise down; each part that wants it
// suspends on its own, so the page shows at once and posters fill in when ScorePlay answers.
const ExtrasContext = createContext<Promise<SourceExtras> | null>(null);

export function ExtrasProvider({ value, children }: { value: Promise<SourceExtras>; children: ReactNode }) {
  return <ExtrasContext value={value}>{children}</ExtrasContext>;
}

export function useExtras() {
  const promise = use(ExtrasContext);
  if (!promise) throw new Error("useExtras needs an ExtrasProvider above it");
  return use(promise);
}

/** The source frame at second `at`, cut from ScorePlay's sprite sheets, filling its 16:9 parent. */
export function SpritePoster({ at, className = "clip-poster" }: { at: number; className?: string }) {
  const { sprites } = useExtras();
  if (!sprites) return null;
  const f = spriteFrame(sprites, at);
  return (
    <div
      aria-hidden
      className={className}
      style={{ backgroundImage: `url("${f.url}")`, backgroundSize: f.size, backgroundPosition: f.position }}
    />
  );
}

export const SLOW_COPY = "ScorePlay is slow; showing the recorded run.";
export const DOWN_COPY = "ScorePlay did not answer; showing the recorded run.";
export const OFF_COPY = "ScorePlay is not connected; showing the recorded run.";
export const NO_FOOTAGE_COPY =
  "No footage. The match video lived on the club’s ScorePlay, which was cleared after the event, and club footage can’t be re-hosted. The moments, timecodes and reasons on this page are the recorded run.";

/** The line for a part of the page ScorePlay did not fill. */
export const missingCopy = (reason: MissingReason) => (reason === "off" ? OFF_COPY : reason === "slow" ? SLOW_COPY : DOWN_COPY);

/** A quiet line in a section whose ScorePlay data is missing. Renders nothing while waiting or when it arrived. */
export function ScorePlayNote({ part, className = "" }: { part: ExtrasPart; className?: string }) {
  return (
    <Suspense fallback={null}>
      <ScorePlayNoteInner part={part} className={className} />
    </Suspense>
  );
}

function ScorePlayNoteInner({ part, className }: { part: ExtrasPart; className: string }) {
  const { missing } = useExtras();
  if (!missing[part]) return null;
  return (
    <p role="status" className={`text-caption text-secondary ${className}`}>
      {missingCopy(missing[part])}
    </p>
  );
}
