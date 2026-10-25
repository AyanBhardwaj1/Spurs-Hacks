import { expect, test } from "bun:test";
import { childEnv } from "./child-env";

test("childEnv drops every API key, keeps the rest, and adds the extras", () => {
  const base = { PATH: "/bin", ANTHROPIC_API_KEY: "a", SCOREPLAY_API_KEY: "s", twelvelabs_api_key: "t", ANTHROPIC_AUTH_TOKEN: "tok", UNSET: undefined };
  expect(childEnv({ REELENGINE_ROOT: "/r" }, base)).toEqual({ PATH: "/bin", ANTHROPIC_AUTH_TOKEN: "tok", REELENGINE_ROOT: "/r" });
});
