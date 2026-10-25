import { expect, test } from "bun:test";
import { readFileSync, readdirSync, rmSync, writeFileSync, existsSync } from "node:fs";
import type { Moment } from "../../src/lib/studio/types";
import { cachePath, readCache } from "./cache";
import { describeMoments } from "./descriptions";

function fixture(count: number) {
  const prefix = `test-description-${crypto.randomUUID()}`;
  const moments: Moment[] = Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-${i}`, kind: "chance", title: `Chance ${i}`, summary: "A chance", start: i * 10, end: i * 10 + 5, peak: i * 10 + 2,
    players: [], team: "spurs", evidence: [], focus: [], scores: { importance: 0, emotion: 0, crowd: 0, social: 0, total: (count - i) / count },
  }));
  const report = cachePath("report/pegasus.json");
  const previous = existsSync(report) ? readFileSync(report) : undefined;
  return { moments, cleanup() {
    for (const file of readdirSync(cachePath("pegasus"))) if (file.startsWith(prefix)) rmSync(cachePath(`pegasus/${file}`));
    if (previous) writeFileSync(report, previous);
    else rmSync(report, { force: true });
  } };
}

test("fails if descriptions run serially, exceed four active calls, or reorder output on completion", async () => {
  const { moments, cleanup } = fixture(6);
  const gates = Array.from({ length: 4 }, () => Promise.withResolvers<void>());
  const started: number[] = [];
  const completed: number[] = [];
  let active = 0;
  let maximum = 0;
  const run = describeMoments(moments, [], async ({ start = 0 }) => {
    const i = start / 10;
    started.push(i);
    maximum = Math.max(maximum, ++active);
    if (i < gates.length) await gates[i].promise;
    completed.push(i);
    active--;
    return { sentences: [`Shot ${i}.`, `Reaction ${i}.`] };
  });
  try {
    await new Promise(setImmediate);
    expect(started).toEqual([0, 1, 2, 3]);
    gates[3].resolve();
    await new Promise(setImmediate);
    expect(completed).toEqual([3, 4, 5]);
    gates[2].resolve();
    gates[1].resolve();
    gates[0].resolve();
    await run;
    expect(maximum).toBe(4);
    expect(moments.map((m) => m.description)).toEqual(moments.map((_, i) => `Shot ${i}. Reaction ${i}.`));
    expect(readCache<{ rows: { momentId: string }[] }>("report/pegasus.json")?.rows.map((r) => r.momentId)).toEqual(moments.map((m) => m.id));
  } finally {
    for (const gate of gates) gate.resolve();
    await run.catch(() => {});
    cleanup();
  }
});

test("fails if 429 retries lack backoff, exceed four attempts, or retry other errors", async () => {
  const { moments, cleanup } = fixture(1);
  const rateLimit = Object.assign(new Error("Rate limited"), { status: 429 });
  const delays: number[] = [];
  let attempts = 0;
  const wait = async (ms: number) => { delays.push(ms); };
  try {
    await expect(describeMoments(moments, [], async () => { attempts++; throw rateLimit; }, wait)).rejects.toBe(rateLimit);
    expect(attempts).toBe(4);
    expect(delays).toEqual([1000, 2000, 4000]);
    attempts = 0;
    delays.length = 0;
    const unavailable = Object.assign(new Error("Unavailable"), { status: 503 });
    await expect(describeMoments(moments, [], async () => { attempts++; throw unavailable; }, wait)).rejects.toBe(unavailable);
    expect(attempts).toBe(1);
    expect(delays).toEqual([]);
    attempts = 0;
    await describeMoments(moments, [], async () => {
      if (++attempts < 3) throw rateLimit;
      return { sentences: ["A shot.", "A reaction."] };
    }, wait);
    expect(moments[0].description).toBe("A shot. A reaction.");
    expect(attempts).toBe(3);
  } finally { cleanup(); }
});
