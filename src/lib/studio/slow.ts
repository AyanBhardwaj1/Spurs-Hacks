// Bounds on how long the studio waits for ScorePlay and Twelve Labs. Everything the pages need comes from
// the committed analysis; ScorePlay adds posters, thumbnails, uploads and decisions, and Twelve Labs answers
// searches. A demo on venue wifi must not stall
// on those, so reads give up after READ_TIMEOUT_MS and the section says ScorePlay is slow. Writes wait
// longer, because giving up early on a write leaves the producer unsure whether it landed.

export const READ_TIMEOUT_MS = 3000;
export const WRITE_TIMEOUT_MS = 15000;

export class ServiceTimeout extends Error {
  constructor(
    readonly service: string,
    what: string,
    ms: number,
  ) {
    super(`${service} did not answer ${what} within ${ms / 1000} s`);
  }
}

/**
 * Settles with `work`, or rejects with ServiceTimeout after `ms`. The request itself carries on, since
 * src/lib/scoreplay.ts takes no abort signal, so a cached promise still fills in for the next visit.
 */
export function within<T>(work: Promise<T>, ms: number, what: string, service = "ScorePlay"): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new ServiceTimeout(service, what, ms)), ms);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}
