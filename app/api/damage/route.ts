import { NextResponse } from "next/server";
import { saveTempFile, cleanupTempFile } from "@/lib/audio";
import { runDamageDetection } from "@/lib/vision";
import type { DamageParty } from "@/lib/types";
import { PARTY_LABEL } from "@/lib/types";
import { extOf, imageMimeOf } from "@/lib/imageMime";
import { trackServerAction } from "@/lib/serverTrack";
import { numEnv } from "@/lib/env";

export const runtime = "nodejs";
export const maxDuration = 60; // Vercel 배포 시 상한(로컬은 무제한)

export async function POST(req: Request): Promise<Response> {
  const temp: string[] = [];
  try {
    const fd = await req.formData();
    const claimant = fd.getAll("claimantImages").filter((f): f is File => f instanceof File);
    const respondent = fd.getAll("respondentImages").filter((f): f is File => f instanceof File);
    if (claimant.length + respondent.length === 0) {
      return NextResponse.json({ error: "신청인 또는 피신청인 사진을 1장 이상 올려주세요." }, { status: 400 });
    }
    const maxPerParty = numEnv("MAX_IMAGES_PER_PARTY", 5);
    for (const [party, files] of [["claimant", claimant], ["respondent", respondent]] as const) {
      if (files.length > maxPerParty) {
        return NextResponse.json(
          { error: `${PARTY_LABEL[party]} 사진은 최대 ${maxPerParty}장까지 올릴 수 있어요.` },
          { status: 400 },
        );
      }
    }
    const maxMb = numEnv("MAX_IMAGE_MB", 10);

    // 통합 순서: 신청인 사진 먼저, 그 뒤 피신청인 (photoIndex 역산 기준)
    const ordered: { file: File; party: DamageParty }[] = [
      ...claimant.map((file) => ({ file, party: "claimant" as const })),
      ...respondent.map((file) => ({ file, party: "respondent" as const })),
    ];

    const images: { path: string; mimeType: string; party: DamageParty }[] = [];
    for (const { file, party } of ordered) {
      const mime = imageMimeOf(file.name);
      if (!mime) {
        return NextResponse.json({ error: `${file.name} — jpg/png/webp만 지원합니다.` }, { status: 400 });
      }
      if (file.size > maxMb * 1024 * 1024) {
        return NextResponse.json({ error: `${file.name} — 최대 ${maxMb}MB까지 가능합니다.` }, { status: 400 });
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const p = await saveTempFile(bytes, extOf(file.name));
      temp.push(p);
      images.push({ path: p, mimeType: mime, party });
    }

    const result = await runDamageDetection(images);
    await trackServerAction("/damage", "damage_detect");
    return NextResponse.json(result, { status: 200 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "처리 중 오류" }, { status: 500 });
  } finally {
    await Promise.all(temp.map((p) => cleanupTempFile(p)));
  }
}
