import "server-only";

import { addMediaTags, addVideoLogs, findOrCreateTagOption, type SpVideoLog } from "../scoreplay";
import type { Moment, Proposal, Spike, Writeback } from "./types";

// What Rundown writes onto ScorePlay assets, so a decision is searchable in
// the club's own system. Every tag starts with `rundown` so the team can
// filter or delete our writes in one query. Agree changes with ScorePlay
// staff on site before writing new tag names.

export const TAXONOMY = {
  root: "rundown",
  approved: "rundown-approved",
  spiked: "rundown-spiked",
  rescued: "rundown-rescued",
  moment: "rundown-moment",
  /** On clips Rundown rendered and uploaded. */
  render: "rundown-render",
  platform: (p: string) => `rundown-platform-${p.toLowerCase().replace(/\s+/g, "-")}`,
  audience: (a: string) => `rundown-audience-${a}`,
  format: (aspect: string, kind: string) => `rundown-format-${aspect.replace(":", "x")}-${kind}`,
  kind: (k: string) => `rundown-kind-${k}`,
  reason: (r: string) => `rundown-spike-${r}`,
  /** Media-level tag on any asset with an approved piece, for media search. */
  approvedAssetTag: { name: "rundown-approved", label: "Rundown: approved piece" },
  /** Media-level tag on a rendered clip the producer handed to the social team. */
  readyToPost: { name: "rundown-ready-to-post", label: "Rundown: ready to post" },
} as const;

async function write(companyId: number, logs: SpVideoLog[], tagAssets: string[] = []): Promise<Writeback> {
  const at = new Date().toISOString();
  const tags = [...new Set(logs.flatMap((l) => l.raw_tags ?? []))];
  const assetIds = [...new Set(logs.map((l) => String(l.media_id)))];
  try {
    await addVideoLogs(companyId, logs);
    if (tagAssets.length) {
      const option = await findOrCreateTagOption(TAXONOMY.approvedAssetTag.name, TAXONOMY.approvedAssetTag.label);
      await Promise.all(tagAssets.map((id) => addMediaTags(Number(id), { tag_option_ids: [option.ID] })));
    }
    return { at, assetIds, tags, ok: true };
  } catch (err) {
    return { at, assetIds, tags, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** One timecoded action per segment of the cut, on that segment's source asset. */
export function writeApproval(companyId: number, p: Proposal) {
  const tags = [
    TAXONOMY.root,
    TAXONOMY.approved,
    TAXONOMY.audience(p.audience),
    TAXONOMY.format(p.format.aspect, p.format.kind),
    ...(p.rescuedFrom ? [TAXONOMY.rescued] : []),
  ];
  const logs = p.cut.map((seg) => ({
    media_id: Number(seg.assetId),
    start_offset: seg.start,
    end_offset: seg.end,
    comment: `Rundown approved: ${p.title}. ${p.format.aspect}, ${p.format.lengthSec}s${seg.note ? `, ${seg.note.toLowerCase()}` : ""}. ${p.caption}`,
    raw_tags: tags,
  }));
  return write(companyId, logs, [...new Set(p.cut.map((s) => s.assetId))]);
}

/** A producer spiking a proposal. The note, if any, goes in the comment. */
export function writeProducerSpike(companyId: number, p: Proposal) {
  const seg = p.cut[0];
  return write(companyId, [
    {
      media_id: Number(seg.assetId),
      start_offset: seg.start,
      end_offset: seg.end,
      comment: `Rundown proposal spiked by producer: ${p.title}.${p.spikeReason ? ` ${p.spikeReason}` : ""}`,
      raw_tags: [TAXONOMY.root, TAXONOMY.spiked, TAXONOMY.audience(p.audience)],
    },
  ]);
}

/** Rundown's own rejection, so the next search shows why the moment was passed over. */
export function writeSpike(companyId: number, s: Spike) {
  return write(companyId, [
    {
      media_id: Number(s.segment.assetId),
      start_offset: s.segment.start,
      end_offset: s.segment.end,
      comment: `Rundown passed on ${s.title}: ${s.detail}`,
      raw_tags: [TAXONOMY.root, TAXONOMY.spiked, TAXONOMY.reason(s.reason), TAXONOMY.kind(s.kind)],
    },
  ]);
}

/** Every moment Twelve Labs found, as searchable timecoded actions. */
export function writeMoments(companyId: number, moments: Moment[]) {
  return write(
    companyId,
    moments.map((m) => ({
      media_id: Number(m.primary.assetId),
      start_offset: m.primary.start,
      end_offset: m.primary.end,
      comment: m.analysis?.description ?? m.title,
      raw_tags: [TAXONOMY.root, TAXONOMY.moment, TAXONOMY.kind(m.kind)],
    })),
  );
}
