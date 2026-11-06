import { PLACEMENTS } from "@/lib/rundown/platforms";
import { captionEvents } from "./captions";
import { postText } from "./post";
import { postOrder } from "./rank";
import type { JobClip, JobMoment, Word } from "./types";

// Getting approved clips out of Rundown in one go: an SRT per clip for platforms that take a captions
// file, a manifest a scheduling tool can read, and a zip to carry them. The zip uses the "stored" method:
// MP4 is already compressed, so deflating it again would cost time and save nothing.

const srtTime = (sec: number) => {
  const ms = Math.max(0, Math.round(sec * 1000));
  const two = (n: number) => String(n).padStart(2, "0");
  return `${two(Math.floor(ms / 3_600_000))}:${two(Math.floor(ms / 60_000) % 60)}:${two(Math.floor(ms / 1000) % 60)},${String(ms % 1000).padStart(3, "0")}`;
};

/** The clip's burned-in captions as an SRT file, in clip time. Empty when there was no transcript. */
export function clipSrt(words: Word[], segments: { start: number; end: number }[]): string {
  return captionEvents(words, segments)
    .map((e, i) => `${i + 1}\n${srtTime(e.start)} --> ${srtTime(e.end)}\n${e.text}\n`)
    .join("\n");
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip of the files as given, uncompressed. Names are UTF-8; sizes must stay under 4 GB in all. */
export function zipStored(files: { name: string; data: Uint8Array }[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // bit 11: the name is UTF-8
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.byteLength, true);
    local.setUint32(22, f.data.byteLength, true);
    local.setUint16(26, name.byteLength, true);
    parts.push(new Uint8Array(local.buffer), name, f.data);

    const entry = new DataView(new ArrayBuffer(46));
    entry.setUint32(0, 0x02014b50, true);
    entry.setUint16(4, 20, true);
    entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x0800, true);
    entry.setUint32(16, crc, true);
    entry.setUint32(20, f.data.byteLength, true);
    entry.setUint32(24, f.data.byteLength, true);
    entry.setUint16(28, name.byteLength, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.byteLength + f.data.byteLength;
  }
  const centralSize = central.reduce((n, p) => n + p.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(new ArrayBuffer(all.reduce((n, p) => n + p.byteLength, 0)));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.byteLength;
  }
  return out;
}

/** What a scheduling tool needs per clip: the files, the platform, the post ready to paste, and where it comes in that platform's posting order. */
export function exportManifest(match: string, clips: JobClip[], moments: JobMoment[] = []) {
  const order = postOrder(clips, moments);
  return {
    match,
    clips: clips.map((c) => {
      const p = PLACEMENTS[c.placement];
      return {
        file: `${c.id}.mp4`,
        captions: `${c.id}.srt`,
        ...(c.render.cover && { cover: `${c.id}.jpg` }),
        platform: p.platform,
        placement: p.placement,
        aspect: p.aspect,
        seconds: Math.round(c.segments.reduce((n, s) => n + s.end - s.start, 0)),
        title: c.title,
        hook: c.hook,
        caption: c.caption,
        hashtags: c.hashtags,
        post: postText(c),
        ...(c.chapters && { chapters: c.chapters }),
        order: order.get(c.id)?.rank,
        source: c.segments,
      };
    }),
  };
}
