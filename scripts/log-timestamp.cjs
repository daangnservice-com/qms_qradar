// dev 서버 출력에 줄마다 시각을 붙인다. 워치독이 `npm run dev 2>&1 | node scripts/log-timestamp.cjs >> dev-server.log` 로 쓴다.
// Next 요청 로그(`GET /api/... 200 in 17ms`)에는 시각이 없어서 나중에 언제 친 호출인지 알 수 없었다.
// URL 쿼리에 실린 시크릿(stt-batch 콜백의 ?secret= 등)은 로그에 남기지 않는다.
const { StringDecoder } = require("node:string_decoder");

const SECRET_PARAM = /([?&](?:secret|token|access_token|api_key|key|password)=)[^&\s"']+/gi;

function stamp(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
  );
}

function writeLine(line) {
  process.stdout.write(`${stamp()} ${line.replace(SECRET_PARAM, "$1***")}\n`);
}

const decoder = new StringDecoder("utf8");
let pending = "";

process.stdin.on("data", (chunk) => {
  pending += decoder.write(chunk);
  const lines = pending.split(/\r?\n/);
  pending = lines.pop() ?? "";
  for (const line of lines) writeLine(line);
});

process.stdin.on("end", () => {
  pending += decoder.end();
  if (pending) writeLine(pending);
});

// 서버가 죽어 파이프가 닫혀도 조용히 끝낸다.
process.stdout.on("error", () => process.exit(0));
