#!/usr/bin/env bash
# Build linux/amd64 API image with GIT_SHA, push to ECR, trigger App Runner deployment.
# Docs: docs/DEPLOY-PROD.md
#
# Requires: docker (buildx), aws CLI, credentials for account 322513863369 (or override).
#
# Usage (from anywhere):
#   bash apps/api/scripts/deploy-apprunner-prod.sh
#
# Env overrides:
#   AWS_ACCOUNT_ID  AWS_REGION  ECR_REPO  APP_RUNNER_SERVICE_ARN

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SHA="$(git -C "$REPO_ROOT" rev-parse HEAD)"

AWS_ACCOUNT_ID="${AWS_ACCOUNT_ID:-322513863369}"
REGION="${AWS_REGION:-us-east-1}"
ECR_REPO="${ECR_REPO:-sovexa-api}"
APP_RUNNER_SERVICE_ARN="${APP_RUNNER_SERVICE_ARN:-arn:aws:apprunner:us-east-1:322513863369:service/sovexa-api-prod/be31ecaa30bc469db5cdbe3fc87273b4}"

REGISTRY="${AWS_ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
IMAGE_LOCAL="sovexa-api:latest"
IMAGE_REMOTE="${REGISTRY}/${ECR_REPO}:latest"

echo "[deploy] GIT_SHA=${SHA}"
echo "[deploy] Building ${IMAGE_LOCAL} (linux/amd64) ..."
docker buildx build --platform linux/amd64 \
  --build-arg "GIT_SHA=${SHA}" \
  -t "${IMAGE_LOCAL}" \
  -f "${REPO_ROOT}/apps/api/Dockerfile" \
  "${REPO_ROOT}"

echo "[deploy] Logging in to ECR ${REGISTRY} ..."
aws ecr get-login-password --region "${REGION}" \
  | docker login --username AWS --password-stdin "${REGISTRY}"

docker tag "${IMAGE_LOCAL}" "${IMAGE_REMOTE}"
echo "[deploy] Pushing ${IMAGE_REMOTE} ..."
docker push "${IMAGE_REMOTE}"

echo "[deploy] Starting App Runner deployment ..."
aws apprunner start-deployment \
  --service-arn "${APP_RUNNER_SERVICE_ARN}" \
  --region "${REGION}"

echo "[deploy] Done — image ${SHA} pushed; App Runner will pull :latest and roll out."
echo "[deploy] Check: curl -s https://api.sovexa.ai/health | jq ."
