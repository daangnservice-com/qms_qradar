import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { saveTempFile, cleanupTempFile } from "@/lib/audio";
import { runDamageChat } from "@/lib/damageChat";
import { insertChatTurn } from "@/lib/bigquery";
import { trackServerAction } from "@/lib/serverTrack";
import { extOf, imageMimeOf } from "@/lib/imageMime";
import type { DamageParty, DamageResult, DamageChatMessage } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

function parseHistory(raw: string): DamageChatMessage[] {
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((m) => m && (m.role === "user" || m.role === "model") && typeof m.text === "string")
      .slice(-20) // 토큰 방어: 최근 20턴만
      .map((m) => ({ role: m.role as "user" | "model", text: String(m.text) }));
  } catch {
    return [];
  }
}

export async function POST(req: Request): Promise<Response> {
  const temp: string[] = [];
  try {
    const fd = await req.formData();
    const message = String(fd.get("message") ?? "").trim().slice(0, 2000);
    if (!message) return NextResponse.json({ error: "질문을 입력해주세요." }, { status: 400 });

    let result: DamageResult;
    try {
      result = JSON.parse(String(fd.get("result") ?? "")) as DamageResult;
    } catch {
      return NextResponse.json({ error: "판정 결과가 없거나 형식이 올바르지 않아요." }, { status: 400 });
    }
    const history = parseHistory(String(fd.get("history") ?? "[]"));

    // 통합 순서(신청인 먼저)로 원본 사진 재첨부 → 임시파일로 저장 후 Gemini 업로드
    const ordered: { file: File; party: DamageParty }[] = [
      ...fd.getAll("claimantImages").filter((f): f is File => f instanceof File).map((file) => ({ file, party: "claimant" as const })),
      ...fd.getAll("respondentImages").filter((f): f is File => f instanceof File).map((file) => ({ file, party: "respondent" as const })),
    ];
    const images: { path: string; mimeType: string; party: DamageParty }[] = [];
    for (const { file, party } of ordered) {
      const mime = imageMimeOf(file.name);
      if (!mime) continue;
      const bytes = new Uint8Array(await file.arrayBuffer());
      const p = await saveTempFile(bytes, extOf(file.name));
      temp.push(p);
      images.push({ path: p, mimeType: mime, party });
    }

    const reply = await runDamageChat(images, result, history, message);

    // 트래킹: 질문/답변 턴 적재(답변별 평가와 message_id로 연결). 실패해도 응답은 정상 반환.
    const messageId = randomUUID();
    try {
      const session = await getServerSession(authOptions);
      await insertChatTurn({
        messageId,
        email: session?.user?.email ?? "",
        question: message,
        answer: reply,
        verdict: String(result.verdict ?? ""),
        promptVersion: String(result.promptVersion ?? ""),
        model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
      });
    } catch (err) {
      console.error("[chat turn tracking]", err);
    }
    await trackServerAction("/damage", "chat_ask");

    return NextResponse.json({ reply, messageId }, { status: 200 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "답변 생성 중 오류" }, { status: 500 });
  } finally {
    await Promise.all(temp.map((p) => cleanupTempFile(p)));
  }
}
