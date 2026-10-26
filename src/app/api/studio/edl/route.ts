import { clipEdl } from "@/lib/studio/edl";
import { loadStudioAnalysis } from "@/lib/studio/load";

// One planned clip as an edit decision list, built from the committed analysis. It needs no key and no
// media: an EDL is timecodes and the master's file name, which the editor relinks to their own copy.
//
// GET ?clip=<clip id>
export function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("clip");
  if (!id) return Response.json({ error: "Name a clip: ?clip=<clip id>." }, { status: 400 });
  const analysis = loadStudioAnalysis();
  const clip = analysis.clips.find((c) => c.id === id);
  if (!clip) return Response.json({ error: `No planned clip ${id} in this analysis.` }, { status: 404 });
  return new Response(clipEdl(clip, analysis.source), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Content-Disposition": `attachment; filename="${clip.id}.edl"` },
  });
}
