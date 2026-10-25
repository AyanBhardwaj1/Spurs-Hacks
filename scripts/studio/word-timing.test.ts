import { expect, test } from "bun:test";
import { alignWords, whisperProblems } from "./word-timing";

const word = (text: string, start: number, end = start + 0.3) => ({ text, start, end });
const round = (words: { text: string; start: number; end: number }[]) => words.map((w) => [w.text, Math.round(w.start * 100) / 100]);

test("moves SRT words to when whisper heard them, packing a misheard name just before the next heard word", () => {
  // The SRT has the line 2.5 s early; whisper heard "Mbeumo" as "Pomo".
  const srt = [word("way.", 7.2), word("Mbeumo", 15.6), word("turns", 15.9), word("and", 16.3), word("scores!", 16.5)];
  const heard = [word("way", 7.8, 8), word("Pomo", 18), word("turns", 18.3), word("and", 18.6), word("scores", 18.8, 19.4)];
  expect(round(alignWords(srt, heard))).toEqual([["way.", 7.8], ["Mbeumo", 17.93], ["turns", 18.3], ["and", 18.6], ["scores!", 18.8]]);
});

test("keeps the SRT's times when whisper heard none of its words", () => {
  const srt = [word("Tonali.", 6)];
  expect(alignWords(srt, [word("crowd", 6.2)])).toEqual(srt);
});

test("does not match a common word from a different line seconds away", () => {
  const srt = [word("the", 10), word("net!", 10.3)];
  const heard = [word("the", 20), word("net", 10.6)];
  expect(round(alignWords(srt, heard))[1]).toEqual(["net!", 10.6]);
  expect(alignWords(srt, heard)[0].start).toBeLessThan(10.6);
});

test("matches a name whisper got one letter wrong", () => {
  const srt = [word("Fernandes.", 4), word("Tonali.", 6)];
  const heard = [word("Fernandes.", 5.2, 5.8), word("Tenali.", 9.3, 9.8)];
  expect(round(alignWords(srt, heard))).toEqual([["Fernandes.", 5.2], ["Tonali.", 9.3]]);
});

test("names a missing whisper-cli and model before any render starts", () => {
  const problems = whisperProblems("no-such-whisper-cli", "/nonexistent/ggml-small.en.bin");
  expect(problems).toHaveLength(2);
  expect(problems[0]).toContain("no-such-whisper-cli");
  expect(problems[1]).toContain("/nonexistent/ggml-small.en.bin");
});
