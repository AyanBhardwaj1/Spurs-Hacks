import { childEnv } from "./child-env";
import { scoreplay } from "./server-modules";

/** Resolve a fresh URL and probe it without saving source media to disk. */
export async function renderSource(mediaId: number) {
  const formats = await scoreplay.getStreamFormats(mediaId);
  const rendition = formats.find((f) => f.type === "original" && f.file_url)
    ?? formats.find((f) => f.type === "video_large" && f.file_url);
  if (!rendition?.file_url) throw new Error(`Media ${mediaId} has no original or video_large URL`);
  const url = rendition.file_url;
  const proc = Bun.spawn([
    process.env.FFPROBE_PATH || "ffprobe", "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height", "-of", "json", url,
  ], { env: childEnv(), stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
  ]);
  if (code !== 0) throw new Error(`Source probe failed: ${stderr.replaceAll(url, "[source URL]")}`);
  const probe: unknown = JSON.parse(stdout);
  if (typeof probe !== "object" || probe === null || !("streams" in probe) || !Array.isArray(probe.streams)) {
    throw new Error(`Invalid source probe for media ${mediaId}`);
  }
  const video: unknown = probe.streams[0];
  if (typeof video !== "object" || video === null || !("width" in video) || !("height" in video)
    || video.width !== 1920 || video.height !== 1080) {
    throw new Error(`Media ${mediaId} ${rendition.type} must be 1920x1080; probe was ${stdout.trim()}`);
  }
  return { url, metadata: { mediaId, format: rendition.type, width: video.width, height: video.height, renditionId: rendition.id } };
}
