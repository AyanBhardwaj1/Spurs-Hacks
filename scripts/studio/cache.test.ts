import { expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { cachePath, readCache, writeCache } from "./cache";

test("fails if a truncated cache crashes recovery or a failed write destroys the prior value", () => {
  const name = `test-cache-${crypto.randomUUID()}/value.json`;
  const path = cachePath(name);
  mkdirSync(dirname(path), { recursive: true });
  try {
    writeFileSync(path, '{"truncated":');
    expect(readCache(name)).toBeUndefined();
    writeCache(name, { valid: true });
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(() => writeCache(name, circular)).toThrow();
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ valid: true });
    expect(existsSync(path)).toBe(true);
  } finally {
    rmSync(dirname(path), { recursive: true, force: true });
  }
});

test("fails if malformed publish or writeback journals allow the pipeline to resume", async () => {
  const root = mkdtempSync(join(tmpdir(), "studio-journals-"));
  const scriptDir = join(root, "scripts", "studio");
  const cacheDir = join(root, ".media", "studio");
  mkdirSync(scriptDir, { recursive: true });
  mkdirSync(cacheDir, { recursive: true });
  copyFileSync(join(import.meta.dir, "cache.ts"), join(scriptDir, "cache.ts"));
  try {
    for (const name of ["publish.json", "writeback.json"]) {
      writeFileSync(join(cacheDir, name), '{"truncated":');
      const child = Bun.spawn([process.execPath, "-e", `import { readCache } from "./scripts/studio/cache.ts"; readCache(${JSON.stringify(name)});`], { cwd: root, stdout: "pipe", stderr: "pipe" });
      const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
      expect(code).not.toBe(0);
      expect(stderr).toContain(name);
      expect(stderr).toContain("reconcile");
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
