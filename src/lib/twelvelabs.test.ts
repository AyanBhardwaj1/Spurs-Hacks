import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";

mock.module("server-only", () => ({}));
const { analyze, TwelveLabsError } = await import("./twelvelabs");

const originalKey = process.env.TWELVELABS_API_KEY;
const originalIndex = process.env.TWELVELABS_INDEX_ID;

afterEach(() => {
  mock.restore();
  if (originalKey === undefined) delete process.env.TWELVELABS_API_KEY;
  else process.env.TWELVELABS_API_KEY = originalKey;
  if (originalIndex === undefined) delete process.env.TWELVELABS_INDEX_ID;
  else process.env.TWELVELABS_INDEX_ID = originalIndex;
});

describe("Pegasus request bounds", () => {
  test("rejects a fetch that never resolves", async () => {
    process.env.TWELVELABS_API_KEY = "test-key";
    process.env.TWELVELABS_INDEX_ID = "test-index";
    let signal: AbortSignal | null | undefined;
    const stalledFetch = Object.assign((_url: URL | RequestInfo, init?: RequestInit) => {
      signal = init?.signal;
      return new Promise<Response>(() => {});
    }, { preconnect: fetch.preconnect });
    spyOn(globalThis, "fetch").mockImplementation(stalledFetch);

    const error = await analyze({
      assetId: "asset",
      prompt: "find the moment",
      schema: { type: "object" },
      resumeTaskId: "stalled-task",
      timeoutMs: 20,
    }).catch((value: unknown) => value);

    expect(error).toBeInstanceOf(TwelveLabsError);
    if (!(error instanceof TwelveLabsError)) throw error;
    expect(error.status).toBe(504);
    expect(error.message).toContain("stalled-task exceeded its 20 ms deadline");
    expect(signal?.aborted).toBe(true);
  }, 500);
});
