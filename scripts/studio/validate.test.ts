import { expect, test } from "bun:test";
import analysis from "../../src/lib/studio/data/mnu-tot.json";
import { assertAnalysis } from "./validate";

test("fails if optional tags or audience are required, or invalid supplied values pass", () => {
  const input = structuredClone(analysis);
  const moment: Partial<(typeof input.moments)[number]> = input.moments[0];
  const clip: Partial<(typeof input.clips)[number]> = input.clips[0];
  delete moment.tags;
  delete clip.audience;
  expect(() => assertAnalysis(input)).not.toThrow();
  expect(() => assertAnalysis({ ...input, moments: [{ ...moment, tags: ["invalid"] }, ...input.moments.slice(1)] })).toThrow("tags");
  expect(() => assertAnalysis({ ...input, clips: [{ ...clip, audience: "invalid" }, ...input.clips.slice(1)] })).toThrow("audience");
});
