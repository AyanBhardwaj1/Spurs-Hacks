import type { Audience, Clip, Moment } from "../../src/lib/studio/types";
import { askClaude } from "./claude";
import { TWELVE_LABS_VIDEO_ID } from "./visual";
import { PEGASUS_ASSET } from "./descriptions";
import { cached, hashOf, writeCache } from "./cache";

export function audienceFor(variant: string): Audience {
  if (/recap/i.test(variant)) return "international";
  if (variant === "Player focus") return "season-ticket-holder";
  if (["Goal", "Moment", "Reaction", "Build-up"].includes(variant)) return "match-fans";
  throw new Error(`No audience mapping for clip variant "${variant}"`);
}

const SCHEMA = {
  type: "object", properties: { clips: { type: "array", items: {
    type: "object", properties: {
      audience: { type: "string", enum: ["sponsor", "international"] }, title: { type: "string" }, caption: { type: "string" }, rationale: { type: "string" },
      segments: { type: "array", items: { type: "object", properties: { start: { type: "number" }, end: { type: "number" } }, required: ["start", "end"] } },
    }, required: ["audience", "title", "caption", "rationale", "segments"],
  } } }, required: ["clips"],
};
type Plan = { audience: "sponsor" | "international"; title: string; caption: string; rationale: string; segments: { start: number; end: number }[] };

export function sponsorVerification(top: Pick<Moment, "start" | "end" | "peak" | "title">, shots: { start: number; end: number }[], segments: { start: number; end: number }[]) {
  const included = shots.filter((shot) => shot.start >= Math.max(top.start, top.peak) && shot.end <= top.end
    && segments.some((segment) => shot.start >= segment.start && shot.end <= segment.end));
  if (!included.length) throw new Error(`No sponsor shots inside the planned edit for "${top.title}"`);
  const range = { start: Math.min(...included.map((shot) => shot.start)), end: Math.max(...included.map((shot) => shot.end)) };
  return { range, cacheKey: `pegasus/sponsor-${Math.floor(range.start)}-${Math.floor(range.end)}.json` };
}

export function audienceRationale(top: Pick<Moment, "title" | "kind">, audience: Plan["audience"], detail: string): string {
  const equaliser = /^(\S+).*\bto equalise\b/i.exec(top.title);
  const subject = equaliser ? `${equaliser[1]}'s equaliser` : top.title;
  return audience === "sponsor"
    ? `Opus's ${top.kind === "goal" ? "action-and-celebration" : "action"} plan includes Marengo search shots subsequently checked with Pegasus: ${detail}`
    : `The build-up introduces Tottenham's attack before ${subject}, with a caption explaining the opponent and the significance for a first-time viewer.`;
}

export async function planAudiences(moments: Moment[], durationSec: number): Promise<Clip[]> {
  const top = [...moments].sort((a, b) => b.scores.total - a.scores.total || a.peak - b.peak)[0];
  const window = { start: Math.max(0, top.peak - 60), end: Math.min(durationSec, top.peak + 60) };
  const query = "sponsor advertising board close up";
  const { value: hits } = await cached(`twelvelabs/sponsor-${hashOf(TWELVE_LABS_VIDEO_ID, query, "50")}.json`, async () => {
    const { twelvelabs } = await import("./server-modules");
    if (twelvelabs.indexId() !== "6adadea25ad4bae62539ac04") throw new Error("Studio sponsor search requires index 6adadea25ad4bae62539ac04");
    return twelvelabs.search({ query, limit: 50, videoIds: [TWELVE_LABS_VIDEO_ID], modalities: ["visual"] });
  });
  const shots = hits.filter((h) => h.end > window.start && h.start < window.end)
    .map((h) => ({ start: Math.max(window.start, h.start), end: Math.min(window.end, h.end), rank: h.rank }));
  writeCache("report/sponsor-shots.json", { momentId: top.id, window, shots });
  const { value } = await askClaude<{ clips: Plan[] }>({
    name: "audience-clips",
    system: "You plan two football video edits for Tottenham's producer to approve. Return plans only, never render or upload. Use only supplied evidence for copy; never invent sponsors, visible logos, scores or player identities. Every segment must lie in a supplied range. Write plain British English captions without emoji.",
    prompt: `Plan exactly one sponsor clip and one international clip for this top moment. The sponsor edit uses at least one supplied sponsor-search shot where partner boards or shirt sponsors may be prominent, plus the decisive action; search hits are candidates requiring producer review, not verified logo visibility. If there are no sponsor shots, use the action range and explicitly say sponsor visibility is unconfirmed in the rationale. The international edit includes build-up before the peak and the decisive action, and explains who Tottenham are, the opponent and why this moment matters to a first-time viewer abroad, using the commentary facts below. No more than four segments per edit, 15-60 seconds total per edit. Source seconds are absolute.\n${JSON.stringify({ moment: { id: top.id, start: top.start, end: top.end, peak: top.peak, title: top.title, summary: top.summary, commentary: top.evidence.filter((e) => e.source === "commentary") }, sponsorShots: shots, buildUp: { start: window.start, end: top.peak } })}`,
    schema: SCHEMA,
  });
  if (value.clips.length !== 2 || new Set(value.clips.map((c) => c.audience)).size !== 2) throw new Error("Audience plan must contain one sponsor and one international clip");
  // The first search found no nearby boards; this query found celebration close-ups inside the existing Opus plan.
  const { value: celebrationHits } = await cached("twelvelabs/sponsor-goal-shirts.json", async () => {
    const { twelvelabs } = await import("./server-modules");
    return twelvelabs.search({ query: "players celebrating goal close up shirt sponsor advertising boards", limit: 50, videoIds: [TWELVE_LABS_VIDEO_ID], modalities: ["visual"] });
  });
  const sponsorShots = [...shots, ...celebrationHits.filter((h) => h.end > window.start && h.start < window.end)
    .map((h) => ({ start: Math.max(window.start, h.start), end: Math.min(window.end, h.end), rank: h.rank }))];
  const sponsorPlan = value.clips.find((clip) => clip.audience === "sponsor");
  if (!sponsorPlan) throw new Error("Audience plan has no sponsor clip");
  const { range: verificationRange, cacheKey } = sponsorVerification(top, sponsorShots, sponsorPlan.segments);
  const { value: verification } = await cached<{ prominent: boolean; detail: string }>(cacheKey, async () => {
    const { twelvelabs } = await import("./server-modules");
    return twelvelabs.analyze({ assetId: PEGASUS_ASSET, ...verificationRange, maxTokens: 512,
      prompt: `Consider only source seconds ${verificationRange.start} to ${verificationRange.end} for "${top.title}". Are shirt sponsors or pitchside partner advertising boards prominent and visibly readable in these shots? Report visible evidence only, do not infer logos or sponsors. State what is visible and where in one concise sentence.`,
      schema: { type: "object", properties: { prominent: { type: "boolean" }, detail: { type: "string" } }, required: ["prominent", "detail"] },
    });
  });
  if (!verification.prominent) throw new Error(`Sponsor visibility was not confirmed: ${verification.detail}`);
  writeCache("report/sponsor-shots.json", { momentId: top.id, window, primaryShots: shots, shots: sponsorShots, verificationRange, verification });
  const clips: Clip[] = value.clips.map((c) => {
    const ranges = [{ start: top.start, end: top.end }, ...(c.audience === "sponsor" ? sponsorShots : [{ start: window.start, end: top.end }])];
    if (!c.segments.length || c.segments.length > 4 || c.segments.some((s) => !Number.isFinite(s.start) || !Number.isFinite(s.end) || s.start >= s.end || !ranges.some((r) => s.start >= r.start && s.end <= r.end))) throw new Error(`${c.audience} plan uses an empty or unsupported range`);
    const duration = c.segments.reduce((sum, s) => sum + s.end - s.start, 0);
    if (duration < 15 || duration > 60 || !c.segments.some((s) => s.start <= top.peak && s.end >= top.peak)) throw new Error(`${c.audience} plan must run 15-60 seconds and include the peak`);
    if (c.audience === "sponsor" && !c.segments.some((s) => s.start <= verificationRange.start && s.end >= verificationRange.end && sponsorShots.some((r) => r.start >= s.start && r.end <= s.end))) throw new Error("Sponsor plan does not include the verified sponsor shots");
    if (c.audience === "international" && !c.segments.some((s) => s.start < top.peak - 10)) throw new Error("International plan lacks build-up context");
    return { ...c,
      caption: c.audience === "international" ? c.caption.replace("away at Old Trafford", "away to Manchester United at Old Trafford") : c.caption,
      rationale: audienceRationale(top, c.audience, verification.detail),
      id: `c-${top.id}-${c.audience}`, lane: "post-match", variant: c.audience === "sponsor" ? "Sponsor" : "International", format: "16:9", hashtags: ["#COYS", "#MUNTOT"], segments: c.segments.map((s) => ({ ...s, momentId: top.id })), durationSec: Math.round(duration * 10) / 10, viralScore: top.scores.total };
  });
  writeCache("report/audience-plans.json", clips);
  return clips;
}
