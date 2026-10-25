import { RundownError } from "@/lib/rundown/errors";
import { updatePackage, type PackageAction } from "@/lib/rundown/social";

export const maxDuration = 60;

/**
 * Works on an approved piece's social package. Body is one of
 * `{ proposalId, action: "render" }` to cut it again,
 * `{ proposalId, action: "caption", caption }` to edit the copy, or
 * `{ proposalId, action: "handoff" }` to mark it ready for the social team.
 * Returns the updated run.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/rundown/runs/[id]/packages">) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as PackageAction | null;
  if (!body || !isAction(body)) {
    return Response.json({ error: 'Send { proposalId, action: "render" | "handoff" } or { proposalId, action: "caption", caption }' }, { status: 400 });
  }
  try {
    return Response.json(await updatePackage(id, body));
  } catch (err) {
    if (err instanceof RundownError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

function isAction(b: PackageAction): boolean {
  if (typeof b.proposalId !== "string") return false;
  if (b.action === "caption") return typeof b.caption === "string" && b.caption.trim().length > 0;
  return b.action === "render" || b.action === "handoff";
}
