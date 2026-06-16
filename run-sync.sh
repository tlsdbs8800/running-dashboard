#!/bin/bash
# 매일 자동 실행: 데이터 수집 → 대시보드 생성 → GitHub 푸시
cd "$(dirname "$0")"

echo "=== $(date '+%Y-%m-%d %H:%M:%S') 동기화 시작 ==="

# 1. 최신 코드 + 데이터 가져오기 (다른 기기에서 업데이트된 내용 반영)
git pull --rebase origin main 2>/dev/null && echo "git pull 완료" || echo "git pull 실패 (무시하고 계속)"

# 2. 데이터 수집 (Python — OAuth 자동 갱신)
python3 sync.py "$@"

# 3. 대시보드 생성
node generate-dashboard.js

# 4. GitHub 푸시 (데이터 + 대시보드)
git add data/ dashboard.html
if git commit -m "sync: $(date '+%Y-%m-%d %H:%M') 자동 갱신" 2>/dev/null; then
  git push && echo "GitHub 푸시 완료 ✓" || echo "GitHub 푸시 실패"
else
  echo "변경사항 없음 — 푸시 생략"
fi

echo "=== 완료 ==="
