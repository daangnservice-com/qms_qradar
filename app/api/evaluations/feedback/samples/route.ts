import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessEvalProgress } from "@/lib/sessionAccessServer";
import {
  FEEDBACK_SOURCE_SYSTEM,
  listFeedbackSamples,
  type FeedbackListFilters,
} from "@/lib/feedbackSamples";
import { listLatestEvaluationItemResults } from "@/lib/evaluationItemResultStore";
import { listHighRiskFlagRules } from "@/lib/highRiskFlagStore";
import { feedbackHighRiskCountPredicates, matchFeedbackHighRiskFlags } from "@/lib/highRiskFlags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  filters?: FeedbackListFilters;
  limit?: number;
};

/** 인앱 문의 스레드 목록. 전화 전용 call-quality 샘플 API와 분리한다. */
export async function POST(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!await ensureSessionCanAccessEvalProgress(session)) {
    return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
  }

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다" }, { status: 400 });
  }

  try {
    const rawLimit = Number(body.limit ?? 100);
    const limit = Math.min(Math.max(Number.isFinite(rawLimit) ? rawLimit : 100, 1), 500);
    // analyzedOnly는 평가 결과 병합 후. 고위험군 건수는 원천 컬럼으로 SQL에서 먼저 좁힌다.
    const {
      analyzedOnly,
      highRiskOnly,
      highRiskFlagKeys,
      highRiskCountAny: _clientHighRiskCount,
      ...restFilters
    } = body.filters ?? {};
    const pickedKeyList = (highRiskFlagKeys ?? []).map((key) => key.trim()).filter(Boolean);
    const needHighRisk = Boolean(highRiskOnly) || pickedKeyList.length > 0;
    const sqlFilters: FeedbackListFilters = { ...restFilters };

    const rules = await listHighRiskFlagRules({ channel: "feedback" }).catch((error) => {
      // 플래그는 부가 정보 — 실패해도 목록 자체는 살아 있어야 한다.
      console.warn("[feedback samples] highRiskFlags:", error instanceof Error ? error.message : error);
      return [];
    });

    if (needHighRisk) {
      const predicates = feedbackHighRiskCountPredicates(rules, pickedKeyList);
      if (!predicates.length) {
        return NextResponse.json({
          channel: "feedback",
          sourceSystem: FEEDBACK_SOURCE_SYSTEM,
          rules,
          samples: [],
        });
      }
      sqlFilters.highRiskCountAny = predicates.map(({ countTarget, minCount }) => ({
        countTarget,
        minCount,
      }));
    }

    const samples = await listFeedbackSamples(sqlFilters, limit);
    const results = await listLatestEvaluationItemResults(
      samples.map((sample) => ({
        channel: "feedback" as const,
        sourceSystem: sample.sourceSystem,
        sourceId: sample.sourceId,
      })),
    );
    const listed = samples.map((sample) => {
      const result = results.get(`feedback:${sample.sourceSystem}:${sample.sourceId}`);
      return {
        ...sample,
        analyzed: Boolean(result),
        analysisId: result?.analysisId ?? null,
        analyzedAt: result?.analyzedAt ?? null,
        aiLabel: result?.aiLabel ?? null,
        highRiskFlags: matchFeedbackHighRiskFlags(rules, sample),
      };
    });

    const pickedKeys = new Set(pickedKeyList);
    const filtered = listed.filter((sample) => {
      if (analyzedOnly && !sample.analyzed) return false;
      if (pickedKeys.size) return sample.highRiskFlags.some((hit) => pickedKeys.has(hit.key));
      if (highRiskOnly) return sample.highRiskFlags.length > 0;
      return true;
    });

    return NextResponse.json({
      channel: "feedback",
      sourceSystem: FEEDBACK_SOURCE_SYSTEM,
      rules,
      samples: filtered,
    });
  } catch (error) {
    console.error("[POST /api/evaluations/feedback/samples]", error);
    return NextResponse.json({ error: "인앱 문의 샘플 조회에 실패했습니다." }, { status: 500 });
  }
}
