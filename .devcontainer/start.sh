#!/usr/bin/env bash
# Starts the full game in the background when the codespace starts.
# The app opens on the forwarded port 8080 once Caddy is listening.
set -euo pipefail

# Docker-in-Docker can take a few seconds to come up after the container starts.
for _ in $(seq 1 30); do
  docker info >/dev/null 2>&1 && break
  sleep 2
done

docker compose up --build --detach
echo "Sudoku World Cup is starting: open the forwarded port 8080 (Ports tab) if it does not open by itself."
