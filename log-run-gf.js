/**
 * Jenny 런 수동 입력 (Apple Watch / Strava 데이터)
 *
 * 기본:
 *   node log-run-gf.js --km 5.2 --pace 7:45 --hr 148
 *
 * 전체 옵션:
 *   --km       거리 km           (필수)
 *   --pace     평균 페이스 mm:ss  (필수)
 *   --hr       평균 심박수
 *   --maxhr    최대 심박수
 *   --calories 칼로리 (kcal)
 *   --steps    총 걸음수
 *   --cadence  케이던스 (spm)
 *   --elevation 고도 상승 (m)
 *   --gct      지면 접촉 시간 (ms)  — Apple Watch Series 8+ / Ultra
 *   --vo       수직 진동 (cm)       — Apple Watch Series 8+ / Ultra
 *   --power    러닝 파워 (W)        — Apple Watch Series 8+ / Ultra
 *   --stride   보폭 (cm)
 *   --date     날짜 yyyy-mm-dd (기본: 오늘)
 *   --name     활동 이름 (기본: "Apple Watch Run")
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
function getArg(name) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : null;
}
function getFloat(name) { const v = getArg(name); return v != null ? parseFloat(v) : null; }
function getInt(name)   { const v = getArg(name); return v != null ? parseInt(v)   : null; }

const km        = getFloat("km");
const pace      = getArg("pace");
const hr        = getInt("hr");
const maxhr     = getInt("maxhr");
const calories  = getInt("calories");
const steps     = getInt("steps");
const cadence   = getInt("cadence");
const elevation = getFloat("elevation");
const gct       = getInt("gct");      // ground contact time ms
const vo        = getFloat("vo");     // vertical oscillation cm
const power     = getInt("power");    // running power W
const stride    = getFloat("stride"); // stride length cm
const date      = getArg("date") ?? new Date().toISOString().slice(0, 10);
const name      = getArg("name") ?? "Apple Watch Run";

if (!km || !pace) {
  console.error("필수 항목 누락. 예: node log-run-gf.js --km 5.2 --pace 7:45 --hr 148");
  process.exit(1);
}

const [paceMin, paceSec] = pace.split(":").map(Number);
const paceSecPerKm = paceMin * 60 + paceSec;
const distanceM  = Math.round(km * 1000);
const durationSec = Math.round(paceSecPerKm * km);

const dataFile = join(__dirname, "data/gf.json");
const existing = existsSync(dataFile) ? JSON.parse(readFileSync(dataFile, "utf-8")) : null;

if (!existing) {
  console.error("data/gf.json 없음. 먼저 sync를 실행하세요.");
  process.exit(1);
}

const duplicate = (existing.activities ?? []).find(a =>
  a.date === date && Math.abs((a.distanceM ?? 0) - distanceM) < 200
);
if (duplicate) {
  console.log(`⚠️  ${date} 같은 거리 런이 이미 있어요 (${(duplicate.distanceM/1000).toFixed(1)}km). 중복 건너뜀.`);
  process.exit(0);
}

const newRun = {
  id: Date.now(),
  date,
  distanceM,
  durationSec,
  avgHR:               hr,
  maxHR:               maxhr,
  avgPaceSecPerKm:     paceSecPerKm,
  calories:            calories ?? (hr ? Math.round(durationSec / 60 * 0.15 * 60) : null),
  steps:               steps,
  cadence:             cadence,
  elevationGainM:      elevation,
  groundContactTimeMs: gct,
  verticalOscillationCm: vo,
  avgPowerW:           power,
  normPowerW:          power,  // Apple Watch doesn't separate norm power
  strideLengthCm:      stride,
  name,
  source: "apple-watch",
};

existing.activities = [newRun, ...(existing.activities ?? [])]
  .sort((a, b) => b.date.localeCompare(a.date))
  .slice(0, 200);

existing.lastSync = new Date().toISOString();
writeFileSync(dataFile, JSON.stringify(existing, null, 2));

const summary = [
  `${date}`, `${km}km`, `${pace}/km`,
  hr ? `HR ${hr}` : null,
  cadence ? `${cadence}spm` : null,
  gct ? `GCT ${gct}ms` : null,
  vo ? `VO ${vo}cm` : null,
  power ? `${power}W` : null,
].filter(Boolean).join(" · ");
console.log(`✅ Jenny 런 추가: ${summary}`);

execSync("node generate-daily-report.js evening", { cwd: __dirname, stdio: "inherit" });
execSync("node generate-dashboard.js", { cwd: __dirname, stdio: "inherit" });

try {
  execSync(`git add data/gf.json data/daily-report-gf.json index.html`, { cwd: __dirname, stdio: "pipe" });
  execSync(`git commit -m "log: Jenny ${date} Apple Watch 런 (${km}km)"`, { cwd: __dirname, stdio: "pipe" });
  execSync("git push", { cwd: __dirname, stdio: "inherit" });
  console.log("✅ GitHub 푸시 완료");
} catch {
  console.log("(변경사항 없거나 push 실패 — 로컬엔 저장됨)");
}
