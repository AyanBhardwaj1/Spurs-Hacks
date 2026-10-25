import "server-only";

import { addMediaTags, findOrCreateTagOption, listVideoLogs, uploadToEvent } from "../scoreplay";
import { RundownError } from "./errors";
import { checkPackage, clubHashtags, fitCaption, placementFor } from "./platforms";
import { defaultFont, ffmpegBinary, renderClip } from "./render";
import { getRun, saveRun } from "./store";
import { streamFor } from "./stream";
import type { Proposal, Run, SocialPackage } from "./types";
import { TAXONOMY } from "./writeback";

// Approval turns a proposal into a package that is ready to post: the clip
// rendered for its platform and uploaded to ScorePlay, the caption fitted to
// the platform's limits, and the checks it passed. Posting itself happens from
// ScorePlay's social publishing, and at this event only as a demo.

/** Builds or rebuilds the package's copy and checks. Keeps any render already done. */
export function buildPackage(run: Run, p: Proposal, previous?: SocialPackage): SocialPackage {
  const placement = placementFor(p.platform, p.format.aspect);
  const moment = run.moments.find((m) => m.id === p.momentId);
  const durationSec = p.cut.reduce((sum, s) => sum + (s.end - s.start), 0);
  const base = p.audience === "partner" && p.partner ? `${p.caption} Presented by ${p.partner}.` : p.caption;
  const { caption, hashtags } = fitCaption(placement, base, clubHashtags(run.input.sport));
  const title = placement.titleLimit ? p.hook.slice(0, placement.titleLimit) : undefined;
  const fresh = p.freshForMinutes === null ? undefined : new Date(Date.parse(p.readyAt) + p.freshForMinutes * 60_000).toISOString();
  return {
    id: `pkg-${p.id}`,
    platform: p.platform,
    placement: placement.placement,
    aspect: placement.aspect,
    width: placement.width,
    height: placement.height,
    durationSec,
    render: previous?.render ?? { status: "queued" },
    title,
    caption,
    hashtags,
    altText: moment?.analysis?.description ?? p.title,
    checks: checkPackage(placement, { durationSec, caption, hashtags, title }, p, moment?.analysis?.brandSafe),
    freshUntil: fresh,
    handoff: previous?.handoff,
    simulated: run.source === "demo" || undefined,
  };
}

/** Builds the package for a newly approved proposal and starts its render. */
export function packageOnApprove(run: Run, p: Proposal) {
  p.package = buildPackage(run, p, p.package?.render.status === "ready" ? p.package : undefined);
  if (p.package.render.status === "ready") return;
  if (run.source === "demo") {
    p.package.render = { status: "ready", finishedAt: new Date().toISOString() };
    return;
  }
  enqueue(run.id, p.id);
}

// One render at a time. Two ffmpeg encodes at once would double memory use on
// a laptop that is also running the dev server and the browser.
const state = globalThis as unknown as { rundownRenderQueue?: { jobs: { runId: string; proposalId: string }[]; busy: boolean } };
const queue = (state.rundownRenderQueue ??= { jobs: [], busy: false });

function enqueue(runId: string, proposalId: string) {
  if (!queue.jobs.some((j) => j.runId === runId && j.proposalId === proposalId)) queue.jobs.push({ runId, proposalId });
  void drain();
}

async function drain() {
  if (queue.busy) return;
  queue.busy = true;
  try {
    for (let job = queue.jobs.shift(); job; job = queue.jobs.shift()) await renderJob(job.runId, job.proposalId);
  } finally {
    queue.busy = false;
  }
}

async function renderJob(runId: string, proposalId: string) {
  const run = await getRun(runId);
  const p = run?.proposals.find((x) => x.id === proposalId);
  if (!run || !p?.package || p.status !== "approved") return;
  const pkg = p.package;
  pkg.render = { status: "rendering", startedAt: new Date().toISOString() };
  await saveRun(run);

  if (!ffmpegBinary()) {
    pkg.render = {
      status: "unavailable",
      error: "ffmpeg is not installed on this server, so the clip was not cut. ScorePlay's preview of the approved range is attached instead.",
      previewUrl: await scoreplayPreview(p),
      finishedAt: new Date().toISOString(),
    };
    await saveRun(run);
    return;
  }

  try {
    if (!run.event) throw new Error("The run has no ScorePlay event to upload into");
    const sources = await Promise.all(
      p.cut.map(async (seg) => {
        const stream = await streamFor(seg.assetId, "mp4");
        if (!stream) throw new Error(`No rendition to cut from for asset ${seg.assetId}`);
        return { url: stream.url, start: seg.start, end: seg.end };
      }),
    );
    const placement = placementFor(p.platform, p.format.aspect);
    const bytes = await renderClip({
      sources,
      width: pkg.width,
      height: pkg.height,
      focusX: run.moments.find((m) => m.id === p.momentId)?.analysis?.focusX,
      hook: p.hook,
      safeTop: placement.safeTop,
      fontFile: defaultFont(),
    });
    pkg.render = { ...pkg.render, status: "uploading" };
    await saveRun(run);
    const slug = `${p.platform}-${pkg.placement}`.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const media = await uploadToEvent(
      run.event.id,
      { name: `rundown-${slug}-${p.id}.mp4`, body: bytes, contentType: "video/mp4" },
      {
        description: pkg.caption,
        raw_tags: [TAXONOMY.root, TAXONOMY.render, TAXONOMY.platform(p.platform), TAXONOMY.audience(p.audience)],
      },
    );
    pkg.render = { ...pkg.render, status: "ready", mediaId: String(media.ID), finishedAt: new Date().toISOString() };
  } catch (err) {
    pkg.render = {
      ...pkg.render,
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      previewUrl: await scoreplayPreview(p),
      finishedAt: new Date().toISOString(),
    };
  }
  await saveRun(run);
}

/** ScorePlay renders a preview for every video log; approval wrote one for the first segment. */
async function scoreplayPreview(p: Proposal): Promise<string | undefined> {
  const seg = p.cut[0];
  try {
    const { items } = await listVideoLogs(Number(seg.assetId));
    const log = items.find((l) => Math.abs(l.start_timestamp / 1000 - seg.start) < 1 && l.tags.includes(TAXONOMY.approved));
    return log?.playback_url;
  } catch {
    return undefined;
  }
}

export type PackageAction =
  | { proposalId: string; action: "render" }
  | { proposalId: string; action: "caption"; caption: string }
  | { proposalId: string; action: "handoff" };

export async function updatePackage(runId: string, input: PackageAction): Promise<Run> {
  const run = await getRun(runId);
  if (!run) throw new RundownError(404, `No run ${runId}`);
  const p = run.proposals.find((x) => x.id === input.proposalId);
  if (!p) throw new RundownError(404, `No proposal ${input.proposalId}`);
  if (p.status !== "approved" || !p.package) throw new RundownError(409, "Approve the proposal before working on its package");

  if (input.action === "render") {
    p.package.render = { status: "queued" };
    packageOnApprove(run, p);
  } else if (input.action === "caption") {
    p.caption = input.caption.trim();
    p.package = buildPackage(run, p, p.package);
  } else {
    await handoff(run, p.package);
  }
  await saveRun(run);
  return run;
}

/**
 * Marks the package as ready for the social team. On a live run the rendered
 * clip is tagged on ScorePlay, where the platform's social publishing picks
 * it up. Rundown itself never posts.
 */
async function handoff(run: Run, pkg: SocialPackage) {
  const failed = pkg.checks.filter((c) => !c.ok);
  if (failed.length) throw new RundownError(422, `Fix these first: ${failed.map((c) => `${c.rule} (${c.detail})`).join("; ")}`);
  if (pkg.render.status !== "ready") throw new RundownError(409, `The clip is ${pkg.render.status}, not ready`);
  if (run.source === "live" && pkg.render.mediaId) {
    const option = await findOrCreateTagOption(TAXONOMY.readyToPost.name, TAXONOMY.readyToPost.label);
    await addMediaTags(Number(pkg.render.mediaId), { tag_option_ids: [option.ID] });
  }
  pkg.handoff = { at: new Date().toISOString(), simulated: run.source === "demo" || undefined };
}
