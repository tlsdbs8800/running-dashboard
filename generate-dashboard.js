/**
 * Reads data/*.json and generates a self-contained index.html with embedded data.
 * No server needed — just open index.html in any browser.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadUser(filename) {
  const p = join(__dirname, "data", filename);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8"));
}

function loadPlan() {
  const p = join(__dirname, "data/weekly-plan.json");
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf-8"));
}

function loadWeightManual() {
  const p = join(__dirname, "data/weight-manual.json");
  if (!existsSync(p)) return [];
  return JSON.parse(readFileSync(p, "utf-8"));
}

// MAF-based HR zones: Z1 < MAF-10, Z2 MAF-10~MAF, Z3 MAF+1~MAF+15, Z4 MAF+16~MAF+28, Z5 above
function hrZone(hr, maf = 146) {
  if (!hr) return 0;
  if (hr < maf - 10) return 1;
  if (hr <= maf)     return 2;
  if (hr <= maf + 15) return 3;
  if (hr <= maf + 28) return 4;
  return 5;
}

function zoneLabel(maf = 146) {
  return `MAF ${maf} 기준 · Z1 <${maf-10} · Z2 ${maf-10}~${maf} · Z3 ${maf+1}~${maf+15} · Z4 ${maf+16}~${maf+28} · Z5 ${maf+29}+`;
}

function combineWeight(garminEntries, manualEntries) {
  const map = new Map();
  (garminEntries || []).forEach((e) => map.set(e.date, e.kg));
  (manualEntries || []).forEach((e) => map.set(e.date, e.kg)); // manual overrides
  return [...map.entries()]
    .map(([date, kg]) => ({ date, kg }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

// --- helpers ---
function secToMMSS(sec) {
  if (!sec) return "--:--";
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
function secToHHMMSS(sec) {
  if (!sec) return "--:--:--";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}
function fmtKm(meters) {
  return (meters / 1000).toFixed(2) + "km";
}

// Compute weekly mileage (last 12 weeks)
function weeklyMileage(activities, numWeeks = 12) {
  const now = new Date();
  const weeks = [];
  for (let i = numWeeks - 1; i >= 0; i--) {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay() - i * 7);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const label = `${String(weekStart.getMonth()+1).padStart(2,"0")}/${String(weekStart.getDate()).padStart(2,"0")}`;
    const km = (activities || [])
      .filter((a) => {
        const d = new Date(a.date);
        return d >= weekStart && d <= weekEnd;
      })
      .reduce((sum, a) => sum + (a.distanceM ?? 0) / 1000, 0);
    weeks.push({ label, km: Math.round(km * 10) / 10 });
  }
  return weeks;
}

// Long run progression (max distance per week)
function longRunProgression(activities, numWeeks = 12) {
  const now = new Date();
  const weeks = [];
  for (let i = numWeeks - 1; i >= 0; i--) {
    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay() - i * 7);
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    const label = `${String(weekStart.getMonth()+1).padStart(2,"0")}/${String(weekStart.getDate()).padStart(2,"0")}`;
    const runs = (activities || []).filter((a) => {
      const d = new Date(a.date);
      return d >= weekStart && d <= weekEnd;
    });
    const maxKm = runs.length > 0 ? Math.max(...runs.map((a) => (a.distanceM ?? 0) / 1000)) : null;
    weeks.push({ label, km: maxKm ? Math.round(maxKm * 10) / 10 : null });
  }
  return weeks;
}

function loadDailyReport() {
  const p = join(__dirname, "data/daily-report.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : null;
}

function loadGfDailyReport() {
  const p = join(__dirname, "data/daily-report-gf.json");
  return existsSync(p) ? JSON.parse(readFileSync(p, "utf-8")) : null;
}

function generate() {
  const yunho = loadUser("yunho.json");
  const gf = loadUser("gf.json");
  const plan = loadPlan();
  const manualWeight = loadWeightManual();
  const daily = loadDailyReport();
  const dailyGf = loadGfDailyReport();

  const yunhoWeekly = yunho ? weeklyMileage(yunho.activities) : [];
  const gfWeekly = gf ? weeklyMileage(gf.activities) : [];
  const yunhoLongRun = yunho ? longRunProgression(yunho.activities) : [];
  const gfLongRun = gf ? longRunProgression(gf.activities) : [];

  // Current Long Run (max in last 4 weeks)
  const yunhoCurrentLR = yunho
    ? Math.max(...(yunho.activities || []).slice(0, 20).map((a) => (a.distanceM ?? 0) / 1000), 0)
    : 0;
  const gfCurrentLR = gf
    ? Math.max(...(gf.activities || []).slice(0, 20).map((a) => (a.distanceM ?? 0) / 1000), 0)
    : 0;

  // Recent 10 runs
  const recentRuns = (yunho?.activities || []).slice(0, 10);
  const gfRecentRuns = (gf?.activities || []).slice(0, 10);

  const yunhoMAF = yunho?.mafHR ?? 146;
  const gfMAF    = gf?.mafHR ?? 155;

  // Pace trend: last 20 runs (oldest→newest)
  const paceTrend = (yunho?.activities || []).slice(0, 20).reverse().map((a) => ({
    date: a.date?.slice(5),
    pace: a.avgPaceSecPerKm ?? null,
    hr: a.avgHR ?? null,
    zone: hrZone(a.avgHR, yunhoMAF),
  }));

  // HR zone distribution (윤호, last 30 runs)
  const zoneCounts = [0, 0, 0, 0, 0]; // Z1~Z5
  (yunho?.activities || []).slice(0, 30).forEach((a) => {
    const z = hrZone(a.avgHR, yunhoMAF);
    if (z >= 1) zoneCounts[z - 1]++;
  });

  // GF pace trend (last 20 runs, oldest→newest)
  const gfPaceTrend = (gf?.activities || []).slice(0, 20).reverse().map((a) => ({
    date: a.date?.slice(5),
    pace: a.avgPaceSecPerKm ?? null,
    hr: a.avgHR ?? null,
    zone: hrZone(a.avgHR, gfMAF),
  }));

  // GF HR zone distribution (last 30 runs)
  const gfZoneCounts = [0, 0, 0, 0, 0];
  (gf?.activities || []).slice(0, 30).forEach((a) => {
    const z = hrZone(a.avgHR, gfMAF);
    if (z >= 1) gfZoneCounts[z - 1]++;
  });

  // Weight trend (combined)
  const weightData = combineWeight(yunho?.weight, manualWeight);
  const latestWeight = weightData.length > 0 ? weightData[weightData.length - 1].kg : null;

  const lastSync = yunho?.lastSync ? new Date(yunho.lastSync).toLocaleString("ko-KR") : "없음";

  const html = `<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate">
<meta http-equiv="Pragma" content="no-cache">
<meta http-equiv="Expires" content="0">
<title>러닝 코치 대시보드</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js"><\/script>
<style>
  :root {
    --bg: #f4f4f8;
    --card: #ffffff;
    --text: #1a1a2e;
    --text2: #555577;
    --text3: #8888aa;
    --border: #e0e0f0;
    --blue: #3b82f6;
    --green: #22c55e;
    --orange: #f97316;
    --red: #ef4444;
    --purple: #a855f7;
    --yunho: #3b82f6;
    --gf: #ec4899;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); font-size: 14px; -webkit-text-size-adjust: 100%; }
  .container { max-width: 1100px; margin: 0 auto; padding: 20px 16px; }
  h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
  .sync-time { font-size: 12px; color: var(--text3); margin-bottom: 20px; }
  .daily-report-card { background: var(--card); border-radius: 12px; padding: 18px 20px; margin-bottom: 20px; }
  .dr-verdict { font-size: 18px; font-weight: 700; margin-bottom: 14px; }
  .dr-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; margin-bottom: 12px; }
  .dr-item { display: flex; flex-direction: column; gap: 2px; }
  .dr-label { font-size: 11px; color: var(--text3); text-transform: uppercase; letter-spacing: .05em; }
  .dr-val { font-size: 14px; color: var(--text1); }
  .dr-advice { background: var(--bg); border-radius: 8px; padding: 10px 14px; font-size: 13px; color: var(--text2); line-height: 1.6; margin-top: 4px; }
  .dr-tomorrow { font-size: 12px; color: var(--text3); margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
  .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .card { background: var(--card); border-radius: 12px; padding: 16px 18px; border: 1px solid var(--border); }
  .card-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--text3); margin-bottom: 10px; }
  .big-num { font-size: 30px; font-weight: 700; }
  .sub { font-size: 12px; color: var(--text2); margin-top: 4px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; }
  .badge-low { background: #fef3c7; color: #92400e; }
  .badge-moderate { background: #dbeafe; color: #1e40af; }
  .badge-high { background: #dcfce7; color: #166534; }
  .badge-ok { background: #dcfce7; color: #166534; }
  .section-title { font-size: 15px; font-weight: 700; margin: 24px 0 10px; }
  .runner-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
  .runner-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
  .runner-name { font-size: 13px; font-weight: 600; }
  /* Roadmap */
  .roadmap { position: relative; padding: 6px 0; }
  .roadmap-track { height: 8px; background: var(--border); border-radius: 99px; overflow: hidden; margin: 8px 0; }
  .roadmap-fill { height: 100%; border-radius: 99px; transition: width .4s ease; }
  .roadmap-labels { display: flex; justify-content: space-between; font-size: 11px; color: var(--text3); }
  .roadmap-markers { display: flex; justify-content: space-between; font-size: 10px; color: var(--text3); margin-top: 4px; }
  /* Table */
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; min-width: 420px; }
  th { text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--text3); padding: 6px 8px; border-bottom: 1px solid var(--border); white-space: nowrap; }
  td { padding: 8px 8px; border-bottom: 1px solid var(--border); white-space: nowrap; }
  tr:last-child td { border-bottom: none; }
  .pace-chip { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 500; }
  .z1 { background: #ecfdf5; color: #065f46; }
  .z2 { background: #eff6ff; color: #1e40af; }
  .z3 { background: #fffbeb; color: #92400e; }
  .z4 { background: #fff1f2; color: #9f1239; }
  /* Chart containers */
  .chart-wrap { position: relative; height: 180px; }

  /* ── 모바일 ── */
  @media (max-width: 680px) {
    .container { padding: 14px 12px; }
    h1 { font-size: 17px; }
    .grid2, .grid3, .grid4 { grid-template-columns: 1fr; gap: 10px; }
    .card { padding: 14px 14px; border-radius: 10px; }
    .big-num { font-size: 26px; }
    .section-title { font-size: 14px; margin: 20px 0 8px; }
    .chart-wrap { height: 160px; }
    /* status grid: 2x2 on mobile */
    .grid4 { grid-template-columns: 1fr 1fr; }
    /* roadmap markers — hide middle ones on very small screens */
    .roadmap-markers span:nth-child(2),
    .roadmap-markers span:nth-child(3) { display: none; }
    /* weekly plan day rows */
    .day-desc { display: none; }
  }
  @media (max-width: 380px) {
    .grid4 { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<div class="container">
  <h1>🏃 러닝 코치 대시보드</h1>
  <div class="sync-time">마지막 동기화: ${lastSync}</div>

  <!-- Daily Report: morning/evening -->
  ${daily ? `
  <div class="section-title">${daily.mode === 'morning' ? '☀️ 오늘 컨디션 & 훈련 추천' : '🌙 오늘 런 분석'}</div>
  <div class="daily-report-card" style="border-left:4px solid ${daily.verdictColor ?? daily.zoneColor ?? '#3b82f6'}">
    ${daily.mode === 'morning' ? `
      <div class="dr-verdict" style="color:${daily.verdictColor}">${daily.verdict}</div>
      <div class="dr-grid">
        <div class="dr-item"><span class="dr-label">준비도</span><span class="dr-val">${daily.readiness ?? '--'}/100 ${daily.readinessLvl ? '· '+daily.readinessLvl : ''}</span></div>
        <div class="dr-item"><span class="dr-label">수면</span><span class="dr-val">${daily.sleepNote || '--'}</span></div>
        ${daily.hrvNote ? `<div class="dr-item"><span class="dr-label">HRV</span><span class="dr-val">${daily.hrvNote}</span></div>` : ''}
        <div class="dr-item"><span class="dr-label">오늘 훈련</span><span class="dr-val" style="font-weight:600">${daily.adjustedLabel ?? daily.todayPlanOrigLabel ?? '--'}</span></div>
      </div>
      ${daily.advice ? `<div class="dr-advice">💡 ${daily.advice}</div>` : ''}
    ` : `
      ${daily.hasRun ? `
        <div class="dr-grid">
          <div class="dr-item"><span class="dr-label">거리</span><span class="dr-val" style="font-weight:600">${daily.km}km ${daily.planComparison ? '· '+daily.planComparison : ''}</span></div>
          <div class="dr-item"><span class="dr-label">페이스</span><span class="dr-val">${daily.paceStr}/km</span></div>
          <div class="dr-item"><span class="dr-label">평균 HR</span><span class="dr-val" style="color:${daily.zoneColor}">${daily.avgHR} bpm · ${daily.zoneLabel}</span></div>
          ${daily.steps ? `<div class="dr-item"><span class="dr-label">걸음수</span><span class="dr-val">${daily.steps.toLocaleString()}보</span></div>` : ''}
          ${daily.elevationGainM ? `<div class="dr-item"><span class="dr-label">고도 상승</span><span class="dr-val">+${daily.elevationGainM}m</span></div>` : ''}
          ${daily.fastest1kmSec ? `<div class="dr-item"><span class="dr-label">최고 1km</span><span class="dr-val">${secToMMSS(daily.fastest1kmSec)}</span></div>` : ''}
        </div>

        ${daily.dynamics ? `
        <div style="margin:10px 0 6px;font-size:11px;font-weight:600;color:var(--text3);letter-spacing:.05em">러닝 다이내믹스</div>
        <div class="dr-grid" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr))">
          ${[
            { key:'gct',     label:'지면 접촉',   unit:'ms' },
            { key:'vo',      label:'수직 진동',   unit:'cm' },
            { key:'vr',      label:'수직 비율',   unit:'%' },
            { key:'cadence', label:'케이던스',    unit:'spm' },
            { key:'power',   label:'파워 (NP)',   unit:'W' },
          ].map(({key,label,unit}) => {
            const d = daily.dynamics[key];
            if (!d?.value) return '';
            return `<div class="dr-item">
              <span class="dr-label">${label}</span>
              <span class="dr-val" style="color:${d.color ?? 'var(--text)'}">
                ${d.value}${unit}
                ${d.rating ? `<span style="font-size:10px;margin-left:4px">(${d.rating})</span>` : ''}
              </span>
            </div>`;
          }).join('')}
        </div>
        ${[daily.dynamics.gct, daily.dynamics.vo, daily.dynamics.cadence]
            .filter(d => d?.tip && d?.rating && !['최상','좋음'].includes(d.rating))
            .slice(0,1)
            .map(d => `<div class="dr-advice" style="margin-top:6px">💡 ${d.tip}</div>`).join('')}
        ` : ''}

        ${daily.aerobicEffect != null || daily.trainingEffectLabel ? `
        <div style="margin:10px 0 4px;font-size:11px;font-weight:600;color:var(--text3);letter-spacing:.05em">훈련 효과</div>
        <div class="dr-grid">
          ${daily.trainingEffectLabel ? `<div class="dr-item"><span class="dr-label">효과 유형</span><span class="dr-val">${daily.trainingEffectLabel}</span></div>` : ''}
          ${daily.aerobicEffect != null ? `<div class="dr-item"><span class="dr-label">유산소</span><span class="dr-val">${daily.aerobicEffect}/5.0</span></div>` : ''}
          ${daily.anaerobicEffect != null ? `<div class="dr-item"><span class="dr-label">무산소</span><span class="dr-val">${daily.anaerobicEffect}/5.0</span></div>` : ''}
          ${daily.trainingLoad != null ? `<div class="dr-item"><span class="dr-label">훈련 부하</span><span class="dr-val">${daily.trainingLoad}</span></div>` : ''}
        </div>` : ''}

        ${daily.hrZoneSec && daily.hrZoneSec.some(v => v > 0) ? `
        <div style="margin:10px 0 4px;font-size:11px;font-weight:600;color:var(--text3);letter-spacing:.05em">HR 존별 시간</div>
        <div style="display:flex;gap:4px;align-items:flex-end;height:40px;margin-bottom:4px">
          ${daily.hrZoneSec.map((sec, i) => {
            const maxSec = Math.max(...daily.hrZoneSec);
            const pct = maxSec > 0 ? sec / maxSec * 100 : 0;
            const colors = ['#22c55e','#16a34a','#f59e0b','#ef4444','#991b1b'];
            const mins = Math.round(sec / 60);
            return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">
              <div style="font-size:9px;color:var(--text3)">${mins}분</div>
              <div style="width:100%;background:${colors[i]};height:${Math.max(4, pct * 0.34)}px;border-radius:2px 2px 0 0;opacity:${sec>0?1:0.15}"></div>
              <div style="font-size:9px;color:var(--text3)">Z${i+1}</div>
            </div>`;
          }).join('')}
        </div>` : ''}

        ${daily.coaching ? `
        <div style="margin-top:12px;background:linear-gradient(135deg,rgba(99,102,241,0.08),rgba(168,85,247,0.08));border:1px solid rgba(99,102,241,0.2);border-radius:10px;padding:12px 14px">
          <div style="font-size:10px;font-weight:700;color:#6366f1;letter-spacing:.08em;margin-bottom:8px">✦ AI COACHING</div>
          <div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:8px">${daily.coaching.headline}</div>
          <div style="font-size:13px;color:var(--text2);line-height:1.65;margin-bottom:8px">${daily.coaching.coaching}</div>
          ${daily.coaching.trend ? `<div style="font-size:12px;color:var(--text3);line-height:1.6;border-top:1px solid rgba(99,102,241,0.15);padding-top:8px;margin-top:4px">📈 ${daily.coaching.trend}</div>` : ''}
          ${daily.coaching.nextRun ? `<div style="font-size:12px;color:#6366f1;font-weight:500;margin-top:8px">▶ ${daily.coaching.nextRun}</div>` : ''}
        </div>
        ` : `<div class="dr-advice">📝 ${daily.feedback}</div>`}
      ` : `<div class="dr-advice">${daily.feedback}</div>`}
      ${daily.tomorrowPlan ? `<div class="dr-tomorrow">내일: ${daily.tomorrowPlan.label} — ${daily.tomorrowPlan.desc}</div>` : ''}
    `}
    <div style="font-size:11px;color:var(--muted);margin-top:8px">${new Date(daily.generatedAt).toLocaleString('ko-KR')} 생성</div>
  </div>
  ` : ''}

  <!-- Jenny Daily Report -->
  ${dailyGf ? `
  <div class="section-title">🌙 Jenny Today's Run</div>
  <div class="daily-report-card" style="border-left:4px solid ${dailyGf.zoneColor ?? '#ec4899'}">
    ${dailyGf.hasRun ? `
      <div class="dr-grid">
        <div class="dr-item"><span class="dr-label">Distance</span><span class="dr-val" style="font-weight:600">${dailyGf.km}km</span></div>
        <div class="dr-item"><span class="dr-label">Pace</span><span class="dr-val">${dailyGf.paceStr}/km</span></div>
        <div class="dr-item"><span class="dr-label">Avg HR</span><span class="dr-val" style="color:${dailyGf.zoneColor}">${dailyGf.avgHR} bpm · ${dailyGf.zoneLabel}</span></div>
        ${dailyGf.steps ? `<div class="dr-item"><span class="dr-label">Steps</span><span class="dr-val">${dailyGf.steps.toLocaleString()}</span></div>` : ''}
        ${dailyGf.elevationGainM ? `<div class="dr-item"><span class="dr-label">Elevation</span><span class="dr-val">+${dailyGf.elevationGainM}m</span></div>` : ''}
        ${dailyGf.fastest1kmSec ? `<div class="dr-item"><span class="dr-label">Best 1km</span><span class="dr-val">${secToMMSS(dailyGf.fastest1kmSec)}</span></div>` : ''}
      </div>

      ${dailyGf.dynamics ? `
      <div style="margin:10px 0 6px;font-size:11px;font-weight:600;color:var(--text3);letter-spacing:.05em">Running Dynamics</div>
      <div class="dr-grid" style="grid-template-columns:repeat(auto-fill,minmax(130px,1fr))">
        ${[
          { key:'gct',     label:'Ground Contact', unit:'ms' },
          { key:'vo',      label:'Vert. Oscillation', unit:'cm' },
          { key:'vr',      label:'Vert. Ratio',    unit:'%' },
          { key:'cadence', label:'Cadence',         unit:'spm' },
          { key:'power',   label:'Power (NP)',      unit:'W' },
        ].map(({key,label,unit}) => {
          const d = dailyGf.dynamics[key];
          if (!d?.value) return '';
          return `<div class="dr-item">
            <span class="dr-label">${label}</span>
            <span class="dr-val" style="color:${d.color ?? 'var(--text)'}">
              ${d.value}${unit}
              ${d.rating ? `<span style="font-size:10px;margin-left:4px">(${d.rating})</span>` : ''}
            </span>
          </div>`;
        }).join('')}
      </div>
      ${[dailyGf.dynamics.gct, dailyGf.dynamics.vo, dailyGf.dynamics.cadence]
          .filter(d => d?.tip && d?.rating && !['Excellent','Good'].includes(d.rating))
          .slice(0,1)
          .map(d => `<div class="dr-advice" style="margin-top:6px">💡 ${d.tip}</div>`).join('')}
      ` : ''}

      ${dailyGf.aerobicEffect != null || dailyGf.trainingEffectLabel ? `
      <div style="margin:10px 0 4px;font-size:11px;font-weight:600;color:var(--text3);letter-spacing:.05em">Training Effect</div>
      <div class="dr-grid">
        ${dailyGf.trainingEffectLabel ? `<div class="dr-item"><span class="dr-label">Type</span><span class="dr-val">${dailyGf.trainingEffectLabel}</span></div>` : ''}
        ${dailyGf.aerobicEffect != null ? `<div class="dr-item"><span class="dr-label">Aerobic</span><span class="dr-val">${dailyGf.aerobicEffect}/5.0</span></div>` : ''}
        ${dailyGf.anaerobicEffect != null ? `<div class="dr-item"><span class="dr-label">Anaerobic</span><span class="dr-val">${dailyGf.anaerobicEffect}/5.0</span></div>` : ''}
        ${dailyGf.trainingLoad != null ? `<div class="dr-item"><span class="dr-label">Training Load</span><span class="dr-val">${dailyGf.trainingLoad}</span></div>` : ''}
      </div>` : ''}

      ${dailyGf.hrZoneSec && dailyGf.hrZoneSec.some(v => v > 0) ? `
      <div style="margin:10px 0 4px;font-size:11px;font-weight:600;color:var(--text3);letter-spacing:.05em">HR Zone Breakdown</div>
      <div style="display:flex;gap:4px;align-items:flex-end;height:40px;margin-bottom:4px">
        ${dailyGf.hrZoneSec.map((sec, i) => {
          const maxSec = Math.max(...dailyGf.hrZoneSec);
          const pct = maxSec > 0 ? sec / maxSec * 100 : 0;
          const colors = ['#22c55e','#16a34a','#f59e0b','#ef4444','#991b1b'];
          const mins = Math.round(sec / 60);
          return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px">
            <div style="font-size:9px;color:var(--text3)">${mins}min</div>
            <div style="width:100%;background:${colors[i]};height:${Math.max(4, pct * 0.34)}px;border-radius:2px 2px 0 0;opacity:${sec>0?1:0.15}"></div>
            <div style="font-size:9px;color:var(--text3)">Z${i+1}</div>
          </div>`;
        }).join('')}
      </div>` : ''}

      ${dailyGf.coaching ? `
      <div style="margin-top:12px;background:linear-gradient(135deg,rgba(236,72,153,0.08),rgba(168,85,247,0.08));border:1px solid rgba(236,72,153,0.2);border-radius:10px;padding:12px 14px">
        <div style="font-size:10px;font-weight:700;color:#ec4899;letter-spacing:.08em;margin-bottom:8px">✦ AI COACHING</div>
        <div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:8px">${dailyGf.coaching.headline}</div>
        <div style="font-size:13px;color:var(--text2);line-height:1.65;margin-bottom:8px">${dailyGf.coaching.coaching}</div>
        ${dailyGf.coaching.trend ? `<div style="font-size:12px;color:var(--text3);line-height:1.6;border-top:1px solid rgba(236,72,153,0.15);padding-top:8px;margin-top:4px">📈 ${dailyGf.coaching.trend}</div>` : ''}
        ${dailyGf.coaching.nextRun ? `<div style="font-size:12px;color:#ec4899;font-weight:500;margin-top:8px">▶ ${dailyGf.coaching.nextRun}</div>` : ''}
      </div>
      ` : `<div class="dr-advice">📝 ${dailyGf.feedback}</div>`}
    ` : `<div class="dr-advice">${dailyGf.feedback}</div>`}
    <div style="font-size:11px;color:var(--muted);margin-top:8px">${new Date(dailyGf.generatedAt).toLocaleString('en-US')} generated</div>
  </div>
  ` : ''}

  <!-- Status Cards -->
  <div class="section-title">오늘 상태</div>
  <div class="grid4">
    <div class="card">
      <div class="card-title">훈련 준비도</div>
      <div class="big-num" style="color:${(yunho?.trainingReadiness?.score ?? 0) >= 67 ? 'var(--green)' : (yunho?.trainingReadiness?.score ?? 0) >= 34 ? 'var(--orange)' : 'var(--red)'}">
        ${yunho?.trainingReadiness?.score ?? '--'}<span style="font-size:16px;font-weight:400">/100</span>
      </div>
      <div class="sub">
        <span class="badge ${(yunho?.trainingReadiness?.level ?? '').toLowerCase() === 'low' ? 'badge-low' : (yunho?.trainingReadiness?.level ?? '').toLowerCase() === 'high' ? 'badge-high' : 'badge-moderate'}">
          ${yunho?.trainingReadiness?.level ?? '--'}
        </span>
      </div>
    </div>
    <div class="card">
      <div class="card-title">수면 점수</div>
      <div class="big-num">${yunho?.sleep?.[0]?.score ?? '--'}</div>
      <div class="sub">${yunho?.sleep?.[0]?.durationMin ? Math.floor(yunho.sleep[0].durationMin/60)+'시간 '+yunho.sleep[0].durationMin%60+'분' : '--'}</div>
    </div>
    <div class="card">
      <div class="card-title">VO2 Max</div>
      <div class="big-num">${yunho?.vo2max?.[0]?.value ?? '--'}</div>
      <div class="sub">평균~양호 구간</div>
    </div>
    <div class="card">
      <div class="card-title">체중</div>
      <div class="big-num">${latestWeight ?? '--'}<span style="font-size:16px;font-weight:400">kg</span></div>
      <div class="sub">${latestWeight ? `목표 70kg · 잔여 ${Math.max(0, latestWeight - 70).toFixed(1)}kg` : '체중 미기록'}</div>
    </div>
  </div>

  <!-- Half Marathon Roadmap -->
  <div class="section-title">하프 마라톤 로드맵 — 목표 21.1km / 2시간</div>
  <div class="grid2">
    ${yunho ? `
    <div class="card">
      <div class="runner-header">
        <div class="runner-dot" style="background:var(--yunho)"></div>
        <div class="runner-name">윤호</div>
        <span class="badge badge-ok" style="margin-left:auto">Long Run ${yunhoCurrentLR.toFixed(1)}km</span>
      </div>
      <div class="roadmap">
        <div class="roadmap-track"><div class="roadmap-fill" style="width:${Math.min(100, yunhoCurrentLR/21.1*100).toFixed(1)}%;background:var(--yunho)"></div></div>
        <div class="roadmap-labels">
          <span>0km</span>
          <span style="font-weight:600;color:var(--yunho)">${yunhoCurrentLR.toFixed(1)}km ← 지금</span>
          <span>21.1km</span>
        </div>
        <div class="roadmap-markers" style="margin-top:8px">
          <span>▲<br>현재</span>
          <span style="text-align:center">▲<br>12km</span>
          <span style="text-align:center">▲<br>15km</span>
          <span style="text-align:center">▲<br>18km</span>
          <span style="text-align:right">🏁<br>21.1km</span>
        </div>
      </div>
    </div>` : ''}
    ${gf ? `
    <div class="card">
      <div class="runner-header">
        <div class="runner-dot" style="background:var(--gf)"></div>
        <div class="runner-name">Jenny</div>
        <span class="badge badge-ok" style="margin-left:auto">Long Run ${gfCurrentLR.toFixed(1)}km</span>
      </div>
      <div class="roadmap">
        <div class="roadmap-track"><div class="roadmap-fill" style="width:${Math.min(100, gfCurrentLR/20*100).toFixed(1)}%;background:var(--gf)"></div></div>
        <div class="roadmap-labels">
          <span>0km</span>
          <span style="font-weight:600;color:var(--gf)">${gfCurrentLR.toFixed(1)}km ← 지금</span>
          <span>20km</span>
        </div>
        <div class="roadmap-markers" style="margin-top:8px">
          <span>▲<br>현재</span>
          <span style="text-align:center">▲<br>10km</span>
          <span style="text-align:center">▲<br>14km</span>
          <span style="text-align:center">▲<br>17km</span>
          <span style="text-align:right">🏁<br>20km</span>
        </div>
      </div>
      <div style="margin-top:8px;font-size:11px;color:var(--text3)">목표: 2026년 말까지 20km 편안하게 완주 · 주 3회 올 이지</div>
    </div>` : `
    <div class="card" style="display:flex;align-items:center;justify-content:center;min-height:120px;color:var(--text3);flex-direction:column;gap:8px">
      <div>Jenny 데이터 연동 대기 중</div>
      <div style="font-size:12px">sessions/gf-session.json 추가 필요</div>
    </div>`}
  </div>

  <!-- Pace Trend + HR Zone (윤호) -->
  <div class="section-title">페이스 트렌드 &amp; HR 존 분포 — 윤호</div>
  <div class="grid2">
    <div class="card">
      <div class="card-title">페이스 추이 (최근 20회)</div>
      <div class="chart-wrap"><canvas id="paceTrendChart"></canvas></div>
    </div>
    <div class="card">
      <div class="card-title">HR 존 분포 (최근 30회)</div>
      <div class="chart-wrap" style="height:160px"><canvas id="hrZoneChart"></canvas></div>
      <div style="font-size:11px;color:var(--text3);margin-top:8px;text-align:center">
        MAF ${yunhoMAF} · Z1 &lt;${yunhoMAF-10} · Z2 ${yunhoMAF-10}~${yunhoMAF} · Z3 ~${yunhoMAF+15} · Z4 ~${yunhoMAF+28} · Z5 ${yunhoMAF+29}+
      </div>
    </div>
  </div>

  <!-- Pace Trend + HR Zone (Jenny) -->
  ${gf ? `
  <div class="section-title">페이스 트렌드 &amp; HR 존 분포 — Jenny</div>
  <div class="grid2">
    <div class="card">
      <div class="card-title">페이스 추이 (최근 20회)</div>
      <div class="chart-wrap"><canvas id="gfPaceTrendChart"></canvas></div>
    </div>
    <div class="card">
      <div class="card-title">HR 존 분포 (최근 30회)</div>
      <div class="chart-wrap" style="height:160px"><canvas id="gfHrZoneChart"></canvas></div>
      <div style="font-size:11px;color:var(--text3);margin-top:8px;text-align:center">
        MAF ${gfMAF} · Z1 &lt;${gfMAF-10} · Z2 ${gfMAF-10}~${gfMAF} · Z3 ~${gfMAF+15} · Z4 ~${gfMAF+28} · Z5 ${gfMAF+29}+
      </div>
    </div>
  </div>` : ''}

  <!-- Weight Trend + Guide -->
  <div class="section-title">체중 트렌드</div>
  <div class="grid2">
    <div class="card">
      <div class="card-title">체중 변화 (목표 70kg)</div>
      ${weightData.length > 1
        ? `<div class="chart-wrap"><canvas id="weightChart"></canvas></div>`
        : `<div style="display:flex;align-items:center;justify-content:center;height:120px;color:var(--text3);flex-direction:column;gap:6px">
             <div>기록된 체중 데이터 부족</div>
             <code style="font-size:11px;background:var(--bg);padding:3px 8px;border-radius:4px">node log-weight.js 71.5</code>
           </div>`}
    </div>
    <div class="card">
      <div class="card-title">체중 기록 가이드</div>
      <div style="display:flex;flex-direction:column;gap:10px;font-size:13px">
        <div style="display:flex;gap:10px;align-items:flex-start">
          <span style="font-size:18px">📅</span>
          <div><strong>주 1회 — 매주 월요일 아침</strong><br>
          <span style="color:var(--text2);font-size:12px">하프 훈련 기간 내내 같은 요일 유지. 화요일 Solo Run 전날이라 컨디션도 안정적.</span></div>
        </div>
        <div style="display:flex;gap:10px;align-items:flex-start">
          <span style="font-size:18px">⏰</span>
          <div><strong>기상 직후, 화장실 다녀온 뒤</strong><br>
          <span style="color:var(--text2);font-size:12px">음식·물 섭취 전. 이 조건만 지키면 ±0.3kg 오차 이내로 일관성 유지됨.</span></div>
        </div>
        <div style="display:flex;gap:10px;align-items:flex-start">
          <span style="font-size:18px">📈</span>
          <div><strong>4주 트렌드로 판단</strong><br>
          <span style="color:var(--text2);font-size:12px">일주일 단위 등락은 무시. 장거리 런 다음날은 염증으로 1~2kg 늘 수 있음 — 정상.</span></div>
        </div>
        <div style="display:flex;gap:10px;align-items:flex-start">
          <span style="font-size:18px">💻</span>
          <div><strong>기록 방법</strong><br>
          <code style="font-size:12px;background:var(--bg);padding:2px 6px;border-radius:4px">node log-weight.js 71.5</code><br>
          <span style="color:var(--text2);font-size:12px">터미널에서 실행하면 대시보드 자동 갱신.</span></div>
        </div>
      </div>
    </div>
  </div>

  <!-- Weekly Mileage Chart -->
  <div class="section-title">주간 누적 거리 (최근 12주)</div>
  <div class="card">
    <div class="chart-wrap"><canvas id="weeklyChart"></canvas></div>
  </div>

  <!-- Long Run Progression -->
  <div class="section-title">Long Run 거리 진행 (최근 12주)</div>
  <div class="card">
    <div class="chart-wrap"><canvas id="longRunChart"></canvas></div>
  </div>

  <!-- LTHR Test Banner -->
  ${plan?.lthrTest ? `
  <div style="margin:24px 0 0;padding:14px 18px;border-radius:10px;border-left:4px solid ${plan.lthrTest.suitable ? '#3b82f6' : '#d1d5db'};background:${plan.lthrTest.suitable ? '#eff6ff' : '#f9fafb'};display:flex;align-items:center;gap:12px">
    <span style="font-size:22px">${plan.lthrTest.suitable ? '🧪' : '⏳'}</span>
    <div>
      <div style="font-size:13px;font-weight:600;color:${plan.lthrTest.suitable ? '#1e40af' : '#6b7280'}">
        LTHR 테스트 ${plan.lthrTest.suitable ? '— 이번 주 추천!' : '— 아직 아님'}
      </div>
      <div style="font-size:12px;color:${plan.lthrTest.suitable ? '#3b82f6' : '#9ca3af'};margin-top:2px">
        ${plan.lthrTest.reason}
        ${plan.lthrTest.recommendedDay ? ` · <strong>${plan.lthrTest.recommendedDay}</strong>` : ''}
      </div>
    </div>
  </div>` : ''}

  <!-- Weekly Training Plan -->
  ${plan ? `
  <div class="section-title">이번 주 훈련 계획 <span style="font-size:12px;font-weight:400;color:var(--text3)">${plan.weekStart} ~ ${plan.weekEnd}</span></div>
  <div class="grid2">
    ${["yunho", "gf"].map((uid) => {
      const p = plan[uid];
      if (!p) return `<div class="card" style="color:var(--text3);display:flex;align-items:center;justify-content:center">${uid === "gf" ? "Jenny 계획 없음" : "윤호 계획 없음"}</div>`;
      const typeColor = { rest: "#e5e7eb", easy: "#dcfce7", tempo: "#dbeafe", long: "#ede9fe", couple: "#fce7f3", fasted: "#fef9c3" };
      const typeText  = { rest: "#6b7280", easy: "#166534", tempo: "#1e40af", long: "#6d28d9", couple: "#9d174d", fasted: "#854d0e" };
      return `
      <div class="card">
        <div class="runner-header" style="margin-bottom:8px">
          <div class="runner-dot" style="background:var(--${uid === "yunho" ? "yunho" : "gf"})"></div>
          <div class="runner-name">${p.name}</div>
          <span style="font-size:11px;color:var(--text3);margin-left:auto">${p.phaseLabel} · 목표 ${p.targetWeeklyKm}km</span>
        </div>
        <div style="font-size:12px;color:var(--text2);margin-bottom:10px;padding:6px 8px;background:var(--bg);border-radius:6px">${p.coachNote}</div>
        <div style="display:flex;flex-direction:column;gap:5px">
          ${p.schedule.map((day) => `
          <div style="display:flex;align-items:center;gap:8px">
            <div style="width:24px;height:24px;border-radius:50%;background:${typeColor[day.type] ?? "#e5e7eb"};color:${typeText[day.type] ?? "#374151"};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;flex-shrink:0">${day.dayName}</div>
            <div style="flex:1;min-width:0">
              <div style="font-size:12px;font-weight:500;color:${typeText[day.type] ?? "var(--text)"}">${day.label}</div>
              ${day.desc ? `<div class="day-desc" style="font-size:11px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${day.desc}</div>` : ""}
            </div>
            <div style="font-size:10px;color:var(--text3);flex-shrink:0">${day.date.slice(5)}</div>
          </div>`).join("")}
        </div>
        <div style="margin-top:10px;font-size:11px;color:var(--text3);border-top:1px solid var(--border);padding-top:8px">
          지난주 ${p.analysis.runsLastWeek}회 · ${p.analysis.lastWeekKm}km · Long Run ${p.analysis.longRunKm}km
        </div>
      </div>`;
    }).join("")}
  </div>` : `
  <div class="section-title">이번 주 훈련 계획</div>
  <div class="card" style="color:var(--text3);text-align:center;padding:24px">
    매주 일요일 저녁 자동 생성됩니다<br>
    <span style="font-size:12px">또는 지금 바로: <code>node generate-plan.js</code></span>
  </div>`}

  <!-- Recent Runs Table -->
  <div class="section-title">최근 러닝 기록 (윤호)</div>
  <div class="card">
    <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>날짜</th><th>거리</th><th>페이스</th><th>평균 HR</th><th>HR 존</th><th>케이던스</th><th>지면접촉</th><th>수직진동</th><th>파워</th><th>훈련효과</th>
        </tr>
      </thead>
      <tbody>
        ${recentRuns.map((r) => {
          const paceStr = secToMMSS(r.avgPaceSecPerKm);
          const z = hrZone(r.avgHR, yunhoMAF);
          const zoneClass = ["","z1","z2","z3","z4","z4"][z];
          const zLabel = ["","Z1","Z2","Z3","Z4","Z5"][z];
          const teKo = { "NO_BENEFIT":"없음","MINOR_BENEFIT":"미미","MAINTAINING":"유지","MAINTAINING_AEROBIC_BASE":"기초유지","IMPROVING":"향상","HIGHLY_IMPROVING":"크게향상","OVERREACHING":"과훈련","AEROBIC_BASE":"유산소기초" };
          return `<tr>
            <td>${r.date}</td>
            <td>${fmtKm(r.distanceM)}</td>
            <td>${paceStr}/km</td>
            <td>${r.avgHR ?? '--'} bpm</td>
            <td><span class="pace-chip ${zoneClass}">${zLabel}</span></td>
            <td>${r.cadence ? r.cadence + ' spm' : '--'}</td>
            <td>${r.groundContactTimeMs ? r.groundContactTimeMs + ' ms' : '--'}</td>
            <td>${r.verticalOscillationCm ? r.verticalOscillationCm + ' cm' : '--'}</td>
            <td>${r.normPowerW ?? r.avgPowerW ? (r.normPowerW ?? r.avgPowerW) + ' W' : '--'}</td>
            <td>${r.trainingEffectLabel ? (teKo[r.trainingEffectLabel] ?? r.trainingEffectLabel) : '--'}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    </div>
  </div>

  <!-- GF Runs Table -->
  ${gfRecentRuns.length > 0 ? `
  <div class="section-title">최근 러닝 기록 (Jenny)</div>
  <div class="card">
    <div class="table-wrap">
    <table>
      <thead><tr><th>날짜</th><th>거리</th><th>페이스</th><th>평균 HR</th><th>시간</th><th>HR 존</th></tr></thead>
      <tbody>
        ${gfRecentRuns.map((r) => {
          const paceStr = secToMMSS(r.avgPaceSecPerKm);
          const z = hrZone(r.avgHR, gfMAF);
          const zClass = ["","z1","z2","z3","z4","z4"][z];
          const zLabel = ["","Z1","Z2","Z3","Z4","Z5"][z];
          return `<tr>
            <td>${r.date}</td>
            <td>${fmtKm(r.distanceM)}</td>
            <td>${paceStr}/km</td>
            <td>${r.avgHR ?? '--'} bpm</td>
            <td>${secToHHMMSS(r.durationSec)}</td>
            <td><span class="pace-chip ${zClass}">${zLabel}</span></td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    </div>
  </div>` : ''}

</div>

<script>
const yunhoWeekly = ${JSON.stringify(yunhoWeekly)};
const gfWeekly = ${JSON.stringify(gfWeekly)};
const yunhoLR = ${JSON.stringify(yunhoLongRun)};
const gfLR = ${JSON.stringify(gfLongRun)};

const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { position: 'top', labels: { font: { size: 12 } } } },
  scales: {
    x: { ticks: { font: { size: 11 }, maxRotation: 45 }, grid: { display: false } },
    y: { ticks: { font: { size: 11 } }, beginAtZero: true }
  }
};

// Weekly mileage bar chart
new Chart(document.getElementById('weeklyChart'), {
  type: 'bar',
  data: {
    labels: yunhoWeekly.map(w => w.label),
    datasets: [
      { label: '윤호 (km)', data: yunhoWeekly.map(w => w.km), backgroundColor: 'rgba(59,130,246,0.7)', borderRadius: 4 },
      ...(gfWeekly.length ? [{ label: 'Jenny (km)', data: gfWeekly.map(w => w.km), backgroundColor: 'rgba(236,72,153,0.7)', borderRadius: 4 }] : [])
    ]
  },
  options: { ...chartDefaults, scales: { ...chartDefaults.scales, y: { ...chartDefaults.scales.y, title: { display: true, text: 'km' } } } }
});

// Long Run progression line chart
const lrLabels = yunhoLR.map(w => w.label);
new Chart(document.getElementById('longRunChart'), {
  type: 'line',
  data: {
    labels: lrLabels,
    datasets: [
      { label: '윤호 Long Run (km)', data: yunhoLR.map(w => w.km), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,0.1)', tension: 0.3, fill: true, pointRadius: 4 },
      ...(gfLR.length ? [{ label: 'Jenny Long Run (km)', data: gfLR.map(w => w.km), borderColor: '#ec4899', backgroundColor: 'rgba(236,72,153,0.1)', tension: 0.3, fill: true, pointRadius: 4 }] : []),
      { label: '목표 (21.1km)', data: lrLabels.map(() => 21.1), borderColor: '#22c55e', borderDash: [5,5], borderWidth: 1.5, pointRadius: 0, fill: false }
    ]
  },
  options: { ...chartDefaults, scales: { ...chartDefaults.scales, y: { ...chartDefaults.scales.y, suggestedMax: 25, title: { display: true, text: 'km' } } } }
});

// Pace trend (sec/km → display as min:sec)
const paceTrend = ${JSON.stringify(paceTrend)};
const zoneColors = ['#6b7280','#16a34a','#2563eb','#d97706','#dc2626','#9333ea'];
if (document.getElementById('paceTrendChart') && paceTrend.length > 0) {
  new Chart(document.getElementById('paceTrendChart'), {
    type: 'line',
    data: {
      labels: paceTrend.map(p => p.date),
      datasets: [{
        label: '페이스 (min/km)',
        data: paceTrend.map(p => p.pace ? Math.round(p.pace / 6) / 10 : null),
        borderColor: '#3b82f6',
        backgroundColor: 'rgba(59,130,246,0.08)',
        tension: 0.3, fill: true, pointRadius: 5,
        pointBackgroundColor: paceTrend.map(p => zoneColors[p.zone] ?? '#3b82f6'),
        pointBorderColor: '#fff', pointBorderWidth: 1.5,
        spanGaps: true,
      }]
    },
    options: {
      ...chartDefaults,
      plugins: { ...chartDefaults.plugins, tooltip: { callbacks: {
        label: (ctx) => {
          const sec = paceTrend[ctx.dataIndex]?.pace;
          if (!sec) return '--';
          return \`\${Math.floor(sec/60)}:\${String(Math.round(sec%60)).padStart(2,'0')}/km  HR \${paceTrend[ctx.dataIndex]?.hr ?? '--'}\`;
        }
      }}},
      scales: { ...chartDefaults.scales,
        y: { ...chartDefaults.scales.y, reverse: true,
          ticks: { font: { size: 11 }, callback: (v) => v.toFixed(1) },
          title: { display: true, text: 'min/km (낮을수록 빠름)' }
        }
      }
    }
  });
}

// HR zone bar chart
const zoneCounts = ${JSON.stringify(zoneCounts)};
const yunhoMAF = ${yunhoMAF};
function hrZoneLabels(maf) {
  return [\`Z1\\n<\${maf-10}\`, \`Z2\\n\${maf-10}~\${maf}\`, \`Z3\\n~\${maf+15}\`, \`Z4\\n~\${maf+28}\`, \`Z5\\n\${maf+29}+\`];
}
if (document.getElementById('hrZoneChart')) {
  new Chart(document.getElementById('hrZoneChart'), {
    type: 'bar',
    data: {
      labels: hrZoneLabels(yunhoMAF),
      datasets: [{ label: '런 횟수', data: zoneCounts,
        backgroundColor: ['#d1fae5','#dbeafe','#fef3c7','#fee2e2','#fae8ff'],
        borderColor:      ['#16a34a','#2563eb','#d97706','#dc2626','#9333ea'],
        borderWidth: 1.5, borderRadius: 4
      }]
    },
    options: { ...chartDefaults,
      plugins: { legend: { display: false } },
      scales: { ...chartDefaults.scales, y: { ...chartDefaults.scales.y, ticks: { stepSize: 1 } } }
    }
  });
}

// GF pace trend chart
const gfPaceTrend = ${JSON.stringify(gfPaceTrend)};
const gfMAF = ${gfMAF};
if (document.getElementById('gfPaceTrendChart') && gfPaceTrend.length > 0) {
  new Chart(document.getElementById('gfPaceTrendChart'), {
    type: 'line',
    data: {
      labels: gfPaceTrend.map(p => p.date),
      datasets: [{
        label: '페이스 (min/km)',
        data: gfPaceTrend.map(p => p.pace ? Math.round(p.pace / 6) / 10 : null),
        borderColor: '#ec4899',
        backgroundColor: 'rgba(236,72,153,0.08)',
        tension: 0.3, fill: true, pointRadius: 5,
        pointBackgroundColor: gfPaceTrend.map(p => zoneColors[p.zone] ?? '#ec4899'),
        pointBorderColor: '#fff', pointBorderWidth: 1.5,
        spanGaps: true,
      }]
    },
    options: {
      ...chartDefaults,
      plugins: { ...chartDefaults.plugins, tooltip: { callbacks: {
        label: (ctx) => {
          const sec = gfPaceTrend[ctx.dataIndex]?.pace;
          if (!sec) return '--';
          return \`\${Math.floor(sec/60)}:\${String(Math.round(sec%60)).padStart(2,'0')}/km  HR \${gfPaceTrend[ctx.dataIndex]?.hr ?? '--'}\`;
        }
      }}},
      scales: { ...chartDefaults.scales,
        y: { ...chartDefaults.scales.y, reverse: true,
          ticks: { font: { size: 11 }, callback: (v) => v.toFixed(1) },
          title: { display: true, text: 'min/km (낮을수록 빠름)' }
        }
      }
    }
  });
}

// GF HR zone bar chart
const gfZoneCounts = ${JSON.stringify(gfZoneCounts)};
if (document.getElementById('gfHrZoneChart')) {
  new Chart(document.getElementById('gfHrZoneChart'), {
    type: 'bar',
    data: {
      labels: hrZoneLabels(gfMAF),
      datasets: [{ label: '런 횟수', data: gfZoneCounts,
        backgroundColor: ['#d1fae5','#fce7f3','#fef3c7','#fee2e2','#fae8ff'],
        borderColor:      ['#16a34a','#ec4899','#d97706','#dc2626','#9333ea'],
        borderWidth: 1.5, borderRadius: 4
      }]
    },
    options: { ...chartDefaults,
      plugins: { legend: { display: false } },
      scales: { ...chartDefaults.scales, y: { ...chartDefaults.scales.y, ticks: { stepSize: 1 } } }
    }
  });
}

// Weight trend
const weightData = ${JSON.stringify(weightData)};
if (document.getElementById('weightChart') && weightData.length > 1) {
  new Chart(document.getElementById('weightChart'), {
    type: 'line',
    data: {
      labels: weightData.map(w => w.date.slice(5)),
      datasets: [
        { label: '체중 (kg)', data: weightData.map(w => w.kg),
          borderColor: '#f97316', backgroundColor: 'rgba(249,115,22,0.1)',
          tension: 0.3, fill: true, pointRadius: 4 },
        { label: '목표 70kg', data: weightData.map(() => 70),
          borderColor: '#22c55e', borderDash: [5,5], borderWidth: 1.5, pointRadius: 0, fill: false }
      ]
    },
    options: { ...chartDefaults,
      scales: { ...chartDefaults.scales,
        y: { ...chartDefaults.scales.y,
          min: Math.floor(Math.min(...weightData.map(w => w.kg), 70) - 1),
          max: Math.ceil(Math.max(...weightData.map(w => w.kg)) + 1),
          title: { display: true, text: 'kg' }
        }
      }
    }
  });
}
<\/script>
</body>
</html>`;

  const outPath = join(__dirname, "index.html");
  writeFileSync(outPath, html);
  console.log(`대시보드 생성 완료 → ${outPath}`);
}

generate();
