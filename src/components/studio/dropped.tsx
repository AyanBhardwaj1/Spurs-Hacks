"use client";

import { useState } from "react";
import { PlayIcon } from "@/components/landing/icons";
import { timecode } from "@/lib/studio/time";
import type { Moment, Rejected } from "@/lib/studio/types";
import { KIND_LABEL, SectionTitle } from "./bits";

type Props = {
  rejected: Rejected[];
  momentsById: Map<string, Moment>;
  onOpenMoment: (id: string) => void;
  onSeek: (t: number, play: boolean) => void;
};

const SOURCES: { key: Rejected["source"]; label: string; blurb: string }[] = [
  { key: "ranking", label: "Ranked below the cut", blurb: "Moments the run found and scored, but did not plan a clip from." },
  { key: "twelvelabs-search", label: "Seen on camera, unpaired", blurb: "Twelve Labs search hits that no commentary moment backs up." },
  { key: "commentary", label: "Commentary it declined", blurb: "Things the commentators called that the run did not keep as moments." },
];

const SHOWN = 6;

// "A producer's first question is always what did it skip, and why." Everything the run weighed and
// dropped, grouped by where the candidate came from, each with the reason and a way to look at it.
export function Dropped({ rejected, momentsById, onOpenMoment, onSeek }: Props) {
  const groups = SOURCES.map((s) => ({ ...s, items: rejected.filter((r) => r.source === s.key) })).filter((g) => g.items.length > 0);

  return (
    <section aria-labelledby="dropped-title">
      <SectionTitle eyebrow="Considered and dropped" title="What it left out, and why" id="dropped-title" />
      {rejected.length === 0 ? (
        <p className="mt-3 max-w-[64ch] text-footnote text-secondary">
          This run did not record what it considered and dropped. The pipeline writes that list with each candidate&rsquo;s
          reason; a run made after it was added will show it here.
        </p>
      ) : (
        <>
          <p className="mt-2 max-w-[64ch] text-footnote text-secondary">
            {rejected.length} candidates the run weighed and dropped, each with its reason, so a producer can catch the one it
            got wrong. Grey ticks on the timeline above mark where they sit.
          </p>
          <div className="mt-6 grid grid-cols-1 items-start gap-6 lg:grid-cols-3">
            {groups.map((g) => (
              <Group key={g.key} label={g.label} blurb={g.blurb} items={g.items} momentsById={momentsById} onOpenMoment={onOpenMoment} onSeek={onSeek} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Group({
  label,
  blurb,
  items,
  momentsById,
  onOpenMoment,
  onSeek,
}: {
  label: string;
  blurb: string;
  items: Rejected[];
  momentsById: Map<string, Moment>;
  onOpenMoment: (id: string) => void;
  onSeek: (t: number, play: boolean) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, SHOWN);
  return (
    <div className="rounded-[18px] bg-grouped p-4">
      <h3 className="flex items-baseline justify-between gap-3 px-1 text-subhead font-semibold">
        {label}
        <span className="num text-caption font-normal text-secondary">{items.length}</span>
      </h3>
      <p className="mt-0.5 px-1 text-caption text-secondary">{blurb}</p>
      <ol className="mt-3 space-y-1">
        {shown.map((r, i) => (
          <Row key={`${r.at}-${i}`} item={r} moment={r.momentId ? momentsById.get(r.momentId) : undefined} onOpenMoment={onOpenMoment} onSeek={onSeek} />
        ))}
      </ol>
      {items.length > SHOWN && (
        <button type="button" onClick={() => setAll((a) => !a)} className="press mt-2 rounded-md px-1 text-caption font-semibold text-tint hover:underline">
          {all ? "Show fewer" : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}

function Row({
  item,
  moment,
  onOpenMoment,
  onSeek,
}: {
  item: Rejected;
  moment?: Moment;
  onOpenMoment: (id: string) => void;
  onSeek: (t: number, play: boolean) => void;
}) {
  const [asked, setAsked] = useState(false);
  const start = moment ? moment.start : Math.max(0, item.at - 3);
  return (
    <li className="rounded-xl px-2 py-2 hover:bg-fill/60">
      <div className="flex items-baseline gap-2">
        <button
          type="button"
          onClick={() => onSeek(start, true)}
          aria-label={`Play ${item.title} from ${timecode(start)}`}
          className="press num inline-flex shrink-0 items-center gap-1 rounded-md text-caption text-tint hover:underline"
        >
          <PlayIcon className="size-2.5" />
          {moment?.matchClock ?? timecode(item.at)}
        </button>
        <p className="min-w-0 text-footnote font-semibold">
          {item.title}
          {item.kind && <span className="font-normal text-secondary"> · {KIND_LABEL[item.kind]}</span>}
        </p>
      </div>
      <p className="mt-1 line-clamp-3 text-caption text-secondary" title={item.reason}>
        {item.reason}
      </p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => {
            setAsked(true);
            if (moment) onOpenMoment(moment.id);
            onSeek(start, true);
          }}
          className="press rounded-md text-caption font-semibold text-tint hover:underline"
        >
          Make a clip anyway
        </button>
        {asked && (
          <span role="status" className="text-caption text-secondary">
            {moment ? "Opened as a moment in the monitor." : "Playing in the monitor."} Planning a new clip from here isn&rsquo;t wired up
            yet; the pipeline plans clips.
          </span>
        )}
      </div>
    </li>
  );
}
