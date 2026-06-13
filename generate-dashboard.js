/**
 * Reads data/*.json and generates a self-contained dashboard.html with embedded data.
 * No server needed — just open dashboard.html in any browser.
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

function generate() {
  const yunho = loadUser("yunho.json");
  const gf = loadUser("gf.json");
  const plan = loadPlan();
  const manualWeight = loadWeightManual();

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
  body { font-family: -apple-system, "Segoe UI", sans-serif; background: var(--bg); color: var(--text); font-size: 14px; }
  .container { max-width: 1100px; margin: 0 auto; padding: 24px 16px; }
  h1 { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
  .sync-time { font-size: 12px; color: var(--text3); margin-bottom: 24px; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
  .grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
  @media (max-width: 700px) { .grid2, .grid3, .grid4 { grid-template-columns: 1fr; } }
  .card { background: var(--card); border-radius: 12px; padding: 18px 20px; border: 1px solid var(--border); }
  .card-title { font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--text3); margin-bottom: 12px; }
  .big-num { font-size: 32px; font-weight: 700; }
  .sub { font-size: 12px; color: var(--text2); margin-top: 4px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600; }
  .badge-low { background: #fef3c7; color: #92400e; }
  .badge-moderate { background: #dbeafe; color: #1e40af; }
  .badge-high { background: #dcfce7; color: #166534; }
  .badge-ok { background: #dcfce7; color: #166534; }
  .section-title { font-size: 16px; font-weight: 700; margin: 28px 0 12px; }
  .runner-header { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; }
  .runner-dot { width: 10px; height: 10px; border-radius: 50%; }
  .runner-name { font-size: 13px; font-weight: 600; }
  /* Roadmap */
  .roadmap { position: relative; padding: 8px 0; }
  .roadmap-track { height: 8px; background: var(--border); border-radius: 99px; overflow: hidden; margin: 8px 0; }
  .roadmap-fill { height: 100%; border-radius: 99px; transition: width .4s ease; }
  .roadmap-labels { display: flex; justify-content: space-between; font-size: 11px; color: var(--text3); }
  .roadmap-markers { display: flex; justify-content: space-between; font-size: 10px; color: var(--text3); margin-top: 4px; }
  /* Table */
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; color: var(--text3); padding: 6px 8px; border-bottom: 1px solid var(--border); }
  td { padding: 8px 8px; border-bottom: 1px solid var(--border); }
  tr:last-child td { border-bottom: none; }
  .pace-chip { display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 500; }
  .z1 { background: #ecfdf5; color: #065f46; }
  .z2 { background: #eff6ff; color: #1e40af; }
  .z3 { background: #fffbeb; color: #92400e; }
  .z4 { background: #fff1f2; color: #9f1239; }
  /* Chart containers */
  .chart-wrap { position: relative; height: 180px; }
</style>
</head>
<body>
<div class="container">
  <h1>🏃 러닝 코치 대시보드</h1>
  <div class="sync-time">마지막 동기화: ${lastSync}</div>

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
        <div class="runner-name">여친</div>
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
      <div>여친 데이터 연동 대기 중</div>
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

  <!-- Pace Trend + HR Zone (여친) -->
  ${gf ? `
  <div class="section-title">페이스 트렌드 &amp; HR 존 분포 — 여친</div>
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
      if (!p) return `<div class="card" style="color:var(--text3);display:flex;align-items:center;justify-content:center">${uid === "gf" ? "여친 계획 없음" : "윤호 계획 없음"}</div>`;
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
              ${day.desc ? `<div style="font-size:11px;color:var(--text3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${day.desc}</div>` : ""}
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
    <table>
      <thead>
        <tr>
          <th>날짜</th>
          <th>거리</th>
          <th>페이스</th>
          <th>평균 HR</th>
          <th>시간</th>
          <th>HR 존</th>
        </tr>
      </thead>
      <tbody>
        ${recentRuns.map((r) => {
          const paceStr = secToMMSS(r.avgPaceSecPerKm);
          const z = hrZone(r.avgHR, yunhoMAF);
          const zoneClass = ["","z1","z2","z3","z4","z4"][z];
          const zLabel = ["","Z1","Z2","Z3","Z4","Z5"][z];
          return `<tr>
            <td>${r.date}</td>
            <td>${fmtKm(r.distanceM)}</td>
            <td>${paceStr}/km</td>
            <td>${r.avgHR ?? '--'} bpm</td>
            <td>${secToHHMMSS(r.durationSec)}</td>
            <td><span class="pace-chip ${zoneClass}">${zLabel}</span></td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  </div>

  <!-- GF Runs Table -->
  ${gfRecentRuns.length > 0 ? `
  <div class="section-title">최근 러닝 기록 (여친)</div>
  <div class="card">
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
      ...(gfWeekly.length ? [{ label: '여친 (km)', data: gfWeekly.map(w => w.km), backgroundColor: 'rgba(236,72,153,0.7)', borderRadius: 4 }] : [])
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
      ...(gfLR.length ? [{ label: '여친 Long Run (km)', data: gfLR.map(w => w.km), borderColor: '#ec4899', backgroundColor: 'rgba(236,72,153,0.1)', tension: 0.3, fill: true, pointRadius: 4 }] : []),
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

  const outPath = join(__dirname, "dashboard.html");
  writeFileSync(outPath, html);
  console.log(`대시보드 생성 완료 → ${outPath}`);
}

generate();
