"""
Garmin data sync — uses garminconnect (Python) for auth + data fetching.
Saves to data/yunho.json and data/gf.json in same format as before.

Usage:
  python3 sync.py              → sync all users
  python3 sync.py --user yunho → sync only yunho
  python3 sync.py --user gf    → sync only gf
"""

import os, sys, json, datetime
from pathlib import Path

BASE = Path(__file__).parent

# Load .env
env_path = BASE / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        if "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())

USERS = {
    "yunho": {
        "data_file": BASE / "data/yunho.json",
        "token_dir": str(BASE / "sessions/garth-yunho"),
        "email_env": "GARMIN_EMAIL",
        "password_env": "GARMIN_PASSWORD",
        "name": "윤호",
        "birth_year": 1992,
        "target_weight_kg": 70,
        "goal_distance_km": 21.1,
        "goal_time_min": 120,
    },
    "gf": {
        "data_file": BASE / "data/gf.json",
        "token_dir": str(BASE / "sessions/garth-gf"),
        "email_env": "GARMIN_GF_EMAIL",
        "password_env": "GARMIN_GF_PASSWORD",
        "name": "Jenny",
        "birth_year": 2001,
        "target_weight_kg": None,
        "goal_distance_km": 20,
        "goal_time_min": None,
        "max_runs_per_week": 3,
        "all_easy": True,
        "hr_ceiling": 155,
        "target_pace_sec_min": 470,
        "target_pace_sec_max": 490,
        "long_run_flag_pct": 15,
        "goal_note": "2026년 말까지 20km 편안하게 완주 · 주 3회 올 이지",
    },
}


def get_client(cfg):
    from garminconnect import Garmin

    token_dir = cfg["token_dir"]
    email = os.environ.get(cfg["email_env"])
    password = os.environ.get(cfg["password_env"])

    client = Garmin(email, password)
    try:
        client.login(tokenstore=token_dir)
        print(f"[{cfg['name']}] 저장된 토큰으로 로그인 성공")
    except Exception:
        print(f"[{cfg['name']}] 토큰 없음 — 새로 로그인 중...")
        if not email or not password:
            raise RuntimeError(f"{cfg['email_env']} / {cfg['password_env']} 미설정")
        client.login()
        client.garth.dump(token_dir)
        print(f"[{cfg['name']}] 로그인 완료, 토큰 저장")
    return client


def fetch_activities(client, cfg, start=0, limit=50):
    try:
        raw = client.get_activities(start, limit)
        result = []
        for a in raw:
            if a.get("activityType", {}).get("typeKey") != "running":
                continue
            dist = a.get("distance", 0) or 0
            dur = a.get("duration", 0) or 0
            pace = round(dur / (dist / 1000)) if dist > 0 else None
            result.append({
                "id": a.get("activityId"),
                "date": (a.get("startTimeLocal") or "")[:10],
                "distanceM": round(dist),
                "durationSec": round(dur),
                "avgHR": a.get("averageHR"),
                "maxHR": a.get("maxHR"),
                "avgPaceSecPerKm": pace,
                "calories": a.get("calories"),
                "name": a.get("activityName", ""),
                "elevationGain": a.get("elevationGain"),
                "elevationLoss": a.get("elevationLoss"),
            })
        print(f"[{cfg['name']}] 러닝 {len(result)}개 수집 (offset={start})")
        return result
    except Exception as e:
        print(f"[{cfg['name']}] 활동 수집 실패: {e}")
        return []


def fetch_vo2max(client, cfg):
    try:
        today = datetime.date.today().isoformat()
        data = client.get_max_metrics(today)
        if isinstance(data, dict) and data.get("generic"):
            g = data["generic"]
            return [{"date": g.get("calendarDate"), "value": g.get("vo2MaxPreciseValue") or g.get("vo2MaxValue")}]
    except Exception as e:
        print(f"[{cfg['name']}] VO2Max 수집 실패: {e}")
    return None


def fetch_weight(client, cfg):
    try:
        end = datetime.date.today()
        start = end - datetime.timedelta(days=365)
        data = client.get_weigh_ins(start.isoformat(), end.isoformat())
        entries = (data.get("dateWeightList") or data.get("allWeightMetrics") or
                   data.get("weight") or (data if isinstance(data, list) else []))
        result = [
            {"date": e.get("calendarDate") or e.get("date"), "kg": (e.get("weight") or 0) / 1000}
            for e in entries if e.get("weight")
        ]
        return sorted(result, key=lambda x: x["date"], reverse=True) or None
    except Exception as e:
        print(f"[{cfg['name']}] 체중 수집 실패: {e}")
    return None


def fetch_sleep(client, cfg):
    try:
        today = datetime.date.today().isoformat()
        data = client.get_sleep_data(today)
        dto = data.get("dailySleepDTO") or {}
        if dto:
            return [{
                "date": dto.get("calendarDate"),
                "score": (dto.get("sleepScores") or {}).get("overall", {}).get("value"),
                "durationMin": round(dto["sleepTimeSeconds"] / 60) if dto.get("sleepTimeSeconds") else None,
            }]
    except Exception as e:
        print(f"[{cfg['name']}] 수면 수집 실패: {e}")
    return None


def fetch_readiness(client, cfg):
    try:
        today = datetime.date.today().isoformat()
        data = client.get_training_readiness(today)
        items = data if isinstance(data, list) else [data]
        tr = items[0] if items else {}
        if tr.get("score") is not None:
            return {
                "date": tr.get("calendarDate", today),
                "score": tr["score"],
                "level": tr.get("level"),
                "feedbackShort": tr.get("feedbackShort"),
                "sleepScore": tr.get("sleepScore"),
                "recoveryTimeMin": tr.get("recoveryTime"),
            }
    except Exception as e:
        print(f"[{cfg['name']}] 훈련 준비도 수집 실패: {e}")
    return None


def merge_data(existing, fresh):
    if not existing:
        return fresh

    # 기존 활동을 id 기준 dict로 — 새 데이터로 업데이트 (elevation 등 신규 필드 반영)
    existing_by_id = {a["id"]: a for a in existing.get("activities", [])}
    for a in fresh.get("activities", []):
        if a["id"] in existing_by_id:
            existing_by_id[a["id"]].update(a)
        else:
            existing_by_id[a["id"]] = a
    merged_acts = sorted(existing_by_id.values(), key=lambda a: a["date"], reverse=True)[:200]

    existing_w_dates = {w["date"] for w in existing.get("weight") or []}
    merged_weight = sorted(
        (existing.get("weight") or []) + [w for w in (fresh.get("weight") or []) if w["date"] not in existing_w_dates],
        key=lambda w: w["date"], reverse=True
    ) or None

    existing_v2_dates = {v["date"] for v in existing.get("vo2max") or []}
    merged_v2 = sorted(
        (existing.get("vo2max") or []) + [v for v in (fresh.get("vo2max") or []) if v["date"] not in existing_v2_dates],
        key=lambda v: v["date"], reverse=True
    ) or None

    return {**existing, **fresh, "activities": merged_acts, "weight": merged_weight, "vo2max": merged_v2}


def sync_user(user_id, backfill=False):
    cfg = USERS[user_id]
    data_file = cfg["data_file"]

    client = get_client(cfg)

    age = datetime.date.today().year - cfg["birth_year"] if cfg.get("birth_year") else None

    if backfill:
        # 200개까지 페이지 단위로 fetch해서 고도 데이터 백필
        print(f"[{cfg['name']}] 백필 모드 — 최대 200개 활동 고도 데이터 수집 중...")
        all_acts = []
        for offset in range(0, 200, 50):
            batch = fetch_activities(client, cfg, start=offset, limit=50)
            all_acts.extend(batch)
            if len(batch) < 50:
                break
        activities = all_acts
    else:
        activities = fetch_activities(client, cfg)

    fresh = {
        "userId": user_id,
        "name": cfg["name"],
        "birthYear": cfg.get("birth_year"),
        "age": age,
        "mafHR": 180 - age if age else None,
        "targetWeightKg": cfg.get("target_weight_kg"),
        "goalDistanceKm": cfg.get("goal_distance_km"),
        "goalTimeMin": cfg.get("goal_time_min"),
        "activities": activities,
        "vo2max": fetch_vo2max(client, cfg),
        "weight": fetch_weight(client, cfg),
        "sleep": fetch_sleep(client, cfg),
        "trainingReadiness": fetch_readiness(client, cfg),
        "lastSync": datetime.datetime.utcnow().isoformat() + "Z",
    }

    existing = None
    if data_file.exists():
        try:
            existing = json.loads(data_file.read_text())
        except Exception:
            pass

    merged = merge_data(existing, fresh)
    data_file.parent.mkdir(exist_ok=True)
    data_file.write_text(json.dumps(merged, indent=2, ensure_ascii=False))
    print(f"[{cfg['name']}] 저장 완료 → {data_file}")


def main():
    args = sys.argv[1:]
    user_arg = None
    backfill = "--backfill" in args

    if "--user" in args:
        user_arg = args[args.index("--user") + 1]
    elif any(a.startswith("--user=") for a in args):
        user_arg = next(a.split("=", 1)[1] for a in args if a.startswith("--user="))

    users_to_sync = [user_arg] if user_arg else list(USERS.keys())

    for uid in users_to_sync:
        if uid not in USERS:
            print(f"알 수 없는 유저: {uid}")
            continue
        try:
            sync_user(uid, backfill=backfill)
        except Exception as e:
            print(f"[{USERS[uid]['name']}] 동기화 실패: {e}")


if __name__ == "__main__":
    main()
