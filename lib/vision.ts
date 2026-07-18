import { GoogleGenerativeAI, type Schema } from "@google/generative-ai";
import { GoogleAIFileManager, FileState } from "@google/generative-ai/server";
import type { DamageResult, DamageVerdict, BoundingBox } from "./types";

const VERDICTS: DamageVerdict[] = ["파손됨", "정상", "불확실"];

export function buildDamagePrompt(imageCount: number): string {
  return [
    `당신은 중고거래 반품/분쟁을 돕는 상품 파손 판정 전문가입니다. 첨부된 사진 ${imageCount}장은 하나의 상품을 여러 각도에서 찍은 것입니다.`,
    "사물 종류와 무관하게 물리적 손상(긁힘/찍힘/파열·찢어짐/깨짐/오염/변형/부품 누락 등)이 있는지 종합적으로 판정하세요.",
    "",
    "판정 규칙:",
    "- verdict: 파손이 명확하면 '파손됨', 손상이 없으면 '정상', 사진이 불충분하거나 애매하면 '불확실'.",
    "- confidence: 0.0~1.0 확신도.",
    "- summary: 한 줄 종합 소견. '불확실'이면 어떤 사진/각도가 더 필요한지 적으세요.",
    "- findings: 파손 근거 목록(부위 location · 유형 type · 설명 description). '정상'이면 빈 배열.",
    "- 각 finding에는 그 파손이 보이는 사진 번호 photoIndex(0부터)와 바운딩 박스 box를 넣으세요.",
    "  box는 '실제 손상 지점만 타이트하게' 감싸는 정규화 사각형 {ymin, xmin, ymax, xmax}이며, 각 값은 0~1000입니다(이미지 좌상단=0,0, 우하단=1000,1000).",
    "  손·손가락·배경·상품 전체가 아니라, 균열/긁힘/얼룩 등 손상이 보이는 바로 그 영역만 감싸세요. 여러 각도 사진 중 그 손상이 가장 잘 보이는 사진의 photoIndex를 쓰세요.",
    "  위치를 정확히 특정할 수 없으면 box는 반드시 null로 두세요. 부정확한 박스보다 박스 없음(null)이 낫습니다.",
    "- perPhoto: 각 사진(index는 0부터)마다 코멘트(note).",
    "",
    "모든 텍스트는 한국어로. 반드시 지정된 JSON 스키마로만 응답하세요.",
  ].join("\n");
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    verdict: { type: "string", enum: ["파손됨", "정상", "불확실"] },
    confidence: { type: "number" },
    summary: { type: "string" },
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          location: { type: "string" },
          type: { type: "string" },
          description: { type: "string" },
          photoIndex: { type: "integer" },
          box: {
            type: "object",
            nullable: true,
            properties: {
              ymin: { type: "integer" },
              xmin: { type: "integer" },
              ymax: { type: "integer" },
              xmax: { type: "integer" },
            },
            required: ["ymin", "xmin", "ymax", "xmax"],
          },
        },
        required: ["location", "type", "description", "photoIndex"],
      },
    },
    perPhoto: {
      type: "array",
      items: {
        type: "object",
        properties: { index: { type: "integer" }, note: { type: "string" } },
        required: ["index", "note"],
      },
    },
  },
  required: ["verdict", "confidence", "summary", "findings", "perPhoto"],
} as const;

function parseBox(b: unknown): BoundingBox | null {
  if (!b || typeof b !== "object") return null;
  const r = b as Record<string, unknown>;
  const ymin = Number(r.ymin), xmin = Number(r.xmin), ymax = Number(r.ymax), xmax = Number(r.xmax);
  if (![ymin, xmin, ymax, xmax].every((n) => Number.isFinite(n))) return null;
  return { ymin, xmin, ymax, xmax };
}

export function parseDamageResult(jsonText: string): DamageResult {
  const cleaned = jsonText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const o = JSON.parse(cleaned);
  const verdict: DamageVerdict = VERDICTS.includes(o.verdict) ? o.verdict : "불확실";
  return {
    verdict,
    confidence: Number(o.confidence ?? 0),
    summary: String(o.summary ?? ""),
    findings: Array.isArray(o.findings)
      ? o.findings.map((f: { location: string; type: string; description: string; photoIndex?: number; box?: unknown }) => ({
          location: String(f.location),
          type: String(f.type),
          description: String(f.description),
          photoIndex: Number.isFinite(Number(f.photoIndex)) ? Number(f.photoIndex) : 0,
          box: parseBox(f.box),
        }))
      : [],
    perPhoto: Array.isArray(o.perPhoto)
      ? o.perPhoto.map((p: { index: number; note: string }) => ({ index: Number(p.index), note: String(p.note) }))
      : [],
  };
}

export async function runDamageDetection(
  images: { path: string; mimeType: string }[],
): Promise<DamageResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 미설정");
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const fileManager = new GoogleAIFileManager(apiKey);
  const uploadedNames: string[] = [];

  try {
    const parts: { fileData: { fileUri: string; mimeType: string } }[] = [];
    for (let i = 0; i < images.length; i++) {
      const up = await fileManager.uploadFile(images[i].path, {
        mimeType: images[i].mimeType,
        displayName: `img-${i}`,
      });
      uploadedNames.push(up.file.name);
      let file = await fileManager.getFile(up.file.name);
      let attempts = 0;
      while (file.state === FileState.PROCESSING) {
        if (attempts >= 30) throw new Error("Gemini 이미지 처리 시간 초과");
        await new Promise((r) => setTimeout(r, 1000));
        file = await fileManager.getFile(up.file.name);
        attempts++;
      }
      if (file.state === FileState.FAILED) throw new Error("Gemini 이미지 처리 실패");
      parts.push({ fileData: { fileUri: file.uri, mimeType: file.mimeType } });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const gm = genAI.getGenerativeModel({
      model,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA as unknown as Schema,
        temperature: 0, // 좌표 안정성을 위해 결정적으로
      },
    });
    const result = await gm.generateContent([...parts, { text: buildDamagePrompt(images.length) }]);
    return parseDamageResult(result.response.text());
  } finally {
    await Promise.all(uploadedNames.map((n) => fileManager.deleteFile(n).catch(() => {})));
  }
}
