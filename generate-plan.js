/**
 * Sunday evening: analyze last week's data → generate next week's training plan.
 * Saves to data/weekly-plan.json and regenerates dashboard.html.
 *
 * Training principles applied:
 *  - 10% rule: weekly mileage increase capped at 10%
 *  - 80/20: ~80% easy (Z2), ~20% quality
 *  - Long run = 30-40% of weekly volume
 *  - Readiness-gated quality: LOW readiness → replace tempo with easy
 *  - Phase-based structure based on current long run distance
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

function hrZone(hr, maf = 146) {
  if (!hr) return 0;
  if (hr < maf - 10) return 1;
  if (hr <= maf)     return 2;
  if (hr <= maf + 15) return 3;
  if (hr <= maf + 28) return 4;
  return 5;
}

function loadUser(filename) {
  const p = join(__dirname, "data", filename);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8"));
}

// YYYY-MM-DD helpers
function dateStr(d) { return d.toISOString().substring(0, 10); }
function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return dateStr.slice(0, 0) + d.toISOString().substring(0, 10);
}
function nextMonday() {
  const now = new Date();
  const day = now.getUTCDay(); // 0=Sun
  const daysUntilMon = day === 0 ? 1 : (8 - day) % 7 || 7;
  const d = new Date(now);
  d.setUTCDate(now.getUTCDate() + daysUntilMon);
  return dateStr(d);
}
function lastNDays(activities, days) {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const cutoffStr = dateStr(cutoff);
  return (activities || []).filter((a) => a.date >= cutoffStr);
}

// Determine training phase from current long run distance
function getPhase(longRunKm) {
  if (longRunKm < 8)  return 1; // Base: build easy mileage
  if (longRunKm < 12) return 2; // Development: add one quality session
  if (longRunKm < 16) return 3; // Build: full quality work
  return 4;                     // Peak/Taper: maintain + rest
}

function phaseLabel(phase) {
  return ["", "기초 단계", "발전 단계", "빌드 단계", "피크/테이퍼"][phase];
}

// ── 공통 주간 체크 (윤호/여친 모두 동일 기준으로 분석) ──────────────────
function weeklyCheck(userData, isGf = false) {
  const acts = userData?.activities || [];
  const lastWeek = lastNDays(acts, 7);
  const prev2Week = lastNDays(acts, 14).filter(a => !lastNDays(acts,7).find(b => b.id === a.id));
  const last4Weeks = lastNDays(acts, 28);

  const mafHR = userData?.mafHR ?? (isGf ? 155 : 146);
  const hrCeiling = isGf ? 155 : mafHR + 15; // GF strict MAF ceiling, 윤호는 Z3까지 허용
  const longRunMaxPct = isGf ? 10 : 15;
  const longRunFlagPct = isGf ? 15 : 20;

  const lastWeekKm = lastWeek.reduce((s,a) => s + (a.distanceM??0)/1000, 0);
  const prevWeekKm = prev2Week.reduce((s,a) => s + (a.distanceM??0)/1000, 0);
  const lastLongRun = lastWeek.length ? Math.max(...lastWeek.map(a=>(a.distanceM??0)/1000)) : 0;
  const prevLongRun = prev2Week.length ? Math.max(...prev2Week.map(a=>(a.distanceM??0)/1000)) : 0;

  const flags = [];

  // Long run progression check
  if (prevLongRun > 0 && lastLongRun > 0) {
    const lrPct = ((lastLongRun - prevLongRun) / prevLongRun) * 100;
    if (lrPct > longRunFlagPct)
      flags.push(`⚠ 롱런 ${lrPct.toFixed(0)}% 증가 — 한계 ${longRunFlagPct}% 초과`);
  }

  // HR ceiling check
  const highHRRuns = lastWeek.filter(a => a.avgHR && a.avgHR > hrCeiling);
  if (highHRRuns.length > 0)
    flags.push(`⚠ ${highHRRuns.length}회 HR ${hrCeiling} 초과 (평균 ${Math.round(highHRRuns.reduce((s,a)=>s+a.avgHR,0)/highHRRuns.length)})`);

  // Pace-HR divergence: HR up but pace same/slower = fatigue signal
  if (lastWeek.length >= 2 && prev2Week.length >= 2) {
    const avgHRlast = lastWeek.reduce((s,a)=>s+(a.avgHR??0),0)/lastWeek.filter(a=>a.avgHR).length;
    const avgHRprev = prev2Week.reduce((s,a)=>s+(a.avgHR??0),0)/prev2Week.filter(a=>a.avgHR).length;
    const avgPaceLast = lastWeek.reduce((s,a)=>s+(a.avgPaceSecPerKm??0),0)/lastWeek.filter(a=>a.avgPaceSecPerKm).length;
    const avgPacePrev = prev2Week.reduce((s,a)=>s+(a.avgPaceSecPerKm??0),0)/prev2Week.filter(a=>a.avgPaceSecPerKm).length;
    if (avgHRlast - avgHRprev > 5 && avgPaceLast >= avgPacePrev - 5)
      flags.push(`⚠ HR+${Math.round(avgHRlast-avgHRprev)} bpm 상승 / 페이스 유지 → 피로 신호`);
  }

  // Rest between runs check (GF only: min 1 day)
  if (isGf && lastWeek.length >= 2) {
    const sorted = [...lastWeek].sort((a,b)=>a.date.localeCompare(b.date));
    for (let i = 1; i < sorted.length; i++) {
      const gap = (new Date(sorted[i].date) - new Date(sorted[i-1].date)) / 86400000;
      if (gap < 1) flags.push(`⚠ ${sorted[i].date} 연속 런 감지 — 런 사이 최소 1일 휴식 권장`);
    }
  }

  // GF: run count > 3/week
  if (isGf && lastWeek.length > 3)
    flags.push(`⚠ 이번 주 ${lastWeek.length}회 런 — 주 최대 3회 권장`);

  // GF: avg pace outside 7:50~8:10/km (470~490 sec)
  if (isGf && lastWeek.length > 0) {
    const easyRuns = lastWeek.filter(a => a.avgPaceSecPerKm);
    if (easyRuns.length > 0) {
      const avgPace = easyRuns.reduce((s,a) => s + a.avgPaceSecPerKm, 0) / easyRuns.length;
      if (avgPace < 470)
        flags.push(`⚠ 평균 페이스 ${Math.floor(avgPace/60)}:${String(Math.round(avgPace%60)).padStart(2,'0')}/km — 목표보다 빠름 (7:50~8:10 유지)`);
      else if (avgPace > 490)
        flags.push(`ℹ 평균 페이스 ${Math.floor(avgPace/60)}:${String(Math.round(avgPace%60)).padStart(2,'0')}/km — 목표보다 느림 (7:50~8:10 목표)`);
    }
  }

  // 윤호: weekly volume > 10% increase
  if (!isGf && prevWeekKm > 0 && lastWeekKm > 0) {
    const volPct = ((lastWeekKm - prevWeekKm) / prevWeekKm) * 100;
    if (volPct > 10)
      flags.push(`⚠ 주간 볼륨 ${volPct.toFixed(0)}% 증가 — 10% 룰 초과`);
  }

  // 윤호: Z2 ratio (easy ratio < 80%)
  if (!isGf && lastWeek.length >= 3) {
    const easyCount = lastWeek.filter(a => a.avgHR && hrZone(a.avgHR, mafHR) <= 2).length;
    const easyRatio = easyCount / lastWeek.length * 100;
    if (easyRatio < 80)
      flags.push(`⚠ 이지 런 비율 ${Math.round(easyRatio)}% — 80/20 원칙 미달 (Z1~Z2 비율 부족)`);
  }

  // Volume change
  const volChangePct = prevWeekKm > 0 ? ((lastWeekKm - prevWeekKm) / prevWeekKm * 100) : null;

  // One-line readiness recommendation
  const readiness = userData?.trainingReadiness?.score ?? null;
  let recommendation = "";
  if (flags.length === 0 && (readiness === null || readiness >= 60))
    recommendation = "✅ 이번 주 계획대로 진행";
  else if (flags.length > 0 && readiness !== null && readiness < 50)
    recommendation = "🔴 볼륨 줄이고 회복 우선";
  else if (flags.length > 0)
    recommendation = "🟡 플래그 확인 후 강도 조절";
  else
    recommendation = "🟡 준비도 확인 후 결정";

  return { flags, lastWeekKm: Math.round(lastWeekKm*10)/10, volChangePct: volChangePct ? Math.round(volChangePct) : null, lastLongRun: Math.round(lastLongRun*10)/10, recommendation };
}

// Generate one user's weekly plan
function planForUser(userData, userName, isGf = false) {
  if (!userData) return null;

  const acts = userData.activities || [];
  const lastWeek = lastNDays(acts, 7);
  const last4Weeks = lastNDays(acts, 28);

  // Stats
  const lastWeekKm = lastWeek.reduce((s, a) => s + (a.distanceM ?? 0) / 1000, 0);
  const avgWeekKm4w = last4Weeks.reduce((s, a) => s + (a.distanceM ?? 0) / 1000, 0) / 4;
  const longRunKm = last4Weeks.length > 0
    ? Math.max(...last4Weeks.map((a) => (a.distanceM ?? 0) / 1000))
    : 0;

  const avgHR = lastWeek.length > 0 && lastWeek.filter(a => a.avgHR).length > 0
    ? Math.round(lastWeek.reduce((s, a) => s + (a.avgHR ?? 0), 0) / lastWeek.filter(a => a.avgHR).length)
    : null;

  const readiness = userData.trainingReadiness?.score ?? null;
  const readinessLevel = userData.trainingReadiness?.level ?? "UNKNOWN";
  const phase = getPhase(longRunKm);

  // GF: all easy, max 10% long run increase, 3 runs/week
  // 윤호: standard progression
  const baseKm = Math.max(lastWeekKm, avgWeekKm4w);
  let targetWeeklyKm = isGf
    ? Math.round(baseKm * (readiness !== null && readiness < 40 ? 0.9 : 1.0))
    : Math.round(baseKm * (readiness >= 67 ? 1.08 : readiness >= 34 ? 1.0 : 0.9));
  targetWeeklyKm = Math.max(targetWeeklyKm, isGf ? 12 : 15);

  let longRunTarget = longRunKm;
  const maxIncreasePct = isGf ? 0.10 : 0.12;
  if (readiness === null || readiness >= (isGf ? 40 : 50)) {
    longRunTarget = Math.min(longRunKm * (1 + maxIncreasePct), isGf ? 20 : 21.1);
    longRunTarget = Math.round(longRunTarget * 10) / 10;
    if (longRunTarget === longRunKm) longRunTarget = longRunKm + 0.5; // min nudge
  }
  longRunTarget = Math.round(longRunTarget * 10) / 10;

  const canQuality = !isGf && (readiness === null || readiness >= 50);
  const mafHR = userData.mafHR ?? (isGf ? 155 : 146);

  // ── 고정 주간 구조 ──────────────────────────────────────────────────────
  // 월: 커플런  화: Solo Easy(윤호만)  수: 휴식  목: Long Run  금: 휴식  토: Easy/공복런  일: 휴식
  const coupleKm = phase >= 3 ? 7 : phase === 2 ? 6 : 5;
  const soloEasyKm = Math.max(5, Math.round(targetWeeklyKm * 0.22));
  const longKm = longRunTarget;
  const satKm = isGf ? Math.max(4, Math.round(targetWeeklyKm * 0.25)) : 5; // GF: easy run min 4km, 윤호: 공복런 5km fixed

  const monday = nextMonday();

  // GF: 3 runs only (Mon couple, Thu long, Sat easy) — all easy, no intensity
  // 윤호: full 5-session week with optional quality work
  const days = isGf ? [
    {
      offset: 0, type: "couple",
      label: `커플런 ${coupleKm}km`,
      desc: `여친 페이스 기준 · HR ${mafHR-10}~${mafHR} 유지 · 대화 가능한 속도 · 7:50~8:10/km`,
    },
    {
      offset: 1, type: "rest",
      label: "휴식",
      desc: "가벼운 스트레칭 OK · 런 사이 최소 1일 휴식",
    },
    {
      offset: 2, type: "rest",
      label: "휴식",
      desc: "내일 롱런 준비 · 충분한 수면",
    },
    {
      offset: 3, type: "long",
      label: `Long Run ${longKm}km`,
      desc: `전체 Easy Z2 · HR ${mafHR} 이하 유지 · 7:50~8:10/km · 준비도 ${readiness ?? "미확인"}/100`,
    },
    {
      offset: 4, type: "rest",
      label: "휴식",
      desc: "롱런 다음날 완전 회복 · 가벼운 걷기 OK",
    },
    {
      offset: 5, type: "easy",
      label: `Easy Run ${satKm}km`,
      desc: `이지 런 · HR ${mafHR} 이하 · 7:50~8:10/km · 다리 풀어주기`,
    },
    {
      offset: 6, type: "rest",
      label: "휴식",
      desc: "한 주 마무리 · 다음 주 계획 확인",
    },
  ] : [
    {
      offset: 0, type: "couple",
      label: `커플런 ${coupleKm}km`,
      desc: "여친 페이스 맞추기 · Easy Z2 · HR 136~146(MAF) · 대화 가능한 속도",
    },
    {
      offset: 1, type: "easy",
      label: `Solo Easy Run ${soloEasyKm}km`,
      desc: "혼자 HR 136~146(MAF) 유지 · 페이스 신경 끄기 · 처음엔 9:00/km 이상도 정상",
    },
    {
      offset: 2, type: "rest",
      label: "휴식",
      desc: "스트레칭 or 폼롤러 · 내일 롱런 준비",
    },
    {
      offset: 3, type: "long",
      label: `Long Run ${longKm}km`,
      desc: canQuality
        ? `처음 ${Math.round(longKm * 0.7)}km HR 135~145 유지 → 마지막 ${Math.round(longKm * 0.3)}km 페이스업 시도`
        : `전체 Easy Z2 · 준비도 낮음(${readiness}/100) — 완주가 목표`,
    },
    {
      offset: 4, type: "rest",
      label: "휴식",
      desc: "롱런 다음날 완전 회복 · 가벼운 걷기 OK",
    },
    {
      offset: 5, type: "fasted",
      label: "공복런 5km",
      desc: "기상 직후 아무것도 안 먹고 · Easy Z2 · HR 136~146(MAF) · 지방 연소 최적 구간",
    },
    {
      offset: 6, type: "rest",
      label: "휴식",
      desc: "한 주 마무리 · 다음 주 계획 확인",
    },
  ];

  // Attach real dates
  const schedule = days.map((d) => ({
    ...d,
    date: addDays(monday, d.offset),
    dayName: ["월", "화", "수", "목", "금", "토", "일"][d.offset],
  }));

  // Overall recommendation text
  const check = weeklyCheck(userData, isGf);
  let coachNote = check.recommendation;
  if (check.flags.length > 0) coachNote += " — " + check.flags.join(" / ");
  if (readiness !== null) {
    if (readiness < 34)
      coachNote += ` 준비도 낮아(${readiness}/100) — 볼륨 줄이고 회복 우선.`;
    else if (readiness >= 67)
      coachNote += ` 준비도 양호(${readiness}/100).`;
    else
      coachNote += ` 준비도 보통(${readiness}/100).`;
  }

  return {
    name: userName,
    phase,
    phaseLabel: phaseLabel(phase),
    analysis: {
      lastWeekKm: Math.round(lastWeekKm * 10) / 10,
      avgWeekKm4w: Math.round(avgWeekKm4w * 10) / 10,
      longRunKm: Math.round(longRunKm * 10) / 10,
      avgHR,
      readinessScore: readiness,
      readinessLevel,
      runsLastWeek: lastWeek.length,
    },
    targetWeeklyKm,
    longRunTarget,
    coachNote,
    schedule,
  };
}

function lthrTestRecommendation(userData) {
  if (!userData) return null;
  const readiness = userData.trainingReadiness?.score ?? null;
  const lastRuns = (userData.activities || []).slice(0, 5);

  // Check if last run was easy (not a long run or tempo)
  const lastRunKm = lastRuns[0] ? lastRuns[0].distanceM / 1000 : 0;
  const daysSinceLastRun = lastRuns[0]
    ? Math.floor((Date.now() - new Date(lastRuns[0].date).getTime()) / 86400000)
    : 99;

  const readinessOk = readiness !== null && readiness >= 60;
  const recoveryOk = daysSinceLastRun >= 1 && lastRunKm < 9; // not right after long run
  const suitable = readinessOk && recoveryOk;

  // Best day this week: Thursday (목요일, offset 3) if suitable, else flag as not yet
  return {
    suitable,
    readiness,
    reason: !readinessOk
      ? `준비도 ${readiness ?? "미확인"}/100 — 60 이상일 때 추천`
      : !recoveryOk
      ? `최근 ${lastRunKm.toFixed(1)}km 런 후 회복 필요 — 하루 더 쉬고`
      : `준비도 ${readiness}/100 · 전날 휴식 → 테스트 최적`,
    recommendedDay: suitable ? "목요일 (롱런 대신 LTHR 테스트)" : null,
  };
}

function generate() {
  const yunho = loadUser("yunho.json");
  const gf    = loadUser("gf.json");

  const monday = nextMonday();
  const sunday = addDays(monday, 6);

  const yunhoPlan = planForUser(yunho, "윤호", false);
  const gfPlan    = planForUser(gf, "여친", true);
  const lthrTest  = lthrTestRecommendation(yunho);

  // If test is suitable this week, replace Thursday's Long Run note
  if (yunhoPlan && lthrTest?.suitable) {
    const thu = yunhoPlan.schedule.find(d => d.offset === 3);
    if (thu) {
      thu.label = "LTHR 테스트 or Long Run";
      thu.desc = "★ 테스트 추천주 — 워밍업 15분 → 30분 전력질주 → 마지막 20분 평균 HR 기록";
      thu.type = "tempo";
    }
  }

  const plan = {
    weekStart: monday,
    weekEnd:   sunday,
    generatedAt: new Date().toISOString(),
    lthrTest,
    yunho: yunhoPlan,
    gf:    gfPlan,
  };

  writeFileSync(join(__dirname, "data/weekly-plan.json"), JSON.stringify(plan, null, 2));
  console.log(`주간 훈련 계획 생성 완료 → ${monday} ~ ${sunday}`);
  if (plan.yunho) console.log(`  윤호: ${plan.yunho.phaseLabel}, 목표 ${plan.yunho.targetWeeklyKm}km`);
  if (plan.gf)    console.log(`  여친: ${plan.gf.phaseLabel}, 목표 ${plan.gf.targetWeeklyKm}km`);

  // Regenerate dashboard with new plan
  execSync("node generate-dashboard.js", { cwd: __dirname, stdio: "inherit" });
}

generate();
