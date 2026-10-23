import { expect, test } from "bun:test";
import { matchMoments } from "./search-moments";
import type { Moment, Player } from "./types";

const moment = (start: number, fields: Partial<Moment>): Moment => ({
  id: `m-${start}`,
  kind: "other",
  title: "",
  summary: "",
  start,
  end: start + 10,
  peak: start,
  players: [],
  team: "neutral",
  evidence: [],
  scores: { importance: 0, emotion: 0, crowd: 0, social: 0, total: 0 },
  focus: [],
  ...fields,
});

const roster: Player[] = [{ id: 7, name: "Destiny Udogie", shortName: "Udogie" }];

test("a title or kind match outranks a moment whose commentary only mentions the word", () => {
  const moments = [
    moment(100, { kind: "save", summary: "The keeper keeps it out after the goal kick", scores: { importance: 0, emotion: 0, crowd: 0, social: 0, total: 0.9 } }),
    moment(200, { kind: "goal", title: "Solanke equalises", scores: { importance: 0, emotion: 0, crowd: 0, social: 0, total: 0.1 } }),
  ];
  expect(matchMoments("goal", moments, roster).map((h) => h.start)).toEqual([200, 100]);
});

test("equal scores fall back to the moment's ranking total", () => {
  const moments = [
    moment(100, { kind: "goal", scores: { importance: 0, emotion: 0, crowd: 0, social: 0, total: 0.4 } }),
    moment(200, { kind: "goal", scores: { importance: 0, emotion: 0, crowd: 0, social: 0, total: 0.8 } }),
  ];
  expect(matchMoments("goal", moments, roster)).toEqual([
    { start: 200, end: 210, rank: 1 },
    { start: 100, end: 110, rank: 2 },
  ]);
});

test("an unaccented name matches an accented title", () => {
  const moments = [moment(100, { kind: "card", title: "Martínez booked for a late tackle" })];
  expect(matchMoments("Martinez", moments, roster).map((h) => h.start)).toEqual([100]);
});

test("a player matches through the roster's short name alone", () => {
  const moments = [moment(100, { kind: "tackle", title: "Left back wins it back", players: [7] }), moment(200, { kind: "tackle" })];
  expect(matchMoments("Udogie", moments, roster).map((h) => h.start)).toEqual([100]);
});

test("returns nothing for stop words only, or when any request word is missing", () => {
  const moments = [moment(100, { kind: "goal", title: "Solanke equalises" })];
  expect(matchMoments("the of", moments, roster)).toEqual([]);
  expect(matchMoments("Solanke penalty", moments, roster)).toEqual([]);
});
