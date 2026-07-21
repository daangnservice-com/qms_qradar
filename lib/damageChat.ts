import { GoogleGenerativeAI } from "@google/generative-ai";
import { GoogleAIFileManager } from "@google/generative-ai/server";
import { uploadImagesForGemini } from "./geminiFiles";
import type { DamageResult, DamageParty, DamageChatMessage } from "./types";
import { PARTY_LABEL } from "./types";

// 판정 결과 + 사진을 근거로, 사용자가 "왜 이렇게 판단했는지" 등을 물을 수 있는 멀티턴 챗봇.
// 서버는 stateless이므로 매 요청에서 원본 사진을 다시 업로드해 시각적으로 재검토한다.

export function buildChatContext(result: DamageResult): string {
  // 사용자 화면과 동일하게 '파당 로컬 번호'(각 측 1부터)로 사진을 지칭한다.
  // 통합 photoIndex(신청인 먼저)를 파당 번호로 환산.
  const localNo = (f: DamageResult["findings"][number]) =>
    (f.party === "respondent" ? f.photoIndex - result.claimantCount : f.photoIndex) + 1;
  const findings = result.findings.length
    ? result.findings
        .map((f, i) => `  ${i + 1}. ${PARTY_LABEL[f.party]} 사진 ${localNo(f)} · ${f.location} · ${f.type} · ${f.description}`)
        .join("\n")
    : "  (없음)";
  const order = [
    result.claimantCount > 0 ? `신청인 ${result.claimantCount}장(신청인 사진 1~${result.claimantCount})` : null,
    result.respondentCount > 0 ? `피신청인 ${result.respondentCount}장(피신청인 사진 1~${result.respondentCount})` : null,
  ]
    .filter(Boolean)
    .join(", 이어서 ");
  return [
    "당신은 방금 아래 파손 판별을 수행한 AI입니다. 첨부된 사진과 이 판정 결과를 근거로, 사용자(분쟁조정 담당자)의 추가 질문에 답하세요.",
    `사진은 ${order} 순서로 첨부되어 있습니다. 사용자가 '신청인 사진 N' 또는 '피신청인 사진 N'이라고 하면 그 측에서 N번째로 첨부된 사진을 가리킵니다.`,
    "",
    `판정: ${result.verdict} (신뢰도 ${Math.round(result.confidence * 100)}%)`,
    `종합 소견: ${result.summary}`,
    `양측 비교: ${result.comparison || "(없음)"}`,
    "파손 근거:",
    findings,
    "",
    "답변 규칙:",
    "- 첨부 사진을 실제로 다시 살펴보고, 판정의 근거를 구체적으로 설명하세요.",
    "- 결과와 다른 소견이 보이면 솔직히 인정하고 정정하세요. 확신이 없으면 불확실하다고 말하세요.",
    "- 분쟁조정에 도움이 되도록 간결하고 사실 기반으로. 모든 답변은 한국어로.",
  ].join("\n");
}

export async function runDamageChat(
  images: { path: string; mimeType: string; party: DamageParty }[],
  result: DamageResult,
  history: DamageChatMessage[],
  message: string,
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 미설정");
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  const fileManager = new GoogleAIFileManager(apiKey);

  const names: string[] = [];
  try {
    const imageParts = await uploadImagesForGemini(fileManager, images, names);
    const genAI = new GoogleGenerativeAI(apiKey);
    const gm = genAI.getGenerativeModel({ model });

    // 사진 + 판정 컨텍스트를 첫 user 턴에 고정(그라운딩), 이어서 대화 히스토리, 마지막에 새 질문.
    const contents = [
      { role: "user" as const, parts: [...imageParts, { text: buildChatContext(result) }] },
      { role: "model" as const, parts: [{ text: "사진과 판정 결과를 확인했습니다. 무엇이 궁금하신가요?" }] },
      ...history.map((m) => ({ role: m.role, parts: [{ text: m.text }] })),
      { role: "user" as const, parts: [{ text: message }] },
    ];
    const res = await gm.generateContent({ contents });
    return res.response.text();
  } finally {
    await Promise.all(names.map((n) => fileManager.deleteFile(n).catch(() => {})));
  }
}
