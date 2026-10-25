import type { ClipSegment, Player } from "../../src/lib/studio/types";
import type { Cue } from "./srt";

// Burned-in captions come from the full match's commentary subtitles. The SRT
// times whole lines, not words, so each word gets a share of its line's time
// by length, packed from the line's start at a speaking pace: a 4 s line that
// only says "Tonali." shows the name when it is said, not for 4 s.

/** A word with source-second times. */
export type Word = { text: string; start: number; end: number };

/** Seconds a word of `n` characters takes to say, roughly three words a second. */
export const sayTime = (n: number) => 0.1 + 0.045 * n;

/** Splits a cue into words and spreads its time across them by length. */
export function cueWords(cue: Cue): Word[] {
  const texts = cue.text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  if (texts.length === 0) return [];
  const weights = texts.map((w) => sayTime(w.length));
  const total = weights.reduce((a, b) => a + b, 0);
  const span = Math.min(cue.end - cue.start, total);
  const words: Word[] = [];
  let at = cue.start;
  texts.forEach((text, i) => {
    const length = (weights[i] / total) * span;
    words.push({ text, start: at, end: at + length });
    at += length;
  });
  return words;
}

/**
 * Places source-time words on the clip's timeline. A word belongs to every
 * segment it overlaps (a replayed range repeats its commentary, since the
 * audio repeats too), clamped to that segment, so a segment that starts
 * mid-word still shows it.
 */
export function wordsInClip(words: Word[], segments: Pick<ClipSegment, "start" | "end">[]): Word[] {
  const out: Word[] = [];
  let offset = 0;
  for (const s of segments) {
    for (const w of words) {
      if (w.end > s.start && w.start < s.end) {
        out.push({ text: w.text, start: offset + Math.max(w.start, s.start) - s.start, end: offset + Math.min(w.end, s.end) - s.start });
      }
    }
    offset += s.end - s.start;
  }
  return out.sort((a, b) => a.start - b.start);
}

const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

export function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return row[b.length];
}

/**
 * Rewrites capitalised words that name a player into the roster's spelling:
 * an exact match once accents and case are ignored ("Savio" to "Sávio"), or one
 * edit away for names of six letters or more ("Matheus" to "Mateus"). Shorter
 * names need the exact match, because one edit turns "Gray" into "Grey" or
 * "Shaw" into "Show". `aliases` covers mishearings too far off to match.
 */
export function nameFixer(names: string[], aliases: Record<string, string> = {}): (text: string) => string {
  const tokens = new Map<string, string>();
  for (const name of names) {
    for (const token of name.split(/[\s-]+/)) {
      if (token.length >= 4 && /^\p{Lu}/u.test(token)) tokens.set(fold(token), token);
    }
  }
  const aliased = new Map(Object.entries(aliases).map(([from, to]) => [fold(from), to]));
  return (text) =>
    text.replace(/\p{Lu}[\p{L}]+/gu, (word) => {
      const key = fold(word);
      const exact = aliased.get(key) ?? tokens.get(key);
      if (exact) return exact;
      if (key.length < 6) return word;
      for (const [folded, token] of tokens) {
        if (Math.abs(folded.length - key.length) <= 1 && editDistance(folded, key) === 1) return token;
      }
      return word;
    });
}

/** Every spelling a caption may correct towards: the roster's short and full names. */
export const rosterNames = (players: Player[]) => players.flatMap((p) => [p.shortName, p.name]);

/** Caption text for a word: uppercase, without the commas and full stops that read as clutter on screen. */
export const captionWord = (text: string) => text.replace(/[.,;:…-]+$/u, "").replace(/^[-…]+/u, "").toUpperCase();

export type Phrase = { words: Word[]; start: number; end: number };

/**
 * Groups words into short on-screen phrases: at most `maxWords` words and
 * `maxChars` characters, broken after punctuation and at pauses. A phrase
 * stays up `hold` seconds after its last word unless the next one starts first.
 */
export function phrases(words: Word[], { maxWords = 3, maxChars = 18, pause = 0.5, hold = 0.5 } = {}): Phrase[] {
  const groups: Word[][] = [];
  for (const word of words) {
    const group = groups.at(-1);
    const last = group?.at(-1);
    const chars = group ? group.map((w) => captionWord(w.text)).join(" ").length + 1 + captionWord(word.text).length : 0;
    const fits = group && last && group.length < maxWords && chars <= maxChars && word.start - last.end <= pause && !/[.,!?;:…-]$/u.test(last.text);
    if (fits) group.push(word);
    else groups.push([word]);
  }
  return groups.map((group, i) => {
    const next = groups[i + 1]?.[0].start ?? Infinity;
    return { words: group, start: group[0].start, end: Math.min(group.at(-1)!.end + hold, next) };
  });
}
