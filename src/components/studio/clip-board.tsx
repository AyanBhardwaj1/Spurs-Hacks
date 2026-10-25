"use client";

import { useMemo, useState, type ReactNode } from "react";
import { CheckIcon } from "@/components/landing/icons";
import { momentGroups, seenOnCamera, type MomentGroup } from "@/lib/studio/clips";
import { timecode } from "@/lib/studio/time";
import type { Audience, Clip, Moment, Player } from "@/lib/studio/types";
import { AUDIENCE_LABEL, KIND_LABEL, SeenOnCamera, SectionTitle, pct } from "./bits";
import { ClipCard } from "./clip-card";
import { ScorePlayNote } from "./extras";
import { ReelStudioEdits } from "./reel-studio";

export type ClipView = "moment" | "ranked";

type Props = {
  ranked: Clip[];
  momentsById: Map<string, Moment>;
  clubEditCounts: Map<string, number>;
  roster: Player[];
  src: string;
  view: ClipView;
  onView: (view: ClipView) => void;
  activeClip: string | null;
  onActive: (id: string) => void;
  onRelease: (id: string) => void;
  onShowMoment: (id: string) => void;
};

const BEST = 5;

const grid = "grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-x-3 gap-y-6";

// The planned clips two ways: grouped by moment, so the several edits of one moment read as a set, or as
// one ranked grid.
export function ClipBoard({ ranked: allRanked, momentsById, clubEditCounts, roster, src, view, onView, activeClip, onActive, onRelease, onShowMoment }: Props) {
  const [audience, setAudience] = useState<Audience | "all">("all");
  const audiences = useMemo(() => {
    const counts = new Map<Audience, number>();
    for (const c of allRanked) if (c.audience) counts.set(c.audience, (counts.get(c.audience) ?? 0) + 1);
    const order = Object.keys(AUDIENCE_LABEL);
    return [...counts].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b)).map(([key, count]) => ({ key, count }));
  }, [allRanked]);
  // One audience shows its best few by viral score: "the right five options in front of a producer".
  const [showAll, setShowAll] = useState(false);
  const forAudience = useMemo(() => (audience === "all" ? allRanked : allRanked.filter((c) => c.audience === audience)), [allRanked, audience]);
  const capped = audience !== "all" && !showAll && forAudience.length > BEST;
  const ranked = useMemo(() => (capped ? forAudience.slice(0, BEST) : forAudience), [capped, forAudience]);
  const { groups, others } = useMemo(() => momentGroups(ranked, momentsById), [ranked, momentsById]);
  const rankOf = useMemo(() => new Map(allRanked.map((c, i) => [c.id, i + 1])), [allRanked]);
  const renderedCount = allRanked.filter((c) => c.scoreplayMediaId).length;
  const variants = groups.reduce((n, g) => n + g.clips.length, 0);

  const card = (clip: Clip, inGroup = false) => (
    <ClipCard
      inGroup={inGroup}
      key={clip.id}
      clip={clip}
      rank={rankOf.get(clip.id) ?? 0}
      momentsById={momentsById}
      clubEditCounts={clubEditCounts}
      roster={roster}
      src={src}
      active={activeClip === clip.id}
      onActive={onActive}
      onRelease={onRelease}
      onShowMoment={onShowMoment}
    />
  );

  const title =
    groups.length > 0
      ? `${variants} edits of the top ${groups.length} moments, and ${others.length} more`
      : `${ranked.length} planned clips`;

  return (
    <section aria-labelledby="clips-title">
      <SectionTitle eyebrow="Planned clips" title={title} id="clips-title">
        <div role="group" aria-label="Arrange clips" className="flex rounded-full bg-fill p-0.5">
          {(
            [
              ["moment", "By moment"],
              ["ranked", "Ranked"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={view === key}
              onClick={() => onView(key)}
              className="h-8 rounded-full px-3.5 text-caption font-semibold text-secondary transition-colors duration-150 hover:text-label aria-pressed:bg-card aria-pressed:text-label"
            >
              {label}
            </button>
          ))}
        </div>
      </SectionTitle>
      <p className="mt-2 max-w-[64ch] text-footnote text-secondary">
        Each plan plays straight from the source, cut and reframed in the browser. Numbers are the rank by viral score.{" "}
        {renderedCount === allRanked.length
          ? "Every one was also rendered and uploaded to ScorePlay."
          : renderedCount === 0
            ? "None has been rendered yet."
            : `${renderedCount} of ${allRanked.length} were also rendered and uploaded to ScorePlay; the other ${allRanked.length - renderedCount} are planned, not rendered.`}
      </p>

      <ScorePlayNote part="uploads" className="mt-2" />
      <ReelStudioEdits clips={allRanked} activeId={activeClip} onActive={onActive} onRelease={onRelease} />

      {audiences.length > 0 && (
        <div role="group" aria-label="Show clips for" className="mt-4 flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-caption text-secondary">For</span>
          {[{ key: "all" as const, label: "Everyone", count: allRanked.length }, ...audiences.map((a) => ({ ...a, label: AUDIENCE_LABEL[a.key] }))].map(
            (a) => (
              <button
                key={a.key}
                type="button"
                aria-pressed={audience === a.key}
                onClick={() => {
                  setAudience(a.key);
                  setShowAll(false);
                }}
                className="press inline-flex h-8 items-center gap-1.5 rounded-full border border-separator px-3 text-caption font-semibold text-secondary hover:text-label aria-pressed:border-label aria-pressed:bg-label aria-pressed:text-page"
              >
                {a.label}
                <span className="num font-normal">{a.count}</span>
              </button>
            ),
          )}
        </div>
      )}

      {audience !== "all" && forAudience.length > 0 && (
        <p className="mt-4 text-footnote text-secondary">
          {capped
            ? `The ${BEST} best of ${forAudience.length} for ${AUDIENCE_LABEL[audience].toLowerCase()}, by viral score.`
            : `All ${forAudience.length} for ${AUDIENCE_LABEL[audience].toLowerCase()}, by viral score.`}
        </p>
      )}

      {ranked.length === 0 ? (
        <p className="mt-6 text-footnote text-secondary">No clips for this audience.</p>
      ) : view === "ranked" ? (
        <div className={`mt-6 ${grid}`}>{ranked.map((c) => card(c))}</div>
      ) : (
        <>
          {groups.map((g) => (
            <MomentRow key={g.moment.id} group={g} clubEdits={clubEditCounts.get(g.moment.id) ?? 0} onShowMoment={onShowMoment}>
              <div className={grid}>{g.clips.map((c) => card(c, true))}</div>
            </MomentRow>
          ))}
          {others.length > 0 && (
            <div className="mt-10">
              <h3 className="text-subhead font-semibold">One edit each</h3>
              <div className={`mt-3 ${grid}`}>{others.map((c) => card(c))}</div>
            </div>
          )}
        </>
      )}
      {audience !== "all" && forAudience.length > BEST && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="press mt-6 rounded-md text-footnote font-semibold text-tint hover:underline"
        >
          {showAll ? `Show the ${BEST} best` : `Show all ${forAudience.length} for ${AUDIENCE_LABEL[audience].toLowerCase()}`}
        </button>
      )}
    </section>
  );
}

function MomentRow({
  group,
  clubEdits,
  onShowMoment,
  children,
}: {
  group: MomentGroup;
  clubEdits: number;
  onShowMoment: (id: string) => void;
  children: ReactNode;
}) {
  const { moment, clips } = group;
  const formats = [...new Set(clips.map((c) => c.format))].join(" and ");
  return (
    <div className="mt-8 first-of-type:mt-6" data-moment-row={moment.id}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t border-separator/60 pb-3 pt-4">
        <span className="num text-[28px] font-semibold leading-none">{moment.matchClock ?? timecode(moment.peak)}</span>
        <div className="min-w-0 flex-1">
          <h3 className="text-title3 font-semibold text-balance">{moment.title}</h3>
          <p className="mt-0.5 text-caption text-secondary">
            {KIND_LABEL[moment.kind]} · {clips.length} edits, {formats} · rank score{" "}
            <span className="num text-label">{pct(moment.scores.total)}</span>
          </p>
        </div>
        <div className="flex items-center gap-3 text-caption">
          {seenOnCamera(moment) && <SeenOnCamera className="font-semibold text-tint" />}
          {clubEdits > 0 && (
            <span className="flex items-center gap-1 font-semibold text-go">
              <CheckIcon className="size-3.5" />
              {clubEdits === 1 ? "Club clipped it too" : `In ${clubEdits} club edits`}
            </span>
          )}
          <button type="button" onClick={() => onShowMoment(moment.id)} className="press rounded-md font-semibold text-tint hover:underline">
            Why this moment
          </button>
        </div>
      </div>
      {children}
    </div>
  );
}
