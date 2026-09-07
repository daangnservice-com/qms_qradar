import { NextResponse } from "next/server";
import { requireEvalOps } from "@/lib/evalOpsAuth";
import { controlLocalStt } from "@/lib/localSttClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 로컬 STT 서버 유휴 창 무시 / 일시정지. 테스트·급한 처리용. */
export async function POST(req: Request) {
  const gate = await requireEvalOps("full");
  if (!gate.ok) return gate.response;
  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  try {
    const result = await controlLocalStt({
      overrideMinutes: raw.overrideMinutes == null ? undefined : Number(raw.overrideMinutes),
      pause: typeof raw.pause === "boolean" ? raw.pause : undefined,
    });
    return NextResponse.json({ ok: true, gate: result });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
