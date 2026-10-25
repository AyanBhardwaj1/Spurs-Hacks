import type { CSSProperties, ReactNode } from "react";
import { Live } from "./live";

// One pass of work between the three systems. Each trip is a small drawing that rises from behind one
// system, glides along a lane to the next and sinks behind it, which gives a small pulse. Requests ride the lane above
// the systems and answers the lane below, so a drawing is in view for its whole trip. The legend lights the
// trip in flight (landing.css, the hop classes). The four trips take turns, a quarter of the loop each.
const LOOP = 8000;
const TURN = LOOP / 4;
// When a trip's drawing sinks behind the next system, from the start of its turn.
const ARRIVE = 1450;
// How far each lane sits above or below the middle of the row.
const LANE = 56;

const systems = [
  { name: "ScorePlay", role: "The record" },
  { name: "Rundown", role: "Finds, drafts, writes back" },
  { name: "Twelve Labs", role: "Marengo and Pegasus" },
];
// The centre of each system, as a percentage of the row's width.
const centres = [100 / 6, 50, 500 / 6];

function Clip() {
  return (
    <span className="grid h-7 w-10 place-items-center rounded-md bg-[linear-gradient(135deg,#4b8b55,#2f6539)] shadow-[0_6px_14px_-6px_rgb(0_0_0/0.5)]">
      <svg viewBox="0 0 10 10" className="size-2.5 fill-white">
        <path d="M2.5 1.5l6 3.5-6 3.5z" />
      </svg>
    </span>
  );
}

function Search() {
  return (
    <span className="grid size-8 place-items-center rounded-full bg-white shadow-[0_6px_14px_-6px_rgb(0_0_0/0.5)]">
      <svg viewBox="0 0 16 16" className="size-4 fill-none stroke-tint" strokeWidth={2} strokeLinecap="round">
        <circle cx="7" cy="7" r="4.25" />
        <path d="M10.2 10.2L13.5 13.5" />
      </svg>
    </span>
  );
}

function Moment() {
  return (
    <span className="relative block h-7 w-10 rounded-md bg-[linear-gradient(180deg,#8a6a72,#3f3248)] shadow-[0_6px_14px_-6px_rgb(0_0_0/0.5)]">
      <span className="absolute inset-x-1.5 bottom-1.5 h-1 rounded-full bg-white/35" />
      <span className="absolute bottom-[3px] left-[58%] size-2.5 -translate-x-1/2 rounded-full bg-white" />
    </span>
  );
}

function Tag() {
  return (
    <span className="grid size-8 place-items-center rounded-full bg-tint shadow-[0_6px_14px_-6px_rgb(0_0_0/0.5)]">
      <svg viewBox="0 0 16 16" className="size-4 fill-white">
        <path d="M2 3.2C2 2.5 2.5 2 3.2 2h4.1c.3 0 .6.1.8.4l5.5 5.5c.5.5.5 1.2 0 1.7l-4.2 4.2c-.5.5-1.2.5-1.7 0L2.4 8.1c-.3-.2-.4-.5-.4-.8z" />
        <circle cx="5.2" cy="5.2" r="1.2" className="fill-tint" />
      </svg>
    </span>
  );
}

const trips: { label: string; from: number; to: number; lane: "request" | "answer"; drawing: ReactNode }[] = [
  { label: "Assets and tags", from: 0, to: 1, lane: "request", drawing: <Clip /> },
  { label: "Search and describe", from: 1, to: 2, lane: "request", drawing: <Search /> },
  { label: "Moments and timecodes", from: 2, to: 1, lane: "answer", drawing: <Moment /> },
  { label: "Tags and actions", from: 1, to: 0, lane: "answer", drawing: <Tag /> },
];

const ms = (value: number) => `${value}ms`;

// A system pulses once for every trip that ends at it. Each pulse is its own wrapper, so Rundown, which two
// trips reach, nests two.
function System({ index }: { index: number }) {
  const system = systems[index];
  const isRundown = system.name === "Rundown";
  let node: ReactNode = (
    <div className={`rounded-2xl px-2.5 py-2.5 text-center sm:px-5 ${isRundown ? "bg-label text-page" : "bg-card"}`}>
      <p className="whitespace-nowrap text-footnote font-semibold max-[359px]:whitespace-normal sm:text-body">{system.name}</p>
      <p className={`hidden text-caption sm:block ${isRundown ? "opacity-75" : "text-secondary"}`}>{system.role}</p>
    </div>
  );
  trips.forEach((trip, i) => {
    if (trip.to !== index) return;
    node = (
      <span className="hop-catch block" style={{ "--d": ms(i * TURN + ARRIVE) } as CSSProperties}>
        {node}
      </span>
    );
  });
  return <div className="relative z-10 flex justify-center px-1 sm:px-2">{node}</div>;
}

export function PlatformFlow() {
  return (
    <Live className="mt-14 rounded-[28px] bg-grouped px-4 pb-7 pt-8 sm:px-8" style={{ "--loop": ms(LOOP) } as CSSProperties}>
      <div aria-hidden className="relative h-44 [container-type:inline-size]">
        {[-LANE, LANE].map((y) => (
          <span
            key={y}
            className="lane absolute inset-x-[16.667%] top-1/2 h-1.5"
            style={{ transform: `translateY(calc(${y}px - 50%))` }}
          />
        ))}
        <div className="absolute inset-0 grid grid-cols-3 items-center">
          {systems.map((system, i) => (
            <System key={system.name} index={i} />
          ))}
        </div>
        {trips.map((trip, i) => (
          <span
            key={trip.label}
            className="hop absolute left-0 top-1/2"
            style={
              {
                "--x0": `${centres[trip.from]}cqw`,
                "--x1": `${centres[trip.to]}cqw`,
                "--y": `${trip.lane === "request" ? -LANE : LANE}px`,
                "--d": ms(i * TURN),
              } as CSSProperties
            }
          >
            {trip.drawing}
          </span>
        ))}
      </div>
      <ol aria-label="What moves between the systems" className="mt-6 grid gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-4">
        {trips.map((trip, i) => (
          <li key={trip.label} className="hop-label flex items-center gap-3" style={{ "--d": ms(i * TURN) } as CSSProperties}>
            <span aria-hidden className="flex w-10 shrink-0 justify-center">
              {trip.drawing}
            </span>
            <span>
              <span className="block text-subhead font-semibold">{trip.label}</span>
              <span className="block text-caption text-secondary">
                {systems[trip.from].name} to {systems[trip.to].name}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </Live>
  );
}
