#!/bin/bash
# Owner gate — canonical rule text lives in CLAUDE.md § Rules (do not duplicate it here).
# Any branch/worktree deletion command gets forced into the owner's approval prompt.
# The command is never modified: exactly what the agent wrote is what runs on approval.
input=$(cat)
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // ""')

[ -z "$cmd" ] && exit 0

if printf '%s' "$cmd" | grep -qE 'git[[:space:]]+branch[[:space:]]+(-[a-zA-Z]*[dD]([[:space:]]|$)|--delete([[:space:]]|$))|git[[:space:]]+push[^;|&]*(--delete([[:space:]]|$)|:refs/heads/|[[:space:]]:[[:alnum:]_.][^[:space:]]*[[:space:]]*$)|git[[:space:]]+worktree[[:space:]]+(remove|prune)|git[[:space:]]+update-ref[[:space:]]+(-d|--delete)|orca[[:space:]]+worktree[[:space:]]+rm'; then
  printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"ask","permissionDecisionReason":"OWNER GATE (CLAUDE.md Rules): deleting a branch/worktree kills every Orca session bound to it. Explicit owner approval required for this exact command."}}'
fi
exit 0
