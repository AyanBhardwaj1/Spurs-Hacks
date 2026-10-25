import { scoreplayConfigured } from "@/lib/scoreplay";
import { streamFor } from "@/lib/rundown/stream";

/**
 * A short-lived URL for a ScorePlay asset, including clips Rundown rendered.
 * `?format=mp4` asks for a single file, for downloading a finished clip.
 */
export async function GET(request: Request, ctx: RouteContext<"/api/rundown/assets/[id]/stream">) {
  const { id } = await ctx.params;
  if (!scoreplayConfigured()) return Response.json({ error: "No ScorePlay key, so nothing to stream" }, { status: 503 });
  const prefer = new URL(request.url).searchParams.get("format") === "mp4" ? "mp4" : "hls";
  const stream = await streamFor(id, prefer);
  if (!stream) return Response.json({ error: `No playable rendition for asset ${id}` }, { status: 404 });
  return Response.json(stream);
}
