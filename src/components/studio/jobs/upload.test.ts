import { expect, test } from "bun:test";
import { uploadFile } from "./upload";

const file = (n: number) => new Blob([new Uint8Array(n).map((_, i) => i % 256)]);

test("sends the file in chunks from where it starts, reporting progress, and returns the job's status", async () => {
  const sent: [number, number][] = [];
  const fetcher = async (url: string, init?: RequestInit) => {
    const offset = Number(new URL(url, "http://x").searchParams.get("offset"));
    const size = (init!.body as Blob).size;
    sent.push([offset, size]);
    return Response.json({ received: offset + size, status: offset + size === 10 ? "queued" : "uploading" });
  };
  const progress: number[] = [];
  const status = await uploadFile({ jobId: "j", file: file(10), from: 2, chunkBytes: 4, fetcher, onProgress: (n) => progress.push(n) });
  expect(sent).toEqual([[2, 4], [6, 4]]);
  expect(progress).toEqual([6, 10]);
  expect(status).toBe("queued");
});

test("a 409 moves to the byte the server holds, and a dropped connection is retried", async () => {
  const sent: number[] = [];
  let drops = 1;
  const fetcher = async (url: string, init?: RequestInit) => {
    const offset = Number(new URL(url, "http://x").searchParams.get("offset"));
    sent.push(offset);
    if (offset === 0) return Response.json({ received: 4 }, { status: 409 });
    if (offset === 4 && drops-- > 0) throw new TypeError("network down");
    const end = offset + (init!.body as Blob).size;
    return Response.json({ received: end, status: end === 8 ? "queued" : "uploading" });
  };
  expect(await uploadFile({ jobId: "j", file: file(8), from: 0, chunkBytes: 4, fetcher, retryMs: 1 })).toBe("queued");
  expect(sent).toEqual([0, 4, 4]);
});

test("a refusal that is not a resume stops the upload with the server's message", async () => {
  const fetcher = async () => Response.json({ error: "The file is over the limit." }, { status: 413 });
  await expect(uploadFile({ jobId: "j", file: file(4), from: 0, chunkBytes: 4, fetcher, retryMs: 1 })).rejects.toThrow("The file is over the limit.");
});
