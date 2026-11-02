import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // The Dockerfile ships .next/standalone: a server.js plus only the node_modules files the app imports.
  output: "standalone",
  cacheComponents: true,
  // The live crowd meter and the job engine run ffmpeg-static's binary. Kept out of the bundle so the package finds the
  // binary beside its own index.js, and traced in by hand because nothing imports the binary itself.
  serverExternalPackages: ["ffmpeg-static"],
  outputFileTracingIncludes: {
    "/api/studio/live/signal": ["./node_modules/ffmpeg-static/ffmpeg"],
    // The job runner starts from the upload route and cuts every clip with the same binary.
    "/api/jobs/**": ["./node_modules/ffmpeg-static/ffmpeg"],
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
