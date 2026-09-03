#!/bin/bash
# 라즈베리파이에서 실행할 동기화 스크립트.
# .github/workflows/sync.yml의 로직을 그대로 옮긴 것 — garth 토큰을
# GitHub Secrets로 base64 왕복시킬 필요가 없어짐 (디스크에 그냥 유지되므로 삭제됨).
#
# 사용법: ./pi-sync.sh [morning|evening|check]  (기본값 check)

set -e
cd "$(dirname "$0")"
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

MODE="${1:-check}"
echo "=== $(date '+%Y-%m-%d %H:%M:%S') [$MODE] 동기화 시작 ==="

git pull --rebase origin main || echo "git pull 실패 (무시)"

python3 sync-garth.py

if [ "$MODE" = "morning" ]; then
  node generate-daily-report.js morning
elif [ "$MODE" = "evening" ]; then
  node generate-daily-report.js evening
else
  # check 모드: 최근 24시간 내 새 런이 있으면 evening 리포트 생성
  COUNT=$(python3 -c "
import json
from datetime import datetime, timedelta, timezone
kst = timezone(timedelta(hours=9))
cutoff = (datetime.now(kst) - timedelta(hours=24)).strftime('%Y-%m-%d')
d = json.load(open('data/yunho.json'))
print(len([a for a in d.get('activities', []) if a['date'] >= cutoff]))
")
  echo "최근 24시간 런: ${COUNT}개"
  [ "$COUNT" -gt 0 ] && node generate-daily-report.js evening
fi

DAY=$(TZ=Asia/Seoul date +%u)  # 1=월 ... 7=일
if [ "$DAY" = "7" ] && [ "$MODE" = "evening" ]; then
  node generate-plan.js
  echo "주간 플랜 생성 완료"
fi

node generate-dashboard.js

git add data/ index.html
if git commit -m "[$MODE] $(date '+%Y-%m-%d %H:%M') 자동 갱신 (pi)" 2>/dev/null; then
  git push || { git pull --rebase origin main && git checkout --theirs data/ index.html && git add data/ index.html && GIT_EDITOR=true git rebase --continue && git push; }
  echo "GitHub 푸시 완료"
else
  echo "변경사항 없음 — 푸시 생략"
fi

echo "=== 완료 ==="
