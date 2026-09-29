# 코스 GPX

`make-course.py` — BRouter(보행 라우팅) + Nominatim(좌표)로 왕복 코스 GPX 생성. 키 없음.
목표 거리에서 편도를 자르고 역순으로 붙이는 방식이라 거리가 정확히 맞는다.

- `yunho-full-14km.gpx` — 솔로 6km(북쪽) + 커플 7.85km(남쪽), 단일 트랙
- `yunho-solo-6km.gpx` / `jenny-couple-8km.gpx` — 구간별

## Garmin 넣는 법
Garmin Connect 웹 → 훈련 및 계획 → 코스 → 가져오기 → GPX 선택 → 저장 → 기기로 보내기

## 다른 코스 만들기
`make-course.py`의 좌표 상수 수정 후:
`outback_exact(WAYPOINTS, 편도거리_m, "코스 이름")`
