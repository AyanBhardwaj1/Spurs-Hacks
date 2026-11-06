import { expect, test } from "bun:test";
import { excitedCalls, fuseMoments, pickedMoment } from "./moments";

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

test("a shot and a goal call around one roar make one moment, and every moment has its own id", () => {
  const transcript = [...words(90, "oh my"), ...words(99.8, "goal")];
  const moments = fuseMoments({ durationSec: 900, peaks: [{ peak: 100, start: 85, end: 110, score: 1 }], words: transcript, cuts: [] });
  expect(moments).toHaveLength(1);
  expect(moments[0].signals).toEqual(["crowd", "commentary"]);
});

test("moments closer than the gap merge into the stronger one, and ids never repeat", () => {
  const moments = fuseMoments({
    durationSec: 900,
    peaks: [{ peak: 300, start: 285, end: 310, score: 1 }, { peak: 300.4, start: 285, end: 310, score: 0.5 }],
    words: words(330, "what a save"),
    cuts: [],
  });
  expect(moments.map((m) => m.peak)).toEqual([300, 330]);
  expect(new Set(moments.map((m) => m.id)).size).toBe(moments.length);
});

test("a moment the producer picks sits where they clicked, quotes what was said and is marked as theirs", () => {
  const m = pickedMoment(300, words(296, "and it is in the net"), 900, new Set(["m-300"]));
  expect(m).toMatchObject({ id: "m-300-2", peak: 300, start: 285, end: 310, score: 1, signals: ["producer"], title: "“and it is in the net” at 5:00", quote: "and it is in the net" });
  expect(pickedMoment(300, [], 900, new Set()).title).toBe("Picked at 5:00");
  expect(pickedMoment(5, [], 12, new Set())).toMatchObject({ id: "m-5", start: 0, end: 12 });
});
