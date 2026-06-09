#!/usr/bin/env bash
set -euo pipefail

OUT_FILE="aws-backend/.env"
PROFILE=""
ROLE_ARN=""
DURATION=3600

usage(){
  cat <<EOF
Usage: $0 [--profile NAME] [--role-arn ARN] [--duration SECONDS] [--out FILE]

Fetch temporary AWS credentials using the AWS CLI and update the AWS_* vars
in the target env file (defaults to aws-backend/.env).

Options:
  --profile NAME    Use AWS CLI profile (optional)
  --role-arn ARN    Assume the given role ARN (optional). If omitted, uses get-session-token.
  --duration N      Duration in seconds for the session token (default: 3600)
  --out FILE        Output env file to update (default: aws-backend/.env)
  -h|--help         Show this help

Examples:
  bash scripts/refresh-aws-env.sh --profile default --duration 3600
  bash scripts/refresh-aws-env.sh --role-arn arn:aws:iam::123456789012:role/MyRole
EOF
}

if [ "$#" -eq 0 ]; then
  # allow running with no args, will try to use default profile
  :
fi

while [ "$#" -gt 0 ]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2;;
    --role-arn) ROLE_ARN="$2"; shift 2;;
    --duration) DURATION="$2"; shift 2;;
    --out) OUT_FILE="$2"; shift 2;;
    -h|--help) usage; exit 0;;
    --) shift; break;;
    *) echo "Unknown arg: $1"; usage; exit 1;;
  esac
done

AWS_CMD="aws"
if [ -n "$PROFILE" ]; then
  AWS_CMD="aws --profile $PROFILE"
fi

TMP_JSON=$(mktemp)
trap 'rm -f "$TMP_JSON"' EXIT

if [ -n "$ROLE_ARN" ]; then
  echo "Assuming role $ROLE_ARN (duration=$DURATION)..."
  $AWS_CMD sts assume-role --role-arn "$ROLE_ARN" --role-session-name refresh-$(date +%s) --duration-seconds $DURATION > "$TMP_JSON"
else
  echo "Requesting session token (duration=$DURATION)..."
  $AWS_CMD sts get-session-token --duration-seconds $DURATION > "$TMP_JSON"
fi

ACCESS_KEY=$(jq -r '.Credentials.AccessKeyId // .Credentials.AccessKey' "$TMP_JSON")
SECRET_KEY=$(jq -r '.Credentials.SecretAccessKey // .Credentials.SecretKey' "$TMP_JSON")
SESSION_TOKEN=$(jq -r '.Credentials.SessionToken' "$TMP_JSON")

if [ -z "$ACCESS_KEY" ] || [ -z "$SECRET_KEY" ] || [ -z "$SESSION_TOKEN" ]; then
  echo "Failed to parse credentials from AWS CLI output:" >&2
  cat "$TMP_JSON" >&2
  exit 2
fi

# Prepare tmp file with existing content but without AWS_* keys
if [ -f "$OUT_FILE" ]; then
  grep -v -E '^(AWS_ACCESS_KEY_ID=|AWS_SECRET_ACCESS_KEY=|AWS_SESSION_TOKEN=)' "$OUT_FILE" > "${OUT_FILE}.partial" || true
else
  # create parent dir if needed
  mkdir -p "$(dirname "$OUT_FILE")"
  : > "${OUT_FILE}.partial"
fi

{
  cat "${OUT_FILE}.partial"
  echo "AWS_ACCESS_KEY_ID=$ACCESS_KEY"
  echo "AWS_SECRET_ACCESS_KEY=$SECRET_KEY"
  echo "AWS_SESSION_TOKEN=$SESSION_TOKEN"
} > "${OUT_FILE}.new"

mv "${OUT_FILE}.new" "$OUT_FILE"
rm -f "${OUT_FILE}.partial"

echo "Updated $OUT_FILE with new temporary credentials. (duration=$DURATION)"

echo "Tip: run 'chmod +x scripts/refresh-aws-env.sh' once to make it executable."
