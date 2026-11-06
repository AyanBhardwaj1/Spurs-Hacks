import { expect, test } from "bun:test";
import { SAMPLE, sampleMatchArgs } from "./sample";

test("the sample match is a test pattern with crowd noise that roars at the planned seconds", () => {
  const args = sampleMatchArgs("out.mp4");
  expect(args).toContain(`testsrc2=size=1280x720:rate=25:duration=${SAMPLE.durationSec}`);
  expect(args).toContain(`anoisesrc=d=${SAMPLE.durationSec}:c=pink:a=0.04`);
  const graph = args[args.indexOf("-filter_complex") + 1];
  for (const r of SAMPLE.roars) expect(graph).toContain(`between(t,${r.at},${r.at + r.seconds})*${r.gain}`);
  expect(args.at(-1)).toBe("out.mp4");
});

test("roars are far enough apart to be separate moments, and inside the match", () => {
  const ats = SAMPLE.roars.map((r) => r.at);
  for (let i = 1; i < ats.length; i++) expect(ats[i] - ats[i - 1]).toBeGreaterThanOrEqual(30);
  for (const r of SAMPLE.roars) expect(r.at + r.seconds).toBeLessThan(SAMPLE.durationSec);
});
