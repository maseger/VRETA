#!/bin/bash
# Installs npm dependencies and GDAL (command-line tools + Python bindings) for VRETA
# in Claude Code cloud sessions. Idempotent: skips GDAL when it is already present.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

# Node-beroenden för appen (vite, vitest, typescript)
if [ -f "$CLAUDE_PROJECT_DIR/package.json" ]; then
  (cd "$CLAUDE_PROJECT_DIR" && npm install --no-audit --no-fund --silent)
fi

if command -v gdalinfo >/dev/null 2>&1; then
  exit 0
fi

export DEBIAN_FRONTEND=noninteractive
SUDO=""
if [ "$(id -u)" -ne 0 ]; then
  SUDO="sudo -n"
fi

$SUDO apt-get update -qq
$SUDO apt-get install -y -qq gdal-bin python3-gdal >/dev/null

# The Python bindings are built for the system python (3.12), not the default python3.
echo 'export GDAL_PYTHON=/usr/bin/python3.12' >> "${CLAUDE_ENV_FILE:-/dev/null}"
