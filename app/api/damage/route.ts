import { NextResponse } from "next/server";
import { saveTempFile, cleanupTempFile } from "@/lib/audio";
import { runDamageDetection } from "@/lib/vision";
import { numEnv } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 60; // Vercel 배포 시 상한(로컬은 무제한)

const ALLOWED = new Map<string, string>([
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
]);

function extOf(name: string): string {
  const m = name.toLowerCase().match(/\.[a-z0-9]+$/);
  return m ? m[0] : "";
}

export async function POST(req: Request): Promise<Response> {
  const temp: string[] = [];
  try {
    const fd = await req.formData();
    const files = fd.getAll("images").filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return NextResponse.json({ error: "이미지를 1장 이상 올려주세요." }, { status: 400 });
    }
    const maxImages = numEnv("MAX_IMAGES", 8);
    if (files.length > maxImages) {
      return NextResponse.json({ error: `이미지는 최대 ${maxImages}장까지 올릴 수 있어요.` }, { status: 400 });
    }
    const maxMb = numEnv("MAX_IMAGE_MB", 10);

    const images: { path: string; mimeType: string }[] = [];
    for (const f of files) {
      const mime = ALLOWED.get(extOf(f.name));
      if (!mime) {
        return NextResponse.json({ error: `${f.name} — jpg/png/webp만 지원합니다.` }, { status: 400 });
      }
      if (f.size > maxMb * 1024 * 1024) {
        return NextResponse.json({ error: `${f.name} — 최대 ${maxMb}MB까지 가능합니다.` }, { status: 400 });
      }
      const bytes = new Uint8Array(await f.arrayBuffer());
      const p = await saveTempFile(bytes, extOf(f.name));
      temp.push(p);
      images.push({ path: p, mimeType: mime });
    }

    const result = await runDamageDetection(images);
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "처리 중 오류" }, { status: 500 });
  } finally {
    await Promise.all(temp.map((p) => cleanupTempFile(p)));
  }
}
