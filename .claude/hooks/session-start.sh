#!/bin/bash
# Installs GDAL (command-line tools + Python bindings) for map work on VRETA
# in Claude Code cloud sessions. Idempotent: skips when GDAL is already present.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
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
