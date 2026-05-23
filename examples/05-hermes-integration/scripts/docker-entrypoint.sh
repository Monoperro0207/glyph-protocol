#!/usr/bin/env bash
# Multi-command entrypoint for the Hermes integration sandbox.
#
# Sub-commands:
#   native  — boots Glyph server, runs the native Python protocol test
#   hermes  — boots Glyph server + bridge, runs Hermes Agent with DeepSeek
#   all     — both, in sequence; exits non-zero if either fails
#   shell   — drops you into bash inside the container (for debugging)
set -euo pipefail

cmd="${1:-all}"
cd /app/examples/05-hermes-integration

start_glyph_server() {
  pnpm exec tsx server.ts > results/glyph-server.log 2>&1 &
  GLYPH_PID=$!
  echo "[entrypoint] glyph server pid=$GLYPH_PID"
  # Wait for /health to respond — server logs binding only after the listener
  # is bound, but a polite poll is more robust than a fixed sleep.
  for i in {1..30}; do
    if curl -sf -m 2 http://127.0.0.1:3199/health > /dev/null; then
      echo "[entrypoint] glyph server ready"
      return 0
    fi
    sleep 0.5
  done
  echo "[entrypoint] glyph server failed to start"
  cat results/glyph-server.log
  return 1
}

stop_glyph_server() {
  if [ -n "${GLYPH_PID:-}" ]; then
    kill "$GLYPH_PID" 2>/dev/null || true
    wait "$GLYPH_PID" 2>/dev/null || true
  fi
}
trap stop_glyph_server EXIT

native_test() {
  start_glyph_server
  echo ""
  echo "=== Native Python protocol test ==="
  /opt/glyph-pyenv/bin/python native-test/test.py | tee results/native-test.log
  exit_code=${PIPESTATUS[0]}
  return $exit_code
}

hermes_test() {
  start_glyph_server
  echo ""
  echo "=== Hermes Agent + DeepSeek-V4 Flash via Glyph→MCP bridge ==="
  if [ -z "${DEEPSEEK_API_KEY:-}" ]; then
    echo "[entrypoint] DEEPSEEK_API_KEY not set — cannot run Hermes test"
    return 2
  fi
  # The hermes-agent CLI is the standard entry point; the bridge is wired
  # via hermes-config/mcp.json which Hermes reads on startup. See README.
  /opt/glyph-pyenv/bin/python scripts/run-agent.py | tee results/hermes-conversation.log
  return ${PIPESTATUS[0]}
}

case "$cmd" in
  native)  native_test ;;
  hermes)  hermes_test ;;
  all)
    native_test
    hermes_test
    ;;
  shell)
    exec /bin/bash
    ;;
  *)
    echo "usage: entrypoint.sh {native|hermes|all|shell}"
    exit 2
    ;;
esac
