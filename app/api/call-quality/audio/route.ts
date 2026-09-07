import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { orgFromParam, canAccessCallQualityPlayback } from "@/lib/callQualityOrg";
import { loadMonoWav } from "@/lib/callAudioCache";

export const runtime = "nodejs";
export const maxDuration = 120; // Genesys 확보 + 다운로드 + 변환 여유
export const dynamic = "force-dynamic";

// conversation_id의 통화 음성을 Genesys에서 받아 재생용 mono WAV로 스트리밍(프록시).
// - 내부 캐시는 stereo 마스터(peaks와 공유); 응답만 mono downmix.
// - WAV: Genesys WEBM은 seek 정보가 없어 특정 구간 이동이 안 됨(WAV는 됨).
// - HTTP Range(206) 지원: 브라우저의 구간 seek에 필요(없으면 0으로 튕김).
// - 변환 결과를 짧게(10분) 메모리 캐시: seek마다 Genesys 재확보+재변환 방지. (영구 저장 아님)
// 허용 계정만.

function toArrayBuffer(u8: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(u8.byteLength);
  new Uint8Array(ab).set(u8);
  return ab;
}

function parseRange(range: string | null, total: number): { start: number; end: number } | null {
  if (!range) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m) return null;
  const [, s, e] = m;
  let start: number;
  let end: number;
  if (s === "" && e === "") return null;
  if (s === "") {
    const n = parseInt(e, 10);
    if (Number.isNaN(n)) return null;
    start = Math.max(0, total - n);
    end = total - 1;
  } else {
    start = parseInt(s, 10);
    end = e === "" ? total - 1 : parseInt(e, 10);
  }
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  if (end >= total) end = total - 1;
  if (start < 0 || start > end) return null;
  return { start, end };
}

export async function GET(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const org = orgFromParam(url.searchParams.get("org"));
  if (!canAccessCallQualityPlayback(org, session.user.email)) return new Response("Forbidden", { status: 403 });

  const conversationId = url.searchParams.get("conversationId") ?? "";
  if (!conversationId) return new Response("conversationId required", { status: 400 });

  try {
    const wav = await loadMonoWav(conversationId);
    const total = wav.byteLength;
    const base: Record<string, string> = {
      "Content-Type": "audio/wav",
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
    };

    const range = parseRange(req.headers.get("range"), total);
    if (range) {
      const chunk = wav.subarray(range.start, range.end + 1);
      return new Response(toArrayBuffer(chunk), {
        status: 206,
        headers: {
          ...base,
          "Content-Range": `bytes ${range.start}-${range.end}/${total}`,
          "Content-Length": String(chunk.byteLength),
        },
      });
    }
    return new Response(toArrayBuffer(wav), { status: 200, headers: { ...base, "Content-Length": String(total) } });
  } catch (err) {
    console.error("[GET /api/call-quality/audio]", err);
    return new Response("audio fetch failed", { status: 502 });
  }
}
