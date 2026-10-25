import { afterEach, expect, mock, spyOn, test } from "bun:test";

mock.module("server-only", () => ({}));
const { GET } = await import("./route");
const { searchMatch } = await import("@/lib/studio/search");
const { ServiceTimeout } = await import("@/lib/studio/slow");
const originalKey = process.env.TWELVELABS_API_KEY;
const originalIndex = process.env.TWELVELABS_INDEX_ID;

afterEach(() => {
  mock.restore();
  if (originalKey === undefined) delete process.env.TWELVELABS_API_KEY;
  else process.env.TWELVELABS_API_KEY = originalKey;
  if (originalIndex === undefined) delete process.env.TWELVELABS_INDEX_ID;
  else process.env.TWELVELABS_INDEX_ID = originalIndex;
});

for (const failure of ["allowance", "network", "timeout"]) {
  test(`returns labelled recorded hits when Twelve Labs fails with ${failure}`, async () => {
    process.env.TWELVELABS_API_KEY = "test-key";
    process.env.TWELVELABS_INDEX_ID = "test-index";
    spyOn(globalThis, "fetch").mockImplementation(Object.assign(async () => {
      if (failure === "network") throw new TypeError("fetch failed");
      if (failure === "timeout") throw new ServiceTimeout("Twelve Labs", "the search", 3000);
      return Response.json({ message: "The Workload allowance is exhausted and overage is disabled" }, { status: 422 });
    }, { preconnect: fetch.preconnect }));
    const response = await GET(new Request("http://localhost/api/studio/search?q=striker%20heads%20cross%20into%20far%20corner"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.source).toBe("recorded");
    expect(body.reason).toBe(failure);
    expect(body.matchedQuery).toBe("striker heads cross into far corner");
    expect(body.hits[0].start).toBeCloseTo(5819.92, 2);
    const unmatched = await GET(new Request("http://localhost/api/studio/search?q=purple%20spaceship"));
    if (failure === "timeout") expect(await unmatched.json()).toEqual({ slow: true });
    else {
      expect(unmatched.status).toBe(502);
      expect((await unmatched.json()).error).toContain("Twelve Labs refused");
    }
  });
}

test("labels successful Twelve Labs searches as live", async () => {
  process.env.TWELVELABS_API_KEY = "test-key";
  process.env.TWELVELABS_INDEX_ID = "test-index";
  spyOn(globalThis, "fetch").mockImplementation(Object.assign(async () => Response.json({ data: [
    { video_id: "6adb019e5beb2f1510570778", start: 123, end: 130, rank: 1 },
  ] }), { preconnect: fetch.preconnect }));
  const response = await GET(new Request("http://localhost/api/studio/search?q=red%20card"));
  expect(await response.json()).toEqual({ source: "live", hits: [{ start: 123, end: 130, rank: 1 }] });
});


for (const status of [401, 403, 422, 500]) {
  test(`keeps upstream ${status} errors instead of returning recorded results`, async () => {
    process.env.TWELVELABS_API_KEY = "test-key";
    process.env.TWELVELABS_INDEX_ID = "test-index";
    spyOn(globalThis, "fetch").mockImplementation(Object.assign(async () => Response.json({ message: "invalid credentials or request" }, { status }), { preconnect: fetch.preconnect }));
    const response = await GET(new Request("http://localhost/api/studio/search?q=red%20card"));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain(`Twelve Labs ${status}`);
  });
}

test("keeps the busy response when two searches are already in flight", async () => {
  process.env.TWELVELABS_API_KEY = "test-key";
  process.env.TWELVELABS_INDEX_ID = "test-index";
  spyOn(globalThis, "fetch").mockImplementation(Object.assign(() => new Promise<Response>(() => {}), { preconnect: fetch.preconnect }));
  const controller = new AbortController();
  const first = searchMatch("one", 10, controller.signal);
  const second = searchMatch("two", 10, controller.signal);
  try {
    const response = await GET(new Request("http://localhost/api/studio/search?q=red%20card"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Twelve Labs search is busy, try again" });
  } finally {
    controller.abort();
    await Promise.allSettled([first, second]);
  }
});
