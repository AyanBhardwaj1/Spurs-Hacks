import { getRun } from "@/lib/rundown/store";

export async function GET(_request: Request, ctx: RouteContext<"/api/rundown/runs/[id]">) {
  const { id } = await ctx.params;
  const run = await getRun(id);
  if (!run) return Response.json({ error: `No run ${id}` }, { status: 404 });
  return Response.json(run);
}
