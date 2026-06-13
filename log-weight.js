/**
 * Manual weight logger.
 * Usage:
 *   node log-weight.js 71.5          → today's date
 *   node log-weight.js 71.5 2026-06-16
 *   node log-weight.js --history     → show last 10 entries
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = join(__dirname, "data/weight-manual.json");

function load() {
  if (!existsSync(FILE)) return [];
  return JSON.parse(readFileSync(FILE, "utf-8"));
}

function save(entries) {
  writeFileSync(FILE, JSON.stringify(entries, null, 2));
}

const args = process.argv.slice(2);

if (args[0] === "--history") {
  const entries = load();
  if (entries.length === 0) { console.log("기록 없음"); process.exit(0); }
  console.log("\n날짜          체중    목표 대비");
  console.log("─".repeat(32));
  entries.slice(-10).reverse().forEach((e) => {
    const diff = (e.kg - 70).toFixed(1);
    const sign = diff > 0 ? "+" : "";
    console.log(`${e.date}    ${e.kg}kg    ${sign}${diff}kg`);
  });
  process.exit(0);
}

const kg = parseFloat(args[0]);
if (isNaN(kg) || kg < 40 || kg > 150) {
  console.error("Usage: node log-weight.js <체중kg>  예: node log-weight.js 71.5");
  process.exit(1);
}

const date = args[1] ?? new Date().toISOString().substring(0, 10);
const entries = load();

// Update if same date exists, otherwise append
const existing = entries.findIndex((e) => e.date === date);
if (existing >= 0) {
  const old = entries[existing].kg;
  entries[existing].kg = kg;
  console.log(`${date} 체중 업데이트: ${old}kg → ${kg}kg`);
} else {
  entries.push({ date, kg });
  entries.sort((a, b) => a.date.localeCompare(b.date));
  const diff = (kg - 70).toFixed(1);
  const sign = diff > 0 ? "+" : "";
  console.log(`✓ ${date} | ${kg}kg | 목표(70kg) 대비 ${sign}${diff}kg`);
}

save(entries);

// Regenerate dashboard
execSync("node generate-dashboard.js", { cwd: __dirname, stdio: "inherit" });
