/**
 * 아이폰 단축어가 호출할 트리거 서버.
 * Node 내장 http 모듈만 사용 — 별도 패키지 설치 불필요.
 *
 * 사용법:
 *   SYNC_TOKEN=아무비밀값 node pi-webhook.js
 *
 * 단축어에서 호출할 주소 (Tailscale 연결 후):
 *   http://<파이의-tailscale-주소>:8787/?mode=check&token=아무비밀값
 */
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 8787;
const TOKEN = process.env.SYNC_TOKEN;

if (!TOKEN) {
  console.error("SYNC_TOKEN 환경변수를 설정하세요 (아무나 못 누르게 막는 비밀값)");
  process.exit(1);
}

createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.searchParams.get("token") !== TOKEN) {
    res.writeHead(403);
    return res.end("forbidden");
  }

  const mode = url.searchParams.get("mode") || "check";
  console.log(`[${new Date().toISOString()}] 트리거 받음 (mode=${mode})`);

  execFile("bash", ["pi-sync.sh", mode], { cwd: __dirname }, (err, stdout, stderr) => {
    if (err) console.error(stderr);
    else console.log(stdout);
  });

  res.writeHead(202, { "Content-Type": "text/plain" });
  res.end("동기화 시작함\n");
}).listen(PORT, () => console.log(`webhook 서버 실행 중: 포트 ${PORT}`));
