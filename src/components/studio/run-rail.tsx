"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CheckIcon, ReplayIcon } from "@/components/landing/icons";
import { stageTime } from "@/lib/studio/time";
import type { StageRun } from "@/lib/studio/types";
import { useReducedMotion } from "./use-reduced-motion";

// Replays the recorded run, stage by stage, with each stage's real detail and duration. The replay is sped
// up: a stage holds the screen for 0.5 to 1.7 s in proportion to how long it really took, so a minute-long
// crowd pass and a one-second ranking both stay readable. The real durations are the numbers shown.
const MIN_MS = 500;
const SPAN_MS = 1200;

type Props = { stages: StageRun[]; recordedAt: string; matchWatch?: boolean };

const replayMs = (s: StageRun, longest: number) => MIN_MS + SPAN_MS * (s.durationMs / longest);

export function RunRail({ stages, recordedAt, matchWatch = false }: Props) {
  const reduced = useReducedMotion();
  // stages.length means the replay has finished; that is also the state before any replay starts.
  const [step, setStep] = useState(stages.length);
  const root = useRef<HTMLElement>(null);
  const started = useRef(false);
  const longest = Math.max(1, ...stages.map((s) => s.durationMs));
  const total = stages.reduce((sum, s) => sum + s.durationMs, 0);

  useEffect(() => {
    if (step >= stages.length) return;
    const id = setTimeout(() => setStep((s) => s + 1), replayMs(stages[step], longest));
    return () => clearTimeout(id);
  }, [step, stages, longest]);

  // Plays once, the first time the rail is on screen. Reduced motion shows the finished run.
  useEffect(() => {
    if (reduced || !root.current) return;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !started.current) {
        started.current = true;
        setStep(0);
      }
    });
    io.observe(root.current);
    return () => io.disconnect();
  }, [reduced]);

  const replaying = step < stages.length;

  return (
    <section ref={root} aria-labelledby="run-title" className="rounded-[18px] bg-grouped">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 pt-4">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="run-title" className="text-subhead font-semibold">
            Pipeline
          </h2>
          <p className="text-caption text-secondary">
            Replay of the run recorded {recordedAt}, sped up. It took <span className="num text-label">{stageTime(total)}</span>.
          </p>
        </div>
        {!reduced && (
        <button
          type="button"
          onClick={() => setStep(0)}
          disabled={replaying}
          className="press inline-flex h-8 items-center gap-1.5 rounded-full bg-fill px-3 text-caption font-semibold text-label hover:bg-separator disabled:opacity-40"
        >
          <ReplayIcon className="size-3" />
          {replaying ? "Replaying" : "Replay run"}
        </button>
        )}
      </div>
      <ol
        className="mt-3 grid gap-px overflow-x-auto px-2 pb-2"
        style={{ gridTemplateColumns: `repeat(${stages.length}, minmax(132px, 1fr))` }}
        aria-busy={replaying}
      >
        {stages.map((s, i) => {
          const state = i < step ? "done" : i === step ? "running" : "waiting";
          return (
            <li
              key={s.id}
              data-state={state}
              className="stage-cell overflow-hidden rounded-xl px-3 pb-3 pt-3.5"
              style={{ "--replay": `${replayMs(s, longest)}ms` } as CSSProperties}
            >
              <span className="stage-fill" aria-hidden />
              <div className="flex items-center justify-between gap-2">
                <span className="num text-caption text-secondary">{String(i + 1).padStart(2, "0")}</span>
                <span className="flex items-center gap-1 text-caption">
                  <span className="num text-label">{stageTime(s.durationMs)}</span>
                  <CheckIcon className="stage-check size-3.5 text-go" />
                </span>
              </div>
              <p className="mt-1.5 text-footnote font-semibold leading-tight">{s.label}</p>
              <p className="mt-1 line-clamp-4 text-caption text-secondary" title={s.detail}>
                {s.detail}
              </p>
            </li>
          );
        })}
      </ol>
      {matchWatch && (
        <p className="px-5 pb-3 text-caption text-secondary">
          Built with MatchWatch (Feria &amp; Hamid): editorial review or Pegasus segmentation prompts feed this run.
        </p>
      )}
    </section>
  );
}
