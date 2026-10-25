#!/bin/sh
# A freshly mounted volume belongs to root. Give the data directory to the node user, then run the
# server as node. exec hands the process over, so SIGTERM reaches Next.js and it can finish its
# after() callbacks before the machine stops.
set -e
mkdir -p "$RUNDOWN_DATA_DIR"
chown -R node:node "$RUNDOWN_DATA_DIR"
exec gosu node "$@"
