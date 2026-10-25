/* eslint-disable @next/next/no-img-element -- Player photos and thumbnails come from ScorePlay's CDN; next/image would need remotePatterns in next.config.ts, which the studio does not own. */
import type { ReactNode } from "react";
import { SCORE_PARTS, type ScoreParts } from "@/lib/studio/clips";
import type { Audience, Clip, Evidence, MomentKind, Player } from "@/lib/studio/types";

export const KIND_LABEL: Record<MomentKind, string> = {
  goal: "Goal",
  "disallowed-goal": "Disallowed goal",
  chance: "Chance",
  save: "Save",
  card: "Card",
  skill: "Skill",
  tackle: "Tackle",
  celebration: "Celebration",
  kickoff: "Kick-off",
  "full-time": "Full time",
  other: "Moment",
};

export const EVIDENCE_LABEL: Record<Evidence["source"], string> = {
  commentary: "Commentary",
  "crowd-audio": "Crowd audio",
  "twelvelabs-search": "Twelve Labs search",
  "twelvelabs-analysis": "Twelve Labs Pegasus",
  social: "Social",
};

/** Who an edit is for, in the brief's words. */
export const AUDIENCE_LABEL: Record<Audience, string> = {
  "match-fans": "Match fans",
  "season-ticket-holder": "Season ticket holders",
  sponsor: "Sponsor",
  international: "International fans",
};

export const LANE_LABEL: Record<Clip["lane"], string> = {
  asap: "ASAP",
  "post-match": "Post-match",
};

/** Marks evidence that came from searching the video with Twelve Labs. */
export function CameraIcon({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <rect x="1.5" y="4" width="9.5" height="8" rx="1.8" />
      <path d="M11 7l3.5-2v6L11 9" />
    </svg>
  );
}

/** "Seen on camera": a Twelve Labs visual search of the match found this moment. */
export function SeenOnCamera({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} title="Confirmed by a Twelve Labs search of the match video">
      <CameraIcon className="size-3.5" />
      Seen on camera · Twelve Labs
    </span>
  );
}

/** A 0-to-1 score as the whole number the studio shows, 0 to 100. */
export const pct = (v: number) => Math.round(v * 100);

export function Avatar({ player, size = 24 }: { player: Player; size?: number }) {
  const initials = player.shortName.slice(0, 2);
  return (
    <span
      className="relative inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-fill text-[10px] font-semibold text-secondary ring-2 ring-page"
      style={{ width: size, height: size }}
      title={player.name}
    >
      <span aria-hidden>{initials}</span>
      {player.photoUrl && (
        <img
          src={player.photoUrl}
          alt=""
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover object-top"
        />
      )}
    </span>
  );
}

export function PlayerStack({ players, size = 24, max = 4 }: { players: Player[]; size?: number; max?: number }) {
  if (players.length === 0) return null;
  const shown = players.slice(0, max);
  const names = players.map((p) => p.shortName).join(", ");
  return (
    <span className="flex items-center gap-2 min-w-0">
      <span className="flex -space-x-1.5" aria-hidden>
        {shown.map((p) => (
          <Avatar key={p.id} player={p} size={size} />
        ))}
      </span>
      <span className="truncate text-caption text-secondary">
        <span className="sr-only">Players: </span>
        {names}
      </span>
    </span>
  );
}

/** Four labelled bars, each 0 to 100, legible from the back of a room. */
export function ScoreParts({ parts, dense = false }: { parts: ScoreParts; dense?: boolean }) {
  return (
    <dl className={`grid grid-cols-[auto_1fr_auto] items-center gap-x-2 ${dense ? "gap-y-1" : "gap-y-1.5"}`}>
      {SCORE_PARTS.map(({ key, label }) => (
        <div key={key} className="contents">
          <dt className="text-caption text-secondary">{label}</dt>
          <dd className="score-bar" aria-hidden>
            <i style={{ transform: `scaleX(${parts[key]})` }} />
          </dd>
          <dd className="num text-caption text-label w-6 text-right">{pct(parts[key])}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-caption font-semibold uppercase tracking-[0.06em] text-secondary">{children}</p>;
}

export function SectionTitle({ eyebrow, title, children, id }: { eyebrow: string; title: string; children?: ReactNode; id?: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 id={id} className="mt-1 text-title2 font-semibold text-balance">
          {title}
        </h2>
      </div>
      {children}
    </div>
  );
}
