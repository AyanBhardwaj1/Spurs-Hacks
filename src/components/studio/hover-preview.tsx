"use client";
/* eslint-disable @next/next/no-img-element -- Thumbnails come from ScorePlay's CDN; next/image would need remotePatterns in next.config.ts, which the studio does not own. */

import { useCallback, useEffect, useRef, useState } from "react";
import { PlayIcon } from "@/components/landing/icons";
import { canAutoPreview, pointerMoved } from "./pointer";
import { useReducedMotion } from "./use-reduced-motion";

// A thumbnail that plays its clip, muted, while the pointer rests on it or after a press. Only one plays
// at a time across the page: starting one stops the last.
let playing: { owner: object; stop: () => void } | null = null;

type Props = {
  label: string;
  thumbnailUrl?: string;
  previewUrl?: string;
  className?: string;
};

export function HoverPreview({ label, thumbnailUrl, previewUrl, className = "" }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [mounted, setMounted] = useState(false);
  const [on, setOn] = useState(false);
  const self = useRef({});
  const reducedMotion = useReducedMotion();
  const automatic = useRef(false);

  const stop = useCallback(() => {
    video.current?.pause();
    root.current?.removeAttribute("data-live");
    setOn(false);
    if (playing?.owner === self.current) playing = null;
  }, []);

  useEffect(() => {
    if (reducedMotion && automatic.current) stop();
  }, [reducedMotion, stop]);

  const start = () => {
    if (!previewUrl) return;
    if (playing && playing.owner !== self.current) playing.stop();
    playing = { owner: self.current, stop };
    setMounted(true);
    setOn(true);
    const v = video.current;
    if (v) {
      v.currentTime = 0;
      v.play().catch((err: DOMException) => {
        if (err.name !== "AbortError") console.error(`Preview of "${label}" did not play:`, err);
      });
    }
  };

  return (
    <div
      ref={root}
      className={`hover-preview relative overflow-hidden bg-card ${className}`}
      // Moved, not entered: see pointer.ts.
      onPointerMove={(e) => {
        if (canAutoPreview(e.pointerType, reducedMotion) && !on && pointerMoved()) {
          automatic.current = true;
          start();
        }
      }}
      onPointerLeave={(e) => e.pointerType === "mouse" && stop()}
    >
      {thumbnailUrl && (
        <img src={thumbnailUrl} alt="" loading="lazy" decoding="async" className="absolute inset-0 size-full object-cover" />
      )}
      {mounted && previewUrl && (
        <video
          ref={video}
          src={previewUrl}
          muted
          loop
          playsInline
          autoPlay
          preload="auto"
          aria-label={label}
          className="absolute inset-0 size-full object-cover"
          onPlaying={() => {
            if (on) root.current?.setAttribute("data-live", "");
          }}
        />
      )}
      {previewUrl && (
        <button
          type="button"
          aria-pressed={on}
          aria-label={`Preview ${label}`}
          onClick={() => {
            automatic.current = false;
            if (on) stop();
            else start();
          }}
          onBlur={stop}
          className="absolute inset-0 grid place-items-end justify-start p-2 focus-visible:outline-offset-[-2px]"
        >
          <span className={`grid size-7 place-items-center rounded-full bg-black/55 text-white backdrop-blur-md transition-opacity duration-150 ${on ? "opacity-0" : "opacity-100"}`}>
            <PlayIcon className="ml-px size-3" />
          </span>
        </button>
      )}
    </div>
  );
}
