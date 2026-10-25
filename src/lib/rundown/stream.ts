import "server-only";

import { getMedia, getStreamFormats, ScorePlayError } from "../scoreplay";

// Presigned rendition URLs from ScorePlay. They last 24 hours, so callers
// ask for one when they need it instead of storing it on the run. The player
// prefers HLS; the renderer prefers a single MP4 it can seek into by range.

export type StreamUrl = { url: string; type: "hls" | "mp4"; expiresAt?: string };

const ORDER = {
  hls: ["stream", "video_medium", "video_small", "video_large", "original"],
  mp4: ["video_large", "video_medium", "original", "video_small"],
};

export async function streamFor(assetId: string, prefer: "hls" | "mp4" = "hls"): Promise<StreamUrl | undefined> {
  const id = Number(assetId);
  if (!Number.isInteger(id)) return undefined;
  try {
    const files = (await getStreamFormats(id)).filter((f) => f.file_url);
    const pick = ORDER[prefer].map((t) => files.find((f) => f.type === t)).find(Boolean) ?? files.find((f) => f.mime_type.startsWith("video/"));
    if (pick?.file_url) {
      return {
        url: pick.file_url,
        type: pick.file_url.includes(".m3u8") || pick.mime_type.includes("mpegurl") ? "hls" : "mp4",
        expiresAt: new Date(Date.now() + 23 * 3600 * 1000).toISOString(),
      };
    }
  } catch (err) {
    // A key without the download right gets a 401 here; the media record may still carry a proxy URL.
    if (!(err instanceof ScorePlayError) || err.status !== 401) throw err;
  }
  const media = await getMedia(id);
  const url = prefer === "mp4" ? (media.proxy_medium ?? media.streaming_url) : (media.streaming_url ?? media.proxy_medium ?? media.proxy_small);
  if (!url) return undefined;
  return { url, type: url.includes(".m3u8") ? "hls" : "mp4" };
}
