import { liveSignal } from "@/lib/studio/live-meter";

// The live crowd meter, polled every couple of seconds by the live page. The browser says which segments
// it holds: ?after=<seq> is its newest and ?before=<seq> the oldest of its unbroken run. The answer
// measures a few segments newer than `after`, then a few older than `before`.

// A request measures at most three 2 s segments, about a second of work; this is a ceiling, not a target.
export const maxDuration = 10;

function seqParam(params: URLSearchParams, name: string): number | undefined | Error {
  const raw = params.get(name);
  if (raw === null) return undefined;
  const value = Number(raw);
  return Number.isInteger(value) ? value : new Error(`${name} must be a segment sequence number, not "${raw}"`);
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const after = seqParam(params, "after");
  const before = seqParam(params, "before");
  if (after instanceof Error) return Response.json({ error: after.message }, { status: 400 });
  if (before instanceof Error) return Response.json({ error: before.message }, { status: 400 });
  try {
    const signal = await liveSignal({ after, before });
    return Response.json(signal, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return Response.json({ error: `The live feed could not be read: ${(err as Error).message}` }, { status: 502 });
  }
}
