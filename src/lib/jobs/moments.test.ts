import { expect, test } from "bun:test";
import { excitedCalls, fuseMoments } from "./moments";

const words = (at: number, text: string) => text.split(" ").map((t, i) => ({ text: t, start: at + i * 0.4, end: at + i * 0.4 + 0.35 }));

test("commentary calls are found by phrase, any sport, and nearby calls count once", () => {
  const transcript = [...words(100, "and he shoots"), ...words(102, "What a goal!"), ...words(104, "unbelievable"), ...words(400, "Touchdown, Chiefs")];
  expect(excitedCalls(transcript).map((c) => c.at)).toEqual([102, 400]);
  expect(excitedCalls(words(10, "a calm passage of play in midfield"))).toEqual([]);
});

test("a moment the crowd and the commentary agree on outranks either alone", () => {
  const moments = fuseMoments({
    durationSec: 900,
    peaks: [{ peak: 300, start: 285, end: 310, score: 1 }, { peak: 600, start: 585, end: 610, score: 0.9 }],
    words: words(298, "what a save"),
    cuts: [],
  });
  expect(moments.map((m) => [m.peak, m.signals])).toEqual([
    [300, ["crowd", "commentary"]],
    [600, ["crowd"]],
  ]);
  expect(moments[0].score).toBeGreaterThan(moments[1].score);
  expect(moments[0].quote).toBe("what a save");
});

test("a call with no roar behind it still becomes a moment, scored below the crowd's", () => {
  const moments = fuseMoments({ durationSec: 900, peaks: [{ peak: 300, start: 285, end: 310, score: 1 }], words: words(700, "oh my word"), cuts: [] });
  const call = moments.find((m) => m.signals.join() === "commentary")!;
  expect(call.peak).toBe(700);
  expect(call.start).toBe(685);
  expect(call.score).toBeLessThan(moments[0].score);
});

test("edges snap to a camera cut within three seconds, never past the peak", () => {
  const [m] = fuseMoments({ durationSec: 900, peaks: [{ peak: 300, start: 285, end: 310, score: 1 }], words: [], cuts: [283.4, 296, 311.2, 330] });
  expect(m.start).toBe(283.4);
  expect(m.end).toBe(311.2);
});

test("titles say what happened and when, in match time", () => {
  const moments = fuseMoments({ durationSec: 4000, peaks: [{ peak: 3725, start: 3710, end: 3735, score: 1 }], words: words(3723, "What a goal!"), cuts: [] });
  expect(moments[0].title).toBe("“What a goal!” at 62:05");
  expect(fuseMoments({ durationSec: 900, peaks: [{ peak: 65, start: 50, end: 75, score: 1 }], words: [], cuts: [] })[0].title).toBe("Crowd erupts at 1:05");
});
