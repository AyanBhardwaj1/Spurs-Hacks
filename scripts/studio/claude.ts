import { tmpdir } from "node:os";
import { cached, hashOf } from "./cache";

// Every Claude call in the pipeline goes through askClaude, which returns
// structured output for a JSON schema and caches it by a hash of the model,
// the prompt and the schema, so changing a prompt reruns only that call and
// answers from different models never mix.
//
// Which model, set by environment:
//   STUDIO_MODEL_TIER  test (default) uses claude-haiku-5-5; real uses claude-opus-5-5.
//   STUDIO_MODEL       an exact model ID that overrides the tier.
// Which provider:
//   STUDIO_PROVIDER    cli (default) runs Claude Code headless. It keeps the
//                      shell's ANTHROPIC_BASE_URL and ANTHROPIC_AUTH_TOKEN, so
//                      locally it goes through Sam's CLIProxyAPI, as Reel Studio
//                      does. ANTHROPIC_API_KEY is removed from its environment, so
//                      the real key in .env.local is neither spent nor sent to the proxy.
//                      api calls the Messages API over HTTPS with ANTHROPIC_API_KEY,
//                      at STUDIO_ANTHROPIC_BASE_URL or https://api.anthropic.com.
//                      This is the path the deployed server uses.
// Images go inline as base64 on both paths, so no frame touches disk.

export type ModelTier = "test" | "real";
export type Provider = "cli" | "api";
export type ModelConfig = { tier: ModelTier; model: string; provider: Provider; apiBaseUrl: string };

const TIER_MODELS: Record<ModelTier, string> = { test: "claude-haiku-5-5", real: "claude-opus-5-5" };

/** Reads the model and provider from the environment; an unknown tier or provider throws instead of falling back. */
export function resolveModelConfig(env: Record<string, string | undefined>): ModelConfig {
  const tier = env.STUDIO_MODEL_TIER?.trim() || "test";
  if (tier !== "test" && tier !== "real") throw new Error(`STUDIO_MODEL_TIER must be "test" or "real", not "${tier}"`);
  const provider = env.STUDIO_PROVIDER?.trim() || "cli";
  if (provider !== "cli" && provider !== "api") throw new Error(`STUDIO_PROVIDER must be "cli" or "api", not "${provider}"`);
  return {
    tier,
    model: env.STUDIO_MODEL?.trim() || TIER_MODELS[tier],
    provider,
    apiBaseUrl: (env.STUDIO_ANTHROPIC_BASE_URL?.trim() || "https://api.anthropic.com").replace(/\/$/, ""),
  };
}

/** The environment for the `claude` child: everything except ANTHROPIC_API_KEY. */
export function cliEnv(env: Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (k !== "ANTHROPIC_API_KEY" && v !== undefined) out[k] = v;
  return out;
}

/**
 * The model name inside cache keys. Answers cached before the model was
 * explicit were keyed by the CLI alias "opus", which resolved to
 * claude-opus-5-5 (the CLI's init message reported "claude-opus-5-5[1m]"), so
 * that model keeps the old key and those answers are reused.
 */
function cacheModelName(model: string): string {
  return model === "claude-opus-5-5" ? "opus" : model;
}

/**
 * The schema as the Messages API's structured outputs accept it: every object
 * closed with additionalProperties false, and the numeric, string-length and
 * array-size limits removed, since the API rejects them. The pipeline already
 * clamps or validates those values after the call.
 */
export function apiSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(apiSchema);
  if (typeof schema !== "object" || schema === null) return schema;
  const UNSUPPORTED = new Set(["minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minLength", "maxLength", "minItems", "maxItems"]);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(schema)) if (!UNSUPPORTED.has(k)) out[k] = apiSchema(v);
  if (out.type === "object") out.additionalProperties = false;
  return out;
}

/** A JPEG sent with the prompt, preceded by its label. */
export type PromptImage = { label: string; jpegBase64: string };

type Request = {
  name: string;
  system: string;
  prompt: string;
  schema: object;
  images?: PromptImage[];
};

let config: ModelConfig | undefined;
/** The model configuration for this process, read once; the first call prints it. */
export function modelConfig(): ModelConfig {
  if (!config) {
    config = resolveModelConfig(process.env);
    console.log(`Claude: tier ${config.tier}, model ${config.model}, provider ${config.provider}${config.provider === "api" ? ` at ${config.apiBaseUrl}` : ""}`);
  }
  return config;
}

export function parseCliOutput(stdout: string, stream: boolean, name: string): { value: unknown; model: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch (error) {
    if (!stream) throw error;
    parsed = stdout.trim().split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line));
  }
  const values: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
  const messages = values.filter((m): m is Record<string, unknown> => typeof m === "object" && m !== null);
  const result = messages.find((m) => m.type === "result");
  if (!result || result.is_error || result.subtype !== "success" || result.structured_output === undefined) {
    throw new Error(`claude returned no structured output for ${name}: ${JSON.stringify(result).slice(0, 500)}`);
  }
  const init = messages.find((m) => m.type === "system" && m.subtype === "init");
  return { value: result.structured_output, model: typeof init?.model === "string" ? init.model : "unknown" };
}

async function viaCli(cfg: ModelConfig, req: Request): Promise<{ value: unknown; model: string }> {
  const images = req.images ?? [];
  const stdin = images.length
    ? `${JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [
            ...images.flatMap((i) => [
              { type: "text", text: i.label },
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: i.jpegBase64 } },
            ]),
            { type: "text", text: req.prompt },
          ],
        },
      })}\n`
    : req.prompt;
  const format = images.length ? ["--input-format", "stream-json", "--output-format", "stream-json", "--verbose"] : ["--output-format", "json"];
  // No tools, no MCP servers, and --safe-mode so the user's CLAUDE.md, skills and hooks stay out of the prompt.
  const proc = Bun.spawn(
    [
      "claude", "-p",
      "--model", cfg.model,
      "--safe-mode",
      "--tools", "",
      "--strict-mcp-config",
      "--no-session-persistence",
      ...format,
      "--system-prompt", req.system,
      "--json-schema", JSON.stringify(req.schema),
    ],
    { cwd: tmpdir(), env: cliEnv(process.env), stdin: new TextEncoder().encode(stdin), stdout: "pipe", stderr: "pipe" },
  );
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`claude exited ${code} for ${req.name}: ${stderr || stdout.slice(0, 500)}`);
  return parseCliOutput(stdout, images.length > 0, req.name);
}

type ApiMessage = { model: string; stop_reason: string; content: { type: string; text?: string }[] };

async function viaApi(cfg: ModelConfig, req: Request): Promise<{ value: unknown; model: string }> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    throw new Error(
      "ANTHROPIC_API_KEY is empty in this process. bun does not let .env.local override a variable the shell already exports, even an empty one; run with `env -u ANTHROPIC_API_KEY bun ...`",
    );
  }
  const images = req.images ?? [];
  const content = [
    ...images.flatMap((i) => [
      { type: "text", text: i.label },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: i.jpegBase64 } },
    ]),
    { type: "text", text: req.prompt },
  ];
  // Structured outputs, not a forced tool call: claude-opus-5-5 rejects tool_choice "tool" with a 400.
  const response = await fetch(`${cfg.apiBaseUrl}/v1/messages`, {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: cfg.model,
      max_tokens: 16000,
      system: req.system,
      messages: [{ role: "user", content }],
      output_config: { format: { type: "json_schema", schema: apiSchema(req.schema) } },
    }),
  });
  if (!response.ok) throw new Error(`Anthropic API ${response.status} for ${req.name}: ${(await response.text()).slice(0, 500)}`);
  const message = (await response.json()) as ApiMessage;
  if (message.stop_reason !== "end_turn") throw new Error(`Anthropic API stopped with ${message.stop_reason} for ${req.name}`);
  const text = message.content.flatMap((b) => (b.type === "text" && b.text ? [b.text] : [])).join("");
  return { value: JSON.parse(text), model: message.model };
}

/** One uncached call through the configured provider; returns the answer and the model that reported back. */
export function callModel(req: Request): Promise<{ value: unknown; model: string }> {
  const cfg = modelConfig();
  return cfg.provider === "api" ? viaApi(cfg, req) : viaCli(cfg, req);
}

export async function askClaude<T>(opts: Request): Promise<{ value: T; hit: boolean; durationMs: number }> {
  const cfg = modelConfig();
  const imageParts = (opts.images ?? []).flatMap((i) => [i.label, i.jpegBase64]);
  const key = `claude/${opts.name}-${hashOf(cacheModelName(cfg.model), opts.system, opts.prompt, JSON.stringify(opts.schema), ...imageParts)}.json`;
  return cached<T>(key, async () => (await callModel(opts)).value as T);
}

/** Runs `task` over `items` with at most `limit` in flight, keeping input order. */
export async function mapLimit<I, O>(items: I[], limit: number, task: (item: I, index: number) => Promise<O>): Promise<O[]> {
  const out = new Array<O>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await task(items[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
