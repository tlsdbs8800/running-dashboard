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

  // 오늘 런 찾기 — 없으면 최근 1일 이내 런으로 fallback
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  let todayRun = (yunho?.activities ?? []).find(a => a.date === today);
  let runDate = today;
  if (!todayRun) {
    const recentRun = (yunho?.activities ?? [])[0];
    if (recentRun && recentRun.date >= yesterdayStr) {
      todayRun = recentRun;
      runDate = recentRun.date;
    }
  }

  if (!todayRun) {
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

  // 러닝 다이내믹스 분석
  const gct   = todayRun.groundContactTimeMs;
  const vo    = todayRun.verticalOscillationCm;
  const vr    = todayRun.verticalRatio;
  const cad   = todayRun.cadence;
  const power = todayRun.normPowerW ?? todayRun.avgPowerW;

  function evalGCT(ms) {
    if (!ms) return null;
    if (ms < 230) return { rating: "최상", color: "#16a34a", tip: "지면 접촉 시간이 매우 짧아 — 탄성이 좋은 폼이야." };
    if (ms < 260) return { rating: "좋음", color: "#22c55e", tip: "지면 접촉 시간 양호." };
    if (ms < 290) return { rating: "보통", color: "#f59e0b", tip: "지면 접촉을 줄이려면 발을 빠르게 들어올리는 연습을 해봐." };
    return { rating: "개선 필요", color: "#ef4444", tip: "지면 접촉이 길어 — 케이던스 높이기(빠른 발 회전)가 도움 돼." };
  }
  function evalVO(cm) {
    if (!cm) return null;
    if (cm < 6)  return { rating: "최상", color: "#16a34a", tip: "수직 진동이 매우 낮아 — 에너지 낭비 없는 효율적인 폼이야." };
    if (cm < 8)  return { rating: "좋음", color: "#22c55e", tip: "수직 진동 양호." };
    if (cm < 10) return { rating: "보통", color: "#f59e0b", tip: "위아래 튀는 동작을 줄이면 효율이 올라가. 코어를 더 잡아봐." };
    return { rating: "개선 필요", color: "#ef4444", tip: "수직 진동이 큰 편이야 — 앞으로 나아가는 에너지를 위로 낭비하고 있어." };
  }
  function evalCadence(spm) {
    if (!spm) return null;
    if (spm >= 180) return { rating: "최상", color: "#16a34a", tip: "케이던스 최적. 관절 부담도 낮아." };
    if (spm >= 175) return { rating: "좋음", color: "#22c55e", tip: "케이던스 좋아." };
    if (spm >= 165) return { rating: "보통", color: "#f59e0b", tip: "케이던스를 5~10 높이면 부상 위험도 줄고 효율도 올라가." };
    return { rating: "낮음", color: "#ef4444", tip: "케이던스가 낮아 — 보폭을 줄이고 발 회전을 빠르게 해봐." };
  }

  const dynamics = {
    gct:     { value: gct,   unit: "ms",  label: "지면접촉",   ...evalGCT(gct) },
    vo:      { value: vo,    unit: "cm",  label: "수직진동",   ...evalVO(vo) },
    vr:      { value: vr,    unit: "%",   label: "수직비율",   rating: vr ? (vr < 8 ? "좋음" : "보통") : null, color: vr ? (vr < 8 ? "#22c55e" : "#f59e0b") : null },
    cadence: { value: cad,   unit: "spm", label: "케이던스",   ...evalCadence(cad) },
    power:   { value: power, unit: "W",   label: "파워(NP)",   rating: null },
  };

  const trainingEffectKo = {
    "NO_BENEFIT": "효과 없음", "MINOR_BENEFIT": "미미한 효과", "MAINTAINING": "유지",
    "MAINTAINING_AEROBIC_BASE": "유산소 기초 유지", "IMPROVING": "향상",
    "HIGHLY_IMPROVING": "크게 향상", "OVERREACHING": "과훈련", "AEROBIC_BASE": "유산소 기초",
  };

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

  // 다이내믹스 코칭 멘트 추가
  const dynamicsTips = [dynamics.gct, dynamics.vo, dynamics.cadence]
    .filter(d => d?.tip && d?.rating && !["최상","좋음"].includes(d.rating))
    .map(d => d.tip);
  if (dynamicsTips.length > 0) feedback += " · " + dynamicsTips[0];

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
    dynamics,
    aerobicEffect: todayRun.aerobicEffect,
    anaerobicEffect: todayRun.anaerobicEffect,
    trainingEffectLabel: trainingEffectKo[todayRun.trainingEffectLabel] ?? todayRun.trainingEffectLabel ?? null,
    trainingLoad: todayRun.trainingLoad,
    hrZoneSec: todayRun.hrZoneSec ?? null,
    elevationGainM: todayRun.elevationGainM,
    fastest1kmSec: todayRun.fastest1kmSec,
    fastest5kmSec: todayRun.fastest5kmSec,
    steps: todayRun.steps,
  };
}

function getTomorrow(plan, todayDate) {
  if (!plan?.yunho?.schedule) return null;
  const tomorrow = new Date(todayDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = tomorrow.toISOString().slice(0, 10);
  return plan.yunho.schedule.find(s => s.date === tomorrowStr) ?? null;
}

// ─── JENNY EVENING ───────────────────────────────────────────────────────────
function generateGfEvening(gf) {
  const today  = todayStr();
  const maf    = gf?.mafHR ?? 155;
  const yday   = new Date(); yday.setDate(yday.getDate() - 1);
  const ydayStr = yday.toISOString().slice(0, 10);
  let todayRun = (gf?.activities ?? []).find(a => a.date === today);
  if (!todayRun) {
    const recent = (gf?.activities ?? [])[0];
    if (recent && recent.date >= ydayStr) todayRun = recent;
  }

  if (!todayRun) {
    return {
      mode: "evening", date: today, generatedAt: new Date().toISOString(),
      hasRun: false,
      feedback: "오늘 런 데이터가 아직 없어. 달렸다면 가민 워치를 폰과 동기화해줘.",
    };
  }

  const km    = (todayRun.distanceM ?? 0) / 1000;
  const pace  = todayRun.avgPaceSecPerKm;
  const avgHR = todayRun.avgHR;
  const zone  = hrZone(avgHR, maf);
  const zoneLabels = ["","Z1 (매우 쉬움)","Z2 (MAF 이지)","Z3 (적당히 힘듦)","Z4 (힘듦)","Z5 (최대)"];
  const zoneColors = ["","#22c55e","#16a34a","#f59e0b","#ef4444","#991b1b"];
  const paceStr = secToMMSS(pace);

  // Jenny는 올 이지 (MAF 이하) 훈련 — 페이스 7:50~8:10 목표
  let feedback = "";
  if (zone <= 2 && pace >= 470 && pace <= 490) {
    feedback = `완벽한 이지 런이야! HR ${avgHR} · ${paceStr}/km — MAF 존에서 목표 페이스 정확히 맞췄어.`;
  } else if (zone <= 2) {
    feedback = `이지 런 잘 됐어. HR ${avgHR}(Z${zone}) 유지. ${pace < 470 ? `페이스(${paceStr})가 조금 빠른 편이야 — 여유 있게 달려도 돼.` : ""}`;
  } else if (zone === 3) {
    feedback = `HR ${avgHR}로 MAF(${maf})보다 조금 올라갔어. 다음엔 페이스를 10~15초 더 줄여봐.`;
  } else {
    feedback = `HR ${avgHR}(${zoneLabels[zone]}) — 올 이지 훈련 중엔 HR ${maf} 이하로 유지하는 게 목표야. 다음엔 천천히!`;
  }

  // 다이내믹스
  const gct  = todayRun.groundContactTimeMs;
  const vo   = todayRun.verticalOscillationCm;
  const vr   = todayRun.verticalRatio;
  const cad  = todayRun.cadence;
  const power = todayRun.normPowerW ?? todayRun.avgPowerW;

  function evalGCT(ms) {
    if (!ms) return null;
    if (ms < 230) return { rating:"최상", color:"#16a34a", tip:"지면 접촉 시간이 매우 짧아 — 탄성이 좋은 폼이야." };
    if (ms < 260) return { rating:"좋음", color:"#22c55e", tip:null };
    if (ms < 290) return { rating:"보통", color:"#f59e0b", tip:"발을 빠르게 들어올리는 연습을 해봐." };
    return { rating:"개선 필요", color:"#ef4444", tip:"케이던스 높이기가 도움 돼." };
  }
  function evalVO(cm) {
    if (!cm) return null;
    if (cm < 6)  return { rating:"최상", color:"#16a34a", tip:null };
    if (cm < 8)  return { rating:"좋음", color:"#22c55e", tip:null };
    if (cm < 10) return { rating:"보통", color:"#f59e0b", tip:"위아래 튀는 동작을 줄여봐. 코어를 더 잡아봐." };
    return { rating:"개선 필요", color:"#ef4444", tip:"수직 진동이 큰 편이야 — 에너지를 앞으로 써봐." };
  }
  function evalCadence(spm) {
    if (!spm) return null;
    if (spm >= 175) return { rating:"좋음", color:"#22c55e", tip:null };
    if (spm >= 165) return { rating:"보통", color:"#f59e0b", tip:"케이던스를 5~10 높이면 효율이 올라가." };
    return { rating:"낮음", color:"#ef4444", tip:"보폭을 줄이고 발 회전을 빠르게 해봐." };
  }

  const dynamics = {
    gct:     { value:gct,   unit:"ms",  label:"지면 접촉", ...evalGCT(gct) },
    vo:      { value:vo,    unit:"cm",  label:"수직 진동", ...evalVO(vo) },
    vr:      { value:vr,    unit:"%",   label:"수직 비율", rating: vr ? (vr<8?"좋음":"보통") : null, color: vr ? (vr<8?"#22c55e":"#f59e0b") : null },
    cadence: { value:cad,   unit:"spm", label:"케이던스",  ...evalCadence(cad) },
    power:   { value:power, unit:"W",   label:"파워 (NP)", rating:null },
  };

  const trainingEffectKo = {
    "NO_BENEFIT":"효과 없음","MINOR_BENEFIT":"미미한 효과","MAINTAINING":"유지",
    "MAINTAINING_AEROBIC_BASE":"유산소 기초 유지","IMPROVING":"향상",
    "HIGHLY_IMPROVING":"크게 향상","OVERREACHING":"과훈련","AEROBIC_BASE":"유산소 기초",
  };

  const dynamicsTip = [dynamics.gct, dynamics.vo, dynamics.cadence]
    .filter(d => d?.tip && d?.rating && !["최상","좋음"].includes(d.rating))
    .map(d => d.tip)[0];
  if (dynamicsTip) feedback += " · " + dynamicsTip;

  return {
    mode: "evening", date: today, generatedAt: new Date().toISOString(),
    hasRun: true,
    km: Math.round(km * 10) / 10,
    paceStr, avgHR, maxHR: todayRun.maxHR,
    zone, zoneLabel: zoneLabels[zone] ?? "", zoneColor: zoneColors[zone] ?? "",
    feedback, dynamics,
    aerobicEffect: todayRun.aerobicEffect,
    anaerobicEffect: todayRun.anaerobicEffect,
    trainingEffectLabel: trainingEffectKo[todayRun.trainingEffectLabel] ?? todayRun.trainingEffectLabel ?? null,
    trainingLoad: todayRun.trainingLoad,
    hrZoneSec: todayRun.hrZoneSec ?? null,
    elevationGainM: todayRun.elevationGainM,
    fastest1kmSec: todayRun.fastest1kmSec,
    steps: todayRun.steps,
  };
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
const yunho = load("yunho.json");
const gf    = load("gf.json");
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

// Jenny evening report (항상 생성)
if (gf) {
  const gfReport = generateGfEvening(gf);
  writeFileSync(join(__dirname, "data/daily-report-gf.json"), JSON.stringify(gfReport, null, 2));
  console.log(`[daily-report-gf] Jenny 리포트 생성 완료`);
}
