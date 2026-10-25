"use client";

import { useEffect } from "react";

// The demo path: one story told in order across the library and the project page. Step 1 is the library;
// the rest are sections of the project page. The URL carries the step as ?present=N (1-based), so a
// reload during the demo comes back to the same place.

export const DEMO_STEPS = [
  { id: "library", title: "The match, in the club's ScorePlay" },
  { id: "run", title: "The run" },
  { id: "match", title: "What it found" },
  { id: "dropped", title: "What it left out, and why" },
  { id: "clips", title: "Edits for each audience" },
  { id: "accuracy", title: "Checked against Tottenham's editors" },
  { id: "published", title: "A producer approves, back in ScorePlay" },
] as const;

export type DemoStepId = (typeof DEMO_STEPS)[number]["id"];

/** The step in the URL, 0-based, or null when the page is not presenting. */
export function stepFromUrl(): number | null {
  const raw = new URLSearchParams(window.location.search).get("present");
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= DEMO_STEPS.length ? n - 1 : 0;
}

/** Keeps the URL on the current step without a navigation, so Back still leaves the page. */
export function writeStepToUrl(step: number | null) {
  const url = new URL(window.location.href);
  if (step === null) url.searchParams.delete("present");
  else url.searchParams.set("present", String(step + 1));
  window.history.replaceState(window.history.state, "", url);
}

// Next keeps the previous page in the document, hidden, to preserve its state, so a plain query can find
// the other page's section of the same name. Only the visible page counts.
function visibleSections() {
  return [...document.querySelectorAll<HTMLElement>("[data-section]")].filter((el) => el.checkVisibility());
}

/** The visible section for a step, to scroll to. */
export function sectionFor(id: DemoStepId) {
  return visibleSections().find((el) => el.dataset.section === id);
}

/** Lights one section and dims the rest. Sections opt in with data-section="<step id>". */
export function spotlight(id: DemoStepId | null) {
  const root = document.documentElement;
  if (id === null) delete root.dataset.presenting;
  else root.dataset.presenting = "";
  for (const el of document.querySelectorAll<HTMLElement>("[data-spotlight]")) delete el.dataset.spotlight;
  if (id === null) return;
  for (const el of visibleSections()) if (el.dataset.section === id) el.dataset.spotlight = "";
}

type BarProps = {
  step: number;
  note: string;
  onGo: (step: number) => void;
  onExit: () => void;
};

// Clickers send PageDown and PageUp; a keyboard uses the arrows. Arrows stay with whatever already uses
// them: the timeline slider, a video's own controls, text fields.
function ownsArrows(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.matches('input, textarea, select, video, [role="slider"], [contenteditable="true"]');
}

export function PresenterBar({ step, note, onGo, onExit }: BarProps) {
  const last = DEMO_STEPS.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const arrows = !ownsArrows(e.target);
      if (e.key === "PageDown" || (arrows && e.key === "ArrowRight")) {
        e.preventDefault();
        if (step < last) onGo(step + 1);
      } else if (e.key === "PageUp" || (arrows && e.key === "ArrowLeft")) {
        e.preventDefault();
        if (step > 0) onGo(step - 1);
      } else if (e.key === "Escape") {
        onExit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, last, onGo, onExit]);

  const current = DEMO_STEPS[step];

  return (
    <div role="region" aria-label="Demo presenter" className="presenter glass-bar fixed inset-x-0 bottom-5 z-40 mx-auto w-[min(920px,calc(100%-32px))] rounded-[20px] border border-separator/60 px-3 py-3 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.8)]">
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label="Previous step"
          disabled={step === 0}
          onClick={() => onGo(step - 1)}
          className="press grid size-10 shrink-0 place-items-center rounded-full bg-fill text-label hover:bg-separator disabled:opacity-30"
        >
          <Chevron dir="prev" />
        </button>
        <div className="min-w-0 flex-1" aria-live="polite">
          <div className="flex items-center gap-2">
            <ol className="flex gap-1" aria-label="Steps">
              {DEMO_STEPS.map((s, i) => (
                <li key={s.id}>
                  <button
                    type="button"
                    aria-label={`Step ${i + 1}: ${s.title}`}
                    aria-current={i === step ? "step" : undefined}
                    onClick={() => onGo(i)}
                    className="grid h-6 w-5 place-items-center rounded"
                  >
                    <span className={`block h-1.5 rounded-full ${i === step ? "w-4 bg-label" : i < step ? "w-1.5 bg-label/60" : "w-1.5 bg-label/25"}`} />
                  </button>
                </li>
              ))}
            </ol>
            <p className="num text-caption text-secondary">
              {step + 1} of {DEMO_STEPS.length}
            </p>
            <p className="min-w-0 truncate text-subhead font-semibold">{current.title}</p>
          </div>
          <p className="mt-0.5 line-clamp-2 text-footnote text-secondary">{note}</p>
        </div>
        <button
          type="button"
          aria-label={step === last ? "Last step" : "Next step"}
          disabled={step === last}
          onClick={() => onGo(step + 1)}
          className="press grid size-10 shrink-0 place-items-center rounded-full bg-button text-white hover:bg-button-hover disabled:opacity-30"
        >
          <Chevron dir="next" />
        </button>
        <button
          type="button"
          onClick={onExit}
          className="press h-10 shrink-0 rounded-full px-3 text-caption font-semibold text-secondary hover:bg-fill hover:text-label"
        >
          Exit <span className="num text-secondary/80">Esc</span>
        </button>
      </div>
    </div>
  );
}

/** The button that starts the presenter, fixed out of the way at the bottom right. */
export function PresentButton({ onStart }: { onStart: () => void }) {
  return (
    <button
      type="button"
      onClick={onStart}
      className="press glass-bar fixed bottom-5 right-5 z-40 inline-flex h-10 items-center gap-2 rounded-full border border-separator/60 px-4 text-footnote font-semibold text-label shadow-[0_16px_40px_-16px_rgb(0_0_0/0.8)] hover:bg-fill"
    >
      <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="currentColor">
        <rect x="1.5" y="2.5" width="13" height="8.5" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6.5 5.2v3.1l2.7-1.55z" />
        <path d="M8 11v2.5M5.5 13.5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      Present the demo
    </button>
  );
}

function Chevron({ dir }: { dir: "prev" | "next" }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d={dir === "prev" ? "M10 3 5 8l5 5" : "M6 3l5 5-5 5"} />
    </svg>
  );
}
