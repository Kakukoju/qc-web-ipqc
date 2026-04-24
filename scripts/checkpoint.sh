#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  scripts/checkpoint.sh "commit message" [--push]

Examples:
  scripts/checkpoint.sh "Add weekly PPT summary notes"
  scripts/checkpoint.sh "Refine spec import flow" --push
EOF
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

message=""
push_after_commit=0

for arg in "$@"; do
  case "$arg" in
    --push)
      push_after_commit=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      if [[ -z "$message" ]]; then
        message="$arg"
      else
        echo "Error: only one commit message is supported." >&2
        usage
        exit 1
      fi
      ;;
  esac
done

if [[ -z "$message" ]]; then
  echo "Error: commit message is required." >&2
  usage
  exit 1
fi

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
if [[ -z "$repo_root" ]]; then
  echo "Error: this command must be run inside a git repository." >&2
  exit 1
fi

cd "$repo_root"

if ! git diff --quiet || ! git diff --cached --quiet || [[ -n "$(git ls-files --others --exclude-standard)" ]]; then
  echo "Staging changes..."
  git add -A
else
  echo "No changes to commit."
  exit 0
fi

echo "Creating commit..."
git commit -m "$message"

current_branch="$(git branch --show-current)"
echo "Created commit on branch: $current_branch"

if [[ $push_after_commit -eq 1 ]]; then
  echo "Pushing to origin/$current_branch..."
  git push
fi
