import { afterEach, expect, mock, spyOn, test } from "bun:test";

mock.module("server-only", () => ({}));
const { POST } = await import("./route");
const { loadStudioAnalysis } = await import("@/lib/studio/load");
const { rescueKey } = await import("@/lib/studio/rescue-log");
const originalKey = process.env.SCOREPLAY_API_KEY;

afterEach(() => {
  mock.restore();
  if (originalKey === undefined) delete process.env.SCOREPLAY_API_KEY;
  else process.env.SCOREPLAY_API_KEY = originalKey;
});

const rescue = (body: unknown) =>
  POST(new Request("http://localhost/api/studio/rescue", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }));

// A ScorePlay stand-in: the logs on the match, a media record with a company, and true for a log write.
function scoreplay(logs: { comment?: string }[]) {
  const posts: string[] = [];
  const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
    Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = new URL(input instanceof Request ? input.url : input);
        if (url.pathname.endsWith("/video/logs")) {
          posts.push(url.pathname);
          const { video_logs } = JSON.parse(String(init?.body)) as { video_logs: { log: { comment?: string } }[] };
          logs.push(...video_logs.map((v) => ({ comment: v.log.comment })));
          return Response.json(true);
        }
        if (url.pathname.endsWith("/logs")) return Response.json({ items: logs.map((l, i) => ({ id: i, tags: [], ...l })), total: logs.length });
        return Response.json({ ID: 130852725, company_id: 7 });
      },
      { preconnect: fetch.preconnect },
    ),
  );
  return { fetchMock, posts };
}

test("without a ScorePlay key, a real candidate comes back offline with the range to cut, and nothing is called", async () => {
  delete process.env.SCOREPLAY_API_KEY;
  const fetchMock = spyOn(globalThis, "fetch");
  const analysis = loadStudioAnalysis();
  const item = analysis.rejected.find((r) => r.source === "ranking" && r.momentId)!;
  const moment = analysis.moments.find((m) => m.id === item.momentId)!;
  const response = await rescue({ at: item.at, title: item.title });
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({ offline: true, start: moment.start, end: moment.end });
  expect(fetchMock).not.toHaveBeenCalled();
});

test("without a ScorePlay key, a candidate outside the run is still a 404", async () => {
  delete process.env.SCOREPLAY_API_KEY;
  expect((await rescue({ at: 1, title: "nope" })).status).toBe(404);
});

test("returns 404 for a candidate outside the committed run, without calling ScorePlay", async () => {
  process.env.SCOREPLAY_API_KEY = "test-key";
  const fetchMock = spyOn(globalThis, "fetch");
  expect((await rescue({ at: 1, title: "nope" })).status).toBe(404);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("writes a real candidate once and reads it back, then reports it as already logged", async () => {
  process.env.SCOREPLAY_API_KEY = "test-key";
  const analysis = loadStudioAnalysis();
  const item = analysis.rejected.find((r) => r.source === "ranking" && r.momentId)!;
  const moment = analysis.moments.find((m) => m.id === item.momentId)!;

  const fresh = scoreplay([]);
  const written = await rescue({ at: item.at, title: item.title });
  expect(await written.json()).toEqual({ status: "written", mediaId: analysis.source.id, start: moment.start, end: moment.end });
  expect(fresh.posts).toHaveLength(1);
  mock.restore();

  const seen = scoreplay([{ comment: `[${rescueKey(analysis.source.id, item.at)}]` }]);
  const again = await rescue({ at: item.at, title: item.title });
  expect((await again.json()).status).toBe("already");
  expect(seen.posts).toHaveLength(0);
});
