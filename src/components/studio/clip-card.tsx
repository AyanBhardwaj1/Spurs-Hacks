"use client";

import { memo, useEffect, useMemo, useRef } from "react";
import { PlayIcon, CheckIcon } from "@/components/landing/icons";
import { linkedMoments, playersFor, reelStudioId, scoreBreakdown, seenOnCamera } from "@/lib/studio/clips";
import { scoreplayMediaUrl } from "@/lib/studio/links";
import { clipLength } from "@/lib/studio/time";
import type { Clip, Moment, Player } from "@/lib/studio/types";
import { AUDIENCE_LABEL, LANE_LABEL, PlayerStack, ScoreParts, SeenOnCamera, pct } from "./bits";
import { ClipFrame } from "./clip-frame";
import { canAutoPreview, pointerMoved } from "./pointer";
import { ReviewControl } from "./review-control";
import { useReducedMotion } from "./use-reduced-motion";

type Props = {
  clip: Clip;
  rank: number;
  momentsById: Map<string, Moment>;
  /** How many of the club's own edits each moment appears in. */
  clubEditCounts: Map<string, number>;
  roster: Player[];
  src: string;
  active: boolean;
  onActive: (id: string) => void;
  /** Stops this card's preview, and leaves another card's alone. */
  onRelease: (id: string) => void;
  onShowMoment: (momentId: string) => void;
  /** Shown inside its moment's row, where the moment's scores are already on screen: say why this edit instead. */
  inGroup?: boolean;
};

/** The frame the poster shows: just after the edit's first cut, so variants of one moment open differently. */
function posterTime(clip: Clip) {
  const first = clip.segments[0];
  return first.start + Math.min(1.5, (first.end - first.start) / 3);
}

export const ClipCard = memo(function ClipCard({
  clip,
  rank,
  momentsById,
  clubEditCounts,
  roster,
  src,
  active,
  onActive,
  onRelease,
  onShowMoment,
  inGroup = false,
}: Props) {
  const moments = useMemo(() => linkedMoments(clip, momentsById), [clip, momentsById]);
  const parts = scoreBreakdown(moments);
  const players = playersFor(
    moments.flatMap((m) => m.players),
    roster,
  );
  const clubEdits = Math.max(0, ...moments.map((m) => clubEditCounts.get(m.id) ?? 0));
  const fills = useRef<(HTMLElement | null)[]>([]);
  const titleId = `clip-${clip.id}-title`;
  const reducedMotion = useReducedMotion();
  const automatic = useRef(false);
  useEffect(() => {
    if (reducedMotion && automatic.current) onRelease(clip.id);
  }, [reducedMotion, onRelease, clip.id]);

  const onProgress = (elapsed: number) => {
    let at = 0;
    clip.segments.forEach((seg, i) => {
      const len = seg.end - seg.start;
      const el = fills.current[i];
      if (el) el.style.transform = `scaleX(${Math.min(1, Math.max(0, (elapsed - at) / len))})`;
      at += len;
    });
  };

  // Pointer previews play on hover; a keyboard or touch user presses the frame instead. Hover starts only
  // when the pointer moved (see pointer.ts), not when the page scrolled a card under it.
  return (
    <article
      id={`clip-${clip.id}`}
      aria-labelledby={titleId}
      data-active={active ? "" : undefined}
      className="clip-card flex flex-col rounded-[18px] p-2 pb-4"
      onPointerMove={(e) => {
        if (canAutoPreview(e.pointerType, reducedMotion) && !active && pointerMoved()) {
          automatic.current = true;
          onActive(clip.id);
        }
      }}
      onPointerLeave={(e) => e.pointerType === "mouse" && onRelease(clip.id)}
    >
      <div className="clip-stage">
        {/* Keep idle cards on sprite posters instead of opening competing MP4 range requests. */}
        <ClipFrame
          format={clip.format}
          segments={clip.segments}
          momentsById={momentsById}
          src={src}
          label={`Preview of ${clip.title}`}
          playing={active}
          restart
          loop
          posterAt={posterTime(clip)}
          onProgress={onProgress}
        />
        <button
          type="button"
          aria-pressed={active}
          aria-label={`Preview ${clip.title}, ${clip.format}, ${clipLength(clip.durationSec)}`}
          onClick={() => {
            automatic.current = false;
            if (active) onRelease(clip.id);
            else onActive(clip.id);
          }}
          onBlur={() => onRelease(clip.id)}
          className="absolute inset-0 rounded-[14px] focus-visible:outline-offset-[-2px]"
        />
        <span className="num pointer-events-none absolute left-5 top-5 text-[13px] font-semibold text-white/90 [text-shadow:0_1px_4px_rgb(0_0_0/0.6)]">
          {String(rank).padStart(2, "0")}
        </span>
        <span className="pointer-events-none absolute right-5 top-5 flex gap-1">
          {reelStudioId(clip) !== undefined && <span className="chip chip-film">Reel Studio edit available</span>}
          {clip.scoreplayMediaId && (
            <span className="chip chip-film gap-1 text-go">
              <CheckIcon className="size-3" />
              In ScorePlay
            </span>
          )}
          <span className="chip chip-film">{clip.format}</span>
        </span>
        <span className="clip-play pointer-events-none absolute inset-0 grid place-items-center" aria-hidden>
          <span className="grid size-11 place-items-center rounded-full bg-black/55 text-white backdrop-blur-md">
            <PlayIcon className="ml-0.5 size-4" />
          </span>
        </span>
        <div className="pointer-events-none absolute inset-x-5 bottom-5 flex items-center gap-2">
          <div className="seg-track flex-1" aria-hidden>
            {clip.segments.map((seg, i) => (
              <span key={i} style={{ flex: seg.end - seg.start }}>
                <i
                  ref={(el) => {
                    fills.current[i] = el;
                  }}
                />
              </span>
            ))}
          </div>
          <span className="chip chip-film num">{clipLength(clip.durationSec)}</span>
        </div>
      </div>

      <div className="flex flex-1 flex-col px-2 pt-3">
        <div className="flex items-center gap-1.5 text-caption text-secondary">
          <span className={`chip ${clip.lane === "asap" ? "bg-label text-page" : "bg-fill text-label"}`}>
            {LANE_LABEL[clip.lane]}
          </span>
          <span className="truncate">{clip.variant}</span>
          {clip.segments.length > 1 && <span className="shrink-0">· {clip.segments.length} cuts</span>}
        </div>
        <h3 id={titleId} className="mt-2 line-clamp-2 text-subhead font-semibold text-balance">
          {clip.title}
        </h3>
        {clip.audience && <p className="mt-0.5 text-caption font-semibold text-secondary">For {AUDIENCE_LABEL[clip.audience].toLowerCase()}</p>}

        <div className="mt-3 flex items-start gap-4">
          <div className="shrink-0">
            <p className="num text-[34px] font-semibold leading-none">{pct(clip.viralScore)}</p>
            <p className="mt-1 text-caption text-secondary">Viral score</p>
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            {inGroup ? (
              <p className="line-clamp-4 text-caption text-secondary">{clip.rationale}</p>
            ) : parts ? (
              <ScoreParts parts={parts} dense />
            ) : (
              <p className="text-caption text-secondary">No moment scores linked to this clip.</p>
            )}
          </div>
        </div>

        <p className="mt-3 line-clamp-2 text-footnote text-label/85">{clip.caption}</p>
        {clip.hashtags.length > 0 && (
          <p className="mt-1 truncate text-caption text-secondary">{clip.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}</p>
        )}

        <div className="mt-auto flex flex-col gap-2 pt-3">
          {!clip.scoreplayMediaId && <p className="text-caption font-semibold text-secondary">Planned, not rendered</p>}
          {clip.scoreplayMediaId && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-caption">
              <span className="font-semibold text-label">Rendered, in ScorePlay</span>
              <a
                href={scoreplayMediaUrl(clip.scoreplayMediaId)}
                target="_blank"
                rel="noreferrer"
                className="rounded-md font-semibold text-tint hover:underline"
              >
                Media {clip.scoreplayMediaId} <span aria-hidden>↗</span>
              </a>
              <a href={`#published-${clip.id}`} className="rounded-md font-semibold text-tint hover:underline">
                Compare with the plan
              </a>
            </p>
          )}
          {moments.some(seenOnCamera) && <SeenOnCamera className="text-caption font-semibold text-tint" />}
          {clubEdits > 0 && (
            <p className="flex items-center gap-1.5 text-caption font-semibold text-go">
              <CheckIcon className="size-3.5" />
              {clubEdits === 1 ? "Club clipped this too" : `Club clipped this too, in ${clubEdits} edits`}
            </p>
          )}
          <div className="flex items-center justify-between gap-3">
            <PlayerStack players={players} size={22} max={3} />
            {moments[0] && (
              <button
                type="button"
                onClick={() => onShowMoment(moments[0].id)}
                className="press shrink-0 rounded-md text-caption font-semibold text-tint hover:underline"
              >
                Why this moment
              </button>
            )}
          </div>
          <ReviewControl clip={clip} className="mt-1 border-t border-separator/60 pt-3" />
        </div>
      </div>
    </article>
  );
});
