#!/bin/bash
# deploy.sh — Full deploy to production
# Usage: ./deploy.sh "commit message"
# Run this after making changes. Handles build check, git push, Vercel trigger, and promotion.

set -e

TOKEN="${VERCEL_TOKEN:-$(grep VERCEL_TOKEN ~/.env.deploy 2>/dev/null | cut -d= -f2)}"
PROJECT_ID="prj_CXrP3GsxdHYwRgF1nW28P3tqYfod"
REPO_ID="1178033501"
ALIASES=(
  "williamson-scheduling.vercel.app"
  "williamson-scheduling-williamsoncivils-projects.vercel.app"
  "williamson-scheduling-williamsoncivil-williamsoncivils-projects.vercel.app"
)

MSG="${1:-deploy}"

echo "▶ Building..."
npm run build

echo "▶ Committing and pushing..."
git add -A
git commit -m "$MSG" || echo "(nothing to commit)"
git push

echo "▶ Triggering Vercel deployment..."
DPL_ID=$(curl -s -X POST "https://api.vercel.com/v13/deployments?projectId=$PROJECT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"williamson-scheduling\",\"gitSource\":{\"type\":\"github\",\"repoId\":\"$REPO_ID\",\"ref\":\"main\"}}" \
  | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))")

echo "  Deployment: $DPL_ID"

echo "▶ Waiting for build to finish..."
for i in $(seq 1 24); do
  sleep 10
  STATE=$(curl -s "https://api.vercel.com/v6/deployments?projectId=$PROJECT_ID&limit=1" \
    -H "Authorization: Bearer $TOKEN" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['deployments'][0]['state'])" 2>/dev/null)
  echo "  [$((i*10))s] $STATE"
  if [ "$STATE" = "READY" ] || [ "$STATE" = "ERROR" ]; then
    break
  fi
done

if [ "$STATE" != "READY" ]; then
  echo "✗ Deployment failed or timed out ($STATE)"
  exit 1
fi

echo "▶ Promoting to all production aliases..."
for ALIAS in "${ALIASES[@]}"; do
  curl -s -X POST "https://api.vercel.com/v10/deployments/$DPL_ID/aliases" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"alias\":\"$ALIAS\"}" > /dev/null
  echo "  ✅ $ALIAS"
done

echo ""
echo "✓ Live at https://williamson-scheduling.vercel.app"
