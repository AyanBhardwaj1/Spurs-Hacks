// Small concurrency tools for the live routes, which several browsers poll at once. Kept apart from the
// routes so their behaviour can be tested without ffmpeg or the network.

/**
 * Runs at most `max` tasks at a time; the rest wait in arrival order. A waiting task whose signal aborts
 * leaves the queue and rejects without ever running.
 */
export function limiter(max: number) {
  let active = 0;
  const waiting: { start: () => void; signal?: AbortSignal }[] = [];

  const next = () => {
    while (active < max && waiting.length > 0) {
      const entry = waiting.shift()!;
      if (!entry.signal?.aborted) entry.start();
    }
  };

  return function run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const start = () => {
        active += 1;
        task()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            next();
          });
      };
      if (signal?.aborted) return reject(signal.reason);
      const entry = { start, signal };
      signal?.addEventListener("abort", () => {
        const i = waiting.indexOf(entry);
        if (i >= 0) {
          waiting.splice(i, 1);
          reject(signal.reason);
        }
      });
      waiting.push(entry);
      next();
    });
  };
}

/** One in-flight promise per key: callers asking for a key already in flight share its result. */
export function sharedInFlight<K, T>() {
  const inFlight = new Map<K, Promise<T>>();
  return (key: K, make: () => Promise<T>): Promise<T> => {
    const existing = inFlight.get(key);
    if (existing) return existing;
    const promise = make().finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
  };
}

/** Each promise's result if it settled before `signal` aborted, else undefined, in input order. */
export async function settledBy<T>(work: Promise<T>[], signal: AbortSignal): Promise<(PromiseSettledResult<T> | undefined)[]> {
  const results: (PromiseSettledResult<T> | undefined)[] = work.map(() => undefined);
  const tracked = work.map((p, i) =>
    p.then(
      (value) => void (results[i] = { status: "fulfilled", value }),
      (reason: unknown) => void (results[i] = { status: "rejected", reason }),
    ),
  );
  const aborted = new Promise<void>((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });
  await Promise.race([Promise.all(tracked), aborted]);
  return [...results];
}
