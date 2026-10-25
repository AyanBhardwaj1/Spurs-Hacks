import { decide, type DecisionInput } from "@/lib/rundown/decide";
import { RundownError } from "@/lib/rundown/errors";

/**
 * A producer's call on one item. Body is one of:
 * `{ proposalId, action: "approve" | "reopen" }`, `{ proposalId, action: "spike", reason? }`
 * or `{ spikeId, action: "rescue" }`. Returns the updated run.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/rundown/runs/[id]/decisions">) {
  const { id } = await ctx.params;
  const body = (await request.json().catch(() => null)) as DecisionInput | null;
  if (!body || !isDecision(body)) {
    return Response.json({ error: 'Send { proposalId, action: "approve" | "spike" | "reopen" } or { spikeId, action: "rescue" }' }, { status: 400 });
  }
  try {
    return Response.json(await decide(id, body));
  } catch (err) {
    if (err instanceof RundownError) return Response.json({ error: err.message }, { status: err.status });
    throw err;
  }
}

function isDecision(b: DecisionInput): boolean {
  if ("spikeId" in b) return typeof b.spikeId === "string" && b.action === "rescue";
  return typeof b.proposalId === "string" && ["approve", "spike", "reopen"].includes(b.action);
}
