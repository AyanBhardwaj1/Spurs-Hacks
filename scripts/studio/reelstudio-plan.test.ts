import { describe, expect, test } from "bun:test";
import type { Clip, Moment, SourceAsset } from "../../src/lib/studio/types";
import { applyReelStudio, buildBrief, clipEditKey, cutRanges, editKey, editPlan, onFrameGrid, reuseOf, scoreAfter, scorebugTop, vocabulary, type ReelStudioRecord } from "./reelstudio-plan";

const moment = (id: string, kind: Moment["kind"], peak: number, team: Moment["team"], players: number[] = []): Moment => ({
  id, kind, title: `${kind} at ${peak}`, summary: "", start: peak - 10, end: peak + 10, peak, players, team,
  evidence: [], scores: { importance: 1, emotion: 1, crowd: 0, social: 0, total: 1 }, focus: [],
});

const clip = (id: string, segments: Clip["segments"]): Clip => ({
  id, lane: "asap", variant: "Goal", format: "9:16", title: "T", caption: "C", hashtags: ["#COYS"], segments,
  durationSec: segments.reduce((sum, s) => sum + s.end - s.start, 0), viralScore: 0.5, rationale: "R",
});

test("cutRanges lays the segments back to back on the cut file's clock", () => {
  const ranges = cutRanges(clip("c", [{ start: 5814, end: 5828 }, { start: 5833.2, end: 5844.2 }, { start: 5960.6, end: 5967 }]));
  expect(ranges).toEqual([
    { source: "s1", start: 0, end: 14 },
    { source: "s1", start: 14, end: 25 },
    { source: "s1", start: 25, end: 31.4 },
  ]);
});

describe("scoreAfter", () => {
  const moments = [
    moment("m-a", "goal", 4668, "opponent"),
    moment("m-b", "disallowed-goal", 5000, "spurs"),
    moment("m-c", "card", 4999, "spurs"),
    moment("m-d", "goal", 5822, "spurs"),
  ];

  test("counts goals up to the moment's peak, home side first, and ignores disallowed goals", () => {
    expect(scoreAfter(moments[2], moments)).toBe("Manchester United 1-0 Tottenham Hotspur");
    expect(scoreAfter(moments[3], moments)).toBe("Manchester United 1-1 Tottenham Hotspur");
    expect(scoreAfter({ peak: 100 }, moments)).toBe("Manchester United 0-0 Tottenham Hotspur");
  });

  test("refuses a goal with no side", () => {
    expect(() => scoreAfter(moments[3], [moment("m-x", "goal", 10, "neutral")])).toThrow("m-x");
  });
});

test("buildBrief names the first player of the first moment by the moment's kind and gives only carded players a photo", () => {
  const source = {
    players: [
      { id: 1, name: "Dominic Solanke", shortName: "Solanke", photoUrl: "https://x/1.png" },
      { id: 2, name: "Sandro Tonali", shortName: "Tonali" },
    ],
  } as SourceAsset;
  const moments = [moment("m-d", "goal", 5822, "spurs", [1, 2, 99])];
  const brief = buildBrief(clip("c", [{ start: 5812, end: 5846, momentId: "m-d" }]), { moments, source }, new Map([[1, "Library/Images/Solanke.png"]]));
  expect(brief.players).toEqual([
    { name: "Solanke", team: "Tottenham Hotspur", role: "scorer", image: "Library/Images/Solanke.png" },
    { name: "Tonali", team: "Tottenham Hotspur", role: "in the move" },
  ]);
  expect(brief.score).toBe("Manchester United 0-1 Tottenham Hotspur");
});

describe("applyReelStudio", () => {
  const source = { players: [{ id: 1, name: "Dominic Solanke", shortName: "Solanke", photoUrl: "https://x/1.png" }] } as SourceAsset;
  const analysis = { moments: [moment("m-g", "goal", 5822, "spurs", [1])], source };
  const made = { source: { mediaId: 9, format: "original", width: 1920, height: 1080, renditionId: "r1" }, reelStudio: "abc", model: "opus", card: 2 };
  const planned = (id: string, segments: Clip["segments"] = [{ start: 5812, end: 5846, momentId: "m-g" }]) => clip(id, segments);
  const receipt = (c: Clip, extra: Partial<ReelStudioRecord["clips"][number]> = {}) => ({
    clipId: c.id, clip: c, file: "", renderMs: 0, bytes: 1, name: c.id, mediaId: 7, state: "tagged" as const, status: "DONE",
    renderSource: made.source, reelStudioCommit: made.reelStudio, model: made.model, cardDesign: made.card,
    editKey: clipEditKey(c, editPlan(c, analysis), made), ...extra,
  });

  test("records an upload ScorePlay finished on the clip it was made from", () => {
    const clips = [planned("c-a"), planned("c-b"), planned("c-c")];
    const record: ReelStudioRecord = { eventId: 1, clips: [receipt(clips[0]), receipt(clips[1], { status: "PROCESSING" }), receipt(clips[2], { state: "created" })] };
    applyReelStudio(clips, record, analysis, () => undefined);
    expect(clips.map((c) => c.reelStudioMediaId)).toEqual([7, undefined, undefined]);
  });

  test("a re-planned clip gets no media ID, even one it carried, and the mismatch is reported", () => {
    const record: ReelStudioRecord = { eventId: 1, clips: [receipt(planned("c-a"))] };
    const replanned = { ...planned("c-a", [{ start: 5812, end: 5850, momentId: "m-g" }]), reelStudioMediaId: 7 };
    const warnings: string[] = [];
    applyReelStudio([replanned], record, analysis, (m) => warnings.push(m));
    expect(replanned.reelStudioMediaId).toBeUndefined();
    expect(warnings).toEqual(["Reel Studio media 7 not recorded on c-a: the clip's plan differs from the one that edit was made from"]);
  });

  test("a changed brief, a receipt from another card design, or one without its inputs is not attached either", () => {
    const retitled = { ...planned("c-a"), caption: "A new caption" };
    const old = planned("c-a");
    const clips = [retitled];
    applyReelStudio(clips, { eventId: 1, clips: [receipt(old)] }, analysis, () => undefined);
    expect(clips[0].reelStudioMediaId).toBeUndefined();
    const same = [planned("c-a")];
    applyReelStudio(same, { eventId: 1, clips: [{ ...receipt(old), cardDesign: 1 }] }, analysis, () => undefined);
    expect(same[0].reelStudioMediaId).toBeUndefined();
    applyReelStudio(same, { eventId: 1, clips: [{ ...receipt(old), model: undefined }] }, analysis, () => undefined);
    expect(same[0].reelStudioMediaId).toBeUndefined();
  });
});

test("vocabulary adds the venue and the names a moment mentions, not the words that start its sentences", () => {
  const players = [{ id: 1, name: "Dominic Solanke", shortName: "Solanke" }];
  const summary = "Cunha plays the ball into Mbeumo, who fires past Kinsky. It is his first shot and makes it 1-0 to United.";
  const words = vocabulary(players, [{ summary }]);
  expect(words.slice(0, 2)).toEqual(["Solanke", "Bryan Mbeumo"]);
  expect(words).toContain("Jarred Gillett");
  expect(words).toContain("Michael Carrick");
  expect(words.slice(-4)).toEqual(["Old Trafford", "Mbeumo", "Kinsky", "United"]);
});

test("onFrameGrid puts every segment edge on a whole frame, so the cut's ranges do too", () => {
  const snapped = onFrameGrid(clip("c", [{ start: 4660, end: 4672 }, { start: 4678.4, end: 4688.3 }, { start: 4752.1, end: 4757.1 }]), 25);
  expect(snapped.segments.map((s) => [s.start, s.end])).toEqual([[4660, 4672], [4678.4, 4688.32], [4752.12, 4757.12]]);
  expect(cutRanges(snapped).map((r) => [r.start, r.end])).toEqual([[0, 12], [12, 21.92], [21.92, 26.92]]);
  expect(snapped.durationSec).toBe(26.92);
});

describe("scorebugTop", () => {
  const seg = { start: 0, end: 10 };
  test("drops the scorebug's band when the crop would show part of it, at any key", () => {
    expect(scorebugTop([{ t: 0, x: 0.9 }, { t: 5, x: 0.5 }], seg, "9:16")).toBe(0.112);
    expect(scorebugTop([{ t: 0, x: 0.9 }, { t: 5, x: 0.6 }], seg, "9:16")).toBe(0);
  });
  test("a square crop is wider, so it reaches the scorebug from further right", () => {
    expect(scorebugTop([{ t: 0, x: 0.6 }], seg, "1:1")).toBe(0.112);
    expect(scorebugTop([{ t: 0, x: 0.7 }], seg, "1:1")).toBe(0);
  });
});

describe("reuseOf", () => {
  const base = { clipId: "c", clip: clip("c", [{ start: 0, end: 10 }]), file: "", renderMs: 0, bytes: 1, name: "n" };
  const opts = { replace: false, again: false, exportExists: true };

  test("reuses a waiting export only for the same inputs, and edits again otherwise", () => {
    expect(reuseOf(undefined, "k", opts)).toBe("edit");
    expect(reuseOf({ ...base, editKey: "k" }, "k", opts)).toBe("reuse");
    expect(reuseOf({ ...base, editKey: "old" }, "k", opts)).toBe("edit");
    expect(reuseOf({ ...base }, "k", opts)).toBe("edit");
    expect(reuseOf({ ...base, editKey: "k" }, "k", { ...opts, exportExists: false })).toBe("edit");
    expect(reuseOf({ ...base, editKey: "k" }, "k", { ...opts, again: true })).toBe("edit");
  });

  test("an upload from other inputs fails closed unless --replace asks for a new media", () => {
    const uploaded = { ...base, mediaId: 7, state: "tagged" as const, editKey: "old" };
    expect(reuseOf({ ...uploaded, editKey: "k" }, "k", opts)).toBe("resume");
    expect(() => reuseOf(uploaded, "k", opts)).toThrow("pass --replace");
    expect(() => reuseOf({ ...base, mediaId: 7, state: "tagged" }, "k", opts)).toThrow("pass --replace");
    expect(reuseOf(uploaded, "k", { ...opts, replace: true })).toBe("replace");
    expect(() => reuseOf({ ...uploaded, state: "created" }, "k", { ...opts, replace: true })).toThrow("mid-upload");
  });
});

test("editKey changes with every input that changes the edit", () => {
  const input = {
    clip: { segments: [{ start: 0, end: 10 }], format: "9:16" as const, title: "T" },
    brief: { kind: "match" as const, match: "A v B", team: "B", moment: "m", players: [] },
    focus: [[{ t: 0, x: 0.5 }]], cropTop: [0], model: "opus", reelStudio: "abc", card: 1,
    source: { mediaId: 1, format: "original", width: 1920, height: 1080, renditionId: "r1" },
  };
  const key = editKey(input);
  expect(editKey({ ...input })).toBe(key);
  for (const changed of [
    { ...input, clip: { ...input.clip, title: "U" } },
    { ...input, clip: { ...input.clip, segments: [{ start: 0, end: 11 }] } },
    { ...input, brief: { ...input.brief, score: "1-1" } },
    { ...input, focus: [[{ t: 0, x: 0.6 }]] },
    { ...input, cropTop: [0.112] },
    { ...input, source: { ...input.source, renditionId: "r2" } },
    { ...input, reelStudio: "abc-dirty" },
    { ...input, model: "haiku" },
    { ...input, card: 2 },
  ]) expect(editKey(changed)).not.toBe(key);
});

test("buildBrief gives no scorer's role to a club player in an opponent's moment", () => {
  const source = { players: [{ id: 1, name: "Archie Gray", shortName: "Gray" }] } as SourceAsset;
  const moments = [moment("m-o", "disallowed-goal", 3633, "opponent", [1])];
  const brief = buildBrief(clip("c", [{ start: 3619, end: 3650, momentId: "m-o" }]), { moments, source }, new Map());
  expect(brief.players).toEqual([{ name: "Gray", team: "Tottenham Hotspur", role: "involved" }]);
});
