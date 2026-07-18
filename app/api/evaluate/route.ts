import { NextResponse } from "next/server";
import { saveTempFile, cleanupTempFile } from "@/lib/audio";
import { evaluateFile } from "@/lib/evaluate";

export const runtime = "nodejs";
export const maxDuration = 60; // Vercel 배포 시 상한(로컬은 무제한)

export async function POST(req: Request): Promise<Response> {
  let tempPath: string | null = null;
  try {
    const fd = await req.formData();
    const file = fd.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "파일이 없습니다." }, { status: 400 });
    }
    if (!file.name.toLowerCase().endsWith(".m4a")) {
      return NextResponse.json({ error: "m4a 파일만 지원합니다." }, { status: 400 });
    }
    const maxMb = Number(process.env.MAX_UPLOAD_MB ?? 200);
    if (file.size > maxMb * 1024 * 1024) {
      return NextResponse.json({ error: `최대 ${maxMb}MB까지 업로드할 수 있습니다.` }, { status: 400 });
    }

    const raw = Number(fd.get("minSilenceSec") ?? 3);
    const minSilenceSec = Math.min(10, Math.max(1, Number.isFinite(raw) ? raw : 3));
    const noiseDb = Number(process.env.SILENCE_NOISE_DB ?? -30);

    const bytes = new Uint8Array(await file.arrayBuffer());
    tempPath = await saveTempFile(bytes, ".m4a");

    const result = await evaluateFile(tempPath, { minSilenceSec, noiseDb });
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "처리 중 오류" }, { status: 500 });
  } finally {
    if (tempPath) await cleanupTempFile(tempPath);
  }
}
