#!/bin/bash
# 새 런 감지 후 evening 리포트 자동 실행
# cron: 16:00~23:00 사이 30분마다 실행

cd "$(dirname "$0")"
export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

TODAY=$(date +%Y-%m-%d)
STATE_FILE=".last-run-state"

# 어제 이전 상태 파일이면 초기화
SAVED_DATE=$(cat "$STATE_FILE" 2>/dev/null | cut -d: -f1)
if [ "$SAVED_DATE" != "$TODAY" ]; then
  echo "$TODAY:0" > "$STATE_FILE"
fi

LAST_COUNT=$(cat "$STATE_FILE" | cut -d: -f2)

# 가민 최신 데이터 동기화 (윤호만)
node sync.js --user yunho 2>/dev/null

# 오늘 런 개수 확인
TODAY_COUNT=$(node -e "
const d = JSON.parse(require('fs').readFileSync('data/yunho.json', 'utf-8'));
console.log((d.activities||[]).filter(r => r.date === '$TODAY').length);
" 2>/dev/null || echo "0")

if [ "${TODAY_COUNT:-0}" -gt "${LAST_COUNT:-0}" ]; then
  echo "=== $(date '+%Y-%m-%d %H:%M:%S') 새 런 감지 (오늘 ${TODAY_COUNT}개) evening 리포트 생성 ==="
  echo "$TODAY:$TODAY_COUNT" > "$STATE_FILE"

  node generate-daily-report.js evening
  node generate-dashboard.js

  git add data/ dashboard.html
  git commit -m "sync: $TODAY 런 후 자동 갱신" 2>/dev/null && \
    git push && echo "GitHub 푸시 완료 ✓" || echo "푸시 실패"
fi
