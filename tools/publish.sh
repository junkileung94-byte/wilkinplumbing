#!/usr/bin/env bash
# Publish content edits: commit everything under site/ and push to GitHub.
# Hostinger redeploys from the pushed commit. Run from anywhere in the repo.
set -euo pipefail
cd "$(dirname "$0")/.."

if git diff --quiet && git diff --cached --quiet; then
  echo "No changes to publish."
  exit 0
fi

git add -A
msg="${1:-Update site content ($(date +%Y-%m-%d\ %H:%M))}"
git commit -q -m "$msg"
git push -q origin main
echo "Published: $msg"
echo "Hostinger will redeploy from the new commit."
