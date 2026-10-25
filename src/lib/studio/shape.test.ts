import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { analysisProblems } from "./shape";

const real = () => JSON.parse(readFileSync(path.join(import.meta.dir, "data/mnu-tot.json"), "utf8"));

describe("analysisProblems", () => {
  test("accepts the pipeline's current output", () => {
    expect(analysisProblems(real())).toEqual([]);
  });

  test("names the fields the review found unchecked", () => {
    const a = real();
    delete a.source.name;
    delete a.source.players;
    a.source.durationSec = "6334";
    delete a.eval.matched;
    a.eval.recall = null;
    expect(analysisProblems(a)).toEqual(["source.name", "source.durationSec", "source.players", "eval.matched", "eval.recall"]);
  });

  test("names the first bad item in a list, down to the nested field", () => {
    const a = real();
    delete a.moments[5].scores.total;
    delete a.moments[9].scores.total;
    a.clips[2].segments = [];
    expect(analysisProblems(a)).toEqual(["moments[5].scores.total", "clips[2].segments (empty)"]);
  });

  test("rejects a date it cannot read and an empty ranking", () => {
    const a = real();
    a.generatedAt = "yesterday";
    a.eval.atK = [];
    expect(analysisProblems(a)).toEqual(["generatedAt (not a date)", "eval.atK (empty)"]);
  });
});
