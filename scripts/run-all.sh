#!/usr/bin/env bash
# Runs every check against fresh servers: types, build, unit checks, API suite, institute scenario, restart
# recovery, and all browser suites. Uses the mock Claude/Resend server, so no real keys are needed.
# Usage: scripts/run-all.sh        (from the repo root; takes about 20 minutes)
set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
PORT=4300
FAILED=()
cleanup() { pkill -f "src/index.ts" 2>/dev/null; kill "$MOCK" 2>/dev/null; rm -rf "$WORK"; }
trap cleanup EXIT

start() { # start [fresh]
  pkill -f "src/index.ts" 2>/dev/null; sleep 1
  if [ "${1:-}" = fresh ]; then DATA="$WORK/data-$RANDOM"; mkdir -p "$DATA"; (cd "$ROOT/server" && DATA_DIR="$DATA" npx tsx src/seed.ts >/dev/null 2>&1); fi
  (cd "$ROOT/server" && exec env RESEND_API_KEY=re_test_key RESEND_BASE_URL=http://localhost:4999 JOB_BACKOFF_SCALE=0.05 \
    SUPER_ADMIN_EMAILS=root-admin@example.com PLATFORM_CLAUDE_KEY=sk-ant-test-valid-platform-key NODE_ENV=production \
    JWT_SECRET=test-secret-0123456789abcdef0123456789abcdef DATA_DIR="$DATA" SEED_DEMO=true ALLOW_SIGNUP=true PORT=$PORT \
    ANTHROPIC_BASE_URL=http://localhost:4999 nohup npx tsx src/index.ts >>"$DATA/server.log" 2>&1) &
  disown
  for _ in $(seq 60); do curl -sf "localhost:$PORT/api/health" >/dev/null && return; sleep 0.5; done
  echo "server didn't start"; tail -20 "$DATA/server.log"; exit 1
}
step() { # step "name" command...
  local name=$1; shift
  printf '▸ %-28s' "$name"
  if out=$("$@" 2>&1); then r=$(echo "$out" | grep -E '✓|passed|after restart' | tail -1); echo "${r:-✓ ok}"; else echo "FAILED"; echo "$out" | grep -E '✗|Error' | head -20; FAILED+=("$name"); fi
}

cd "$ROOT"
step "typecheck" npm run -s typecheck
step "web build" npm -w web run -s build
step "page grouping (unit)" bash -c "cd server && npx tsx ../scripts/unit-sheetmap.ts"
MOCK_FAIL_RATE=0.2 node scripts/mock-claude.mjs >"$WORK/mock.log" 2>&1 & MOCK=$!
sleep 1
start fresh; step "API suite" env DATA_DIR="$DATA" node scripts/e2e-api.mjs
start fresh; step "institute scenario" node scripts/e2e-institute.mjs
start fresh; R=$(node scripts/e2e-restart.mjs start | tail -1)
pkill -9 -f "src/index.ts" 2>/dev/null; sleep 1; start; step "restart recovery" node scripts/e2e-restart.mjs check "$R"
for s in e2e-ui-shell e2e-ui-phase2 e2e-ui-phase4 e2e-ui-phase5; do start fresh; step "$s" node "scripts/$s.mjs"; done

echo
if [ ${#FAILED[@]} -eq 0 ]; then echo "✓ everything passed"; else echo "✗ failed: ${FAILED[*]}"; exit 1; fi
