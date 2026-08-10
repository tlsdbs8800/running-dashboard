/**
 * Garmin Connect 로그인 스크립트
 *
 * 실제 브라우저 창을 열어서 로그인하면 모든 쿠키(httpOnly 포함)를
 * 자동으로 추출해서 sessions/{userId}-session.json에 저장합니다.
 *
 * 사용법:
 *   node login.js            → 윤호 세션 저장
 *   node login.js --user gf  → Jenny 세션 저장
 *
 * 토큰 만료 시 이 스크립트만 다시 실행하면 됩니다.
 */

import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import * as readline from "node:readline";

const __dirname = dirname(fileURLToPath(import.meta.url));

const args = process.argv.slice(2);
const userId = args.find((a) => a.startsWith("--user="))?.split("=")[1]
  ?? (args.indexOf("--user") !== -1 ? args[args.indexOf("--user") + 1] : "yunho");

const sessionFile = join(__dirname, `sessions/${userId}-session.json`);
const garminDomains = [
  "https://connect.garmin.com",
  "https://sso.garmin.com",
  "https://garmin.com",
];

function prompt(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (ans) => { rl.close(); resolve(ans); });
  });
}

console.log(`\n[${userId}] Garmin Connect 로그인 스크립트`);
console.log("─".repeat(50));
console.log("브라우저 창이 열립니다. 가민 커넥트에 로그인 후");
console.log("대시보드(홈 화면)가 완전히 로드될 때까지 기다려주세요.\n");

// macOS Chrome 또는 Playwright 번들 Chromium 사용
const chromiumExecs = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  process.env.CHROMIUM_PATH,
].filter(Boolean);

let browser;
for (const execPath of chromiumExecs) {
  try {
    browser = await chromium.launch({
      headless: false,
      executablePath: execPath,
      args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    });
    console.log(`브라우저 경로: ${execPath}`);
    break;
  } catch {
    // try next
  }
}

if (!browser) {
  // Playwright 번들 Chromium fallback
  try {
    browser = await chromium.launch({
      headless: false,
      args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    });
    console.log("브라우저: Playwright 번들 Chromium");
  } catch (e) {
    console.error("브라우저를 열 수 없습니다:", e.message);
    console.error("npx playwright install chromium 을 실행해보세요.");
    process.exit(1);
  }
}

const context = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
  viewport: { width: 1280, height: 800 },
});

const page = await context.newPage();

// automation 감지 회피
await page.addInitScript(() => {
  Object.defineProperty(navigator, "webdriver", { get: () => undefined });
});

await page.goto("https://connect.garmin.com/signin/", {
  waitUntil: "domcontentloaded",
  timeout: 30000,
});

console.log("✅ 브라우저가 열렸습니다.");
console.log("━".repeat(50));
console.log("1. 이메일과 비밀번호로 로그인");
console.log("2. 대시보드 홈이 완전히 로드될 때까지 대기");
console.log("3. 이 터미널로 돌아와서 Enter 누르기");
console.log("━".repeat(50));

await prompt("\n로그인 완료 후 Enter를 누르세요... ");

// 쿠키 추출 (httpOnly 포함 — Playwright는 자신의 컨텍스트 쿠키를 모두 읽을 수 있음)
const allCookies = await context.cookies(garminDomains);
console.log(`\n✅ 쿠키 ${allCookies.length}개 추출`);

// CSRF 토큰 추출
let csrf = null;
try {
  csrf = await page.evaluate(
    "document.querySelector('meta[name=\"csrf-token\"]')?.content ?? null"
  );
  if (csrf) console.log(`✅ CSRF 토큰 획득: ${csrf.substring(0, 8)}...`);
  else console.log("⚠️  CSRF 토큰 없음 (일부 기능에 영향 없음)");
} catch {
  console.log("⚠️  CSRF 토큰 추출 실패");
}

await browser.close();

// 저장
mkdirSync(join(__dirname, "sessions"), { recursive: true });

const sessionData = {
  cookies: allCookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path ?? "/",
    secure: c.secure ?? false,
    httpOnly: c.httpOnly ?? false,
    sameSite: c.sameSite ?? "Lax",
  })),
  csrf_token: csrf,
};

writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));
console.log(`\n✅ 세션 저장 완료: ${sessionFile}`);

// 윤호 세션은 ~/.garmin-connect-mcp/session.json에도 복사
if (userId === "yunho") {
  const mcpDir = join(homedir(), ".garmin-connect-mcp");
  mkdirSync(mcpDir, { recursive: true });
  writeFileSync(join(mcpDir, "session.json"), JSON.stringify(sessionData, null, 2));
  console.log(`✅ MCP 세션도 업데이트: ~/.garmin-connect-mcp/session.json`);
}

console.log("\n이제 node sync.js 를 실행하세요!\n");
