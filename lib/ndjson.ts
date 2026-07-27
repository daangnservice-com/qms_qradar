// NDJSON(줄 단위 JSON) 스트림 응답을 이벤트 단위로 읽는다.
// /api/evaluate는 긴 분석 중에도 주기적으로 이벤트를 흘려보내 앞단 로드밸런서의
// idle timeout(무통신 시간 기준)을 피하는데, 그 스트림을 소비하는 쪽 구현.
// 청크 경계가 줄 중간을 자를 수 있어 버퍼에 모았다가 개행 단위로 끊어 파싱한다.
export async function* readNdjson<T = unknown>(body: ReadableStream<Uint8Array> | null): AsyncGenerator<T> {
  if (!body) return;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (line) yield JSON.parse(line) as T;
      }
    }
    // 마지막 줄에 개행이 없을 수도 있다.
    const last = (buf + decoder.decode()).trim();
    if (last) yield JSON.parse(last) as T;
  } finally {
    reader.releaseLock();
  }
}
