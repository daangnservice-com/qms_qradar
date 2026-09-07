import { GoogleGenerativeAI, type Schema } from "@google/generative-ai";
import { CS_CHECKLIST } from "./csChecklist";
import { listCriterionPromptsFor, resolveCriterionLabelMap } from "./criterionStore";
import { annotationReviewNeeded } from "./evalReviewTypes";
import { listRecentEvalReviews } from "./evalReviewStore";
import { logLlmCall } from "./llmCallLog";
import { listLatestQaResults, listQaReferenceSamples } from "./qaStore";
import { compareCriterionScores } from "./scoreDetailParse";
import { cached, SERVER_CACHE_TTL } from "./serverCache";
import { formatPromptFieldText, formatPromptFields } from "./promptFieldFormat";
import type {
  PromptImproveCriterionGroup,
  PromptImproveExample,
  PromptImproveGenerateResult,
  PromptImproveKind,
  PromptImproveSet,
} from "./promptImproveTypes";
import { PROMPT_IMPROVE_KIND_LABEL } from "./promptImproveTypes";
import type { ChecklistResult } from "./types";

function catById(): Map<number, string> {
  return new Map(CS_CHECKLIST.map((c) => [c.id, c.category]));
}

function parseChecklist(json: string): ChecklistResult[] {
  try {
    const v = JSON.parse(json) as ChecklistResult[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/** Train set: QA 레퍼런스 수기 score_detail ≠ AI checklist (FP/FN) */
export async function listTrainMismatchGroups(opts?: {
  criterionId?: number | null;
  limitPerCriterion?: number;
}): Promise<PromptImproveCriterionGroup[]> {
  const limitPer = opts?.limitPerCriterion ?? 40;
  const [refs, latest, labelById] = await Promise.all([
    listQaReferenceSamples(2000),
    listLatestQaResults(),
    resolveCriterionLabelMap(),
  ]);
  const cats = catById();
  const byCrit = new Map<number, PromptImproveExample[]>();

  for (const ref of refs) {
    const qa = latest.get(ref.conversationId);
    if (!qa || qa.error) continue;
    const checklist = parseChecklist(qa.checklistJson);
    if (!checklist.length && !ref.humanScoreItems.length) continue;

    const { rows } = compareCriterionScores({
      humanItems: ref.humanScoreItems,
      aiChecklist: checklist,
      labelById,
    });

    for (const row of rows) {
      if (row.status !== "fp" && row.status !== "fn" && row.status !== "human_only" && row.status !== "ai_only") {
        continue;
      }
      if (opts?.criterionId != null && row.id !== opts.criterionId) continue;

      const kind: PromptImproveKind = row.status === "fp" || row.status === "ai_only" ? "fp" : "fn";
      const aiItem = checklist.find((c) => c.id === row.id);
      const humanItem = ref.humanScoreItems.find((h) => h.id === row.id);
      const quote = aiItem?.evidence?.[0]?.quote ?? null;
      const atSec = aiItem?.evidence?.[0]?.atSec ?? null;

      const ex: PromptImproveExample = {
        id: `train:${ref.conversationId}:${row.id}:${kind}`,
        set: "train",
        kind,
        criterionId: row.id,
        criterionLabel: row.label || labelById.get(row.id) || String(row.id),
        category: cats.get(row.id) ?? "",
        conversationId: ref.conversationId,
        humanNote: humanItem
          ? `수기 부적합: ${humanItem.raw}`
          : kind === "fn"
            ? "수기 score_detail에 해당 항목 있음"
            : "수기 score_detail에 해당 항목 없음",
        aiNote: aiItem
          ? `AI violated=${aiItem.violated} · ${aiItem.reason || "(reason 없음)"}`
          : "AI checklist에 항목 없음",
        quote,
        atSec,
        updatedAt: qa.analyzedAt,
      };

      const list = byCrit.get(row.id) ?? [];
      if (list.length < limitPer) {
        list.push(ex);
        byCrit.set(row.id, list);
      }
    }
  }

  return groupsFromMap(byCrit, labelById, cats);
}

/** Test set: 평가 진행 수기 리뷰 — AI 정정 / 수기 추가 */
export async function listTestMismatchGroups(opts?: {
  criterionId?: number | null;
  limitPerCriterion?: number;
}): Promise<PromptImproveCriterionGroup[]> {
  const limitPer = opts?.limitPerCriterion ?? 40;
  const [reviews, labelById] = await Promise.all([
    listRecentEvalReviews(3000),
    resolveCriterionLabelMap(),
  ]);
  const cats = catById();
  const byCrit = new Map<number, PromptImproveExample[]>();

  for (const r of reviews) {
    let kind: PromptImproveKind | null = null;
    if (r.source === "human") {
      if (r.judgment === "best") continue; // Best 마크는 별도 페이지에서 모음
      kind = "human_added";
    } else if (r.source === "ai") {
      const aiSaidNeeded = r.aiViolated === true;
      const needed = annotationReviewNeeded(r);
      if (aiSaidNeeded && !needed) kind = "ai_corrected_fp";
      else if (!aiSaidNeeded && needed) kind = "ai_corrected_fn";
      else if (aiSaidNeeded && needed && r.judgment === "hot") kind = "considered_hot";
      else continue;
    }
    if (!kind) continue;
    if (opts?.criterionId != null && r.criterionId !== opts.criterionId) continue;

    const label = labelById.get(r.criterionId) || String(r.criterionId);
    const ex: PromptImproveExample = {
      id: `test:${r.annotationId}`,
      set: "test",
      kind,
      criterionId: r.criterionId,
      criterionLabel: label,
      category: cats.get(r.criterionId) ?? "",
      conversationId: r.conversationId,
      humanNote: [
        `수기 검토: ${annotationReviewNeeded(r) ? "필요" : "불필요"}`,
        r.judgment !== "best" ? `최종: ${r.judgment.toUpperCase()}` : null,
        r.comment ? `코멘트: ${r.comment}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      aiNote:
        r.source === "ai"
          ? `AI violated=${r.aiViolated} · ${r.aiReason || "(reason 없음)"}`
          : "AI 미감지(수기 추가)",
      quote: r.quote ?? r.aiQuote,
      atSec: Number.isFinite(r.atSec) ? r.atSec : null,
      updatedAt: r.updatedAt,
    };

    const list = byCrit.get(r.criterionId) ?? [];
    if (list.length < limitPer) {
      list.push(ex);
      byCrit.set(r.criterionId, list);
    }
  }

  return groupsFromMap(byCrit, labelById, cats);
}

export async function listMismatchGroups(
  set: PromptImproveSet,
  opts?: { criterionId?: number | null },
): Promise<PromptImproveCriterionGroup[]> {
  const crit = opts?.criterionId ?? "all";
  return cached(`mismatch:${set}:${crit}`, SERVER_CACHE_TTL.mismatchGroups, () =>
    set === "train" ? listTrainMismatchGroups(opts) : listTestMismatchGroups(opts),
  );
}

function groupsFromMap(
  byCrit: Map<number, PromptImproveExample[]>,
  labelById: Map<number, string>,
  cats: Map<number, string>,
): PromptImproveCriterionGroup[] {
  const out: PromptImproveCriterionGroup[] = [];
  for (const [criterionId, examples] of byCrit) {
    const counts: PromptImproveCriterionGroup["counts"] = {};
    for (const e of examples) {
      counts[e.kind] = (counts[e.kind] ?? 0) + 1;
    }
    out.push({
      criterionId,
      label: examples[0]?.criterionLabel || labelById.get(criterionId) || String(criterionId),
      category: examples[0]?.category || cats.get(criterionId) || "",
      counts,
      examples,
    });
  }
  out.sort((a, b) => b.examples.length - a.examples.length || a.criterionId - b.criterionId);
  return out;
}

function formatExamplesForPrompt(examples: PromptImproveExample[]): string {
  return examples
    .map((e, i) => {
      const lines = [
        `### 사례 ${i + 1} [${PROMPT_IMPROVE_KIND_LABEL[e.kind]}]`,
        `- conversation: ${e.conversationId}`,
        `- 수기: ${e.humanNote}`,
        `- AI: ${e.aiNote}`,
      ];
      if (e.quote) lines.push(`- quote: "${e.quote}"`);
      if (e.atSec != null) lines.push(`- atSec: ${e.atSec}`);
      return lines.join("\n");
    })
    .join("\n\n");
}

/** 불일치 사례 + 기존 항목 프롬프트 → 개선 초안 생성 */
export async function generateImprovedCriterionPrompt(input: {
  criterionId: number;
  examples: PromptImproveExample[];
  /** 특정 프롬프트 버전. 없으면 해당 기준 최신 */
  promptId?: string | null;
  currentFields?: Record<string, string> | null;
  userNote?: string | null;
  conversationId?: string | null;
}): Promise<PromptImproveGenerateResult> {
  if (!input.examples.length) throw new Error("개선에 사용할 불일치 사례가 없습니다");

  const versions = await listCriterionPromptsFor(input.criterionId);
  const selected =
    (input.promptId ? versions.find((v) => v.promptId === input.promptId) : null) ??
    versions.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0] ??
    null;

  const label =
    selected?.label ||
    input.examples[0]?.criterionLabel ||
    CS_CHECKLIST.find((c) => c.id === input.criterionId)?.label ||
    String(input.criterionId);
  const category =
    selected?.category ||
    input.examples[0]?.category ||
    CS_CHECKLIST.find((c) => c.id === input.criterionId)?.category ||
    "";

  const currentFields =
    input.currentFields && Object.keys(input.currentFields).length
      ? input.currentFields
      : (selected?.fields ?? {});

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY 미설정");
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

  const schema = {
    type: "object",
    properties: {
      definition: { type: "string", description: "항목 정의(판정 기준)" },
      good: { type: "string", description: "좋은 사례(위반 아님)" },
      bad: { type: "string", description: "나쁜 사례(위반)" },
      exception: { type: "string", description: "해당 없음 예외(AI가 검출하지 않을 조건)" },
      rationale: { type: "string", description: "이번 수정 이유 요약(한국어)" },
    },
    required: ["definition", "good", "bad", "exception", "rationale"],
  } as unknown as Schema;

  const system = [
    "당신은 CS 콜 품질 평가용 AI 체크리스트 프롬프트 엔지니어입니다.",
    "목표: 수기 평가와 AI 평가의 불일치를 줄이도록 항목 프롬프트(definition/good/bad/exception)를 개선합니다.",
    "규칙:",
    "- 기존 프롬프트의 의도를 유지하되, 제공된 불일치 사례에서 드러난 오탐/미탐 패턴을 반영하세요.",
    "- FP(AI만 위반): 정의·나쁜사례를 좁히거나 예외를 명확히 해 과탐을 줄이세요.",
    "- FN/수기추가(수기만 위반): 정의·나쁜사례를 보강해 미탐을 줄이세요.",
    "- 모든 필드는 한국어. 구체적·검증 가능한 문구. 추측으로 새 정책을 만들지 마세요.",
    "- quote가 있으면 그 발화 패턴을 good/bad/exception에 반영하세요.",
    "- 서식: 각 필드 문자열에 실제 줄바꿈(\\n)을 넣으세요. 문장·조건·예시·예외를 한 줄에 몰아쓰지 말고 항목별로 줄을 나누세요.",
    "  예) 정의는 판정 요지 / 세부 조건 / 근거 요구를 줄바꿈으로 구분. good·bad는 사례마다 줄바꿈.",
  ].join("\n");

  const userPrompt = [
    `평가 항목: [${input.criterionId}] (${category}) ${label}`,
    "",
    "## 현재 프롬프트 필드",
    JSON.stringify(currentFields, null, 2),
    "",
    "## 불일치 사례 (수기 ≠ AI)",
    formatExamplesForPrompt(input.examples),
    "",
    input.userNote?.trim() ? `## 추가 지시\n${input.userNote.trim()}\n` : "",
    "위 사례를 반영한 개선 프롬프트 필드를 JSON으로 출력하세요.",
  ]
    .filter(Boolean)
    .join("\n");

  const genAI = new GoogleGenerativeAI(apiKey);
  const gm = genAI.getGenerativeModel({
    model,
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: schema,
    },
  });

  const t0 = Date.now();
  try {
    const result = await gm.generateContent(`${system}\n\n${userPrompt}`);
    const latencyMs = Date.now() - t0;
    const text = result.response.text();
    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(text) as Record<string, string>;
    } catch {
      throw new Error("LLM 응답 JSON 파싱 실패");
    }

    const fields: Record<string, string> = formatPromptFields({
      definition: String(parsed.definition ?? ""),
      good: String(parsed.good ?? ""),
      bad: String(parsed.bad ?? ""),
      exception: String(parsed.exception ?? ""),
    });
    // 기존에 있던 커스텀 필드 키는 유지(값 없으면 기존 유지)
    for (const [k, v] of Object.entries(currentFields)) {
      if (!(k in fields)) fields[k] = formatPromptFieldText(v);
    }

    const usage = result.response.usageMetadata;
    const llmCallId = await logLlmCall({
      purpose: "prompt_improve",
      conversationId: input.conversationId ?? input.examples[0]?.conversationId ?? null,
      meta: {
        model,
        latencyMs,
        promptTokenCount: usage?.promptTokenCount ?? null,
        candidatesTokenCount: usage?.candidatesTokenCount ?? null,
        totalTokenCount: usage?.totalTokenCount ?? null,
      },
    });

    return {
      fields,
      rationale: String(parsed.rationale ?? ""),
      model,
      llmCallId,
    };
  } catch (e) {
    const latencyMs = Date.now() - t0;
    const errMsg = e instanceof Error ? e.message : String(e);
    await logLlmCall({
      purpose: "prompt_improve",
      conversationId: input.conversationId ?? input.examples[0]?.conversationId ?? null,
      meta: { model, latencyMs, error: errMsg },
    });
    throw e;
  }
}
