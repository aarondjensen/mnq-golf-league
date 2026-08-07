#!/usr/bin/env bash
#
# Deploy firestore.rules WITHOUT the Firebase CLI.
#
# Why this exists
# ───────────────
# `firebase deploy --only firestore:rules` needs the Firebase CLI to be
# logged in, and on a machine with no browser (Cloud Shell) that means
# `firebase login --no-localhost` — which prints a URL and asks you to
# paste an auth code back. On a phone that's the one thing you can't
# reliably do, so a rules fix could end up blocked until someone reached
# a laptop.
#
# This script talks to the Firebase Rules REST API directly and borrows
# gcloud's credentials, which in Cloud Shell are already there the moment
# the tab opens. No login, no paste, no key file.
#
# Usage:  npm run rules       (from the repo root)
#
# It does exactly what the CLI does, in the two calls the CLI makes:
#   1. upload firestore.rules as a new ruleset
#   2. point the `cloud.firestore` release at that ruleset
#
# Step 2 is the atomic switch — until it runs, the new ruleset exists but
# governs nothing, so a failure between the two leaves the live rules
# untouched rather than half-applied.

set -euo pipefail

PROJECT="mnq-golf-leage"           # matches .firebaserc; note the spelling
RULES_FILE="firestore.rules"
RELEASE="cloud.firestore"          # the (default) database's rules release
API="https://firebaserules.googleapis.com/v1"

fail() { printf '\n✗ %s\n' "$1" >&2; exit 1; }

[ -f "$RULES_FILE" ] || fail "No $RULES_FILE here. Run this from the repo root."
command -v gcloud >/dev/null 2>&1 || fail "gcloud not found. In Cloud Shell it's built in; on a laptop use 'firebase deploy --only firestore:rules' instead."
command -v jq     >/dev/null 2>&1 || fail "jq not found (it's preinstalled in Cloud Shell)."
command -v curl   >/dev/null 2>&1 || fail "curl not found."

echo "→ Getting a token from gcloud…"
TOKEN="$(gcloud auth print-access-token 2>/dev/null)" \
  || fail "gcloud has no credentials. In Cloud Shell this should be automatic; otherwise run 'gcloud auth login'."
[ -n "$TOKEN" ] || fail "gcloud returned an empty token."

# jq builds the body so the rules text is escaped properly — it's full of
# quotes, slashes and newlines, and hand-rolling that JSON is how you end
# up deploying a mangled file.
echo "→ Uploading $RULES_FILE…"
CREATE_BODY="$(jq -n --arg name "$RULES_FILE" --rawfile content "$RULES_FILE" \
  '{source: {files: [{name: $name, content: $content}]}}')"

CREATE_RESP="$(curl -sS -X POST "$API/projects/$PROJECT/rulesets" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$CREATE_BODY")"

RULESET="$(printf '%s' "$CREATE_RESP" | jq -r '.name // empty')"
if [ -z "$RULESET" ]; then
  printf '%s\n' "$CREATE_RESP" | jq -r '.error.message // .' >&2
  fail "Upload rejected. If that message is about syntax, the rules file itself is bad; nothing was published."
fi
echo "  ruleset: $RULESET"

# Only now does anything change for real.
echo "→ Publishing…"
PATCH_BODY="$(jq -n --arg rel "projects/$PROJECT/releases/$RELEASE" --arg rs "$RULESET" \
  '{release: {name: $rel, rulesetName: $rs}}')"

PATCH_RESP="$(curl -sS -X PATCH "$API/projects/$PROJECT/releases/$RELEASE" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$PATCH_BODY")"

if [ -z "$(printf '%s' "$PATCH_RESP" | jq -r '.name // empty')" ]; then
  printf '%s\n' "$PATCH_RESP" | jq -r '.error.message // .' >&2
  fail "Publish failed. The live rules are unchanged."
fi

echo
echo "✓ Rules are live on $PROJECT."
printf '%s' "$PATCH_RESP" | jq -r '"  ruleset: \(.rulesetName)\n  updated: \(.updateTime)"'
