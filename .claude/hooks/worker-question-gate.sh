#!/usr/bin/env bash
# Stop hook — refuse to end a turn while an Orca worker is waiting on an answer.
#
# Why this exists (2026-09-22): a worker asked two questions through
# `orca orchestration ask`. Both were delivered to the Run mailbox, but
# `orca orchestration check` returns ONE delivery at a time and does not advance
# until that delivery is acknowledged. An earlier worker_done had been read and
# acted on but never `--ack`ed, so every later `check` kept replaying it
# (`count 1`) and both questions sat behind it, invisible. The worker blocked for
# ~25 minutes and would have waited indefinitely; only the owner asking "are your
# workers actually working?" surfaced it. The contract already said to ack, and
# the orchestrator had read the contract that same session — so prose was not the
# fix. This is.
#
# Mechanism: a question and its answer share a thread — the reply carries
# `thread_id` equal to the question's `id`. A question with no such reply is
# unanswered. Everything else is deliberately left alone.
#
# It FAILS OPEN: missing orca, missing python, a timeout, malformed JSON or any
# other error exits 0 and the turn ends normally. A gate that blocks the session
# when it breaks would be worse than the stall it prevents.
#
# Escape hatch: `touch .claude/hooks/.skip-worker-question-gate` to silence it
# (e.g. a question that will never be answered on a dead run). Remove the file to
# re-arm.

set -uo pipefail

GATE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -e "$GATE_DIR/.skip-worker-question-gate" ] && exit 0

STDIN_JSON="$(cat 2>/dev/null || true)"

command -v orca   >/dev/null 2>&1 || exit 0
command -v python3 >/dev/null 2>&1 || exit 0

# Claude Code sets stop_hook_active when the turn is already continuing because
# of a Stop hook. Blocking again there would loop.
if [ -n "$STDIN_JSON" ]; then
  printf '%s' "$STDIN_JSON" | python3 -c '
import json,sys
try:
    sys.exit(1 if json.load(sys.stdin).get("stop_hook_active") else 0)
except Exception:
    sys.exit(0)
' || exit 0
fi

# macOS ships no `timeout` (it is GNU coreutils), and the first version of this
# hook used it: the command failed with 127 on every run, the guard fell through
# its fail-open path and the gate silently never fired. Hence the portable
# watchdog below — and the live test at the bottom of this file's history.
run_with_deadline() {  # <seconds> <command...>
  local deadline="$1"; shift
  local out; out="$(mktemp)" || return 1
  # Job control puts the background command in its own process group, so the
  # deadline can kill the whole tree. Killing only the direct pid leaves the
  # children running — the first version of this watchdog leaked a `sleep`.
  set -m
  "$@" >"$out" 2>/dev/null &
  local pid=$!
  set +m
  local waited=0
  while kill -0 "$pid" 2>/dev/null; do
    if [ "$waited" -ge "$deadline" ]; then
      kill -9 -"$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null
      wait "$pid" 2>/dev/null
      rm -f "$out"
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  wait "$pid"; local rc=$?
  cat "$out"
  rm -f "$out"
  return $rc
}

INBOX="$(run_with_deadline 15 orca orchestration inbox --json --limit 200)" || exit 0
[ -z "$INBOX" ] && exit 0

PENDING="$(printf '%s' "$INBOX" | python3 -c '
import json, sys
from datetime import datetime, timedelta, timezone

# Only recent questions. An old one on a finished Run must not block the session
# forever; a genuinely stuck worker is answered well inside this window.
WINDOW_HOURS = 8

try:
    payload = json.load(sys.stdin)
except Exception:
    sys.exit(0)

msgs = (payload.get("result") or payload).get("messages") or []
answered = {m.get("thread_id") for m in msgs if m.get("thread_id")}
cutoff = datetime.now(timezone.utc) - timedelta(hours=WINDOW_HOURS)

out = []
for m in msgs:
    if m.get("type") != "question":
        continue
    if not str(m.get("to_handle") or "").startswith("run:"):
        continue          # not addressed to a coordinator mailbox
    if m.get("id") in answered:
        continue
    raw = m.get("created_at") or ""
    try:
        when = datetime.fromisoformat(raw.replace("Z", "+00:00"))
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        if when < cutoff:
            continue
    except Exception:
        pass              # unparseable timestamp: treat as current, fail loud
    subject = (m.get("subject") or "question").strip()
    body = " ".join((m.get("body") or "").split())[:240]
    mid = m.get("id")
    sender = m.get("from_handle")
    out.append("  - %s from %s (%s): %s" % (mid, sender, subject, body))

if out:
    print("\n".join(out))
' 2>/dev/null)" || exit 0

[ -z "$PENDING" ] && exit 0

cat >&2 <<EOF
An Orca worker is blocked waiting on you. Do not end the turn.

$PENDING

Answer each one with:
  orca orchestration reply --id <message_id> --body "<answer>"

Then acknowledge the delivery so the queue advances — an unacknowledged delivery
hides every message behind it:
  orca orchestration check --json           # read deliveryId
  orca orchestration check --ack <deliveryId>

Inspect with 'orca orchestration inbox', not 'check': inbox shows every message
regardless of acknowledgement, so a stuck ack cannot hide a worker's question.
EOF
exit 2
