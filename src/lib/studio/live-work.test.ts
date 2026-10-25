import { describe, expect, test } from "bun:test";
import { limiter, settledBy, sharedInFlight } from "./live-work";

/** A promise the test settles by hand. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}
const tick = () => new Promise((r) => setImmediate(r));

describe("limiter", () => {
  test("never runs more than its limit at once, and starts waiting tasks as others finish", async () => {
    const run = limiter(2);
    let running = 0;
    let peak = 0;
    const gates = Array.from({ length: 5 }, () => deferred());
    const all = gates.map((g) =>
      run(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await g.promise;
        running -= 1;
      }),
    );
    await tick();
    expect(running).toBe(2);
    for (const g of gates) {
      g.resolve();
      await tick();
    }
    await Promise.all(all);
    expect(peak).toBe(2);
  });

  test("a waiting task whose request gave up never runs", async () => {
    const run = limiter(1);
    const gate = deferred();
    const first = run(() => gate.promise);
    const controller = new AbortController();
    let ran = false;
    const second = run(async () => void (ran = true), controller.signal);
    controller.abort(new Error("deadline"));
    await expect(second).rejects.toThrow("deadline");
    gate.resolve();
    await first;
    await tick();
    expect(ran).toBe(false);
  });
});

test("callers asking for a key already in flight share one piece of work", async () => {
  const shared = sharedInFlight<number, number>();
  let calls = 0;
  const gate = deferred<number>();
  const a = shared(7, () => (calls++, gate.promise));
  const b = shared(7, () => (calls++, gate.promise));
  gate.resolve(42);
  expect(await Promise.all([a, b])).toEqual([42, 42]);
  expect(calls).toBe(1);
  await shared(7, async () => (calls++, 1));
  expect(calls).toBe(2);
});

test("settledBy returns what finished before the deadline and leaves the rest out", async () => {
  const controller = new AbortController();
  const done = Promise.resolve("measured");
  const failed = Promise.reject(new Error("ffmpeg exited 1"));
  const stuck = new Promise<string>(() => {});
  const result = settledBy([done, stuck, failed], controller.signal);
  await tick();
  controller.abort();
  const [a, b, c] = await result;
  expect(a).toEqual({ status: "fulfilled", value: "measured" });
  expect(b).toBeUndefined();
  expect(c?.status).toBe("rejected");
});
