import { writeAll } from "@/lib/rundown/decide";
import { RundownError } from "@/lib/rundown/errors";

/** Writes every moment, or every spike with its reason, onto ScorePlay. Body: `{ what: "moments" | "spikes" }`. */
export async function POST(request: Request, ctx: RouteContext<"/api/rundown/runs/[id]/writeback">) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as { what?: string } | null;
  if (body?.what !== "moments" && body?.what !== "spikes") {
    return Response.json({ error: 'Send { what: "moments" } or { what: "spikes" }' }, { status: 400 });
  }
  try {
    return Response.json(await writeAll(id, body.what));
  } catch (err) {
    if (err instanceof RundownError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}
