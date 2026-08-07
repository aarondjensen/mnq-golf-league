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
command -v jq   >/dev/null 2>&1 || fail "jq not found (it's preinstalled in Cloud Shell)."
command -v curl >/dev/null 2>&1 || fail "curl not found."
# gcloud is NOT required — the metadata server below can supply the token
# on its own, and failing here would skip that path entirely.

# Two independent ways to get a token, because in Cloud Shell either can
# be the one that works:
#
#   1. gcloud — the normal path, but it can sit un-authorized until you
#      approve the "Authorize Cloud Shell" dialog, and on a phone that
#      dialog is easy to miss or to have never rendered.
#   2. The metadata server — Cloud Shell runs one, and it serves the
#      logged-in USER's credentials (this is how Application Default
#      Credentials resolve there). It needs no gcloud state at all, so it
#      often works when path 1 hasn't been authorized.
#
# Failures here are printed in full rather than swallowed. An earlier cut
# of this script hid gcloud's stderr, which turned "why did this fail"
# into a guessing game over screenshots.
echo "→ Getting an access token…"
TOKEN=""
GCLOUD_ERR=""

if command -v gcloud >/dev/null 2>&1; then
  if TOKEN_TRY="$(gcloud auth print-access-token 2>&1)" && [ -n "$TOKEN_TRY" ]; then
    TOKEN="$TOKEN_TRY"
    echo "  got one from gcloud"
  else
    GCLOUD_ERR="$TOKEN_TRY"
    echo "  gcloud couldn't provide one, trying the metadata server…"
  fi
fi

if [ -z "$TOKEN" ]; then
  META="http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token"
  if META_RESP="$(curl -sS --max-time 10 -H 'Metadata-Flavor: Google' "$META" 2>&1)"; then
    TOKEN="$(printf '%s' "$META_RESP" | jq -r '.access_token // empty' 2>/dev/null || true)"
    [ -n "$TOKEN" ] && echo "  got one from the metadata server"
  fi
fi

if [ -z "$TOKEN" ]; then
  echo
  echo "── diagnostics ───────────────────────────────"
  echo "gcloud said:"
  printf '%s\n' "${GCLOUD_ERR:-（gcloud not installed）}"
  echo
  echo "accounts gcloud knows about:"
  gcloud auth list 2>&1 || true
  echo "──────────────────────────────────────────────"
  echo
  fail "No credentials available. Screenshot the diagnostics above. Most likely fix: run 'gcloud auth login' and approve the Cloud Shell authorize prompt."
fi

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
