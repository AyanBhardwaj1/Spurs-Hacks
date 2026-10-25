import { matchTimeAt } from "./align";
import { propose } from "./propose";
import { STAGE_NAMES, type Asset, type MatchLogEvent, type Moment, type MomentAnalysis, type Run, type RunInput } from "./types";

// A hand-written run for when no API keys are set, so the workspace has
// something to render in development and CI. Every ID, timecode and line
// below is made up. None of it comes from the match data.

const assets: Asset[] = [
  { id: "demo-broadcast", kind: "video", role: "broadcast", name: "Full match broadcast (sample)", durationSec: 6120, players: [], tags: [] },
  { id: "demo-iso-goal", kind: "video", role: "iso", name: "ISO camera behind the home goal (sample)", durationSec: 6050, players: [], tags: [] },
  { id: "demo-iso-bench", kind: "video", role: "iso", name: "Bench camera (sample)", durationSec: 6000, players: [], tags: [] },
  { id: "demo-presser", kind: "video", role: "press", name: "Post-match press conference (sample)", durationSec: 840, players: [], tags: [] },
  { id: "demo-tunnel", kind: "video", role: "other", name: "Tunnel camera (sample)", durationSec: 2400, players: [], tags: [] },
];

const captions = (base: string): MomentAnalysis["captions"] => ({
  "season-ticket": `You were there for this. ${base}`,
  "first-time-abroad": `${base} Here is why it mattered.`,
  partner: base,
  "social-native": base,
  "player-fans": base,
  family: base,
});

const analysis = (a: Partial<MomentAnalysis> & Pick<MomentAnalysis, "description" | "hook" | "intensity">): MomentAnalysis => ({
  players: [],
  emotion: "elation",
  isReplay: false,
  sponsorsVisible: [],
  crowdAudible: true,
  quality: "good",
  brandSafe: true,
  captions: captions(a.description),
  ...a,
});

const moments: Moment[] = [
  {
    id: "m-demo-equaliser",
    kind: "goal",
    title: "Equaliser",
    primary: { assetId: "demo-broadcast", start: 1062, end: 1080 },
    angles: [{ assetId: "demo-iso-goal", start: 1060, end: 1078, note: "ISO camera behind the home goal (sample)" }],
    signals: [
      { source: "match-log", label: "Goal", ref: "demo-1", strength: 0.95 },
      { source: "footage", label: "Goal", query: "the ball hits the back of the net for a goal", strength: 0.93 },
      { source: "fans", label: "that equaliser from behind the goal, the noise", query: "equaliser from behind the goal", strength: 0.7 },
    ],
    analysis: analysis({
      description: "A low finish into the far corner levels the game; the home end behind the goal erupts.",
      hook: "From where you were standing",
      intensity: 0.92,
      sponsorsVisible: ["Main partner (sample)"],
    }),
    score: 0.98,
  },
  {
    id: "m-demo-red",
    kind: "card",
    title: "Red card",
    primary: { assetId: "demo-broadcast", start: 3486, end: 3504 },
    angles: [{ assetId: "demo-iso-bench", start: 3490, end: 3506, note: "Bench camera (sample)" }],
    signals: [
      { source: "match-log", label: "Red card", ref: "demo-2", strength: 0.8 },
      { source: "footage", label: "Red card", query: "referee shows a red card", strength: 0.78 },
      { source: "fans", label: "how is that a red?? explain it to me", query: "how is that a red explain it to me", strength: 0.66 },
    ],
    analysis: analysis({
      description: "A late challenge, the referee shows red, and the bench is on its feet arguing.",
      hook: "Why that was a red",
      intensity: 0.8,
      emotion: "anger",
    }),
    score: 0.92,
  },
  {
    id: "m-demo-red-replay",
    kind: "card",
    title: "Red card",
    primary: { assetId: "demo-broadcast", start: 3520, end: 3532 },
    angles: [],
    signals: [{ source: "footage", label: "Red card", query: "referee shows a red card", strength: 0.62 }],
    analysis: analysis({ description: "Wide slow-motion replay of the same challenge.", hook: "The challenge again", intensity: 0.5, isReplay: true }),
    score: 0.62,
  },
  {
    id: "m-demo-bench",
    kind: "bench",
    title: "Bench loses it",
    primary: { assetId: "demo-iso-bench", start: 1064, end: 1076 },
    angles: [],
    signals: [{ source: "footage", label: "Bench loses it", query: "substitutes jumping off the bench celebrating", strength: 0.88 }],
    analysis: analysis({ description: "The substitutes sprint off the bench toward the corner flag.", hook: "The bench saw it first", intensity: 0.85 }),
    score: 0.88,
  },
  {
    id: "m-demo-quiet",
    kind: "silence",
    title: "Venue goes quiet",
    primary: { assetId: "demo-broadcast", start: 4410, end: 4420 },
    angles: [],
    signals: [{ source: "footage", label: "Venue goes quiet", query: "stadium falls silent, fans with hands on their heads in disbelief", strength: 0.71 }],
    analysis: analysis({ description: "A shot is cleared off the line; the home end goes silent, hands on heads.", hook: "Off the line", intensity: 0.7, emotion: "tension" }),
    score: 0.71,
  },
  {
    id: "m-demo-partner",
    kind: "sponsor",
    title: "Partner in frame",
    primary: { assetId: "demo-broadcast", start: 1865, end: 1895 },
    angles: [],
    signals: [{ source: "footage", label: "Partner in frame", query: "close-up of a player with the shirt sponsor logo clearly visible", strength: 0.5 }],
    analysis: analysis({
      description: "A long passing move with the front-of-shirt logo readable in close-up for most of it.",
      hook: "Twelve passes",
      intensity: 0.55,
      sponsorsVisible: ["Main partner (sample)"],
      emotion: "calm",
    }),
    score: 0.5,
  },
  {
    id: "m-demo-presser",
    kind: "press",
    title: "Manager on the red card",
    primary: { assetId: "demo-presser", start: 212, end: 236 },
    angles: [],
    signals: [
      { source: "footage", label: "Quote on the red card", query: "I have seen that given and not given", strength: 0.78 },
      { source: "fans", label: "manager's face when they asked about the red lmao", query: "manager's face when they asked about the red", strength: 0.6 },
    ],
    analysis: analysis({ description: "The manager pauses, smiles, and says he has seen that given and not given.", hook: "Given and not given", intensity: 0.66, emotion: "humour" }),
    score: 0.86,
  },
  {
    id: "m-demo-scuffle",
    kind: "confrontation",
    title: "Flashpoint",
    primary: { assetId: "demo-tunnel", start: 1320, end: 1335 },
    angles: [],
    signals: [{ source: "footage", label: "Flashpoint", query: "players pushing and arguing face to face", strength: 0.58 }],
    analysis: analysis({
      description: "Players push each other in the tunnel at half time while staff separate them.",
      hook: "Half-time tunnel",
      intensity: 0.6,
      brandSafe: false,
      brandSafetyNote: "A physical altercation between players; the club would not post this.",
      emotion: "anger",
    }),
    score: 0.58,
  },
  {
    id: "m-demo-woodwork",
    kind: "chance",
    title: "Woodwork",
    primary: { assetId: "demo-broadcast", start: 2702, end: 2710 },
    angles: [],
    signals: [{ source: "footage", label: "Woodwork", query: "shot hits the post or crossbar", strength: 0.3 }],
    score: 0.3,
  },
];

// A sample match log: kickoff at 14:00 UTC, 46-minute first half, 15-minute
// break. The sample broadcast starts at kickoff and keeps one minute of the break.
const sampleLog: MatchLogEvent[] = [
  { id: "demo-ko", kind: "kickoff", period: 1, wallclock: "2026-10-18T14:00:00Z", players: [], text: "" },
  { id: "demo-ht", kind: "halftime", period: 1, wallclock: "2026-10-18T14:46:00Z", players: [], text: "" },
  { id: "demo-2h", kind: "second-half", period: 2, wallclock: "2026-10-18T15:01:00Z", players: [], text: "" },
  { id: "demo-ft", kind: "full-time", period: 2, wallclock: "2026-10-18T15:50:00Z", players: [], text: "" },
];
const sampleAlignment = { shiftByPeriod: { 1: 0, 2: 2820 }, matched: 1 };

export function demoRun(input: RunInput): Run {
  const now = new Date().toISOString();
  const timed = structuredClone(moments).map((m) =>
    m.primary.assetId === "demo-broadcast" ? { ...m, matchTime: matchTimeAt(sampleLog, sampleAlignment, m.primary.start) } : m,
  );
  const stages = STAGE_NAMES.map((name) => ({
    name,
    status: "done" as const,
    detail: "Sample data: no API keys are set",
    startedAt: now,
    finishedAt: now,
  }));
  const result = propose(timed, { assets, partners: ["Main partner (sample)"], now });
  return {
    id: `demo-${Date.now().toString(36)}`,
    input,
    source: "demo",
    status: "done",
    createdAt: now,
    event: { id: input.eventId, name: "Sample match (no API keys set)" },
    stages,
    assets,
    partners: ["Main partner (sample)"],
    moments: timed,
    proposals: result.proposals,
    spikes: result.spikes,
    storage: result.storage,
  };
}
