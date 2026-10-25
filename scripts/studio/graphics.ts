import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { focusAt } from "../../src/lib/studio/reframe";
import type { Clip, FocusKey, Moment, Player } from "../../src/lib/studio/types";
import { assDocument, colourTag, assText, type AssEvent, type AssStyle } from "./ass";
import { hashOf } from "./cache";
import type { CrowdFrames } from "./crowd";
import { captionWord, nameFixer, phrases, rosterNames, wordsInClip, type Word } from "./captions";

// Club-style graphics for portrait and square clips, drawn by the same ffmpeg
// run that cuts the clip: a hook card over the opening, word-by-word captions
// from the commentary, a punch-in at the moment's beat, a player card with the
// ScorePlay headshot just after it, and an end card with the score. Text is an
// ASS file that libass burns in; the card box and headshot are overlays that
// share one eased slide. 16:9 clips keep the plain burned-in title.

const NAVY = "#132257";
const WHITE = "#FFFFFF";
/** Words not being spoken; light enough to read on navy, dim enough that the spoken word stands out. */
const PERIWINKLE = "#AFC0E8";
const RED_CARD = "#E3262F";
const FONT = { heavy: "Avenir Next Condensed Heavy", numbers: "DIN Condensed" };
const FONT_FILES = ["/System/Library/Fonts/Avenir Next Condensed.ttc", "/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf"];
const FPS = 25;

/** What the graphics need about a match that the analysis does not hold. */
export type MatchInfo = {
  home: string;
  away: string;
  spursAreHome: boolean;
  /** Opponents the commentary names, as the moment summaries spell them; ScorePlay's roster is Spurs only. */
  opponents: string[];
  /** Commentary mishearings too far from the name to correct by spelling. */
  aliases: Record<string, string>;
};

/**
 * Keyed by the source's ScorePlay media ID. Any other source gets no team
 * names, score, opponent spellings or aliases, rather than this match's.
 */
const MATCHES: Record<number, MatchInfo> = {
  // Manchester United vs Spurs, Full Match, 2026-27.
  130852725: {
    home: "Man United",
    away: "Spurs",
    spursAreHome: false,
    opponents: ["Mbeumo", "Cunha", "Martínez", "Shaw", "Dalot"],
    // 4660 s: the m-4668-goal summary has "Cunha plays the ball into Mbeumo".
    aliases: { Künlü: "Cunha" },
  },
};

const TIMING = {
  hookEnd: 1.3,
  endCard: 1.6,
  /** The player card enters this long after the beat, once the punch-in has eased out. */
  cardDelay: 1.0,
  cardHold: 2.8,
  cardIn: 0.35,
  cardOut: 0.22,
  /** Punch-in: eases in before the beat, holds, eases back out; 1.5 s in all. */
  punchLead: 0.4,
  punchHold: 0.5,
  punchOut: 0.6,
  punchZoom: 1.2,
};

type Layout = {
  width: number;
  height: number;
  /** Source pixels the crop keeps across, as render.ts crops a 1920x1080 source. */
  cropWidth: number;
  caption: { size: number; marginV: number; marginH: number };
  hook: { size: number; y: number };
  card: { x: number; y: number; height: number; head: number; name: number; clock: number };
  end: { size: number; mark: number };
};

// 9:16 keeps captions above the bottom quarter, where Reels and TikTok put
// their own caption and buttons; everything clears the scorebug's top-left corner.
const LAYOUTS: Record<"9:16" | "1:1", Layout> = {
  "9:16": {
    width: 1080, height: 1920, cropWidth: 606,
    caption: { size: 102, marginV: 470, marginH: 80 },
    hook: { size: 100, y: 640 },
    card: { x: 56, y: 1040, height: 220, head: 290, name: 100, clock: 70 },
    end: { size: 104, mark: 60 },
  },
  "1:1": {
    width: 1080, height: 1080, cropWidth: 1080,
    caption: { size: 90, marginV: 110, marginH: 70 },
    hook: { size: 92, y: 330 },
    card: { x: 48, y: 620, height: 180, head: 236, name: 82, clock: 58 },
    end: { size: 88, mark: 40 },
  },
};

export type GraphicsInput = {
  /** The source's ScorePlay media ID, which picks the match's names and score order. */
  sourceId: number;
  clip: Clip;
  moments: Moment[];
  /** The source's roster: names to spell captions by, and ScorePlay headshots. */
  players: Player[];
  /** Commentary words with source-second times: the SRT's words, timed by word-timing.ts. */
  words: Word[];
  focus: Map<string, FocusKey[]>;
  /** The match's crowd loudness frames (crowd-frames.json), to time a goal's beat. */
  crowd: CrowdFrames;
  /** A job directory for the ASS files, which must outlive the ffmpeg run. */
  dir: string;
};

export type Graphics = {
  /** Extra ffmpeg inputs, appended after the clip's segment inputs. */
  inputs: string[];
  /** Filters from the concatenated video `videoIn` to `out`; `firstInput` is the index of `inputs`' first input. */
  graph: (videoIn: string, out: string, firstInput: number) => string;
  /** Changes whenever anything drawn changes, for the render cache key. */
  key: string;
};

/** Home-away score just after source second `t`, counting goal moments. */
export function scoreAt(moments: Pick<Moment, "kind" | "team" | "peak">[], t: number, spursAreHome: boolean): string {
  const goals = moments.filter((m) => m.kind === "goal" && m.peak <= t);
  const spurs = goals.filter((m) => m.team === "spurs").length;
  const opponent = goals.filter((m) => m.team === "opponent").length;
  return spursAreHome ? `${spurs}-${opponent}` : `${opponent}-${spurs}`;
}

/** Clip seconds at which source second `t` first plays, or undefined if no segment holds it. */
export function clipTime(segments: Clip["segments"], t: number): number | undefined {
  let offset = 0;
  for (const s of segments) {
    if (t >= s.start && t < s.end) return offset + t - s.start;
    offset += s.end - s.start;
  }
  return undefined;
}

/** Where focus `x` (0 to 1 of the source width) lands across the cropped frame, 0 to 1. */
export function focusInCrop(x: number, cropWidth: number, sourceWidth = 1920): number {
  const left = Math.min(sourceWidth - cropWidth, Math.max(0, x * sourceWidth - cropWidth / 2));
  return (x * sourceWidth - left) / cropWidth;
}

/** An ffmpeg expression for the punch-in zoom at clip second `T`: ease-out cubic in, hold, smoothstep out. */
export function zoomExpression(beat: number, T: string): string {
  const { punchLead, punchHold, punchOut, punchZoom } = TIMING;
  const into = `clip((${T}-${(beat - punchLead).toFixed(3)})/${punchLead},0,1)`;
  const back = `clip((${T}-${(beat + punchHold).toFixed(3)})/${punchOut},0,1)`;
  return `(1+${(punchZoom - 1).toFixed(3)}*((1-pow(1-${into},3))-${back}*${back}*(3-2*${back})))`;
}

/** What the ffmpeg build and the fonts lack for clip graphics, one line per problem. */
export function graphicsToolProblems(ffmpeg: string): string[] {
  const probe = Bun.spawnSync([ffmpeg, "-hide_banner", "-filters"], { stderr: "ignore" });
  if (!probe.success) return [`ffmpeg not runnable at "${ffmpeg}"; set FFMPEG_PATH`];
  const filters = probe.stdout.toString();
  return [
    ...["ass", "perspective", "overlay"]
      .filter((filter) => !new RegExp(` ${filter} `).test(filters))
      .map((filter) => `${ffmpeg} has no ${filter} filter; set FFMPEG_PATH to an ffmpeg built with libass`),
    ...FONT_FILES.filter((f) => !existsSync(f)).map((f) => `font file ${f} is missing`),
  ];
}

/** The ASS document for captions, the hook card and the end card. */
export function overlayAss(input: Pick<GraphicsInput, "sourceId" | "clip" | "moments" | "players" | "words">, format: keyof typeof LAYOUTS): string {
  const { clip, moments, players } = input;
  const match = MATCHES[input.sourceId];
  const layout = LAYOUTS[format];
  const { width, height } = layout;
  const duration = clip.durationSec;
  const endStart = duration - TIMING.endCard;
  const styles: AssStyle[] = [
    {
      name: "Caption", font: FONT.heavy, size: layout.caption.size, colour: WHITE, spacing: 1,
      outline: { colour: "#070B1C", width: 3 }, box: { colour: NAVY, opacity: 0.82, padding: 18 },
      alignment: 2, marginH: layout.caption.marginH, marginV: layout.caption.marginV,
    },
    {
      name: "Hook", font: FONT.heavy, size: layout.hook.size, colour: WHITE, spacing: 1,
      box: { colour: NAVY, opacity: 0.94, padding: 26 }, alignment: 5, marginH: 80,
    },
    { name: "Plate", font: FONT.heavy, size: 10, colour: NAVY, alignment: 7 },
    { name: "Mark", font: FONT.heavy, size: layout.end.mark, colour: WHITE, spacing: 14, alignment: 5 },
    { name: "Score", font: FONT.heavy, size: layout.end.size, colour: WHITE, spacing: 2, alignment: 5, marginH: 60 },
  ];

  const fix = nameFixer([...rosterNames(players), ...(match?.opponents ?? [])], match?.aliases);
  const words = wordsInClip(input.words, clip.segments)
    .filter((w) => w.start >= TIMING.hookEnd && w.start < endStart)
    .filter((w) => captionWord(w.text) !== "")
    .map((w) => ({ ...w, text: fix(w.text) }));
  const inactive = `{\\1c${colourTag(PERIWINKLE)}}`;
  const active = `{\\1c${colourTag(WHITE)}}`;
  const captions: AssEvent[] = phrases(words).flatMap((phrase) =>
    phrase.words.map((word, k) => {
      const pop = k === 0 ? "{\\fscx94\\fscy94\\t(0,140,0.5,\\fscx100\\fscy100)}" : "";
      const text = phrase.words.map((w, j) => `${j === k ? active : inactive}${assText(captionWord(w.text))}`).join(" ");
      return {
        start: k === 0 ? phrase.start : word.start,
        end: Math.min(phrase.words[k + 1]?.start ?? phrase.end, endStart),
        style: "Caption",
        text: pop + text,
      };
    }),
  );

  const hook: AssEvent = {
    start: 0, end: TIMING.hookEnd, style: "Hook", layer: 2,
    text: `{\\an5\\pos(${width / 2},${layout.hook.y})\\fad(80,160)\\fscx94\\fscy94\\t(0,220,0.5,\\fscx100\\fscy100)}${assText(clip.title.toUpperCase())}`,
  };
  const cy = height / 2;
  const rise = "\\fscx96\\fscy96\\t(0,300,0.5,\\fscx100\\fscy100)";
  const end: AssEvent[] = [
    { start: endStart, end: duration + 1, style: "Plate", layer: 3, text: `{\\pos(0,0)\\1c${colourTag(NAVY)}\\1a&H0F&\\fad(220,0)\\p1}m 0 0 l ${width} 0 ${width} ${height} 0 ${height}{\\p0}` },
    { start: endStart + 0.08, end: duration + 1, style: "Mark", layer: 4, text: `{\\pos(${width / 2},${cy - layout.end.size * 1.05})\\fad(200,0)${rise}}RUNDOWN` },
    { start: endStart + 0.08, end: duration + 1, style: "Plate", layer: 4, text: `{\\pos(${width / 2 - 60},${cy - layout.end.size * 0.62})\\1c${colourTag(WHITE)}\\fad(200,0)\\p1}m 0 0 l 120 0 120 6 0 6{\\p0}` },
  ];
  if (match) {
    const score = `${match.home} ${scoreAt(moments, Infinity, match.spursAreHome)} ${match.away}`;
    end.push({ start: endStart + 0.14, end: duration + 1, style: "Score", layer: 4, text: `{\\pos(${width / 2},${cy + layout.end.size * 0.2})\\fad(200,0)${rise}}${assText(score.toUpperCase())}` });
  }
  return assDocument(width, height, styles, [...captions, hook, ...end]);
}

type Card = { player: Player; start: number; end: number; clock: string; red: boolean; width: number };

/** The player card's ASS: the name and the clock and score, drawn on the card's own navy box. */
function cardAss(card: Card, layout: Layout): string {
  const { height, head, name, clock } = layout.card;
  const textX = Math.round(head * 0.92 + 40);
  const styles: AssStyle[] = [
    { name: "Name", font: FONT.heavy, size: name, colour: WHITE, spacing: 1, alignment: 1 },
    { name: "Clock", font: FONT.numbers, size: clock, colour: PERIWINKLE, spacing: 1, alignment: 7 },
    { name: "Plate", font: FONT.heavy, size: 10, colour: WHITE, alignment: 7 },
  ];
  const nameBase = Math.round(height * 0.56);
  const clockTop = nameBase + Math.round(height * 0.06);
  const chip = card.red ? Math.round(clock * 0.5) : 0;
  const events: AssEvent[] = [
    { start: 0, end: 60, style: "Plate", text: `{\\pos(0,0)\\p1}m 0 0 l 8 0 8 ${height} 0 ${height}{\\p0}` },
    { start: 0, end: 60, style: "Name", text: `{\\pos(${textX},${nameBase})}${assText(card.player.shortName.toUpperCase())}` },
    { start: 0, end: 60, style: "Clock", text: `{\\pos(${textX + (chip ? chip + 14 : 0)},${clockTop})}${assText(card.clock)}` },
  ];
  if (chip) {
    const h = Math.round(chip * 1.4);
    events.push({ start: 0, end: 60, style: "Plate", text: `{\\pos(${textX + 2},${clockTop + Math.round(clock * 0.14)})\\1c${colourTag(RED_CARD)}\\p1}m 0 0 l ${chip} 0 ${chip} ${h} 0 ${h}{\\p0}` });
  }
  return assDocument(card.width, height, styles, events);
}

/**
 * A goal's beat from the crowd's roar, from the 100 ms crowd RMS frames, or
 * undefined without a clear roar near `peak`. A moment's peak comes from the
 * commentary SRT, which can sit seconds off the picture: 2 s before Solanke's
 * header and 2.5 s before Mbeumo's shot. This takes the steepest 1 s rise of
 * the crowd floor (the 20th percentile of a 1 s window, which ignores speech)
 * from 2 s before the peak to 6 s after, plus 0.4 s; in the rendered frames
 * that lands on Solanke's header and on Mbeumo's shot.
 */
export function roarOnset(frames: CrowdFrames, peak: number, minRiseDb = 4): number | undefined {
  const step = frames.frameSec;
  const perSec = Math.round(1 / step);
  const floor = (i: number) => {
    const window = frames.rmsDb.slice(Math.max(0, i - perSec / 2), i + perSec / 2).sort((a, b) => a - b);
    return window[Math.floor(window.length * 0.2)];
  };
  let best = { rise: -Infinity, at: 0 };
  for (let i = Math.round((peak - 2) / step); i <= Math.round((peak + 6) / step); i++) {
    if (i - perSec / 2 < 0 || i + perSec * 1.5 > frames.rmsDb.length) continue;
    const rise = floor(i + perSec) - floor(i);
    if (rise > best.rise) best = { rise, at: i * step };
  }
  return best.rise >= minRiseDb ? Math.round((best.at + 0.4) * 100) / 100 : undefined;
}

/**
 * The moment a clip is about (the first segment's moment that plays its own
 * peak) and its beat in clip seconds: the roar's onset for a goal, else the peak.
 */
function mainMoment(clip: Clip, moments: Moment[], crowd: CrowdFrames): { moment: Moment; beat: number; at: number } | undefined {
  for (const s of clip.segments) {
    const moment = moments.find((m) => m.id === s.momentId);
    if (!moment || clipTime(clip.segments, moment.peak) === undefined) continue;
    const roar = moment.kind === "goal" ? roarOnset(crowd, moment.peak) : undefined;
    const beat = roar !== undefined && clipTime(clip.segments, roar) !== undefined ? roar : moment.peak;
    return { moment, beat, at: clipTime(clip.segments, beat)! };
  }
  return undefined;
}

export function clipGraphics(input: GraphicsInput): Graphics | undefined {
  const { clip, moments, players, focus, dir } = input;
  if (clip.format === "16:9") return undefined;
  const layout = LAYOUTS[clip.format];
  const overlay = overlayAss(input, clip.format);
  const overlayFile = join(dir, `${clip.id}.ass`);
  writeFileSync(overlayFile, overlay);

  const main = mainMoment(clip, moments, input.crowd);
  const endStart = clip.durationSec - TIMING.endCard;
  // The analysis lists a moment's main player first. Only Spurs players have ScorePlay headshots.
  const player = main && players.find((p) => p.id === main.moment.players[0] && p.photoUrl);
  let card: Card | undefined;
  if (main && player) {
    const start = main.at + TIMING.cardDelay;
    const end = Math.min(start + TIMING.cardHold, endStart);
    const match = MATCHES[input.sourceId];
    const score = match && scoreAt(moments, main.moment.peak, match.spursAreHome);
    const clock = [main.moment.matchClock, score].filter(Boolean).join(" · ");
    const nameWidth = player.shortName.length * layout.card.name * 0.5;
    const width = Math.round(Math.min(layout.width - 2 * layout.card.x, Math.max(layout.width * 0.5, layout.card.head * 0.92 + 40 + nameWidth + 60)));
    if (end - start >= 1.5) card = { player, start, end, clock, red: main.moment.kind === "card", width };
  }
  const cardFile = join(dir, `${clip.id}.card.ass`);
  const cardDoc = card ? cardAss(card, layout) : "";
  if (card) writeFileSync(cardFile, cardDoc);

  let punch: { at: number; cx: number } | undefined;
  if (main) {
    const keys = focus.get(main.moment.id) ?? [];
    punch = { at: main.at, cx: focusInCrop(focusAt(keys, main.beat), layout.cropWidth) };
  }

  const quote = (path: string) => `'${path.replace(/'/g, "\\'")}'`;
  const graph = (videoIn: string, out: string, firstInput: number) => {
    const { width: W, height: H } = layout;
    const chain: string[] = [];
    if (punch) {
      const z = zoomExpression(punch.at, `(on/${FPS})`);
      const cx = Math.round(punch.cx * W);
      const cy = Math.round(H * 0.5);
      const x0 = `${cx}*(1-1/${z})`;
      const y0 = `${cy}*(1-1/${z})`;
      chain.push(
        `perspective=x0='${x0}':y0='${y0}':x1='${x0}+${W}/${z}':y1='${y0}':x2='${x0}':y2='${y0}+${H}/${z}':x3='${x0}+${W}/${z}':y3='${y0}+${H}/${z}':interpolation=linear:eval=frame`,
      );
    }
    chain.push(`ass=filename=${quote(overlayFile)}`);
    if (!card) return `${videoIn}${chain.join(",")}${out}`;

    const { x, y, height, head } = layout.card;
    const length = card.end - card.start;
    const fades = `fade=t=in:st=0:d=0.2:alpha=1,fade=t=out:st=${(length - TIMING.cardOut).toFixed(2)}:d=${TIMING.cardOut}:alpha=1,setpts=PTS+${card.start.toFixed(3)}/TB`;
    const slide =
      `${x}-80*pow(1-clip((t-${card.start.toFixed(3)})/${TIMING.cardIn},0,1),3)` +
      `-30*pow(clip((t-${(card.end - TIMING.cardOut).toFixed(3)})/${TIMING.cardOut},0,1),2)`;
    const headY = y + height - head;
    return (
      `${videoIn}${chain.join(",")}[gfx0];` +
      `color=c=0x${NAVY.slice(1)}:s=${card.width}x${height}:r=${FPS}:d=${length.toFixed(2)},ass=filename=${quote(cardFile)},format=rgba,${fades}[gfxbox];` +
      `[${firstInput}:v]scale=-1:${head},format=rgba,${fades}[gfxhead];` +
      `[gfx0][gfxbox]overlay=x='${slide}':y=${y}:eof_action=pass[gfx1];` +
      `[gfx1][gfxhead]overlay=x='${slide}+16':y=${headY}:eof_action=pass${out}`
    );
  };

  const inputs = card ? ["-loop", "1", "-framerate", String(FPS), "-t", (card.end - card.start).toFixed(2), "-i", card.player.photoUrl!] : [];
  return { inputs, graph, key: hashOf(overlay, cardDoc, JSON.stringify(punch ?? null), JSON.stringify(inputs)) };
}
