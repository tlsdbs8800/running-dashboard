#!/bin/bash
# GitHub Actions 초기 설정 스크립트
# 실행 전 garth-login.py로 두 유저 로그인 완료 필요

set -e
cd "$(dirname "$0")"

echo "=== GitHub Actions 자동화 설정 ==="
echo ""

# gh CLI 확인
if ! command -v gh &>/dev/null; then
  echo "❌ gh CLI가 없습니다. 설치: brew install gh"
  exit 1
fi

if ! gh auth status &>/dev/null; then
  echo "❌ gh 로그인 필요: gh auth login"
  exit 1
fi

REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)
echo "레포: $REPO"
echo ""

# garth 토큰 업로드
upload_token() {
  local user=$1
  local dir="sessions/garth-$user"
  if [ ! -d "$dir" ]; then
    echo "⚠️  $dir 없음 — python3 garth-login.py --user $user 먼저 실행하세요"
    return
  fi
  SECRET_NAME="GARTH_$(echo "$user" | tr '[:lower:]' '[:upper:]')_TOKENS"
  ENCODED=$(tar czf - "$dir" | base64)
  echo "$ENCODED" | gh secret set "$SECRET_NAME" --body "$(cat)" -R "$REPO"
  echo "✅ $SECRET_NAME 업로드 완료"
}

upload_token yunho
upload_token gf

# GH_PAT 안내
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "마지막 단계: GH_PAT 설정"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1. https://github.com/settings/tokens/new 접속"
echo "2. Note: running-dashboard-actions"
echo "3. Expiration: No expiration"
echo "4. Scopes 체크:"
echo "   ✅ repo (전체)"
echo "   ✅ secrets (write:org 또는 repo secrets)"
echo "5. Generate token → 복사"
echo ""
echo -n "PAT 붙여넣기: "
read -r PAT
echo "$PAT" | gh secret set GH_PAT --body "$(cat)" -R "$REPO"
echo "✅ GH_PAT 업로드 완료"

echo ""
echo "=== 설정 완료 ==="
echo "GitHub Actions → Actions 탭에서 'Garmin Sync' 워크플로우 확인하세요"
echo ""
echo "이후 관리:"
echo "  - 30일 후 토큰 갱신: python3 garth-login.py && bash setup-github-actions.sh"
