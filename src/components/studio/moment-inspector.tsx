"use client";

import { CheckIcon, PlayIcon } from "@/components/landing/icons";
import { clubVideos, editorialOf, onCamera, playersFor, type EditorialLens } from "@/lib/studio/clips";
import { timecode } from "@/lib/studio/time";
import type { Clip, Evidence, GroundTruthClip, Moment, Player } from "@/lib/studio/types";
import type { ReactNode } from "react";
import { CameraIcon, EVIDENCE_LABEL, Eyebrow, KIND_LABEL, PlayerStack, ScoreParts, pct } from "./bits";

type Props = {
  moment: Moment;
  /** True when the writeback logged this moment, with its tags, onto the match in ScorePlay. */
  written: boolean;
  /** Moments in source order, for stepping. */
  ordered: Moment[];
  roster: Player[];
  clubClips: GroundTruthClip[];
  clips: Clip[];
  onSelect: (id: string) => void;
  onSeek: (t: number, play: boolean) => void;
  onShowClip: (id: string) => void;
};

const TEAM_LABEL: Record<Moment["team"], string> = { spurs: "Spurs", opponent: "Opponent", neutral: "Both sides" };

export function MomentInspector({ moment, written, ordered, roster, clubClips, clips, onSelect, onSeek, onShowClip }: Props) {
  const i = ordered.findIndex((m) => m.id === moment.id);
  const prev = ordered[i - 1];
  const next = ordered[i + 1];
  const evidence = [...moment.evidence].sort((a, b) => a.at - b.at);
  const seen = evidence.filter(onCamera);
  const heard = evidence.filter((e) => !onCamera(e));
  const commentary = heard.filter((e) => e.source === "commentary").length;
  const crowd = heard.filter((e) => e.source === "crowd-audio").length;
  const players = playersFor(moment.players, roster);
  const clubEdits = clubVideos(clubClips);
  const editorial = editorialOf(moment);

  return (
    <section aria-labelledby="moment-title" className="flex h-full flex-col rounded-[18px] bg-grouped">
      <div className="flex items-center justify-between gap-2 px-5 pt-4">
        <Eyebrow>
          Moment {i + 1} of {ordered.length}
        </Eyebrow>
        <div className="flex gap-1">
          <StepButton label="Earlier moment" disabled={!prev} onClick={() => prev && onSelect(prev.id)} dir="prev" />
          <StepButton label="Later moment" disabled={!next} onClick={() => next && onSelect(next.id)} dir="next" />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
        <div className="mt-3 flex items-baseline gap-3">
          {moment.matchClock && <span className="num text-[30px] font-semibold leading-none">{moment.matchClock}</span>}
          <span className="text-caption text-secondary">
            {KIND_LABEL[moment.kind]} · {TEAM_LABEL[moment.team]}
          </span>
        </div>
        <h2 id="moment-title" className="mt-2 text-title3 font-semibold text-balance">
          {moment.title}
        </h2>
        <p className="mt-1.5 line-clamp-3 text-footnote text-secondary text-pretty" title={moment.summary}>{moment.summary}</p>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <button
            type="button"
            onClick={() => onSeek(moment.start, true)}
            className="press inline-flex h-8 items-center gap-1.5 rounded-full bg-button px-3 text-caption font-semibold text-white hover:bg-button-hover"
          >
            <PlayIcon className="size-3" />
            Play from {timecode(moment.start)}
          </button>
          <span className="num text-caption text-secondary">
            {timecode(moment.start)}–{timecode(moment.end)} · peak {timecode(moment.peak)}
          </span>
        </div>

        {players.length > 0 && (
          <div className="mt-3">
            <PlayerStack players={players} size={24} />
          </div>
        )}

        <ul aria-label="Signals" className="mt-4 flex flex-wrap gap-1.5 border-t border-separator/60 pt-4 text-caption">
          <li className="rounded-full bg-fill px-2.5 py-1">
            Rank score <span className="num font-semibold text-label">{pct(moment.scores.total)}</span>
          </li>
          {commentary > 0 && (
            <li className="rounded-full bg-fill px-2.5 py-1">
              Commentary <span className="num font-semibold text-label">×{commentary}</span>
            </li>
          )}
          {crowd > 0 && <li className="rounded-full bg-fill px-2.5 py-1">Crowd rise</li>}
          {seen.length > 0 && (
            <li className="flex items-center gap-1 rounded-full bg-tint-fill px-2.5 py-1 font-semibold text-tint">
              <CameraIcon className="size-3.5" />
              Seen on camera · Twelve Labs
            </li>
          )}
        </ul>

        {(moment.description || (moment.tags && moment.tags.length > 0)) && (
          <div className="mt-4 rounded-xl bg-tint-fill/60 px-3 py-2.5">
            {moment.description && (
              <>
                <p className="flex items-center gap-1.5 text-caption font-semibold text-tint">
                  <CameraIcon className="size-3.5" />
                  Described by Twelve Labs Pegasus
                </p>
                <p className="mt-1 line-clamp-4 text-footnote text-label" title={moment.description}>
                  {moment.description}
                </p>
              </>
            )}
            {moment.tags && moment.tags.length > 0 && (
              <p className="mt-1.5 text-caption text-secondary">
                {written ? "Tags written to ScorePlay: " : "Proposed tags (not written): "}
                <span className="text-label">{moment.tags.join(" · ")}</span>
              </p>
            )}
          </div>
        )}

        {editorial && <EditorialReview lens={editorial} />}

        <h3 className="mt-5 text-footnote font-semibold">Why it was picked</h3>
        {evidence.length === 0 ? (
          <p className="mt-1 text-caption text-secondary">The run recorded no evidence for this moment.</p>
        ) : (
          <>
            {seen.length > 0 && (
              <EvidenceList
                title={
                  <>
                    <CameraIcon className="size-3.5 text-tint" />
                    Seen on camera: Twelve Labs search of the match video
                  </>
                }
                items={seen}
                onSeek={onSeek}
              />
            )}
            {heard.length > 0 && <EvidenceList title="Heard: commentary and crowd" items={heard} onSeek={onSeek} />}
          </>
        )}

        <h3 className="mt-5 text-footnote font-semibold">
          {clubEdits.length > 1 ? `In ${clubEdits.length} club edits` : <>The club&rsquo;s own clips</>}
        </h3>
        {clubEdits.length > 0 ? (
          <ul className="mt-1.5 space-y-1">
            {clubEdits.map((v) => (
              <li key={v.scoreplayId} className="flex items-start gap-2 text-footnote">
                <CheckIcon className="mt-0.5 size-4 shrink-0 text-go" />
                <span>
                  Tottenham&rsquo;s team used it in <span className="font-semibold">{v.name}</span>
                  <span className="text-secondary">
                    {" "}
                    · located by {v.ranges[0].alignedBy}, {pct(Math.max(...v.ranges.map((r) => r.confidence)))}% sure
                  </span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-footnote text-secondary">None of the club&rsquo;s clips covers this moment.</p>
        )}

        <div className="mt-5 flex items-start gap-4 border-t border-separator/60 pt-4">
          <div className="shrink-0">
            <p className="num text-[30px] font-semibold leading-none">{pct(moment.scores.total)}</p>
            <p className="mt-1 text-caption text-secondary">Rank score</p>
          </div>
          <div className="min-w-0 flex-1 pt-0.5">
            <ScoreParts parts={moment.scores} />
          </div>
        </div>

        {clips.length > 0 && (
          <>
            <h3 className="mt-5 text-footnote font-semibold">Planned clips</h3>
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {clips.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onShowClip(c.id)}
                    className="press inline-flex h-7 max-w-[260px] items-center gap-1.5 rounded-full bg-fill px-2.5 text-caption text-label hover:bg-separator"
                  >
                    <span className="num text-secondary">{c.format}</span>
                    <span className="truncate">{c.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

function StepButton({ label, disabled, onClick, dir }: { label: string; disabled: boolean; onClick: () => void; dir: "prev" | "next" }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="press grid size-8 place-items-center rounded-full bg-fill text-label hover:bg-separator disabled:opacity-35"
    >
      <svg aria-hidden viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
        <path d={dir === "prev" ? "M10 3 5 8l5 5" : "M6 3l5 5-5 5"} />
      </svg>
    </button>
  );
}

// A Twelve Labs search line reads '"<query>" found at 366-376 s, rank 10 of the match'; the query is the
// part worth reading, so it leads.
const QUERY = /^"(.+?)"\s*(.*)$/;

function EvidenceList({ title, items, onSeek }: { title: ReactNode; items: Evidence[]; onSeek: (t: number, play: boolean) => void }) {
  return (
    <div className="mt-2">
      <p className="flex items-center gap-1.5 px-2 text-caption font-semibold text-secondary">{title}</p>
      <ol className="mt-1 space-y-0.5">
        {items.map((e, k) => {
          const query = onCamera(e) ? QUERY.exec(e.detail) : null;
          return (
            <li key={k}>
              <button
                type="button"
                onClick={() => onSeek(Math.max(0, e.at - 3), true)}
                className="press grid w-full grid-cols-[auto_1fr] gap-x-3 rounded-lg px-2 py-1.5 text-left hover:bg-fill"
              >
                <span className="num pt-px text-caption text-tint">{timecode(e.at)}</span>
                <span className="min-w-0">
                  <span className="flex items-center gap-2 text-caption text-secondary">
                    {EVIDENCE_LABEL[e.source]}
                    <span className="score-bar w-10" aria-label={`strength ${pct(e.strength)} of 100`}>
                      <i style={{ transform: `scaleX(${e.strength})` }} />
                    </span>
                  </span>
                  {query ? (
                    <span className="block text-footnote">
                      <span className="text-label">&ldquo;{query[1]}&rdquo;</span> <span className="text-secondary">{query[2]}</span>
                    </span>
                  ) : (
                    <span className="block text-footnote text-label">{e.detail}</span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

const LENS: { key: "importance" | "excitement" | "watchability"; label: string }[] = [
  { key: "importance", label: "Importance" },
  { key: "excitement", label: "Excitement" },
  { key: "watchability", label: "Watchability" },
];

// MatchWatch's editorial review of the moment, from Feria & Hamid's MatchWatch prompts. It sits beside
// the ranking and does not change it, so it is labelled as a second opinion rather than as a score part.
function EditorialReview({ lens }: { lens: EditorialLens }) {
  return (
    <div className="mt-4 rounded-xl border border-separator/70 px-3 py-2.5">
      <p className="text-caption font-semibold text-label">MatchWatch editorial review</p>
      <dl className="mt-1.5 grid grid-cols-[auto_1fr_auto] items-center gap-x-2 gap-y-1">
        {LENS.map(({ key, label }) => {
          const v = lens[key];
          return (
            <div key={key} className="contents">
              <dt className="text-caption text-secondary">{label}</dt>
              <dd className="score-bar" aria-hidden>
                {v !== null && <i style={{ transform: `scaleX(${v})` }} />}
              </dd>
              <dd className="num w-14 text-right text-caption text-label">{v === null ? "unknown" : pct(v)}</dd>
            </div>
          );
        })}
      </dl>
      {lens.flags.length > 0 && (
        <p className="mt-1.5 text-caption text-secondary">
          Flags: <span className="text-label">{lens.flags.join(" · ")}</span>
        </p>
      )}
      <p className="mt-1 text-[11px] text-secondary">Shown beside the ranking; it does not change it.</p>
    </div>
  );
}
