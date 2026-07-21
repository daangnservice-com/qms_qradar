import { GoogleGenerativeAI, type Schema } from "@google/generative-ai";
import { GoogleAIFileManager } from "@google/generative-ai/server";
import { uploadImagesForGemini } from "./geminiFiles";
import type { DamageResult, DamageVerdict, DamageParty, BoundingBox } from "./types";

const VERDICTS: DamageVerdict[] = ["파손됨", "정상", "불확실"];

// 프롬프트/판정 로직 버전. 프롬프트를 의미 있게 바꿀 때마다 올린다.
// 피드백(damage_feedback.prompt_version)과 짝지어 버전별 품질을 비교하기 위함.
export const DAMAGE_PROMPT_VERSION = "v1";

export interface PartyCounts { claimant: number; respondent: number; }

// 통합 인덱스(신청인 사진 먼저, 그 뒤 피신청인)를 party로 역산.
export function partyOfIndex(index: number, counts: PartyCounts): DamageParty {
  return index < counts.claimant ? "claimant" : "respondent";
}

export function buildDamagePrompt(counts: PartyCounts): string {
  const total = counts.claimant + counts.respondent;
  const cEnd = counts.claimant - 1; // 신청인 사진 마지막 인덱스
  const rStart = counts.claimant; // 피신청인 사진 시작 인덱스
  const rEnd = total - 1;
  const range = (n: number, a: number, b: number) =>
    n === 0 ? "없음" : n === 1 ? `사진 ${a}` : `사진 ${a}~${b}`;
  return [
    `당신은 중고거래 반품/분쟁을 돕는 상품 파손 판정 전문가입니다. 첨부된 사진 ${total}장은 분쟁의 양측이 제출한 증거입니다.`,
    `- 신청인(파손을 주장하는 쪽)이 제출: ${range(counts.claimant, 0, cEnd)} (${counts.claimant}장)`,
    `- 피신청인(반박하는 쪽)이 제출: ${range(counts.respondent, rStart, rEnd)} (${counts.respondent}장)`,
    "양측 사진은 같은 상품을 서로 다른 시점·각도·조명에서 찍은 것일 수 있습니다.",
    "사물 종류와 무관하게 물리적 손상(긁힘/찍힘/파열·찢어짐/깨짐/오염/변형/부품 누락 등)이 있는지 양측 사진을 종합해 판정하세요.",
    "",
    "판정 규칙:",
    "- verdict: 파손이 명확하면 '파손됨', 손상이 없으면 '정상', 사진이 불충분하거나 애매하면 '불확실'.",
    "- confidence: 0.0~1.0 확신도.",
    "- summary: 한 줄 종합 소견. '불확실'이면 어떤 사진/각도가 더 필요한지 적으세요.",
    "- comparison: 양측 사진 간 파손 표현의 차이·불일치를 분석하세요. 예: 신청인 사진엔 손상이 보이나 피신청인 사진엔 안 보임, 촬영 각도/조명 차이로 달라 보임, 같은 상품인지 의심되는 정황 등. 한쪽만 제출했거나 특이사항이 없으면 그 사실을 적으세요.",
    "- findings: 파손 근거 목록(부위 location · 유형 type · 설명 description). '정상'이면 빈 배열.",
    "- 각 finding에는 그 파손이 보이는 사진 번호 photoIndex(0부터, 위 통합 번호 기준)와 바운딩 박스 box를 넣으세요.",
    "  box는 '실제 손상 지점만 타이트하게' 감싸는 정규화 사각형 {ymin, xmin, ymax, xmax}이며, 각 값은 0~1000입니다(이미지 좌상단=0,0, 우하단=1000,1000).",
    "  손·손가락·배경·상품 전체가 아니라, 균열/긁힘/얼룩 등 손상이 보이는 바로 그 영역만 감싸세요. 여러 각도 사진 중 그 손상이 가장 잘 보이는 사진의 photoIndex를 쓰세요.",
    "  위치를 정확히 특정할 수 없으면 box는 반드시 null로 두세요. 부정확한 박스보다 박스 없음(null)이 낫습니다.",
    "- perPhoto: 각 사진(index는 0부터, 통합 번호 기준)마다 코멘트(note).",
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
    comparison: { type: "string" },
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
  required: ["verdict", "confidence", "summary", "comparison", "findings", "perPhoto"],
} as const;

function parseBox(b: unknown): BoundingBox | null {
  if (!b || typeof b !== "object") return null;
  const r = b as Record<string, unknown>;
  const ymin = Number(r.ymin), xmin = Number(r.xmin), ymax = Number(r.ymax), xmax = Number(r.xmax);
  if (![ymin, xmin, ymax, xmax].every((n) => Number.isFinite(n))) return null;
  return { ymin, xmin, ymax, xmax };
}

export function parseDamageResult(jsonText: string, counts: PartyCounts): DamageResult {
  const cleaned = jsonText.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const o = JSON.parse(cleaned);
  const verdict: DamageVerdict = VERDICTS.includes(o.verdict) ? o.verdict : "불확실";
  const total = counts.claimant + counts.respondent;
  return {
    verdict,
    confidence: Number(o.confidence ?? 0),
    summary: String(o.summary ?? ""),
    comparison: String(o.comparison ?? ""),
    findings: Array.isArray(o.findings)
      ? o.findings.map((f: { location: string; type: string; description: string; photoIndex?: number; box?: unknown }) => {
          const raw = Number.isFinite(Number(f.photoIndex)) ? Number(f.photoIndex) : 0;
          const inRange = raw >= 0 && raw < total;
          const photoIndex = inRange ? raw : 0;
          return {
            location: String(f.location),
            type: String(f.type),
            description: String(f.description),
            photoIndex,
            party: partyOfIndex(photoIndex, counts),
            // 범위 밖 인덱스는 어느 사진인지 신뢰할 수 없으므로 박스를 그리지 않는다
            // (0으로 클램프한 채 박스를 그리면 엉뚱한(대개 신청인) 사진에 상대측 손상이 표시됨)
            box: inRange ? parseBox(f.box) : null,
          };
        })
      : [],
    perPhoto: Array.isArray(o.perPhoto)
      ? o.perPhoto.map((p: { index: number; note: string }) => ({ index: Number(p.index), note: String(p.note) }))
      : [],
    claimantCount: counts.claimant,
    respondentCount: counts.respondent,
    promptVersion: DAMAGE_PROMPT_VERSION,
  };
}

export async function runDamageDetection(
  images: { path: string; mimeType: string; party: DamageParty }[],
): Promise<DamageResult> {
  // 통합 순서(신청인 먼저, 그 뒤 피신청인)로 party 개수 집계. 인덱스=party 매핑의 기준.
  const counts: PartyCounts = {
    claimant: images.filter((i) => i.party === "claimant").length,
    respondent: images.filter((i) => i.party === "respondent").length,
  };
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 미설정");
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const fileManager = new GoogleAIFileManager(apiKey);
  const uploadedNames: string[] = [];

  try {
    const parts = await uploadImagesForGemini(fileManager, images, uploadedNames);

    const genAI = new GoogleGenerativeAI(apiKey);
    const gm = genAI.getGenerativeModel({
      model,
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA as unknown as Schema,
        temperature: 0, // 좌표 안정성을 위해 결정적으로
      },
    });
    const result = await gm.generateContent([...parts, { text: buildDamagePrompt(counts) }]);
    return parseDamageResult(result.response.text(), counts);
  } finally {
    await Promise.all(uploadedNames.map((n) => fileManager.deleteFile(n).catch(() => {})));
  }
}
