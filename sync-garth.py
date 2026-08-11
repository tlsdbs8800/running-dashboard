"""
Garmin data sync using garth (OAuth2, no browser needed).

Usage:
  python3 sync-garth.py              → sync all users
  python3 sync-garth.py --user yunho → sync only yunho
  python3 sync-garth.py --user gf    → sync only girlfriend
"""

import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

import garth

BASE = Path(__file__).parent

USERS = {
    "yunho": {
        "garth_dir": BASE / "sessions/garth-yunho",
        "data_file": BASE / "data/yunho.json",
        "name": "윤호",
        "birth_year": 1992,
        "target_weight_kg": 70,
        "goal_distance_km": 21.1,
        "goal_time_min": 120,
    },
    "gf": {
        "garth_dir": BASE / "sessions/garth-gf",
        "data_file": BASE / "data/gf.json",
        "name": "Jenny",
        "birth_year": 2001,
        "target_weight_kg": None,
        "goal_distance_km": 20,
        "goal_time_min": None,
        "max_runs_per_week": 3,
        "hr_ceiling": 155,
        "target_pace_sec_min": 470,
        "target_pace_sec_max": 490,
    },
}


def fetch_user_data(user_id, config):
    garth_dir = config["garth_dir"]
    name = config["name"]

    if not garth_dir.exists():
        print(f"[{name}] garth 토큰 없음: {garth_dir} — 건너뜀")
        return None

    garth.resume(str(garth_dir))
    print(f"[{name}] 데이터 수집 시작...")

    today = datetime.now().strftime("%Y-%m-%d")

    # Activities (last 50 runs)
    acts_raw = garth.connectapi(
        "activitylist-service/activities/search/activities",
        params={"start": 0, "limit": 50, "activityType": "running"},
    )
    activities = []
    for a in acts_raw or []:
        dist = a.get("distance") or 0
        dur = a.get("duration") or 0
        activities.append({
            "id": a.get("activityId"),
            "date": (a.get("startTimeLocal") or "")[:10],
            "distanceM": round(dist),
            "durationSec": round(dur),
            "avgHR": a.get("averageHR"),
            "maxHR": a.get("maxHR"),
            "avgPaceSecPerKm": round(dur / (dist / 1000)) if dist > 0 else None,
            "calories": a.get("calories"),
            "name": a.get("activityName", ""),
        })
    print(f"[{name}] 러닝 {len(activities)}개 수집")

    # VO2Max
    vo2max = None
    try:
        res = garth.connectapi(f"metrics-service/metrics/maxmet/latest/{today}")
        g = (res or {}).get("generic", {})
        if g.get("calendarDate"):
            vo2max = [{"date": g["calendarDate"], "value": g.get("vo2MaxPreciseValue") or g.get("vo2MaxValue")}]
    except Exception as e:
        print(f"[{name}] VO2Max 실패: {e}")

    # Weight (last 12 months)
    weight = None
    try:
        start = (datetime.now() - timedelta(days=365)).strftime("%Y-%m-%d")
        res = garth.connectapi(f"weight-service/weight/range/{start}/{today}", params={"includeAll": "true"})
        if res and res.get("dateWeightList"):
            weight = [
                {"date": w["calendarDate"], "kg": w["weight"] / 1000}
                for w in res["dateWeightList"] if w.get("weight")
            ]
    except Exception as e:
        print(f"[{name}] 체중 실패: {e}")

    # Sleep
    sleep = None
    try:
        res = garth.connectapi(
            "sleep-service/sleep/dailySleepData",
            params={"date": today, "nonSleepBufferMinutes": 60},
        )
        dto = (res or {}).get("dailySleepDTO", {})
        if dto.get("calendarDate"):
            sleep = [{"date": dto["calendarDate"],
                      "score": (dto.get("sleepScores") or {}).get("overall", {}).get("value"),
                      "durationMin": round(dto["sleepTimeSeconds"] / 60) if dto.get("sleepTimeSeconds") else None}]
    except Exception as e:
        print(f"[{name}] 수면 실패: {e}")

    # Training Readiness
    training_readiness = None
    try:
        res = garth.connectapi(f"metrics-service/metrics/trainingreadiness/{today}")
        tr = res[0] if isinstance(res, list) else res
        if tr and tr.get("score") is not None:
            training_readiness = {
                "date": tr.get("calendarDate", today),
                "score": tr["score"],
                "level": tr.get("level"),
                "feedbackShort": tr.get("feedbackShort"),
                "sleepScore": tr.get("sleepScore"),
                "recoveryTimeMin": tr.get("recoveryTime"),
            }
    except Exception as e:
        print(f"[{name}] 훈련준비도 실패: {e}")

    garth.save(str(garth_dir))  # persist refreshed tokens

    age = datetime.now().year - config["birth_year"]
    return {
        "userId": user_id,
        "name": name,
        "birthYear": config["birth_year"],
        "age": age,
        "mafHR": 180 - age,
        "targetWeightKg": config.get("target_weight_kg"),
        "goalDistanceKm": config.get("goal_distance_km"),
        "goalTimeMin": config.get("goal_time_min"),
        "activities": activities,
        "vo2max": vo2max,
        "weight": weight,
        "sleep": sleep,
        "trainingReadiness": training_readiness,
        "lastSync": datetime.now().isoformat(),
    }


def merge(existing, fresh):
    if not existing:
        return fresh
    seen_ids = {a["id"] for a in existing.get("activities", [])}
    new_acts = [a for a in fresh.get("activities", []) if a["id"] not in seen_ids]
    acts = sorted(new_acts + existing.get("activities", []), key=lambda a: a["date"], reverse=True)[:200]

    seen_w = {w["date"] for w in existing.get("weight") or []}
    wt = sorted((existing.get("weight") or []) + [w for w in (fresh.get("weight") or []) if w["date"] not in seen_w],
                key=lambda w: w["date"], reverse=True)

    seen_v = {v["date"] for v in existing.get("vo2max") or []}
    v2 = sorted((existing.get("vo2max") or []) + [v for v in (fresh.get("vo2max") or []) if v["date"] not in seen_v],
                key=lambda v: v["date"], reverse=True)

    return {**existing, **fresh, "activities": acts, "weight": wt, "vo2max": v2}


def sync_user(user_id):
    config = USERS[user_id]
    existing = None
    if config["data_file"].exists():
        try:
            existing = json.loads(config["data_file"].read_text())
        except Exception:
            pass

    fresh = fetch_user_data(user_id, config)
    if not fresh:
        return

    merged = merge(existing, fresh)
    config["data_file"].write_text(json.dumps(merged, ensure_ascii=False, indent=2))
    print(f"[{config['name']}] 저장 완료 → {config['data_file']}")


def main():
    args = sys.argv[1:]
    if "--user" in args:
        idx = args.index("--user")
        users = [args[idx + 1]]
    else:
        users = list(USERS.keys())

    for user_id in users:
        if user_id not in USERS:
            print(f"알 수 없는 유저: {user_id}")
            continue
        try:
            sync_user(user_id)
        except Exception as e:
            print(f"[{USERS[user_id]['name']}] 동기화 실패: {e}")


if __name__ == "__main__":
    main()
