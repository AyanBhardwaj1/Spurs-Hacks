# Rundown runs as one long-lived Node server. The engine keeps runs in memory and in RUNDOWN_DATA_DIR,
# finishes work after the response with after(), and cuts clips with ffmpeg, so it needs a machine that
# stays up and a disk that survives restarts. See docs/deploy.md.
#
# bun installs packages and runs the build, as in local development. Next.js itself runs on Node.

FROM node:22-bookworm-slim AS base
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app

FROM base AS build
COPY --from=oven/bun:1.3.10-slim /usr/local/bin/bun /usr/local/bin/bun
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
# server.js serves public/ only if it exists, and the repo has none yet.
RUN mkdir -p public && bun run build

FROM base AS run
# ffmpeg cuts social clips. The engine burns hooks into them with DejaVu Sans Bold, its Linux default.
# gosu lets the entrypoint drop from root to the node user.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core gosu \
  && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
  PORT=3000 \
  HOSTNAME=0.0.0.0 \
  RUNDOWN_DATA_DIR=/data/rundown
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
COPY --from=build --chown=node:node /app/public ./public
COPY --chmod=755 docker-entrypoint.sh /usr/local/bin/
# The engine creates /app/.media for clips it is cutting, so node needs to own /app itself.
RUN chown node:node /app
# Runs and cached Twelve Labs answers live on the volume: IDs, timecodes and text. Clips are cut in
# /app/.media, which is not on the volume and is emptied after each job.
VOLUME /data
EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server.js"]
