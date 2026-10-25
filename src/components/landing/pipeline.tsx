import type { CSSProperties, ReactNode } from "react";
import { Live } from "./live";

// The six stages from the README's flow, each with a small drawing that loops while it is on screen.
// Every moving part reads the drawing's clock (landing.css, the k-* classes); `at` is where in the loop it
// moves. Drawings use the page's color tokens through fill-* classes, so they follow light and dark mode.
// They are decoration: the text under each one carries the meaning.

const at = (value: number, extra?: Record<string, string | number>) => ({ "--at": value, ...extra }) as CSSProperties;

function Drawing({ index, children }: { index: number; children: ReactNode }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 200 124"
      className="clock h-full w-auto max-w-full overflow-visible drop-shadow-[0_10px_16px_rgb(0_0_0/0.12)] lg:h-auto lg:w-full"
      style={{ "--loop": "5200ms", "--phase": `${index * -650}ms` } as CSSProperties}
      fontFamily="system-ui, -apple-system, sans-serif"
    >
      {children}
    </svg>
  );
}

function Gradients() {
  return (
    <svg aria-hidden width="0" height="0" className="absolute">
      <defs>
        <linearGradient id="pl-pitch" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4b8b55" />
          <stop offset="1" stopColor="#2f6539" />
        </linearGradient>
        <linearGradient id="pl-crowd" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#6c5468" />
          <stop offset="1" stopColor="#3f3248" />
        </linearGradient>
        <linearGradient id="pl-bench" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#647487" />
          <stop offset="1" stopColor="#44525f" />
        </linearGradient>
        <linearGradient id="pl-photo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#e7c27a" />
          <stop offset="1" stopColor="#c77a52" />
        </linearGradient>
      </defs>
    </svg>
  );
}

// Where the playhead sits when each knob pops: it starts at x 14 and crosses 170 units over 0.6 of the loop.
const scanAt = (x: number) => 0.06 + ((x - 14) / 170) * 0.6;

const stages: { title: string; detail: string; drawing: (index: number) => ReactNode }[] = [
  {
    title: "Pull the match",
    detail: "Rundown searches the club's ScorePlay library by match, player or tag, and streams each rendition by URL.",
    drawing: (index) => (
      <Drawing index={index}>
        <rect className="fill-fill" x="62" y="8" width="112" height="63" rx="9" />
        <rect className="k-in" style={at(0.12)} x="46" y="22" width="112" height="63" rx="9" fill="url(#pl-crowd)" />
        <g className="k-in" style={at(0.22)}>
          <rect x="30" y="38" width="112" height="63" rx="9" fill="url(#pl-pitch)" />
          <path d="M78 58.5l19 11-19 11z" fill="#fff" />
        </g>
        <rect className="k-pop" style={at(0.36)} x="128" y="72" width="52" height="40" rx="7" fill="url(#pl-photo)" />
      </Drawing>
    ),
  },
  {
    title: "Find the moments",
    detail: "Twelve Labs Marengo searches every camera for the bench reacting, the away end, the stadium going quiet.",
    drawing: (index) => (
      <Drawing index={index}>
        <rect x="14" y="14" width="172" height="20" rx="6" fill="url(#pl-pitch)" />
        <rect x="14" y="42" width="172" height="20" rx="6" fill="url(#pl-crowd)" />
        <rect x="14" y="70" width="172" height="20" rx="6" fill="url(#pl-bench)" />
        <g className="k-scan fill-label" style={at(0.06, { "--len": 0.6, "--dist": "170px" })}>
          <rect x="12.5" y="9" width="3" height="85" rx="1.5" shapeRendering="crispEdges" />
          <circle cx="14" cy="9" r="4.5" />
        </g>
        <circle className="k-pop" style={at(scanAt(50))} cx="50" cy="24" r="6" fill="#fff" />
        <circle className="k-pop" style={at(scanAt(96))} cx="96" cy="52" r="6" fill="#fff" />
        <circle className="k-pop" style={at(scanAt(112))} cx="112" cy="80" r="6" fill="#fff" />
        <g className="k-in" style={at(0)}>
          <rect x="14" y="100" width="128" height="20" rx="10" className="fill-fill" />
          <text x="26" y="114" fontSize="11" className="fill-secondary">
            home end celebrates
          </text>
        </g>
      </Drawing>
    ),
  },
  {
    title: "Describe each one",
    detail: "Pegasus says what a moment shows, who is in it, and whether it is a replay or a clean shot.",
    drawing: (index) => (
      <Drawing index={index}>
        <rect x="22" y="6" width="156" height="66" rx="9" fill="url(#pl-crowd)" />
        <circle cx="62" cy="34" r="9" fill="#e2bb92" />
        <circle cx="100" cy="40" r="8" fill="#c98f6a" />
        <circle cx="136" cy="32" r="9" fill="#e2bb92" />
        <rect className="k-in fill-grouped" style={at(0.1)} x="34" y="56" width="150" height="42" rx="12" />
        <rect className="k-grow fill-label" style={at(0.2)} x="48" y="68" width="112" height="6" rx="3" />
        <rect className="k-grow fill-secondary" style={at(0.32)} x="48" y="80" width="76" height="6" rx="3" fillOpacity="0.5" />
        <rect className="k-pop fill-fill" style={at(0.44)} x="34" y="104" width="44" height="14" rx="7" />
        <rect className="k-pop fill-fill" style={at(0.5)} x="84" y="104" width="58" height="14" rx="7" />
      </Drawing>
    ),
  },
  {
    title: "Draft for each audience",
    detail: "Rundown weighs the footage, the match log, fan reaction and the archive, then drafts a piece with a format, a length and a reason.",
    drawing: (index) => (
      <Drawing index={index}>
        {[10, 46, 82].map((y) => (
          <rect key={`row-${y}`} x="14" y={y} width="172" height="30" rx="9" className="fill-grouped" />
        ))}
        {[10, 46, 82].map((y, i) => (
          <g key={y} className="k-slide" style={at(0.06 + i * 0.12)}>
            <circle cx="30" cy={y + 15} r="4.5" className="fill-tally" />
            <rect x="44" y={y + 12} width={[78, 64, 70][i]} height="6" rx="3" className="fill-label" />
            <rect x="136" y={y + 9} width="38" height="12" rx="6" className="fill-fill" />
          </g>
        ))}
      </Drawing>
    ),
  },
  {
    title: "A producer decides",
    detail: "Approve or spike. Rundown keeps what it passed on, with the reason, so nothing is dropped without a trace.",
    drawing: (index) => (
      <Drawing index={index}>
        <rect x="14" y="42" width="100" height="38" rx="19" className="fill-tint-fill" />
        <rect className="k-on fill-go" style={at(0.47)} x="14" y="42" width="100" height="38" rx="19" fillOpacity="0.18" />
        <text className="k-off fill-tint" style={at(0.47)} x="64" y="66" fontSize="15" fontWeight="600" textAnchor="middle">
          Approve
        </text>
        <text className="k-on fill-go" style={at(0.47)} x="64" y="66" fontSize="15" fontWeight="600" textAnchor="middle">
          Approved
        </text>
        <rect x="122" y="42" width="64" height="38" rx="19" className="fill-fill" />
        <text x="154" y="66" fontSize="15" fontWeight="600" textAnchor="middle" className="fill-label">
          Spike
        </text>
        <path
          className="k-move"
          style={at(0.08, { "--to": 0.38, "--press": 0.42, "--dx": "70px", "--dy": "36px" })}
          d="M80 70v22l5.6-5.2 3.8 8.4 4-1.8-3.8-8.2 7.8-.7z"
          fill="#fff"
          stroke="#1d1d1f"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
      </Drawing>
    ),
  },
  {
    title: "Write it back",
    detail: "Each approval becomes a timecoded action on the source asset in ScorePlay, tagged so the club can search it.",
    drawing: (index) => (
      <Drawing index={index}>
        <rect x="12" y="10" width="108" height="61" rx="9" fill="url(#pl-pitch)" />
        <rect x="12" y="80" width="108" height="10" rx="5" className="fill-fill" />
        <rect className="k-slide fill-label" style={at(0.06, { "--from": "-16px" })} x="28" y="80" width="18" height="10" rx="5" />
        {[14, 38, 62].map((y, i) => (
          <g key={y} className="k-slide" style={at(0.2 + i * 0.1, { "--from": "-56px" })}>
            <rect x="128" y={y} width={i === 2 ? 44 : 60} height="18" rx="9" className="fill-fill" />
            <circle cx="139" cy={y + 9} r="3.5" className={i === 0 ? "fill-go" : "fill-secondary"} />
          </g>
        ))}
      </Drawing>
    ),
  },
];

export function Pipeline() {
  return (
    <Live reveal className="flow relative mt-12 md:mt-16">
      <Gradients />
      <ol className="grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-6">
        {stages.map((stage, i) => (
          <li key={stage.title} className="flow-node relative" style={{ "--i": i } as CSSProperties}>
            <div className="relative flex h-32 items-center lg:h-auto">
              {stage.drawing(i)}
              {i < stages.length - 1 ? (
                <span aria-hidden className="dots absolute -right-[22.5px] top-1/2 hidden -translate-y-1/2 gap-[3px] text-secondary lg:flex">
                  <i />
                  <i />
                  <i />
                </span>
              ) : null}
            </div>
            <p className="timecode mt-5 text-footnote text-secondary">0{i + 1}</p>
            <h2 className="mt-1 text-body font-semibold">{stage.title}</h2>
            <p className="mt-1.5 text-subhead text-secondary">{stage.detail}</p>
          </li>
        ))}
      </ol>
    </Live>
  );
}
