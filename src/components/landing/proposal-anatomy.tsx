import type { CSSProperties, ReactNode } from "react";
import { Live } from "./live";
import { proposals, type Signal } from "./sample-match";

const equaliser = proposals[0];

const parts = [
  { title: "The moment", detail: "What happens, which camera caught it, and the timecode where it starts." },
  { title: "The signal", detail: "What surfaced it: the footage, the match log, fan reaction or the archive." },
  { title: "The audience", detail: "Who the piece is for, such as season ticket holders, a sponsor or a first-time viewer abroad." },
  { title: "The cut", detail: "The aspect ratio and running time to edit to." },
  { title: "The reason", detail: "Why this piece should exist now, in one or two sentences a producer can argue with." },
];

// The card lights its parts in turn, a fifth of the loop each (landing.css, k-lit). The last part lets go
// just before the loop ends, so it fades out instead of switching off as the loop starts over.
const lit = (n: number) => ({ "--at": (n - 1) / 5, "--until": Math.min(n / 5, 0.97) }) as CSSProperties;

function Marker({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      className="anatomy-marker flex size-6 shrink-0 items-center justify-center rounded-full bg-label text-caption font-semibold text-page"
    >
      {n}
    </span>
  );
}

function Part({ n, children }: { n: number; children: ReactNode }) {
  return (
    <div data-part={n} className="anatomy-part k-lit -mx-3 flex items-start gap-3 rounded-xl px-3 py-3.5" style={lit(n)}>
      <Marker n={n} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

export function ProposalAnatomy() {
  return (
    <Live
      className="anatomy clock mt-12 grid gap-10 md:mt-16 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-center lg:gap-16"
      style={{ "--loop": "9000ms" } as CSSProperties}
    >
      <div className="reveal rounded-[22px] bg-card px-6 py-4 shadow-[0_30px_80px_-40px_rgb(0_0_0/0.3)] md:px-8 md:py-5">
        <Part n={1}>
          <p className="timecode text-footnote text-secondary">
            {equaliser.tc} · {equaliser.source}
          </p>
          <p className="mt-1 text-title2 font-semibold">{equaliser.moment}</p>
        </Part>
        <Part n={2}>
          <span className="rounded-full bg-fill px-2.5 py-0.5 text-footnote font-semibold">{equaliser.signal}</span>
        </Part>
        <Part n={3}>
          <p className="text-body">
            <span className="text-secondary">For </span>
            <span className="font-semibold">{equaliser.audience}</span>
          </p>
        </Part>
        <Part n={4}>
          <p className="timecode text-body font-semibold">{equaliser.format}</p>
        </Part>
        <Part n={5}>
          <p className="text-body">{equaliser.why}</p>
        </Part>
      </div>
      <ol className="reveal -my-3">
        {parts.map((part, i) => (
          <li key={part.title} data-legend={i + 1} className="anatomy-legend k-lit flex gap-4 py-3" style={lit(i + 1)}>
            <Marker n={i + 1} />
            <div>
              <h2 className="text-body font-semibold">{part.title}</h2>
              <p className="mt-1 text-secondary">{part.detail}</p>
            </div>
          </li>
        ))}
      </ol>
    </Live>
  );
}

const at = (value: number) => ({ "--at": value }) as CSSProperties;

// Small looping glyphs, one per signal, drawn in the page's tokens.
const glyphs: Record<Signal, ReactNode> = {
  Footage: (
    <>
      <rect x="4" y="8" width="40" height="30" rx="7" className="fill-fill" />
      <path className="k-pop fill-label" style={at(0.12)} d="M20 16.5l12 6.5-12 6.5z" />
      <circle className="k-pop fill-secondary" style={at(0.3)} cx="38" cy="13" r="3" />
    </>
  ),
  "Match log": (
    <>
      {[10, 21, 32].map((y, i) => (
        <g key={y} className="k-slide" style={{ ...at(0.08 + i * 0.14), "--from": "-10px" } as CSSProperties}>
          <circle cx="9" cy={y + 3} r="3" className="fill-label" />
          <rect x="16" y={y} width={[26, 20, 24][i]} height="6" rx="3" className="fill-fill" />
        </g>
      ))}
    </>
  ),
  Fans: (
    <>
      <path d="M10 8h28a6 6 0 016 6v14a6 6 0 01-6 6H24l-9 7v-7h-5a6 6 0 01-6-6V14a6 6 0 016-6z" className="fill-fill" />
      {[16, 24, 32].map((x, i) => (
        <circle key={x} className="k-pop fill-label" style={at(0.12 + i * 0.1)} cx={x} cy="21" r="2.6" />
      ))}
    </>
  ),
  Archive: (
    <>
      <rect className="k-in" style={at(0.2)} x="14" y="6" width="20" height="16" rx="3" fill="#d99a63" />
      <rect x="6" y="18" width="36" height="22" rx="5" className="fill-fill" />
      <rect x="4" y="14" width="40" height="8" rx="4" className="fill-label" />
      <rect x="19" y="27" width="10" height="4" rx="2" className="fill-secondary" />
    </>
  ),
};

const signals: { name: Signal; detail: string }[] = [
  { name: "Footage", detail: "The bench reacting, the away end, the moment the stadium goes quiet." },
  { name: "Match log", detail: "Key events from the match, lined up with the broadcast so Rundown searches around them." },
  { name: "Fans", detail: "What supporters are already arguing about, before the club has a clip out." },
  { name: "Archive", detail: "An older clip of the same kind of moment, for a then-and-now piece." },
];

export function Signals() {
  return (
    <Live className="mt-10">
      <ul className="grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
        {signals.map((signal, i) => (
          <li key={signal.name} className="reveal">
            <svg
              aria-hidden
              viewBox="0 0 48 44"
              className="clock h-11 w-12 overflow-visible"
              style={{ "--loop": "3600ms", "--phase": `${i * -500}ms` } as CSSProperties}
            >
              {glyphs[signal.name]}
            </svg>
            <h3 className="mt-4 text-title3 font-semibold">{signal.name}</h3>
            <p className="mt-2 text-secondary">{signal.detail}</p>
          </li>
        ))}
      </ul>
    </Live>
  );
}
