/**
 * Jenny 런 수동 입력 (가민 없이 애플워치/스트라바 데이터로)
 *
 * 사용법:
 *   node log-run-gf.js --km 5.2 --pace 7:45 --hr 148
 *   node log-run-gf.js --km 5.2 --pace 7:45 --hr 148 --date 2026-08-11
 *
 * 옵션:
 *   --km    거리 (필수)
 *   --pace  평균 페이스 mm:ss (필수)
 *   --hr    평균 심박수 (선택)
 *   --maxhr 최대 심박수 (선택)
 *   --date  날짜 yyyy-mm-dd (기본: 오늘)
 *   --name  활동 이름 (기본: "Apple Watch Run")
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

const km    = parseFloat(getArg("km"));
const pace  = getArg("pace");
const hr    = getArg("hr") ? parseInt(getArg("hr")) : null;
const maxhr = getArg("maxhr") ? parseInt(getArg("maxhr")) : null;
const date  = getArg("date") ?? new Date().toISOString().slice(0, 10);
const name  = getArg("name") ?? "Apple Watch Run";

if (!km || !pace) {
  console.error("필수 항목 누락. 예: node log-run-gf.js --km 5.2 --pace 7:45 --hr 148");
  process.exit(1);
}

// pace mm:ss → sec/km
const [paceMin, paceSec] = pace.split(":").map(Number);
const paceSecPerKm = paceMin * 60 + paceSec;
const distanceM = Math.round(km * 1000);
const durationSec = Math.round(paceSecPerKm * km);

const dataFile = join(__dirname, "data/gf.json");
const existing = existsSync(dataFile) ? JSON.parse(readFileSync(dataFile, "utf-8")) : null;

if (!existing) {
  console.error("data/gf.json 없음. 먼저 sync를 실행하세요.");
  process.exit(1);
}

// 중복 체크 (같은 날짜 + 비슷한 거리)
const duplicate = (existing.activities ?? []).find(a =>
  a.date === date && Math.abs((a.distanceM ?? 0) - distanceM) < 200
);
if (duplicate) {
  console.log(`⚠️  ${date} 같은 거리 런이 이미 있어요 (${(duplicate.distanceM/1000).toFixed(1)}km). 중복 건너뜀.`);
  process.exit(0);
}

const newRun = {
  id: Date.now(),   // 임시 ID
  date,
  distanceM,
  durationSec,
  avgHR: hr,
  maxHR: maxhr,
  avgPaceSecPerKm: paceSecPerKm,
  calories: hr ? Math.round(durationSec / 60 * 0.15 * 60) : null,
  name,
  source: "manual",
};

existing.activities = [newRun, ...(existing.activities ?? [])]
  .sort((a, b) => b.date.localeCompare(a.date))
  .slice(0, 200);

existing.lastSync = new Date().toISOString();
writeFileSync(dataFile, JSON.stringify(existing, null, 2));
console.log(`✅ Jenny 런 추가 완료`);
console.log(`   ${date} · ${km}km · ${pace}/km${hr ? ` · HR ${hr}` : ""}`);

// 대시보드 자동 갱신
execSync("node generate-daily-report.js evening", { cwd: __dirname, stdio: "inherit" });
execSync("node generate-dashboard.js", { cwd: __dirname, stdio: "inherit" });

// GitHub push
try {
  execSync(`git add data/gf.json data/daily-report-gf.json index.html`, { cwd: __dirname, stdio: "pipe" });
  execSync(`git commit -m "log: Jenny ${date} 런 수동 입력 (${km}km)"`, { cwd: __dirname, stdio: "pipe" });
  execSync("git push", { cwd: __dirname, stdio: "inherit" });
  console.log("✅ GitHub 푸시 완료");
} catch {
  console.log("(변경사항 없거나 push 실패 — 로컬엔 저장됨)");
}
