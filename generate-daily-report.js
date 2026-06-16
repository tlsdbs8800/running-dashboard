/**
 * 하루 두 번 실행:
 *   node generate-daily-report.js morning  → 아침: 컨디션 + 오늘 훈련 조정
 *   node generate-daily-report.js evening  → 저녁: 오늘 런 분석 + 내일 예고
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const mode = process.argv[2] ?? "morning"; // morning | evening

function load(file) {
  const p = join(__dirname, "data", file);
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : null;
}

function hrZone(hr, maf = 146) {
  if (!hr) return 0;
  if (hr < maf - 10) return 1;
  if (hr <= maf)     return 2;
  if (hr <= maf + 15) return 3;
  if (hr <= maf + 28) return 4;
  return 5;
}

function secToMMSS(sec) {
  if (!sec) return "--:--";
  return `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// ─── MORNING ─────────────────────────────────────────────────────────────────
function generateMorning(yunho, plan) {
  const today  = todayStr();
  const tr     = yunho?.trainingReadiness;
  const sleep  = yunho?.sleep?.[0];
  const maf    = yunho?.mafHR ?? 146;

  const readiness     = tr?.score ?? null;
  const readinessLvl  = tr?.level ?? null;
  const sleepScore    = sleep?.score ?? null;
  const sleepMin      = sleep?.durationMin ?? null;
  const hrv           = tr?.hrvFactorPercent ?? null;

  // 오늘 계획 찾기
  const todayPlan = plan?.yunho?.schedule?.find(s => s.date === today) ?? null;

  // 컨디션 기반 조정
  let verdict = "", verdictColor = "", advice = "", adjustedLabel = todayPlan?.label ?? "휴식";

  if (todayPlan?.type === "rest") {
    verdict = "😴 오늘은 휴식일";
    verdictColor = "#64748b";
    advice = "스트레칭이나 폼롤러 가볍게";
  } else if (readiness === null) {
    verdict = "📊 준비도 데이터 없음";
    verdictColor = "#64748b";
    advice = todayPlan?.desc ?? "";
  } else if (readiness >= 70) {
    verdict = "✅ 컨디션 좋음 — 계획대로 달려도 돼";
    verdictColor = "#16a34a";
    advice = `${todayPlan?.desc ?? ""} · HR ${maf - 10}~${maf} 유지`;
  } else if (readiness >= 50) {
    verdict = "🟡 보통 — 계획대로, 몸 무거우면 1km 줄이기";
    verdictColor = "#d97706";
    advice = `${todayPlan?.desc ?? ""} · 페이스 10~15초 여유있게`;
    // 라벨에서 km 추출해 조정
    adjustedLabel = todayPlan?.label?.replace(/(\d+(?:\.\d+)?)km/, (_, n) => `${n}km (무거우면 ${Math.max(3, +n - 1)}km)`) ?? adjustedLabel;
  } else {
    verdict = "🔴 컨디션 낮음 — 볼륨 줄이고 여유있게";
    verdictColor = "#dc2626";
    const origKm = parseFloat(todayPlan?.label?.match(/(\d+(?:\.\d+)?)/)?.[1] ?? "5");
    const reducedKm = Math.max(3, origKm - 1);
    adjustedLabel = todayPlan?.label?.replace(/(\d+(?:\.\d+)?)km/, `${reducedKm}km`) ?? adjustedLabel;
    advice = `${todayPlan?.desc ?? ""} · 페이스 20~30초 느리게 · HR ${maf} 이하 철저히`;
  }

  // HRV 코멘트
  let hrvNote = "";
  if (hrv !== null) {
    if (hrv >= 80) hrvNote = "HRV 좋음 — 신체 회복 충분";
    else if (hrv >= 60) hrvNote = "HRV 보통";
    else hrvNote = "HRV 낮음 — 생리적 피로 있음";
  }

  // 수면 코멘트
  let sleepNote = "";
  if (sleepMin !== null) {
    const h = Math.floor(sleepMin / 60), m = sleepMin % 60;
    sleepNote = `${h}시간 ${m > 0 ? m + "분" : ""}`;
    if (sleepScore !== null) sleepNote += ` · 수면 점수 ${sleepScore}`;
  }

  return {
    mode: "morning",
    date: today,
    generatedAt: new Date().toISOString(),
    readiness, readinessLvl, sleepScore, sleepMin, hrv,
    verdict, verdictColor, advice, adjustedLabel,
    hrvNote, sleepNote,
    todayPlanType: todayPlan?.type ?? null,
    todayPlanOrigLabel: todayPlan?.label ?? null,
    todayPlanDesc: todayPlan?.desc ?? null,
  };
}

// ─── EVENING ─────────────────────────────────────────────────────────────────
function generateEvening(yunho, plan) {
  const today = todayStr();
  const maf   = yunho?.mafHR ?? 146;

  // 오늘 런 찾기
  const todayRun = (yunho?.activities ?? []).find(a => a.date === today);

  if (!todayRun) {
    // 오늘 런 없음 — 휴식일이거나 아직 동기화 안 됨
    const todayPlan = plan?.yunho?.schedule?.find(s => s.date === today);
    return {
      mode: "evening",
      date: today,
      generatedAt: new Date().toISOString(),
      hasRun: false,
      isRestDay: todayPlan?.type === "rest",
      feedback: todayPlan?.type === "rest"
        ? "오늘은 휴식일이야. 잘 쉬었어! 내일 컨디션 체크 후 훈련 조정할게."
        : "오늘 런 데이터가 아직 없어. 달렸다면 가민 워치를 폰과 동기화해줘.",
      tomorrowPlan: getTomorrow(plan, today),
    };
  }

  const km      = (todayRun.distanceM ?? 0) / 1000;
  const pace    = todayRun.avgPaceSecPerKm;
  const avgHR   = todayRun.avgHR;
  const maxHR   = todayRun.maxHR;
  const zone    = hrZone(avgHR, maf);

  // HR 존 평가
  const zoneLabels = ["", "Z1 (매우 쉬움)", "Z2 (MAF 이지)", "Z3 (적당히 힘듦)", "Z4 (힘듦)", "Z5 (최대)"];
  const zoneColors = ["", "#22c55e", "#16a34a", "#f59e0b", "#ef4444", "#991b1b"];

  // 오늘 계획과 비교
  const todayPlan = plan?.yunho?.schedule?.find(s => s.date === today);
  const plannedKm = parseFloat(todayPlan?.label?.match(/(\d+(?:\.\d+)?)/)?.[1] ?? "0");
  const kmDiff    = plannedKm > 0 ? km - plannedKm : null;

  let planComparison = "";
  if (kmDiff !== null) {
    if (Math.abs(kmDiff) <= 0.3) planComparison = "✅ 계획 달성";
    else if (kmDiff > 0) planComparison = `✅ 계획보다 ${kmDiff.toFixed(1)}km 더 달림`;
    else planComparison = `⚠️ 계획보다 ${Math.abs(kmDiff).toFixed(1)}km 적게 달림`;
  }

  // 종합 피드백
  let feedback = "";
  const paceStr = secToMMSS(pace);

  if (zone <= 2 && pace && pace <= 540) {
    feedback = `완벽한 이지 런이야! HR ${avgHR} · ${paceStr}/km — MAF 존에서 정확히 달렸어. 이 훈련이 쌓이면 같은 HR에서 페이스가 자연스럽게 빨라져.`;
  } else if (zone <= 2) {
    feedback = `이지 런 잘 됐어. HR ${avgHR}으로 Z${zone} 유지. 내일도 이 감각 기억해.`;
  } else if (zone === 3) {
    feedback = `HR ${avgHR}로 MAF(${maf})보다 조금 올라갔어. 이지 런에선 Z2 이하 유지가 목표야. 다음엔 페이스를 10~15초 더 줄여봐.`;
  } else {
    feedback = `HR ${avgHR}(${zoneLabels[zone]}) — 오늘은 좀 빡세게 달렸어. 이지 런 날엔 HR ${maf} 아래로 유지해야 MAF 훈련 효과가 나와. 내일 or 모레 충분히 쉬기.`;
  }

  // 내일 예고
  const tomorrow = getTomorrow(plan, today);

  return {
    mode: "evening",
    date: today,
    generatedAt: new Date().toISOString(),
    hasRun: true,
    km: Math.round(km * 10) / 10,
    paceStr,
    avgHR, maxHR,
    zone, zoneLabel: zoneLabels[zone] ?? "", zoneColor: zoneColors[zone] ?? "",
    planComparison,
    plannedKm: plannedKm || null,
    feedback,
    tomorrowPlan: tomorrow,
  };
}

function getTomorrow(plan, todayDate) {
  if (!plan?.yunho?.schedule) return null;
  const tomorrow = new Date(todayDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  return plan.yunho.schedule.find(s => s.date === tomorrowStr) ?? null;
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
const yunho = load("yunho.json");
const plan  = load("weekly-plan.json");

let report;
if (mode === "evening") {
  report = generateEvening(yunho, plan);
} else {
  report = generateMorning(yunho, plan);
}

writeFileSync(join(__dirname, "data/daily-report.json"), JSON.stringify(report, null, 2));
console.log(`[daily-report] ${mode} 리포트 생성 완료 → data/daily-report.json`);
console.log(`  ${report.verdict ?? report.feedback ?? ""}`);
