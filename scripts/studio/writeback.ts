import { closeSync, mkdirSync, openSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import type { MatchAnalysis, Moment } from "../../src/lib/studio/types";
import type { SpVideoLogEntry } from "../../src/lib/scoreplay";
import { cachePath, hashOf, readCache } from "./cache";

const SOURCE_ID = 130852725;
type Receipt = { state: "pending" | "written"; momentId: string };
type Journal = { mediaId: number; logs: Record<string, Receipt>; confirmed?: MatchAnalysis["writeback"] };
type Confirmed = NonNullable<MatchAnalysis["writeback"]>;
export type WritebackResult = { kind: "confirmed"; confirmed: Confirmed } | { kind: "rehearsal"; videoLogs: number; tags: string[]; confirmed?: Confirmed };

export function rehearsalWriteback(targets: Moment[], videoLogs: number, confirmed?: Confirmed): WritebackResult {
  return { kind: "rehearsal", videoLogs, tags: [...new Set(targets.flatMap((m) => m.tags ?? []))].sort(), confirmed };
}

export function applyWriteback(analysis: Pick<MatchAnalysis, "source" | "writeback">, result: WritebackResult): void {
  analysis.writeback = result.confirmed;
  if (result.confirmed) analysis.source.tags = [...new Set([...analysis.source.tags, ...result.confirmed.tags])];
}

// The marker survives a lost HTTP response, so a rerun can recover a successful write from ScorePlay.
export function writebackKey(mediaId: number, moment: Pick<Moment, "id" | "start" | "end">): string {
  return `rundown:${mediaId}:${hashOf(moment.id, String(moment.start), String(moment.end))}`;
}

export function pendingLogs(moments: Moment[], remote: Pick<SpVideoLogEntry, "comment">[], journal: Journal["logs"]): Moment[] {
  return moments.filter((m) => {
    const key = writebackKey(SOURCE_ID, m);
    if (remote.some((log) => log.comment?.includes(`[${key}]`))) return false;
    if (journal[key]) throw new Error(`Writeback ${key} has a ${journal[key].state} receipt but is absent from ScorePlay; reconcile it before another write`);
    return true;
  });
}

function save(journal: Journal) {
  const path = cachePath("writeback.json");
  writeFileSync(`${path}.tmp`, JSON.stringify(journal, null, 2));
  renameSync(`${path}.tmp`, path);
}

function logCount(response: { items: SpVideoLogEntry[]; total?: number }): number {
  // This workspace's endpoint returns page/limit, without the total declared by the app client.
  const count = response.total ?? response.items.length;
  if (count > response.items.length || response.items.length >= 200) throw new Error(`ScorePlay returned ${response.items.length} logs; refusing a potentially incomplete duplicate check`);
  return count;
}

export async function writeback(moments: Moment[]): Promise<WritebackResult> {
  const targets = [...moments].sort((a, b) => b.scores.total - a.scores.total || a.peak - b.peak).slice(0, 30);
  const journal = readCache<Journal>("writeback.json") ?? { mediaId: SOURCE_ID, logs: {} };
  if (journal.mediaId !== SOURCE_ID) throw new Error(`Writeback journal belongs to media ${journal.mediaId}`);
  if (process.env.STUDIO_CACHE_ONLY === "1") {
    if (process.env.STUDIO_NO_WRITES === "1") {
      console.log(`[writeback] STUDIO_NO_WRITES: rehearsal of ${targets.length} logs using cached receipts; no writes`);
      return rehearsalWriteback(targets, journal.confirmed?.videoLogs ?? 0, journal.confirmed);
    }
    if (!journal.confirmed || targets.some((m) => journal.logs[writebackKey(SOURCE_ID, m)]?.state !== "written")) throw new Error("STUDIO_CACHE_ONLY is set and writeback has not been confirmed");
    return { kind: "confirmed", confirmed: journal.confirmed };
  }
  mkdirSync(cachePath(""), { recursive: true });
  const lock = cachePath("writeback.lock");
  const fd = openSync(lock, "wx");
  try {
    const { scoreplay } = await import("./server-modules");
    const before = await scoreplay.listVideoLogs(SOURCE_ID);
    logCount(before);
    // A timed rehearsal from an empty cache can place moments a second differently, which gives new
    // keys and would write near-duplicate logs, so STUDIO_NO_WRITES reports the writes and makes none.
    if (process.env.STUDIO_NO_WRITES === "1") {
      const missing = targets.filter((m) => !before.items.some((log) => log.comment?.includes(`[${writebackKey(SOURCE_ID, m)}]`)));
      console.log(`[writeback] STUDIO_NO_WRITES: would write ${missing.length} of ${targets.length} logs; ${logCount(before)} already on media ${SOURCE_ID}`);
      return rehearsalWriteback(targets, logCount(before), journal.confirmed);
    }
    const missing = pendingLogs(targets, before.items, journal.logs);
    const media = await scoreplay.getMedia(SOURCE_ID);
    if (!Number.isInteger(media.company_id) || media.company_id <= 0) throw new Error("ScorePlay source has no company_id for /video/logs");
    for (const moment of missing) {
      const key = writebackKey(SOURCE_ID, moment);
      journal.logs[key] = { state: "pending", momentId: moment.id };
      save(journal);
      const written = await scoreplay.addVideoLogs(media.company_id, [{
        media_id: SOURCE_ID, start_offset: moment.start, end_offset: moment.end,
        comment: `${moment.title}\nKind: ${moment.kind}\n${moment.evidence.map((e) => `${e.source}: ${e.detail}`).join("\n")}\n[${key}]`,
        raw_tags: moment.tags, player_ids: moment.players,
      }]);
      if (written !== true) throw new Error(`ScorePlay /video/logs did not confirm ${key}: ${JSON.stringify(written)}`);
      journal.logs[key].state = "written";
      save(journal);
    }
    const tags = [...new Set(targets.flatMap((m) => m.tags ?? []))].sort();
    const tagIds: number[] = [];
    for (const name of tags) {
      const result = await scoreplay.tagSearch(name);
      const tag = result.tags.find((t) => t.name.toLowerCase() === name.toLowerCase());
      if (!tag) throw new Error(`ScorePlay /video/logs did not create taxonomy tag "${name}"`);
      if (!media.tags?.some((t) => t.tag_option_id === tag.ID || t.tag_option?.ID === tag.ID)) tagIds.push(tag.ID);
    }
    if (tagIds.length) await scoreplay.addMediaTags(SOURCE_ID, { tag_option_ids: tagIds });
    const after = await scoreplay.listVideoLogs(SOURCE_ID);
    const count = logCount(after);
    const absent = targets.filter((m) => !after.items.some((log) => log.comment?.includes(`[${writebackKey(SOURCE_ID, m)}]`)));
    if (absent.length) throw new Error(`ScorePlay readback is missing logs for ${absent.map((m) => m.id).join(", ")}`);
    const tagged = await scoreplay.getMedia(SOURCE_ID);
    const absentTags = tags.filter((name) => !tagged.tags?.some((t) => t.tag_option?.name.toLowerCase() === name.toLowerCase()));
    if (absentTags.length) throw new Error(`ScorePlay source readback is missing tags: ${absentTags.join(", ")}`);
    for (const m of targets) journal.logs[writebackKey(SOURCE_ID, m)] = { momentId: m.id, state: "written" };
    journal.confirmed = { videoLogs: count, tags, at: new Date().toISOString(), momentIds: targets.map((moment) => moment.id) };
    save(journal);
    console.log(`[writeback] GET /media/${SOURCE_ID}/logs confirmed ${count} logs, ${targets.length} Rundown markers; ${missing.length} new writes`);
    return { kind: "confirmed", confirmed: journal.confirmed };
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}
