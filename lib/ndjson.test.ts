import { describe, it, expect } from "vitest";
import { readNdjson } from "./ndjson";

// 청크 경계를 임의로 자르는 스트림(실제 네트워크와 같은 상황) 생성
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      for (const s of chunks) c.enqueue(enc.encode(s));
      c.close();
    },
  });
}

async function collect(chunks: string[]) {
  const out: unknown[] = [];
  for await (const ev of readNdjson(streamOf(chunks))) out.push(ev);
  return out;
}

describe("readNdjson", () => {
  it("줄 단위로 이벤트를 뽑는다", async () => {
    expect(await collect(['{"type":"heartbeat","elapsedMs":5000}\n{"type":"result","result":1}\n'])).toEqual([
      { type: "heartbeat", elapsedMs: 5000 },
      { type: "result", result: 1 },
    ]);
  });

  it("한 줄이 여러 청크로 쪼개져 와도 이어붙인다", async () => {
    expect(await collect(['{"type":"prog', 'ress","step":"analyze"', "}\n"])).toEqual([
      { type: "progress", step: "analyze" },
    ]);
  });

  it("마지막 줄에 개행이 없어도 읽는다", async () => {
    expect(await collect(['{"a":1}\n{"b":2}'])).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("빈 줄은 건너뛴다", async () => {
    expect(await collect(['\n{"a":1}\n\n'])).toEqual([{ a: 1 }]);
  });

  it("body가 없으면 아무것도 내지 않는다", async () => {
    const out: unknown[] = [];
    for await (const ev of readNdjson(null)) out.push(ev);
    expect(out).toEqual([]);
  });
});
