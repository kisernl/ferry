#!/usr/bin/env bash
# Fill placeholders in the IAM policy templates.
# Usage: ./fill.sh <account-id> <region> [prefix]
set -euo pipefail
ACCOUNT="${1:?account id required}"
REGION="${2:?region required}"
PREFIX="${3:-ferry}"
DIR="$(cd "$(dirname "$0")" && pwd)"
for f in server-policy.json optional-check-policy.json; do
  sed -e "s/{ACCOUNT_ID}/$ACCOUNT/g" -e "s/{REGION}/$REGION/g" -e "s/{PREFIX}/$PREFIX/g" \
    "$DIR/$f" > "$DIR/${f%.json}.filled.json"
  echo "wrote $DIR/${f%.json}.filled.json"
done
