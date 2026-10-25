// The app's server clients (ScorePlay, Twelve Labs, Bryan's renderer) import
// "server-only", which Next resolves to an empty module and bun cannot find.
// Outside Next it guards nothing, so this registers it as an empty virtual
// module before loading them. Import the clients from here, not directly.
Bun.plugin({
  name: "server-only outside Next",
  setup(build) {
    build.module("server-only", () => ({ contents: "", loader: "js" }));
  },
});

export const scoreplay = await import("../../src/lib/scoreplay");
export const twelvelabs = await import("../../src/lib/twelvelabs");
export const rundownRender = await import("../../src/lib/rundown/render");
