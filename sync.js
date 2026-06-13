/**
 * Garmin data sync for running tracker.
 * Fetches activities, VO2Max, weight, sleep for each user and merges into data/*.json
 *
 * Usage:
 *   node sync.js              → sync all users
 *   node sync.js --user yunho → sync only yunho
 *   node sync.js --user gf    → sync only girlfriend
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));

const USERS = {
  yunho: {
    sessionFile: join(__dirname, "sessions/yunho-session.json"),
    dataFile: join(__dirname, "data/yunho.json"),
    name: "윤호",
    birthYear: 1992,
    targetWeightKg: 70,
    goalDistanceKm: 21.1,
    goalTimeMin: 120,
  },
  gf: {
    sessionFile: join(__dirname, "sessions/gf-session.json"),
    dataFile: join(__dirname, "data/gf.json"),
    name: "Jenny",
    birthYear: 2001,
    targetWeightKg: null,
    goalDistanceKm: 20,
    goalTimeMin: null,
    maxRunsPerWeek: 3,
    allEasy: true,            // no intensity work
    hrCeiling: 155,           // MAF — flag if avg HR exceeds this
    targetPaceSecMin: 470,    // 7:50/km
    targetPaceSecMax: 490,    // 8:10/km
    longRunMaxIncreasePct: 10,
    longRunFlagPct: 15,
    goalNote: "2026년 말까지 20km 편안하게 완주 · 주 3회 올 이지",
  },
};

function isJwtExpiredOrSoon(jwtValue, bufferSec = 3600) {
  try {
    const payload = JSON.parse(Buffer.from(jwtValue.split(".")[1], "base64url").toString());
    return payload.exp * 1000 < Date.now() + bufferSec * 1000;
  } catch { return true; }
}

async function refreshSessionIfNeeded(config) {
  const session = JSON.parse(readFileSync(config.sessionFile, "utf-8"));
  const jwtCookie = session.cookies.find((c) => c.name === "JWT_WEB");
  const needsRefresh = !session.csrf_token || (jwtCookie && isJwtExpiredOrSoon(jwtCookie.value));
  if (!needsRefresh) return;

  console.log(`[${config.name}] 세션 갱신 중 (CSRF=${!session.csrf_token ? "없음" : "만료"})...`);
  let playwright;
  try { playwright = await import("playwright"); }
  catch { throw new Error("playwright not available"); }

  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext();
  await context.addCookies(session.cookies.map((c) => ({
    name: c.name, value: c.value, domain: c.domain, path: "/",
  })));

  const page = await context.newPage();
  try {
    // Navigate to app — triggers JWT refresh via SSO if session cookie is valid
    // Also extracts CSRF token from the page meta tag
    await page.goto("https://connect.garmin.com/app/dashboard", {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    // Brief wait for any post-load auth redirects to settle
    await page.waitForTimeout(3000);
    const csrf = await page.evaluate(
      "document.querySelector('meta[name=\"csrf-token\"]')?.content ?? null"
    );
    const newCookies = await context.cookies();
    const garminCookies = newCookies
      .filter((c) => c.domain?.includes("garmin"))
      .map((c) => ({ name: c.name, value: c.value, domain: c.domain }));

    const newJwt = garminCookies.find((c) => c.name === "JWT_WEB");
    if (newJwt && !isJwtExpiredOrSoon(newJwt.value, 60)) {
      session.cookies = garminCookies;
      if (csrf) session.csrf_token = csrf;
      writeFileSync(config.sessionFile, JSON.stringify(session, null, 2));
      if (config.sessionFile.includes("yunho")) {
        writeFileSync(join(homedir(), ".garmin-connect-mcp/session.json"),
          JSON.stringify(session, null, 2));
      }
      console.log(`[${config.name}] 세션 갱신 완료 ✓ (CSRF: ${csrf ? "획득" : "없음"})`);
    } else {
      console.log(`[${config.name}] 세션 갱신 실패 — 기존으로 계속 시도`);
    }
  } finally {
    await browser.close();
  }
}

async function fetchUserData(userId, config) {
  if (!existsSync(config.sessionFile)) {
    console.log(`[${config.name}] 세션 파일 없음: ${config.sessionFile} — 건너뜀`);
    return null;
  }

  await refreshSessionIfNeeded(config);

  let GarminClient;
  try {
    const mod = await import("@etweisberg/garmin-connect-mcp");
    GarminClient = mod.GarminClient;
  } catch {
    // Try local node_modules path
    const localMod = await import(join(__dirname, "node_modules/@etweisberg/garmin-connect-mcp/dist/garmin-client.js"));
    GarminClient = localMod.GarminClient;
  }

  const client = new GarminClient(config.sessionFile);

  try {
    console.log(`[${config.name}] 데이터 수집 시작...`);

    // Fetch profile to get displayName
    const profile = await client.get("userprofile-service/userprofile/settings");
    const displayName = profile.displayName;
    console.log(`[${config.name}] 프로필: ${displayName}`);

    // Fetch last 50 running activities
    const activitiesRes = await client.get("activitylist-service/activities/search/activities", {
      start: 0,
      limit: 50,
      activityType: "running",
    });
    const activities = (activitiesRes || []).map((a) => ({
      id: a.activityId,
      date: a.startTimeLocal?.substring(0, 10) ?? "",
      distanceM: Math.round(a.distance ?? 0),
      durationSec: Math.round(a.duration ?? 0),
      avgHR: a.averageHR ?? null,
      maxHR: a.maxHR ?? null,
      avgPaceSecPerKm: a.distance > 0 ? Math.round((a.duration / (a.distance / 1000))) : null,
      calories: a.calories ?? null,
      name: a.activityName ?? "",
    }));
    console.log(`[${config.name}] 러닝 ${activities.length}개 수집`);

    // Fetch VO2Max
    let vo2max = null;
    try {
      const today = new Date().toISOString().split("T")[0];
      const vo2Res = await client.get(`metrics-service/metrics/maxmet/latest/${today}`);
      if (vo2Res?.generic?.calendarDate) {
        vo2max = [{ date: vo2Res.generic.calendarDate, value: vo2Res.generic.vo2MaxPreciseValue ?? vo2Res.generic.vo2MaxValue }];
      }
    } catch (e) {
      console.log(`[${config.name}] VO2Max 수집 실패: ${e.message}`);
    }

    // Fetch weight (last 12 months)
    let weight = null;
    try {
      const endDate = new Date().toISOString().split("T")[0];
      const startDate = new Date(Date.now() - 365 * 86400000).toISOString().split("T")[0];
      const weightRes = await client.get(`weight-service/weight/range/${startDate}/${endDate}`, { includeAll: "true" });
      if (weightRes?.dateWeightList) {
        weight = weightRes.dateWeightList
          .map((w) => ({
            date: w.calendarDate,
            kg: w.weight ? w.weight / 1000 : null, // Garmin stores in grams
          }))
          .filter((w) => w.kg !== null);
      }
    } catch (e) {
      console.log(`[${config.name}] 체중 수집 실패: ${e.message}`);
    }

    // Fetch today's sleep score
    let sleep = null;
    try {
      const today = new Date().toISOString().split("T")[0];
      const sleepRes = await client.get("sleep-service/sleep/dailySleepData", {
        date: today,
        nonSleepBufferMinutes: 60,
      });
      if (sleepRes?.dailySleepDTO) {
        sleep = [{
          date: sleepRes.dailySleepDTO.calendarDate,
          score: sleepRes.dailySleepDTO.sleepScores?.overall?.value ?? null,
          durationMin: sleepRes.dailySleepDTO.sleepTimeSeconds
            ? Math.round(sleepRes.dailySleepDTO.sleepTimeSeconds / 60)
            : null,
        }];
      }
    } catch (e) {
      console.log(`[${config.name}] 수면 수집 실패: ${e.message}`);
    }

    // Fetch training readiness (today)
    let trainingReadiness = null;
    try {
      const today = new Date().toISOString().split("T")[0];
      const trRes = await client.get(`metrics-service/metrics/trainingreadiness/${today}`);
      const tr = Array.isArray(trRes) ? trRes[0] : trRes;
      if (tr?.score != null) {
        trainingReadiness = {
          date: tr.calendarDate ?? today,
          score: tr.score,
          level: tr.level ?? null,
          feedbackShort: tr.feedbackShort ?? null,
          sleepScore: tr.sleepScore ?? null,
          recoveryTimeMin: tr.recoveryTime ?? null,
        };
      }
    } catch (e) {
      console.log(`[${config.name}] 훈련 준비도 수집 실패: ${e.message}`);
    }

    await client.close();

    const age = config.birthYear ? new Date().getFullYear() - config.birthYear : null;
    return {
      userId,
      name: config.name,
      garminDisplayName: displayName,
      birthYear: config.birthYear,
      age,
      mafHR: age ? 180 - age : null,
      targetWeightKg: config.targetWeightKg,
      goalDistanceKm: config.goalDistanceKm,
      goalTimeMin: config.goalTimeMin,
      activities,
      vo2max,
      weight,
      sleep,
      trainingReadiness,
      lastSync: new Date().toISOString(),
    };
  } catch (err) {
    await client.close().catch(() => {});
    throw err;
  }
}

function mergeData(existing, fresh) {
  if (!existing) return fresh;

  // Merge activities: keep all existing + add new ones (by id)
  const existingIds = new Set((existing.activities || []).map((a) => a.id));
  const newActivities = (fresh.activities || []).filter((a) => !existingIds.has(a.id));
  const mergedActivities = [...newActivities, ...(existing.activities || [])]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 200); // keep last 200

  // Merge weight: deduplicate by date, keep all
  const existingWeightDates = new Set((existing.weight || []).map((w) => w.date));
  const newWeight = (fresh.weight || []).filter((w) => !existingWeightDates.has(w.date));
  const mergedWeight = [...(existing.weight || []), ...newWeight].sort((a, b) => b.date.localeCompare(a.date));

  // Merge VO2Max: same
  const existingV2Dates = new Set((existing.vo2max || []).map((v) => v.date));
  const newV2 = (fresh.vo2max || []).filter((v) => !existingV2Dates.has(v.date));
  const mergedV2 = [...(existing.vo2max || []), ...newV2].sort((a, b) => b.date.localeCompare(a.date));

  return {
    ...existing,
    ...fresh,
    activities: mergedActivities,
    weight: mergedWeight,
    vo2max: mergedV2,
  };
}

async function syncUser(userId) {
  const config = USERS[userId];
  let existing = null;

  if (existsSync(config.dataFile)) {
    try {
      existing = JSON.parse(readFileSync(config.dataFile, "utf-8"));
    } catch {}
  }

  const fresh = await fetchUserData(userId, config);
  if (!fresh) return;

  const merged = mergeData(existing, fresh);
  writeFileSync(config.dataFile, JSON.stringify(merged, null, 2));
  console.log(`[${config.name}] 저장 완료 → ${config.dataFile}`);

  // Also sync session back to ~/.garmin-connect-mcp/session.json for MCP use
  if (userId === "yunho") {
    writeFileSync(`${process.env.HOME}/.garmin-connect-mcp/session.json`,
      readFileSync(config.sessionFile));
  }
}

async function main() {
  const args = process.argv.slice(2);
  const userArg = args.find((a) => a.startsWith("--user="))?.split("=")[1]
    ?? (args.indexOf("--user") !== -1 ? args[args.indexOf("--user") + 1] : null);

  const usersToSync = userArg ? [userArg] : Object.keys(USERS);

  for (const userId of usersToSync) {
    if (!USERS[userId]) {
      console.error(`알 수 없는 유저: ${userId}`);
      continue;
    }
    try {
      await syncUser(userId);
    } catch (err) {
      console.error(`[${USERS[userId].name}] 동기화 실패: ${err.message}`);
      if (err.message.includes("401")) {
        console.error(`  → 세션 만료됨. ${userId === "yunho" ? "윤호" : "Jenny"} 가민에 재로그인 후 쿠키를 sessions/${userId}-session.json에 업데이트해주세요.`);
      }
    }
  }
}

async function generateDashboard() {
  try {
    const { default: generate } = await import("./generate-dashboard.js?" + Date.now());
  } catch (e) {
    const { execSync } = await import("node:child_process");
    execSync("node generate-dashboard.js", { cwd: __dirname, stdio: "inherit" });
  }
}

async function pushDashboard() {
  const { execSync } = await import("node:child_process");
  try {
    execSync('git add dashboard.html', { cwd: __dirname, stdio: "pipe" });
    const today = new Date().toISOString().substring(0, 10);
    execSync(`git commit -m "dashboard: ${today} 자동 갱신"`, { cwd: __dirname, stdio: "pipe" });
    execSync('git push', { cwd: __dirname, stdio: "inherit" });
    console.log("대시보드 GitHub 푸시 완료 ✓");
  } catch (e) {
    // No changes to commit, or push failed — non-fatal
    if (!e.message?.includes("nothing to commit")) {
      console.log("GitHub 푸시 실패 (원격 연결 확인):", e.message?.split("\n")[0]);
    }
  }
}

main()
  .then(() => generateDashboard())
  .then(() => pushDashboard())
  .catch(console.error);
