import { afterEach, expect, mock, spyOn, test } from "bun:test";

mock.module("server-only", () => ({}));
const { OpenAIError, openaiConfigured, parseWords, structured, withRetry } = await import("./openai");
const originalKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  mock.restore();
  if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalKey;
});

test("is off without a key", () => {
  delete process.env.OPENAI_API_KEY;
  expect(openaiConfigured()).toBe(false);
});

test("transcript words move to source time by the piece's offset, and junk entries are dropped", () => {
  const body = { words: [{ word: " What", start: 1.2, end: 1.5 }, { word: "a", start: 1.5, end: 1.6 }, { word: "", start: 2, end: 2.1 }, { word: "goal", start: "x", end: 3 }, { word: "late", start: 4, end: 3.9 }] };
  expect(parseWords(body, 600)).toEqual([
    { text: "What", start: 601.2, end: 601.5 },
    { text: "a", start: 601.5, end: 601.6 },
  ]);
  expect(parseWords({ text: "no word timings" }, 0)).toEqual([]);
});

test("retries rate limits and server errors, then gives up; a bad request fails at once", async () => {
  let calls = 0;
  const flaky = () => {
    calls += 1;
    if (calls < 3) throw new OpenAIError("busy", 429);
    return Promise.resolve("ok");
  };
  expect(await withRetry(flaky, { baseMs: 1 })).toBe("ok");
  expect(calls).toBe(3);

  calls = 0;
  await expect(withRetry(() => { calls += 1; throw new OpenAIError("down", 503); }, { baseMs: 1, retries: 2 })).rejects.toThrow("down");
  expect(calls).toBe(3);

  calls = 0;
  await expect(withRetry(() => { calls += 1; throw new OpenAIError("bad key", 401); }, { baseMs: 1 })).rejects.toThrow("bad key");
  expect(calls).toBe(1);
});

test("structured output is parsed and checked before it is used, and a reply that fails the check is an error", async () => {
  process.env.OPENAI_API_KEY = "test-key";
  const reply = (content: string) =>
    spyOn(globalThis, "fetch").mockImplementation(Object.assign(async () => Response.json({ choices: [{ message: { content } }] }), { preconnect: fetch.preconnect }));
  const isScore = (v: unknown): v is { score: number } => typeof v === "object" && v !== null && typeof (v as { score: unknown }).score === "number";
  const ask = () => structured({ name: "score", system: "s", user: "u", schema: { type: "object" }, check: isScore });

  const ok = reply('{"score": 0.7}');
  expect(await ask()).toEqual({ score: 0.7 });
  const sent = JSON.parse(String((ok.mock.calls[0][1] as RequestInit).body));
  expect(sent.response_format.type).toBe("json_schema");
  mock.restore();

  reply('{"score": "high"}');
  await expect(ask()).rejects.toThrow(/did not match/);
  mock.restore();
  reply("not json");
  await expect(ask()).rejects.toThrow(/did not match/);
});
