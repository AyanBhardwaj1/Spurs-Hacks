"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { ReplayIcon } from "./icons";
import { proposals } from "./sample-match";

// Every clip from one match as a tile, then the five worth making. The markup is the finished drawing;
// each beat below adds one data attribute and landing.css transitions carry the change, so a replay
// part-way through simply starts again from the dim grid.
const BEATS: [string, number][] = [
  ["watched", 250],
  ["found", 1950],
  ["picked", 2900],
];

// Grid geometry in percent of the figure, which is twice as wide as it is tall. Tiles and slots are 16:9.
const COLS = 16;
const ROWS = 7;
const GAP_X = 0.6;
const GAP_Y = 1.4;
const TILE_W = (100 - (COLS - 1) * GAP_X) / COLS;
const TILE_H = TILE_W * 2 * (9 / 16);
const SLOT_GAP = 2.2;
const SLOT_W = (100 - 4 * SLOT_GAP) / 5;
const SLOT_H = SLOT_W * 2 * (9 / 16);
const SLOT_Y = 61;
const GRID_H = ROWS * TILE_H + (ROWS - 1) * GAP_Y;

// Muted stand-ins for frames: the pitch, the stands, a photo, the bench, the press room, the home kit.
const LOOKS = [
  "radial-gradient(circle at 50% 50%, rgb(255 255 255 / 0.5) 0 9%, transparent 10%), linear-gradient(160deg, #4b8b55, #2f6539)",
  "radial-gradient(circle at 30% 40%, #e2bb92 0 14%, transparent 15%), radial-gradient(circle at 68% 62%, #c98f6a 0 13%, transparent 14%), linear-gradient(#665066, #3f3248)",
  "linear-gradient(135deg, #e7c27a, #c77a52)",
  "linear-gradient(transparent 62%, #2c4f8a 62% 74%, transparent 74%), linear-gradient(#647487, #44525f)",
  "radial-gradient(circle at 50% 58%, #2a2a2e 0 9%, transparent 10%), linear-gradient(#ece8e0, #cdc7bc)",
  "linear-gradient(160deg, #1d2d63, #34488f)",
];

// Tiles that hold a moment. Five become proposals, in the order of the sample running order; the rest
// were found and left behind.
const PICKS: Record<number, { pick: number; look: number }> = {
  19: { pick: 0, look: 1 },
  38: { pick: 1, look: 0 },
  61: { pick: 2, look: 4 },
  85: { pick: 3, look: 5 },
  106: { pick: 4, look: 3 },
};
const OTHER_MOMENTS = new Set([7, 29, 40, 53, 72, 94, 99]);

const tiles = Array.from({ length: COLS * ROWS }, (_, i) => {
  const col = i % COLS;
  const row = Math.floor(i / COLS);
  const picked = PICKS[i];
  const style: Record<string, string | number> = {
    "--x": col * (TILE_W + GAP_X),
    "--y": row * (TILE_H + GAP_Y),
    "--w": TILE_W,
    "--h": TILE_H,
    "--col": col,
    "--look": LOOKS[picked ? picked.look : (i * 7 + row * 3) % LOOKS.length],
  };
  if (picked) {
    style["--pick"] = picked.pick;
    style["--tx"] = picked.pick * (SLOT_W + SLOT_GAP);
    style["--ty"] = SLOT_Y;
    style["--s"] = SLOT_W / TILE_W;
  }
  return { i, picked: Boolean(picked), moment: Boolean(picked) || OTHER_MOMENTS.has(i), style: style as CSSProperties };
});

export function MatchFunnel() {
  const figure = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = figure.current;
    if (!node) return;
    let timers: number[] = [];
    const reset = () => {
      timers.forEach(clearTimeout);
      timers = [];
      node.dataset.instant = "";
      for (const [name] of BEATS) delete node.dataset[name];
      node.getBoundingClientRect(); // commit the dim grid before transitions come back
      delete node.dataset.instant;
    };
    const play = () => {
      reset();
      for (const [name, time] of BEATS) {
        timers.push(
          window.setTimeout(() => {
            node.dataset[name] = "";
          }, time),
        );
      }
    };
    node.addEventListener("rundown:replay", play);

    let observer: IntersectionObserver | undefined;
    // A figure already on screen (a reload part-way down) keeps its finished drawing instead of vanishing.
    const below = node.getBoundingClientRect().top > innerHeight;
    if (below && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      reset();
      // Plays once the top of the grid rises past the lowest 30% of the window, so most of the figure,
      // slots included, is on screen when the picks fly.
      observer = new IntersectionObserver(
        ([entry]) => {
          if (!entry.isIntersecting) return;
          observer?.disconnect();
          play();
        },
        { rootMargin: "0px 0px -30% 0px" },
      );
      observer.observe(node);
    }
    return () => {
      observer?.disconnect();
      timers.forEach(clearTimeout);
      node.removeEventListener("rundown:replay", play);
    };
  }, []);

  return (
    <figure className="mt-12 md:mt-16">
      <div
        ref={figure}
        data-watched=""
        data-found=""
        data-picked=""
        aria-hidden
        className="funnel aspect-[2/1] w-full"
      >
        {tiles.map((tile) => (
          <span
            key={tile.i}
            className="funnel-tile"
            data-moment={tile.moment ? "" : undefined}
            data-pick={tile.picked ? "" : undefined}
            style={tile.style}
          />
        ))}
        <span className="funnel-scan playhead absolute top-0" style={{ height: `${GRID_H}%` }} />
        {proposals.map((p, i) => {
          const left = `${i * (SLOT_W + SLOT_GAP)}%`;
          return (
            <div key={p.id}>
              <span
                className="funnel-slot absolute grid place-items-center rounded-[10px] bg-fill text-footnote font-semibold text-secondary"
                style={{ left, top: `${SLOT_Y}%`, width: `${SLOT_W}%`, height: `${SLOT_H}%` }}
              >
                {i + 1}
              </span>
              <p
                className="funnel-label absolute hidden text-left sm:block"
                style={{ left, top: `${SLOT_Y + SLOT_H + 2.5}%`, width: `${SLOT_W}%`, "--pick": i } as CSSProperties}
              >
                <span className="block truncate text-footnote font-semibold">{p.audience}</span>
                <span className="timecode block text-caption text-secondary">{p.format}</span>
              </p>
            </div>
          );
        })}
      </div>
      <figcaption className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-[46ch] text-footnote text-secondary">
          Every tile is a clip from one match. Rundown watches all of them, marks the moments, and moves five
          into the running order, each for a named audience. Tiles are drawn, not footage.
        </p>
        <button
          type="button"
          onClick={() => figure.current?.dispatchEvent(new Event("rundown:replay"))}
          className="press inline-flex h-11 shrink-0 items-center gap-2 self-start rounded-full bg-fill px-5 text-[15px] font-semibold hover:bg-[color-mix(in_srgb,var(--fill),var(--label)_8%)]"
        >
          <ReplayIcon />
          Replay
        </button>
      </figcaption>
      <ol className="mt-6 grid gap-3 sm:hidden">
        {proposals.map((p, i) => (
          <li key={p.id} className="flex items-baseline gap-3 text-subhead">
            <span className="timecode text-footnote text-secondary">{i + 1}</span>
            <span className="font-semibold">{p.audience}</span>
            <span className="timecode text-footnote text-secondary">{p.format}</span>
          </li>
        ))}
      </ol>
    </figure>
  );
}
