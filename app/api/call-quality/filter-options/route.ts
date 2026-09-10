import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessAnyCallQuality } from "@/lib/sessionAccessServer";
import { listFilterOptions } from "@/lib/evaluationSamples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 필터 드롭다운용 고유값(팀·카테고리·닉네임).
// 샘플 소스가 조직 공통이라 옵션도 공통 → 콜 분석 어느 탭이든 권한이 있으면 허용한다.
// (성장문화실 화이트리스트로만 가드하던 시절, 페이팀 전용 계정이 403을 받아 드롭다운이 통째로 비었다.)
export async function GET(): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response("Unauthorized", { status: 401 });
  if (!await ensureSessionCanAccessAnyCallQuality(session)) return new Response("Forbidden", { status: 403 });

  try {
    return Response.json(await listFilterOptions());
  } catch (err) {
    console.error("[GET /api/call-quality/filter-options]", err);
    // 실패는 500으로 알린다. 200+빈 옵션으로 삼키면 "값이 없어요"와 구분이 안 된다.
    return Response.json({ error: "필터 옵션을 불러오지 못했습니다." }, { status: 500 });
  }
}
