import "server-only";

import { RundownError } from "./errors";
import { pitchesFor, toProposal } from "./propose";
import { packageOnApprove } from "./social";
import { getRun, saveRun } from "./store";
import type { Proposal, Run, Spike, Writeback } from "./types";
import { writeApproval, writeMoments, writeProducerSpike, writeSpike } from "./writeback";

// A producer's decisions. Approvals and spikes are written onto the ScorePlay
// asset straight away, because a decision that only lives in Rundown is one
// the club never hears about.

export type DecisionInput =
  | { proposalId: string; action: "approve" }
  | { proposalId: string; action: "spike"; reason?: string }
  | { proposalId: string; action: "reopen" }
  | { spikeId: string; action: "rescue" };

function simulated(assetIds: string[], tags: string[]): Writeback {
  return { at: new Date().toISOString(), assetIds, tags, ok: true, simulated: true };
}

export async function decide(runId: string, input: DecisionInput): Promise<Run> {
  const run = await getRun(runId);
  if (!run) throw new RundownError(404, `No run ${runId}`);
  const live = run.source === "live" && run.companyId !== undefined;

  if ("spikeId" in input) {
    const s = run.spikes.find((x) => x.id === input.spikeId);
    if (!s) throw new RundownError(404, `No spike ${input.spikeId}`);
    if (s.status === "rescued") return run;
    const proposal = rescue(run, s);
    if (!proposal) throw new RundownError(422, `No format suits "${s.title}", so there is nothing to rescue it into`);
    s.status = "rescued";
    s.rescuedAs = proposal.id;
    run.proposals.unshift(proposal);
    await saveRun(run);
    return run;
  }

  const p = run.proposals.find((x) => x.id === input.proposalId);
  if (!p) throw new RundownError(404, `No proposal ${input.proposalId}`);
  if (input.action === "approve") {
    p.status = "approved";
    p.spikedBy = undefined;
    p.spikeReason = undefined;
    p.writeback = live
      ? await writeApproval(run.companyId as number, p)
      : simulated(p.cut.map((s) => s.assetId), ["rundown-approved"]);
    packageOnApprove(run, p);
  } else if (input.action === "spike") {
    p.status = "spiked";
    p.spikedBy = "producer";
    p.spikeReason = input.reason?.trim() || undefined;
    p.writeback = live ? await writeProducerSpike(run.companyId as number, p) : simulated([p.cut[0].assetId], ["rundown-spiked"]);
  } else {
    // ScorePlay does not return log IDs on create, so an earlier write stays on the asset.
    p.status = "review";
    p.spikedBy = undefined;
    p.spikeReason = undefined;
  }
  await saveRun(run);
  return run;
}

function rescue(run: Run, s: Spike): Proposal | undefined {
  const moment = run.moments.find((m) => m.id === s.momentId);
  if (!moment) return undefined;
  const [pitch] = pitchesFor(moment, run.partners.map((x) => x.toLowerCase()));
  if (!pitch) return undefined;
  return { ...toProposal(moment, pitch, run.assets, new Date().toISOString()), id: `${s.id}-rescued`, rescuedFrom: s.id };
}

/** Writes every moment, or every Rundown spike, onto its ScorePlay asset as a timecoded action. */
export async function writeAll(runId: string, what: "moments" | "spikes"): Promise<Writeback> {
  const run = await getRun(runId);
  if (!run) throw new RundownError(404, `No run ${runId}`);
  const company = run.companyId;
  if (run.source !== "live" || company === undefined) {
    const ids = what === "moments" ? run.moments.map((m) => m.primary.assetId) : run.spikes.map((s) => s.segment.assetId);
    return simulated([...new Set(ids)], [what === "moments" ? "rundown-moment" : "rundown-spiked"]);
  }
  if (what === "moments") return writeMoments(company, run.moments);
  const pending = run.spikes.filter((s) => s.status === "spiked" && !s.writeback?.ok);
  const results = await Promise.all(pending.map((s) => writeSpike(company, s)));
  pending.forEach((s, i) => (s.writeback = results[i]));
  await saveRun(run);
  const failed = results.find((r) => !r.ok);
  return {
    at: new Date().toISOString(),
    assetIds: [...new Set(results.flatMap((r) => r.assetIds))],
    tags: [...new Set(results.flatMap((r) => r.tags))],
    ok: !failed,
    error: failed?.error,
  };
}
