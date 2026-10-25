import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";

mock.module("server-only", () => ({}));
const { searchMatch } = await import("./search");

const originalKey = process.env.TWELVELABS_API_KEY;
const originalIndex = process.env.TWELVELABS_INDEX_ID;

afterEach(() => {
  mock.restore();
  if (originalKey === undefined) delete process.env.TWELVELABS_API_KEY;
  else process.env.TWELVELABS_API_KEY = originalKey;
  if (originalIndex === undefined) delete process.env.TWELVELABS_INDEX_ID;
  else process.env.TWELVELABS_INDEX_ID = originalIndex;
});

describe("studio search", () => {
  test("passes caller cancellation to Twelve Labs", async () => {
    process.env.TWELVELABS_API_KEY = "test-key";
    process.env.TWELVELABS_INDEX_ID = "test-index";
    let requestSignal: AbortSignal | undefined;
    const stalledFetch = Object.assign((_url: URL | RequestInfo, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return new Promise<Response>(() => {});
    }, { preconnect: fetch.preconnect });
    spyOn(globalThis, "fetch").mockImplementation(stalledFetch);
    const controller = new AbortController();
    const pending = searchMatch("goal", 10, controller.signal);
    setTimeout(() => controller.abort(), 10);

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(requestSignal?.aborted).toBe(true);
  }, 500);

  test("rejects a third search while two requests are in flight", async () => {
    process.env.TWELVELABS_API_KEY = "test-key";
    process.env.TWELVELABS_INDEX_ID = "test-index";
    spyOn(globalThis, "fetch").mockImplementation(Object.assign(() => new Promise<Response>(() => {}), { preconnect: fetch.preconnect }));
    const firstController = new AbortController();
    const secondController = new AbortController();
    const first = searchMatch("one", 10, firstController.signal);
    const second = searchMatch("two", 10, secondController.signal);
    await expect(searchMatch("three")).rejects.toMatchObject({ message: "Twelve Labs search is busy, try again" });
    firstController.abort();
    secondController.abort();
    await Promise.allSettled([first, second]);
  }, 500);
});
