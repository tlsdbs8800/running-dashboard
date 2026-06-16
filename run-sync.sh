#!/bin/bash
# 사용법:
#   run-sync.sh morning   → 오전 7시: 컨디션 + 오늘 훈련 조정
#   run-sync.sh evening   → 오후 10시: 런 분석
#   run-sync.sh           → 모드 자동 감지 (7-11시=morning, 나머지=evening)

cd "$(dirname "$0")"

export PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

HOUR=$(date +%H)
if [ -z "$1" ]; then
  if [ "$HOUR" -ge 7 ] && [ "$HOUR" -lt 12 ]; then
    MODE="morning"
  else
    MODE="evening"
  fi
else
  MODE="$1"
fi

echo "=== $(date '+%Y-%m-%d %H:%M:%S') [$MODE] 동기화 시작 ==="

# 1. 최신 코드 + 데이터 가져오기
git pull --rebase origin main 2>/dev/null && echo "git pull 완료" || echo "git pull 실패 (무시)"

# 2. 가민 데이터 수집
python3 sync.py

# 3. 일일 리포트 생성 (morning or evening)
node generate-daily-report.js $MODE

# 4. 대시보드 생성
node generate-dashboard.js

# 5. 일요일 저녁이면 주간 플랜도 생성
DAY=$(date +%u)  # 1=월 ... 7=일
if [ "$DAY" = "7" ] && [ "$MODE" = "evening" ]; then
  node generate-plan.js
  echo "주간 플랜 생성 완료"
fi

# 6. GitHub 푸시
git add data/ dashboard.html
if git commit -m "[$MODE] $(date '+%Y-%m-%d %H:%M') 자동 갱신" 2>/dev/null; then
  git push && echo "GitHub 푸시 완료 ✓" || echo "GitHub 푸시 실패"
else
  echo "변경사항 없음 — 푸시 생략"
fi

echo "=== 완료 ==="
