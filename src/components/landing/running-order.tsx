"use client";

import { useState, type CSSProperties } from "react";
import { CheckIcon } from "./icons";
import { proposals, spikes, timelinePosition } from "./sample-match";
import { TrafficLights } from "./window-chrome";

type Decision = "proposed" | "approved" | "spiked";
type Mark = { id: string; tc: string; decision: Decision };

const row =
  "row-in rounded-xl px-4 py-4 md:grid md:grid-cols-[6rem_minmax(0,1fr)_auto] md:items-start md:gap-x-4 md:px-5 md:py-5";
const button = "press inline-flex h-9 items-center rounded-full text-subhead pointer-coarse:h-11";
const tinted = `${button} bg-tint-fill px-4 font-semibold text-tint hover:bg-[color-mix(in_srgb,var(--tint-fill),var(--tint)_12%)]`;
const gray = `${button} bg-fill px-4 font-semibold text-label hover:bg-[color-mix(in_srgb,var(--fill),var(--label)_8%)]`;
const plain = `${button} -mr-3 px-3 text-tint hover:bg-tint-fill`;
const sectionHeader = "px-4 pb-2 text-footnote font-semibold uppercase tracking-[0.04em] text-secondary md:px-5";

// The tally light: red while a piece waits on the producer, a check once approved, unlit once spiked.
function StatusMark({ decision }: { decision: Decision }) {
  return (
    <span aria-hidden className="flex size-3.5 shrink-0 items-center justify-center">
      {decision === "approved" ? (
        <CheckIcon className="size-3.5 text-go" />
      ) : decision === "proposed" ? (
        <span className="size-2 rounded-full bg-tally" />
      ) : (
        <span className="size-2 rounded-full bg-separator" />
      )}
    </span>
  );
}

// Every moment on the sample broadcast, drawn as a film strip, so a producer sees where the queue sits
// in the match.
const STRIP =
  "repeating-linear-gradient(90deg, var(--fill) 0 14px, color-mix(in srgb, var(--fill), var(--label) 7%) 14px 28px)";

// Waiting marks draw last, so nothing covers a piece the producer still has to decide.
const drawOrder: Record<Decision, number> = { spiked: 0, approved: 1, proposed: 2 };
// Marks closer than this share of the strip would cover each other. Each one after the first in such a run
// steps right by STEP pixels, so every mark stays visible.
const NEAR = 2;
const STEP = 14;

function Timeline({ marks }: { marks: Mark[] }) {
  const byPosition = marks
    .map((mark) => ({ ...mark, left: timelinePosition(mark.tc), step: 0 }))
    .sort((a, b) => a.left - b.left);
  byPosition.forEach((mark, i) => {
    const before = byPosition[i - 1];
    if (before && mark.left - before.left < NEAR) mark.step = before.step + 1;
  });
  const placed = [...byPosition].sort((a, b) => drawOrder[a.decision] - drawOrder[b.decision]);

  return (
    <div aria-hidden className="rounded-2xl bg-card px-4 pb-3 pt-4 md:px-5">
      <div className="relative h-6 rounded-md" style={{ background: STRIP }}>
        {placed.map((mark) => (
          <span
            key={mark.id}
            className="absolute top-1/2 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-card shadow-[0_2px_6px_rgb(0_0_0/0.2)]"
            style={{ left: `${mark.left}%`, marginLeft: mark.step * STEP }}
          >
            <StatusMark decision={mark.decision} />
          </span>
        ))}
      </div>
      <div className="timecode mt-2 flex justify-between text-caption text-secondary">
        <span>00:00:00</span>
        <span>Post-match</span>
      </div>
    </div>
  );
}

export function RunningOrder() {
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [rescued, setRescued] = useState<Set<string>>(new Set());
  const decide = (id: string, decision: Decision) =>
    setDecisions((current) => ({ ...current, [id]: decision }));

  const approved = proposals.filter((p) => decisions[p.id] === "approved").length;
  const producerSpiked = proposals.filter((p) => decisions[p.id] === "spiked").length;
  const waiting = proposals.length - approved - producerSpiked + rescued.size;
  const marks = [
    ...spikes.map((s): Mark => ({ id: s.id, tc: s.tc, decision: rescued.has(s.id) ? "proposed" : "spiked" })),
    ...proposals.map((p): Mark => ({ id: p.id, tc: p.tc, decision: decisions[p.id] ?? "proposed" })),
  ];

  return (
    <section
      aria-labelledby="running-order"
      className="overflow-hidden rounded-[22px] bg-grouped text-left shadow-[0_40px_100px_-40px_rgb(0_0_0/0.35)]"
    >
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 pt-4 md:px-5">
        <div className="flex min-w-0 items-center gap-4">
          <TrafficLights />
          <div className="min-w-0">
            <h2 id="running-order" className="text-body font-semibold">
              Tottenham Hotspur v Manchester United
            </h2>
            <p className="text-caption text-secondary">Sample running order</p>
          </div>
        </div>
        <p aria-live="polite" className="flex flex-wrap items-center gap-x-2 text-footnote text-secondary">
          <span className="inline-flex items-center gap-1.5 font-semibold text-label">
            <span aria-hidden className={`size-2 rounded-full ${waiting > 0 ? "bg-tally" : "bg-separator"}`} />
            {waiting} waiting
          </span>
          <span aria-hidden>·</span>
          <span>{approved} approved</span>
          <span aria-hidden>·</span>
          <span>{spikes.length - rescued.size + producerSpiked} spiked</span>
        </p>
      </header>

      <div className="px-3 pb-5 pt-4 md:px-5 md:pb-6 md:pt-5">
        <Timeline marks={marks} />

        <h3 className={`mt-6 ${sectionHeader}`}>Proposed</h3>
        <ol className="rounded-2xl bg-card">
          {proposals.map((p, i) => {
            const decision = decisions[p.id] ?? "proposed";
            return (
              <li key={p.id} style={{ "--i": i } as CSSProperties} className={row}>
                <div className="flex items-center gap-2 md:pt-0.5">
                  <StatusMark decision={decision} />
                  <span className="timecode text-footnote text-secondary">{p.tc}</span>
                </div>
                <div className={`mt-1.5 md:mt-0 ${decision === "spiked" ? "text-secondary" : ""}`}>
                  <p id={`${p.id}-moment`} className="text-body font-semibold">
                    <span className={decision === "spiked" ? "dim" : undefined}>{p.moment}</span>
                  </p>
                  <p className="mt-0.5 text-subhead text-secondary">{p.source}</p>
                  <p className="mt-2 max-w-[56ch] text-subhead">{p.why}</p>
                  <dl className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-footnote">
                    <div>
                      <dt className="sr-only">Signal</dt>
                      <dd className="rounded-full bg-fill px-2 py-0.5 text-caption font-semibold">{p.signal}</dd>
                    </div>
                    <div className="flex gap-1">
                      <dt className="text-secondary">For</dt>
                      <dd className="font-semibold">{p.audience}</dd>
                    </div>
                    <div>
                      <dt className="sr-only">Format</dt>
                      <dd className="timecode text-secondary">{p.format}</dd>
                    </div>
                  </dl>
                </div>
                <div className="mt-4 flex items-center gap-3 md:mt-0 md:justify-end">
                  {decision === "proposed" ? (
                    <>
                      <button
                        type="button"
                        onClick={() => decide(p.id, "approved")}
                        aria-describedby={`${p.id}-moment`}
                        className={tinted}
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        onClick={() => decide(p.id, "spiked")}
                        aria-describedby={`${p.id}-moment`}
                        className={gray}
                      >
                        Spike
                      </button>
                    </>
                  ) : (
                    <>
                      <span
                        className={`inline-flex items-center gap-1 text-subhead font-semibold ${decision === "approved" ? "text-go" : "text-secondary"}`}
                      >
                        {decision === "approved" ? (
                          <>
                            <CheckIcon className="size-4" />
                            Approved
                          </>
                        ) : (
                          "Spiked by you"
                        )}
                      </span>
                      <button
                        type="button"
                        onClick={() => decide(p.id, "proposed")}
                        aria-describedby={`${p.id}-moment`}
                        className={plain}
                      >
                        Undo
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        <h3 className={`mt-6 ${sectionHeader}`}>Spiked by Rundown, with the reason</h3>
        <ol className="rounded-2xl bg-card">
          {spikes.map((s, i) => {
            const index = proposals.length + i;
            const isRescued = rescued.has(s.id);
            return (
              <li key={s.id} style={{ "--i": index } as CSSProperties} className={row}>
                <div className="flex items-center gap-2 md:pt-0.5">
                  <StatusMark decision={isRescued ? "proposed" : "spiked"} />
                  <span className="timecode text-footnote text-secondary">{s.tc}</span>
                </div>
                <div className="mt-1.5 md:mt-0">
                  <p
                    id={`${s.id}-moment`}
                    className={`text-body font-semibold ${isRescued ? "" : "text-secondary"}`}
                  >
                    <span
                      className={isRescued ? undefined : "dim"}
                      style={{ "--dim-delay": `${index * 50 + 520}ms` } as CSSProperties}
                    >
                      {s.moment}
                    </span>
                    <span className="ml-2 text-subhead font-normal text-secondary">{s.source}</span>
                  </p>
                  <p className="mt-1.5 max-w-[56ch] text-subhead">
                    <span className="mr-1.5 font-semibold text-secondary">Why</span>
                    {s.reason}
                  </p>
                </div>
                <div className="mt-4 flex items-center gap-3 md:mt-0 md:justify-end">
                  {isRescued ? (
                    <span className="inline-flex h-9 items-center text-subhead font-semibold pointer-coarse:h-11">
                      Back in the queue
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setRescued((current) => new Set(current).add(s.id))}
                      aria-describedby={`${s.id}-moment`}
                      className={gray}
                    >
                      Rescue
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
        <p className="px-4 pt-3 text-footnote text-secondary md:px-5">
          These rows are made up to show the layout. Rundown will fill this sheet from the match on ScorePlay.
        </p>
      </div>
    </section>
  );
}
