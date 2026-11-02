import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Word } from "./types";

// The OpenAI calls a job makes, over plain fetch. Every one is optional: with no OPENAI_API_KEY the job
// runs on crowd noise and rules alone and says so. Model output is never trusted as it arrives; each
// structured answer is checked in code before anything uses it.

const API = "https://api.openai.com/v1";
/** Configurable, since model names change faster than this code. whisper-1 is the model with word timings. */
const TRANSCRIBE_MODEL = () => process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";
const CHAT_MODEL = () => process.env.OPENAI_MODEL || "gpt-4.1-mini";
const TIMEOUT_MS = 120_000;

export const openaiConfigured = () => Boolean(process.env.OPENAI_API_KEY);

export class OpenAIError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** Rate limits, server errors and dropped connections are worth another try; anything else is not. */
const transient = (err: unknown) =>
  err instanceof OpenAIError ? err.status === 429 || (err.status ?? 0) >= 500 : err instanceof TypeError || (err instanceof Error && err.name === "TimeoutError");

export async function withRetry<T>(fn: () => Promise<T>, { retries = 3, baseMs = 1000 } = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries || !transient(err)) throw err;
      await new Promise((r) => setTimeout(r, baseMs * 2 ** attempt));
    }
  }
}

async function call(endpoint: string, body: BodyInit, json: boolean): Promise<unknown> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new OpenAIError("No OpenAI key on the server.");
  return withRetry(async () => {
    const res = await fetch(`${API}${endpoint}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, ...(json ? { "Content-Type": "application/json" } : {}) },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new OpenAIError(`OpenAI answered ${res.status}: ${detail.slice(0, 300)}`, res.status);
    }
    return res.json();
  });
}

/** Timed words from a verbose_json transcription, moved into source time. Entries without sane timings are dropped. */
export function parseWords(body: unknown, offset: number): Word[] {
  const words = (body as { words?: unknown }).words;
  if (!Array.isArray(words)) return [];
  const out: Word[] = [];
  for (const w of words) {
    const { word, start, end } = w as { word?: unknown; start?: unknown; end?: unknown };
    if (typeof word !== "string" || typeof start !== "number" || typeof end !== "number") continue;
    const text = word.trim();
    if (!text || end < start) continue;
    out.push({ text, start: Math.round((offset + start) * 1000) / 1000, end: Math.round((offset + end) * 1000) / 1000 });
  }
  return out;
}

/** Word-timed transcript of one audio piece. */
export async function transcribePiece(file: string, offset: number): Promise<Word[]> {
  const body = new FormData();
  body.append("model", TRANSCRIBE_MODEL());
  body.append("response_format", "verbose_json");
  body.append("timestamp_granularities[]", "word");
  body.append("file", new Blob([await readFile(file)], { type: "audio/mpeg" }), path.basename(file));
  return parseWords(await call("/audio/transcriptions", body, false), offset);
}

type StructuredAsk<T> = {
  /** A short name for the schema, which OpenAI echoes in errors. */
  name: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  /** The code-side check every answer must pass. */
  check: (value: unknown) => value is T;
};

/** One chat call that must answer JSON matching `schema`, then `check`. */
export async function structured<T>({ name, system, user, schema, check }: StructuredAsk<T>): Promise<T> {
  const reply = (await call(
    "/chat/completions",
    JSON.stringify({
      model: CHAT_MODEL(),
      temperature: 0.4,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_schema", json_schema: { name, strict: true, schema } },
    }),
    true,
  )) as { choices?: { message?: { content?: string } }[] };
  const content = reply.choices?.[0]?.message?.content ?? "";
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    value = undefined;
  }
  if (!check(value)) throw new OpenAIError(`The ${name} answer did not match its schema: ${content.slice(0, 200)}`);
  return value;
}
