import "server-only";
import { setTimeout as delay } from "node:timers/promises";

// Twelve Labs v1.3 client. Search is multipart and returns a rank, not a
// score. Analyze takes the indexed video's `asset_id`, not its `_id`.

const BASE = "https://api.twelvelabs.io/v1.3";

export type TlIndex = {
  _id: string;
  index_name: string;
  video_count?: number;
  models: { model_name: string; model_options: string[] }[];
  addons?: string[];
};

export type TlIndexedAsset = {
  _id: string;
  asset_id?: string;
  status?: string;
  system_metadata?: { filename?: string; duration?: number; fps?: number; width?: number; height?: number };
  user_metadata?: Record<string, unknown>;
  hls?: { video_url?: string; thumbnail_urls?: string[]; status?: string };
};

export type TlClip = {
  video_id: string;
  start: number;
  end: number;
  rank: number;
  thumbnail_url?: string;
  transcription?: string;
  user_metadata?: Record<string, unknown>;
};

export class TwelveLabsError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    message: string,
  ) {
    super(`Twelve Labs ${status} on ${path}: ${message}`);
  }
}

export function twelvelabsConfigured() {
  return Boolean(process.env.TWELVELABS_API_KEY && process.env.TWELVELABS_INDEX_ID);
}

export function indexId() {
  const id = process.env.TWELVELABS_INDEX_ID;
  if (!id) throw new TwelveLabsError(0, "", "TWELVELABS_INDEX_ID is not set");
  return id;
}

async function tl<T>(
  path: string,
  init: { method?: string; query?: Record<string, string | number | boolean | undefined>; json?: unknown; form?: FormData; signal?: AbortSignal } = {},
): Promise<T> {
  const key = process.env.TWELVELABS_API_KEY;
  if (!key) throw new TwelveLabsError(0, path, "TWELVELABS_API_KEY is not set");
  const url = new URL(BASE + path);
  for (const [k, v] of Object.entries(init.query ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  return withAbort(init.signal, async () => {
    const res = await fetch(url, {
      method: init.method ?? (init.json || init.form ? "POST" : "GET"),
      headers: { "x-api-key": key, ...(init.json ? { "Content-Type": "application/json" } : {}) },
      body: init.form ?? (init.json ? JSON.stringify(init.json) : undefined),
      cache: "no-store",
      signal: init.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      let message = text || res.statusText;
      try {
        message = (JSON.parse(text) as { message?: string }).message ?? message;
      } catch {}
      throw new TwelveLabsError(res.status, path, message.slice(0, 300));
    }
    return (await res.json()) as T;
  });
}

async function withAbort<T>(signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
  if (!signal) return operation();
  signal.throwIfAborted();
  let onAbort = () => {};
  const aborted = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    // Also bound transports or response bodies that ignore the signal.
    return await Promise.race([operation(), aborted]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

export function getIndex() {
  return tl<TlIndex>(`/indexes/${indexId()}`);
}

/** Every indexed video. The list omits `user_metadata`, so callers retrieve each one. */
export async function listIndexedAssets() {
  const out: TlIndexedAsset[] = [];
  for (let page = 1; page < 50; page++) {
    const res = await tl<{ data: TlIndexedAsset[]; page_info: { total_page: number } }>(
      `/indexes/${indexId()}/indexed-assets`,
      { query: { page, page_limit: 50 } },
    );
    out.push(...res.data);
    if (page >= res.page_info.total_page) break;
  }
  return out;
}

export function getIndexedAsset(id: string) {
  return tl<TlIndexedAsset>(`/indexes/${indexId()}/indexed-assets/${id}`);
}

export type SearchOptions = {
  query: string;
  /** Limit the search to these indexed videos. */
  videoIds?: string[];
  /** Modalities to search. Must be a subset of what the index was built with. */
  modalities?: string[];
  limit?: number;
};

export async function search(opts: SearchOptions & { signal?: AbortSignal }): Promise<TlClip[]> {
  const form = new FormData();
  form.set("index_id", indexId());
  form.set("query_text", opts.query);
  for (const m of opts.modalities ?? ["visual", "audio"]) form.append("search_options", m);
  form.set("group_by", "clip");
  form.set("page_limit", String(Math.min(50, opts.limit ?? 10)));
  form.set("include_user_metadata", "true");
  if (opts.videoIds?.length) form.set("filter", JSON.stringify({ id: opts.videoIds }));
  const res = await tl<{ data: TlClip[] }>("/search", { form, signal: opts.signal });
  return res.data;
}

export type AnalyzeOptions = {
  /** The indexed video's `asset_id`. */
  assetId: string;
  prompt: string;
  schema: Record<string, unknown>;
  start?: number;
  end?: number;
  maxTokens?: number | "unlimited";
  temperature?: number;
  analysisMode?: "general" | "time_based_metadata";
  responseFormat?: Record<string, unknown>;
  /** Overall async-task budget, including task creation and HTTP requests. Defaults to thirty minutes. */
  timeoutMs?: number;
  resumeTaskId?: string;
  onTaskCreated?: (taskId: string) => void;
};

function pegasusModel() {
  return process.env.TWELVELABS_PEGASUS_MODEL ?? "pegasus1.6";
}

/** Pegasus with a JSON schema. Falls back to an async task when the sync call refuses the video's length. */
export async function analyze<T>(opts: AnalyzeOptions): Promise<T> {
  const body = {
    model_name: pegasusModel(),
    video: { type: "asset_id", asset_id: opts.assetId },
    ...(opts.analysisMode === "time_based_metadata" ? {} : { prompt: opts.prompt }),
    temperature: opts.temperature ?? 0.2,
    stream: false,
    max_tokens: opts.maxTokens ?? 2048,
    response_format: opts.responseFormat ?? { type: "json_schema", json_schema: opts.schema },
    ...(opts.analysisMode ? { analysis_mode: opts.analysisMode } : {}),
    ...(opts.start !== undefined && opts.end !== undefined
      ? { start_time: Math.max(0, opts.start), end_time: Math.max(opts.start + 1, opts.end) }
      : {}),
  };
  if (opts.analysisMode === "time_based_metadata" || opts.resumeTaskId) return analyzeAsync<T>(body, opts);
  try {
    const res = await tl<{ data: string; finish_reason: string }>("/analyze", { json: body });
    return parseAnalysis<T>(res.data, res.finish_reason);
  } catch (err) {
    const tooLong = err instanceof TwelveLabsError && [400, 413, 422].includes(err.status) && /duration|long|exceed|limit/i.test(err.message);
    if (!tooLong) throw err;
    return analyzeAsync<T>(body, opts);
  }
}

async function analyzeAsync<T>(body: Record<string, unknown>, opts: Pick<AnalyzeOptions, "resumeTaskId" | "onTaskCreated" | "timeoutMs"> = {}): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 30 * 60 * 1000;
  const deadline = AbortSignal.timeout(timeoutMs);
  const requestSignal = () => AbortSignal.any([deadline, AbortSignal.timeout(30_000)]);
  const rest = { ...body };
  delete rest.stream;
  try {
    const task = opts.resumeTaskId ? { task_id: opts.resumeTaskId } : await tl<{ task_id: string }>("/analyze/tasks", { json: rest, signal: requestSignal() });
    opts.onTaskCreated?.(task.task_id);
    while (true) {
      const res = await tl<{
        status: string;
        result?: { data: string; finish_reason: string };
        error?: { message?: string };
      }>(`/analyze/tasks/${task.task_id}`, { signal: requestSignal() });
      if (res.status === "ready" && res.result) {
        if (res.error?.message) throw new TwelveLabsError(502, "/analyze/tasks", res.error.message);
        return parseAnalysis<T>(res.result.data, res.result.finish_reason);
      }
      if (res.status === "failed" || res.status === "canceled") {
        throw new TwelveLabsError(500, "/analyze/tasks", res.error?.message ?? res.status);
      }
      await delay(4000, undefined, { signal: deadline });
    }
  } catch (error) {
    if (deadline.aborted) {
      throw new TwelveLabsError(504, "/analyze/tasks", `Analysis task ${opts.resumeTaskId ?? "request"} exceeded its ${timeoutMs} ms deadline`);
    }
    throw error;
  }
}

function parseAnalysis<T>(data: string, finishReason: string): T {
  if (finishReason === "length") throw new TwelveLabsError(502, "/analyze", "Pegasus output was cut off at max_tokens");
  try {
    return JSON.parse(data) as T;
  } catch {
    const why = finishReason === "length" ? "the output was cut off at max_tokens" : "the output was not JSON";
    throw new TwelveLabsError(502, "/analyze", `Could not parse Pegasus output: ${why}`);
  }
}
