#!/bin/bash
set -euo pipefail

# Install Node.js 22 using n if not already installed
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  npm install -g n
  n 22
  export PATH=/usr/local/n/versions/node/*/bin:$PATH
fi

# Enable corepack and install pnpm
if ! command -v pnpm >/dev/null; then
  corepack enable
  corepack prepare pnpm@10.8.1 --activate
fi

# Install project dependencies and build the CLI
pnpm install
pnpm --filter @openai/codex run build

# Ensure API key is available for integration tests and visual loop
if [[ -z "${OPENAI_API_KEY:-}" ]]; then
  echo "WARNING: OPENAI_API_KEY is not set. Visual loop features will be disabled."
else
  export OPENAI_API_KEY
fi

# Optionally install native sandbox dependencies if GH_TOKEN is set
if command -v gh >/dev/null && command -v zstd >/dev/null && [[ -n "${GH_TOKEN:-}" ]]; then
  bash ./codex-cli/scripts/install_native_deps.sh
else
  echo "Skipping install_native_deps.sh. Ensure gh, zstd, and GH_TOKEN are available to install sandbox binaries."
fi

