// Sends a match video to its job in chunks. The server says where it is with every answer, so a 409
// moves the upload to that byte, and a dropped connection retries the same chunk a few times before
// giving up. Re-running it with the same file resumes from the job's `received`.

type Upload = {
  jobId: string;
  file: Blob;
  /** The byte to start from: 0 for a new job, the job's `received` to resume one. */
  from: number;
  chunkBytes: number;
  onProgress?: (received: number) => void;
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
  retryMs?: number;
};

const RETRIES = 4;

export async function uploadFile({ jobId, file, from, chunkBytes, onProgress, fetcher = fetch, retryMs = 1500 }: Upload): Promise<string> {
  let offset = from;
  let status = "uploading";
  let failures = 0;
  while (offset < file.size) {
    const piece = file.slice(offset, Math.min(file.size, offset + chunkBytes));
    let res: Response;
    try {
      res = await fetcher(`/api/jobs/${jobId}/upload?offset=${offset}`, { method: "PUT", body: piece });
    } catch (err) {
      if (++failures > RETRIES) throw new Error(`The upload stopped: ${(err as Error).message}. Choose the file again to resume.`);
      await new Promise((r) => setTimeout(r, retryMs * failures));
      continue;
    }
    const body = (await res.json().catch(() => ({}))) as { received?: number; status?: string; error?: string };
    if (res.status === 409 && typeof body.received === "number") {
      offset = body.received;
      continue;
    }
    if (!res.ok) throw new Error(body.error ?? `The server answered ${res.status}.`);
    failures = 0;
    offset = body.received ?? offset + piece.size;
    status = body.status ?? status;
    onProgress?.(offset);
  }
  return status;
}
