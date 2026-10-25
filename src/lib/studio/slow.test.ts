import { describe, expect, test } from "bun:test";
import { ServiceTimeout, within } from "./slow";

const after = <T>(ms: number, value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

describe("within", () => {
  test("passes a fast answer through", async () => {
    expect(await within(after(5, "ok"), 200, "x")).toBe("ok");
  });

  test("gives up with ServiceTimeout naming what was slow", async () => {
    const err = await within(after(200, "late"), 10, "the match listing").catch((e) => e);
    expect(err).toBeInstanceOf(ServiceTimeout);
    expect(err.message).toBe("ScorePlay did not answer the match listing within 0.01 s");
  });

  test("passes a fast failure through unchanged", async () => {
    const boom = new Error("403");
    expect(await within(Promise.reject(boom), 200, "x").catch((e) => e)).toBe(boom);
  });
});
