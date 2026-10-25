import { describe, expect, test } from "bun:test";
import { apiSchema, cliEnv, parseCliOutput, resolveModelConfig } from "./claude";

test("fails if CLI result objects or message arrays lose structured output", () => {
  const result = { type: "result", subtype: "success", structured_output: { title: "Goal" } };
  const init = { type: "system", subtype: "init", model: "reported-model" };
  for (const stream of [false, true]) {
    expect(parseCliOutput(JSON.stringify(result), stream, "clip")).toEqual({ value: { title: "Goal" }, model: "unknown" });
    expect(parseCliOutput(JSON.stringify([init, result]), stream, "clip")).toEqual({ value: { title: "Goal" }, model: "reported-model" });
  }
  expect(parseCliOutput([init, result].map((m) => JSON.stringify(m)).join("\n"), true, "image").model).toBe("reported-model");
  expect(() => parseCliOutput(JSON.stringify({ ...result, is_error: true }), false, "bad")).toThrow("no structured output");
});

describe("resolveModelConfig", () => {
  test("defaults to the Haiku test tier through the CLI", () => {
    expect(resolveModelConfig({})).toEqual({
      tier: "test",
      model: "claude-haiku-5-5",
      provider: "cli",
      apiBaseUrl: "https://api.anthropic.com",
    });
  });

  test("the real tier uses Opus, and an exact model ID overrides either tier", () => {
    expect(resolveModelConfig({ STUDIO_MODEL_TIER: "real" }).model).toBe("claude-opus-5-5");
    expect(resolveModelConfig({ STUDIO_MODEL_TIER: "real", STUDIO_MODEL: "claude-sonnet-5-5" }).model).toBe("claude-sonnet-5-5");
  });

  test("the API base URL comes only from STUDIO_ANTHROPIC_BASE_URL, never the proxy's ANTHROPIC_BASE_URL", () => {
    expect(resolveModelConfig({ ANTHROPIC_BASE_URL: "http://127.0.0.1:8317", STUDIO_PROVIDER: "api" }).apiBaseUrl).toBe("https://api.anthropic.com");
    expect(resolveModelConfig({ STUDIO_ANTHROPIC_BASE_URL: "https://example.test/" }).apiBaseUrl).toBe("https://example.test");
  });

  test("rejects an unknown tier or provider instead of falling back", () => {
    expect(() => resolveModelConfig({ STUDIO_MODEL_TIER: "opus" })).toThrow("STUDIO_MODEL_TIER");
    expect(() => resolveModelConfig({ STUDIO_PROVIDER: "proxy" })).toThrow("STUDIO_PROVIDER");
  });
});

describe("cliEnv", () => {
  test("removes the API key and keeps the proxy settings", () => {
    expect(
      cliEnv({ ANTHROPIC_API_KEY: "sk-ant-real", ANTHROPIC_BASE_URL: "http://127.0.0.1:8317", ANTHROPIC_AUTH_TOKEN: "t", PATH: "/bin" }),
    ).toEqual({ ANTHROPIC_BASE_URL: "http://127.0.0.1:8317", ANTHROPIC_AUTH_TOKEN: "t", PATH: "/bin" });
  });
});

describe("apiSchema", () => {
  test("closes every object and drops the limits the API rejects", () => {
    const schema = {
      type: "object",
      properties: {
        frames: {
          type: "array",
          minItems: 1,
          items: { type: "object", properties: { x: { type: "number", minimum: 0, maximum: 1 } }, required: ["x"] },
        },
      },
      required: ["frames"],
    };
    expect(apiSchema(schema)).toEqual({
      type: "object",
      properties: {
        frames: {
          type: "array",
          items: { type: "object", properties: { x: { type: "number" } }, required: ["x"], additionalProperties: false },
        },
      },
      required: ["frames"],
      additionalProperties: false,
    });
  });
});
