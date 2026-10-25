"use client";

import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";

// How much of a figure may show at the bottom edge on load and still wait to play its entrance.
const SLIVER = 100;

// Wraps a figure that moves. While it is off screen it carries data-paused, which stops its .clock and
// dots (landing.css), so a page of loops costs nothing out of view. With `reveal`, its entrance also plays
// once, as its top passes the lower fifth of the screen. The markup is the finished state (data-shown).
// A figure that loads well in view keeps it. One that loads with more than a sliver showing in the lower
// fifth plays at once, and one that loads lower waits for its top to rise past the fifth.
export function Live({
  className,
  style,
  reveal = false,
  children,
}: {
  className?: string;
  style?: CSSProperties;
  reveal?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const pause = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) delete node.dataset.paused;
      else node.dataset.paused = "";
    });
    pause.observe(node);

    let show: IntersectionObserver | undefined;
    let frame = 0;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const top = node.getBoundingClientRect().top;
    if (reveal && !reduced && top > innerHeight * 0.8) {
      // Hide without transitions, so what the server drew doesn't visibly fade out. Reading layout commits
      // the hidden state before transitions come back.
      node.dataset.instant = "";
      delete node.dataset.shown;
      node.getBoundingClientRect();
      delete node.dataset.instant;
      const play = () => {
        node.dataset.shown = "";
      };
      if (top < innerHeight - SLIVER) {
        // More than a sliver already shows above the bottom edge: play the entrance now rather than leave
        // that part blank. A sliver waits, so the entrance plays where it can be seen.
        frame = requestAnimationFrame(play);
      } else {
        show = new IntersectionObserver(
          ([entry]) => {
            if (!entry.isIntersecting) return;
            show?.disconnect();
            play();
          },
          { rootMargin: "0px 0px -20% 0px" },
        );
        show.observe(node);
      }
    }
    return () => {
      pause.disconnect();
      show?.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [reveal]);

  return (
    <div ref={ref} data-shown="" data-reveal={reveal ? "" : undefined} className={className} style={style}>
      {children}
    </div>
  );
}
