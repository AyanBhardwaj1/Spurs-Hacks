import { combineStrengths, fitSegment, formatTimecode } from "./moments";
import { freshForMinutes } from "./platforms";
import type {
  Asset,
  Audience,
  Format,
  Moment,
  MomentKind,
  Platform,
  Proposal,
  Segment,
  Spike,
  StorageVerdict,
} from "./types";

// Turns analysed moments into ranked proposals and a spiked list. Everything
// here is deterministic so a producer can ask why and get the same answer.

export type Pitch = {
  audience: Audience;
  platform: Platform;
  format: Format;
  fit: number;
  angle: string;
  partner?: string;
};

const AUDIENCE_LABEL: Record<Audience, string> = {
  "season-ticket": "season ticket holders",
  "first-time-abroad": "first-time viewers abroad",
  partner: "the shirt partner",
  "social-native": "the social feed",
  "player-fans": "the player's own fans",
  family: "young fans and families",
};

function pitch(
  audience: Audience,
  platform: Platform,
  aspect: Format["aspect"],
  lengthSec: number,
  kind: Format["kind"],
  fit: number,
  angle: string,
): Pitch {
  return { audience, platform, format: { kind, aspect, lengthSec }, fit, angle };
}

const PITCHES: Record<MomentKind, Pitch[]> = {
  goal: [
    pitch("social-native", "X", "16:9", 12, "clip", 0.95, "the finish, out while the stadium is still loud"),
    pitch("social-native", "TikTok", "9:16", 12, "clip", 0.9, "the finish, tight, hook in the first second"),
    pitch("season-ticket", "Instagram", "9:16", 15, "reaction", 0.85, "the goal from where the fans stood"),
    pitch("first-time-abroad", "YouTube", "16:9", 40, "explainer", 0.8, "the build-up with captions on who and why it matters"),
  ],
  celebration: [
    pitch("social-native", "TikTok", "9:16", 10, "clip", 0.9, "the celebration on its own"),
    pitch("family", "Club app", "16:9", 15, "clip", 0.6, "the celebration with the crowd behind it"),
  ],
  chance: [pitch("social-native", "X", "16:9", 10, "clip", 0.7, "the near miss and the reaction")],
  crowd: [
    pitch("season-ticket", "Instagram", "9:16", 15, "reaction", 0.95, "the stands, not the pitch"),
    pitch("first-time-abroad", "YouTube", "16:9", 30, "clip", 0.65, "what it sounds like to be there"),
  ],
  "away-end": [pitch("social-native", "TikTok", "9:16", 12, "reaction", 0.6, "the other end of the ground")],
  silence: [
    pitch("social-native", "TikTok", "9:16", 8, "reaction", 0.85, "the second the place went quiet"),
    pitch("season-ticket", "Instagram", "9:16", 12, "reaction", 0.6, "the quiet, then the noise"),
  ],
  bench: [
    pitch("social-native", "TikTok", "9:16", 10, "reaction", 0.9, "the bench, which the broadcast cut away from"),
    pitch("season-ticket", "Instagram", "9:16", 12, "reaction", 0.7, "the squad reacting together"),
  ],
  coach: [
    pitch("social-native", "X", "1:1", 15, "reaction", 0.6, "the touchline, uncut"),
    pitch("first-time-abroad", "YouTube", "16:9", 30, "explainer", 0.5, "the coach's reaction with context on the game state"),
  ],
  card: [
    pitch("first-time-abroad", "YouTube", "16:9", 40, "explainer", 0.85, "the incident with captions explaining the rule"),
    pitch("social-native", "X", "16:9", 15, "clip", 0.55, "the decision and the reaction"),
  ],
  confrontation: [pitch("first-time-abroad", "YouTube", "16:9", 30, "explainer", 0.6, "what happened and why it boiled over")],
  skill: [
    pitch("social-native", "TikTok", "9:16", 12, "clip", 0.9, "the move, slowed at the key touch"),
    pitch("player-fans", "Instagram", "9:16", 20, "clip", 0.85, "the player, every touch of the move"),
    pitch("first-time-abroad", "YouTube", "16:9", 30, "clip", 0.6, "the move with the player introduced"),
  ],
  sponsor: [pitch("partner", "Partner", "16:9", 30, "clip", 0.9, "a clean run of play with the partner readable")],
  press: [
    pitch("social-native", "X", "1:1", 20, "quote", 0.85, "one answer, captioned"),
    pitch("first-time-abroad", "YouTube", "16:9", 45, "quote", 0.6, "the answer with the question it was responding to"),
  ],
  other: [pitch("social-native", "TikTok", "9:16", 12, "clip", 0.5, "the moment as it happened")],
};

export type ProposeOptions = {
  assets: Asset[];
  /** Sponsor names the club has a deal with. */
  partners: string[];
  /** When the proposals are ready; becomes each proposal's `readyAt`. */
  now: string;
  /** Most proposals to keep. */
  keep?: number;
};

export type ProposeResult = {
  proposals: Proposal[];
  spikes: Spike[];
  storage: StorageVerdict[];
};

const WEAK_SCORE = 0.35;
/** The brief's "right five options": the best piece from each of the five strongest moments. */
const SHORTLIST = 5;
/** One moment fans out to a few pieces, but never fills the queue on its own. */
const MAX_PER_MOMENT = 4;
const MAX_PER_AUDIENCE = 4;

export function propose(moments: Moment[], opts: ProposeOptions): ProposeResult {
  const spikes: Spike[] = [];
  const live: Moment[] = [];
  const partners = opts.partners.map((p) => p.toLowerCase());
  // Pegasus only watches the strongest moments. Once it has, a moment it skipped
  // has had no brand-safety check, so it is not pitched.
  const analysed = moments.some((m) => m.analysis);

  for (const m of moments) {
    const a = m.analysis;
    const prior = a?.isReplay ? findOriginal(m, moments) : undefined;
    if (prior) {
      spikes.push(spike(m, "replay", `Broadcast replay of ${prior.title.toLowerCase()} at ${formatTimecode(prior.primary.start)}, which is already in the pool.`, prior.id));
    } else if (a && !a.brandSafe) {
      spikes.push(spike(m, "brand-safety", a.brandSafetyNote ?? "Pegasus flagged this as not brand-safe."));
    } else if (a?.quality === "poor") {
      spikes.push(spike(m, "quality", `Pegasus rated the footage poor: ${a.description}`));
    } else if (m.kind === "sponsor" && a && !partnerIn(m, partners)) {
      const seen = a.sponsorsVisible.join(", ");
      spikes.push(spike(m, "rights", seen ? `The logo in frame (${seen}) is not one of the club's partners.` : "Pegasus could not read a partner logo in frame."));
    } else if (m.score < WEAK_SCORE && !m.signals.some((s) => s.source !== "footage")) {
      spikes.push(spike(m, "weak", `Only the "${m.signals[0]?.label ?? m.title}" search found it, scoring ${pct(m.score)}, and nothing outside the footage points at it.`));
    } else if (analysed && !a) {
      spikes.push(spike(m, "cut-for-time", `Pegasus only looked at the strongest moments, and this one ranked below them at ${pct(m.score)}.`));
    } else {
      live.push(m);
    }
  }

  const pitched = live.flatMap((m) => pitchesFor(m, partners).map((p) => toProposal(m, p, opts.assets, opts.now)));
  pitched.sort((a, b) => b.score - a.score);

  const keep = opts.keep ?? 15;
  const perMoment = new Map<string, number>();
  const perAudience = new Map<Audience, number>();
  const proposals: Proposal[] = [];
  for (const p of pitched) {
    if (proposals.length >= keep) break;
    if ((perMoment.get(p.momentId) ?? 0) >= MAX_PER_MOMENT) continue;
    if ((perAudience.get(p.audience) ?? 0) >= MAX_PER_AUDIENCE) continue;
    proposals.push(p);
    perMoment.set(p.momentId, (perMoment.get(p.momentId) ?? 0) + 1);
    perAudience.set(p.audience, (perAudience.get(p.audience) ?? 0) + 1);
  }

  markShortlist(proposals);

  const chosen = new Set(proposals.map((p) => p.momentId));
  const lastKept = proposals.at(-1)?.score ?? 0;
  for (const m of live) {
    if (chosen.has(m.id)) continue;
    const best = pitched.find((p) => p.momentId === m.id);
    if (m.publishedIn) {
      spikes.push(spike(m, "already-published", `The club already posted this in "${m.publishedIn}".`));
    } else {
      spikes.push(spike(m, "cut-for-time", best ? `Best pitch (${AUDIENCE_LABEL[best.audience]}) scored ${pct(best.score)}; the last proposal kept scored ${pct(lastKept)}.` : "No format suited this moment."));
    }
  }

  proposals.sort((a, b) => Number(b.shortlist) - Number(a.shortlist) || b.score - a.score);
  return { proposals, spikes, storage: storageVerdicts(opts.assets, moments) };
}

/** Flags the best piece from each of the strongest moments, so one goal cannot fill the shortlist. */
function markShortlist(byScore: Proposal[]) {
  const moments = new Set<string>();
  for (const p of byScore) {
    if (moments.size >= SHORTLIST) break;
    if (moments.has(p.momentId)) continue;
    moments.add(p.momentId);
    p.shortlist = true;
  }
}

/** The first club partner whose logo Pegasus read in the moment. */
function partnerIn(m: Moment, partners: string[]) {
  return m.analysis?.sponsorsVisible.find((s) => partners.some((p) => s.toLowerCase().includes(p)));
}

export function pitchesFor(m: Moment, partners: string[]): Pitch[] {
  const partner = partnerIn(m, partners);
  if (m.kind === "sponsor") return PITCHES.sponsor.map((p) => ({ ...p, partner }));
  const pitches = [...PITCHES[m.kind]];
  if (partner && (m.analysis?.intensity ?? 0) >= 0.6) {
    pitches.push({ ...pitch("partner", "Partner", "16:9", 20, "clip", 0.8, `a big moment with ${partner} readable in frame`), partner });
  }
  if (m.archive) {
    pitches.push(pitch("player-fans", "Instagram", "9:16", 30, "then-and-now", 0.85, "today's moment cut against the archive clip"));
  }
  return pitches;
}

export function toProposal(m: Moment, pitch: Pitch, assets: Asset[], now: string): Proposal {
  const a = m.analysis;
  const momentStrength = a ? 0.5 * m.score + 0.5 * a.intensity : m.score;
  const signal = combineStrengths(m.signals.filter((s) => s.source !== "footage").map((s) => s.strength));
  const novelty = m.publishedIn ? 0.3 : 1;
  const raw = 0.5 * momentStrength + 0.2 * signal + 0.3 * pitch.fit;
  const score = round2(raw * (0.5 + 0.5 * novelty));

  return {
    id: `${m.id}-${pitch.audience}-${pitch.platform.toLowerCase().replace(/\s+/g, "-")}-${pitch.format.kind}`,
    momentId: m.id,
    title: a?.hook && pitch.audience === "social-native" ? a.hook : `${m.title}: ${pitch.angle}`,
    audience: pitch.audience,
    platform: pitch.platform,
    format: pitch.format,
    cut: buildCut(m, pitch, assets),
    hook: a?.hook ?? m.title,
    caption: a?.captions[pitch.audience] ?? a?.description ?? m.title,
    why: whyNow(m, pitch),
    signals: m.signals,
    score,
    scoreParts: { moment: round2(momentStrength), signal: round2(signal), fit: pitch.fit, novelty },
    partner: pitch.partner,
    matchEventId: matchEventOf(m),
    shortlist: false,
    readyAt: now,
    freshForMinutes: freshForMinutes(pitch.platform, m.kind),
    status: "review",
  };
}

function buildCut(m: Moment, pitch: Pitch, assets: Asset[]): Segment[] {
  const duration = (id: string) => assets.find((x) => x.id === id)?.durationSec;
  const focus: Segment = {
    ...m.primary,
    start: m.analysis?.bestStart ?? m.primary.start,
    end: m.analysis?.bestEnd ?? m.primary.end,
  };
  const len = pitch.format.lengthSec;

  if (pitch.format.kind === "then-and-now" && m.archive) {
    return [
      { ...fitSegment(m.archive, len * 0.4, duration(m.archive.assetId)), note: "Then" },
      { ...fitSegment(focus, len * 0.6, duration(focus.assetId)), note: "Now" },
    ];
  }
  const crowdAngle = m.angles[0];
  if (pitch.format.kind === "reaction" && crowdAngle) {
    return [
      { ...fitSegment(focus, len * 0.5, duration(focus.assetId)), note: "The moment" },
      { ...fitSegment(crowdAngle, len * 0.5, duration(crowdAngle.assetId)), note: "The reaction" },
    ];
  }
  return [fitSegment(focus, len, duration(focus.assetId))];
}

function whyNow(m: Moment, pitch: Pitch): string {
  const parts: string[] = [];
  const fans = m.signals.filter((s) => s.source === "fans");
  if (fans.length) parts.push(fans.length === 1 ? "A fan post points at this moment." : `${fans.length} fan posts point at this moment.`);
  const log = m.signals.find((s) => s.source === "match-log");
  if (log) parts.push(`It is in the match log: ${log.label}.`);
  const probes = m.signals.filter((s) => s.source === "footage").length;
  if (probes > 1) parts.push(`${probes} separate searches landed on it.`);
  if (m.angles.length) parts.push(`There is a second angle on ${m.angles.length === 1 ? "another camera" : `${m.angles.length} other cameras`}.`);
  if (m.publishedIn) parts.push(`The club already posted it in "${m.publishedIn}", so this cut aims somewhere new.`);
  parts.push(`For ${AUDIENCE_LABEL[pitch.audience]}: ${pitch.angle}.`);
  return parts.join(" ");
}

/** The earlier live moment a replay repeats: same video, same kind, within two minutes before. */
function findOriginal(replay: Moment, all: Moment[]) {
  return all.find(
    (o) =>
      o.id !== replay.id &&
      !o.analysis?.isReplay &&
      o.kind === replay.kind &&
      o.primary.videoId === replay.primary.videoId &&
      o.primary.start < replay.primary.start &&
      replay.primary.start - o.primary.end <= 120,
  );
}

function storageVerdicts(assets: Asset[], moments: Moment[]): StorageVerdict[] {
  return assets
    .filter((a) => a.kind === "video" && a.role !== "published-edit" && a.role !== "archive")
    .map((a) => {
      const primary = moments.filter((m) => m.primary.assetId === a.id).length;
      const angles = moments.filter((m) => m.angles.some((s) => s.assetId === a.id)).length;
      if (primary || angles) {
        const plural = (n: number) => (n === 1 ? "moment" : "moments");
        const reason = !angles
          ? `${primary} ${plural(primary)} came from it.`
          : !primary
            ? `Second angle for ${angles} ${plural(angles)}.`
            : `${primary} ${plural(primary)} came from it, and it is the second angle for ${angles} more.`;
        return { assetId: a.id, verdict: "keep" as const, reason };
      }
      return {
        assetId: a.id,
        verdict: "cold-storage" as const,
        reason: `None of the searches found a usable moment in ${a.durationSec ? formatTimecode(a.durationSec) : "this asset"}.`,
      };
    });
}

const matchEventOf = (m: Moment) => m.signals.find((s) => s.source === "match-log")?.ref;

export function spike(m: Moment, reason: Spike["reason"], detail: string, supersededBy?: string): Spike {
  return {
    id: `s-${m.id}`,
    momentId: m.id,
    title: m.title,
    kind: m.kind,
    segment: m.primary,
    matchEventId: matchEventOf(m),
    reason,
    detail,
    supersededBy,
    status: "spiked",
  };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const round2 = (n: number) => Math.round(n * 100) / 100;
