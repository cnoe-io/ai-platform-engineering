#!/bin/bash
# beforeShellExecution hook: pause for confirmation on git commands that can
# move the checked-out branch pointer, clobber uncommitted work, or rewrite
# shared history. Read-only git and `git worktree` (the safe isolation path)
# are allowed automatically. See .cursor/rules/safe-git-worktree.mdc.
#
# Fails OPEN (allows) on parse/tooling errors so it never blocks the whole
# session; this is a safety nudge, not a hard security boundary.

input=$(cat)

# Extract the command; fall back to allow if jq or the field is missing.
if ! command -v jq >/dev/null 2>&1; then
  echo '{ "permission": "allow" }'
  exit 0
fi
command=$(printf '%s' "$input" | jq -r '.command // empty' 2>/dev/null)

if [ -z "$command" ]; then
  echo '{ "permission": "allow" }'
  exit 0
fi

# Quick out: nothing to guard if there's no git invocation.
if ! printf '%s' "$command" | grep -Eq '(^|[^[:alnum:]])git([[:space:]]|$)'; then
  echo '{ "permission": "allow" }'
  exit 0
fi

ask() {
  msg="$1"
  agent_msg="Per .cursor/rules/safe-git-worktree.mdc, this git command can disturb the user's working tree or shared history. Confirm with the user, or do the work in an isolated worktree (git worktree add /tmp/caipe-<task> origin/main -b <branch>). Command: ${command}"
  jq -n --arg m "$msg" --arg a "$agent_msg" \
    '{ permission: "ask", user_message: $m, agent_message: $a }'
  exit 0
}

# --- Branch-pointer / working-tree mutations -------------------------------
# checkout, switch, reset, restore, stash, clean, rebase, merge
if printf '%s' "$command" | grep -Eq '(^|[^[:alnum:]])git[[:space:]]+(checkout|switch|reset|restore|stash|clean|rebase|merge)([[:space:]]|$)'; then
  ask "This git command can move your branch or overwrite uncommitted edits. Review before running, or isolate the work in a git worktree."
fi

# --- Destructive branch ops (delete / rename / force) ----------------------
if printf '%s' "$command" | grep -Eq '(^|[^[:alnum:]])git[[:space:]]+branch[[:space:]]+(-[dDmM]|--delete|--move|--force|-f)([[:space:]]|$)'; then
  ask "This deletes, renames, or force-updates a branch. Review before running."
fi

# --- Force push / push to a protected branch -------------------------------
if printf '%s' "$command" | grep -Eq '(^|[^[:alnum:]])git[[:space:]]+push'; then
  if printf '%s' "$command" | grep -Eq '(--force([-=]|[[:space:]]|$)|--force-with-lease|(^|[[:space:]])-f([[:space:]]|$))'; then
    ask "This is a force-push and can rewrite remote history. Review carefully."
  fi
  if printf '%s' "$command" | grep -Eq '(^|[[:space:]])(origin[[:space:]]+)?(main|master)([[:space:]]|:|$)'; then
    ask "This pushes to a protected branch (main/master). Push to a feature branch instead."
  fi
fi

# Everything else (status, log, diff, show, fetch, worktree, add, commit,
# normal push to a feature branch, ...) is allowed.
echo '{ "permission": "allow" }'
exit 0
