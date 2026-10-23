import { expect, test } from "bun:test";
import { findRejected, hasRescue, rescueKey, rescueRange } from "./rescue-log";
import type { Rejected } from "./types";

test("rescueKey rounds the candidate second to one decimal", () => {
  expect(rescueKey(130852725, 5819.92)).toBe("rundown-rescue:130852725:5819.9");
});

test("rescueRange uses the moment's range, else 5 s before to 10 s after inside the source", () => {
  expect(rescueRange({ at: 100 }, { start: 90, end: 120 }, 6334)).toEqual({ start: 90, end: 120 });
  expect(rescueRange({ at: 5 }, undefined, 6334)).toEqual({ start: 0, end: 15 });
  expect(rescueRange({ at: 6330 }, undefined, 6334)).toEqual({ start: 6325, end: 6334 });
});

test("hasRescue matches only a comment carrying the bracketed key", () => {
  const key = rescueKey(1, 10);
  expect(hasRescue([{ comment: `Rescued\n[${key}]` }], key)).toBe(true);
  expect(hasRescue([{ comment: key }], key)).toBe(false);
  expect(hasRescue([{}], key)).toBe(false);
  expect(hasRescue([{ comment: `[${rescueKey(1, 11)}]` }], key)).toBe(false);
});

test("findRejected needs the exact title at that second", () => {
  const rejected: Rejected[] = [{ title: "Son shoots wide", at: 42, source: "commentary", reason: "Off target." }];
  expect(findRejected(rejected, 42, "Son shoots wide")).toBe(rejected[0]);
  expect(findRejected(rejected, 42, "Son shoots wid")).toBeUndefined();
});
