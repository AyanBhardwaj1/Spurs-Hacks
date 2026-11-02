import "server-only";

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { parseRange } from "./requests";

/** A file as a response, honouring a single byte range so a video player can seek in it. */
export async function fileResponse(file: string, request: Request, { download }: { download?: string } = {}): Promise<Response> {
  let size: number;
  try {
    size = (await stat(file)).size;
  } catch {
    return Response.json({ error: "That file is not there." }, { status: 404 });
  }
  const headers: Record<string, string> = { "Content-Type": "video/mp4", "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600" };
  if (download) headers["Content-Disposition"] = `attachment; filename="${download.replace(/[^\w.-]/g, "_")}"`;
  const range = parseRange(request.headers.get("range"), size);
  if (range === "unsatisfiable") return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  const { start, end } = range ?? { start: 0, end: size - 1 };
  // Pulled a chunk at a time, so a slow player never makes the server buffer the file, and closed if it leaves.
  const stream = createReadStream(file, { start, end });
  const chunks = stream[Symbol.asyncIterator]();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await chunks.next();
      if (done) controller.close();
      else controller.enqueue(new Uint8Array(value as Buffer));
    },
    cancel() {
      stream.destroy();
    },
  });
  return new Response(body, {
    status: range ? 206 : 200,
    headers: { ...headers, "Content-Length": String(end - start + 1), ...(range && { "Content-Range": `bytes ${start}-${end}/${size}` }) },
  });
}
