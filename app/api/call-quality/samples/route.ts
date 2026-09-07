import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";

import { orgFromParam, canAccessOrg } from "@/lib/callQualityOrg";

import { listEvaluationSamples } from "@/lib/evaluationSamples";

import {

  listEvalFlagsByConversationIds,

  listRecentAnalyzedConversationIds,

  listRecentConversationIdsByReview,

} from "@/lib/analysisStore";

import { listHighRiskConversationIds, listHighRiskFlagRules, listLongCallConversationIds } from "@/lib/highRiskFlagStore";

import { listActiveClaimsByConversationIds } from "@/lib/evalReviewClaimStore";

import { cachedEvalSamplesFor, rememberEvalSamples } from "@/lib/evalReviewClaimCache";

import { listMyEvalQueueConversationIds } from "@/lib/evalReviewMine";

import { listRecentConversationIdsWithStt, listSttPresenceByConversationIds } from "@/lib/sttPresence";

import type { SampleFilters } from "@/lib/types";



export const runtime = "nodejs";

export const dynamic = "force-dynamic";



function intersectIds(a: string[], b: string[]): string[] {

  const set = new Set(b);

  return a.filter((id) => set.has(id));

}



function restrictIds(existing: string[] | undefined, pool: string[]): string[] {

  const cur = (existing ?? []).map((s) => s.trim()).filter(Boolean);

  return cur.length ? intersectIds(cur, pool) : pool;

}



// 콜 분석 대상 샘플 목록(BigQuery, 선택적 필터). 조직(탭)별 허용 계정만.

export async function POST(req: Request): Promise<Response> {

  const session = await getServerSession(authOptions);

  if (!session?.user?.email) return new Response("Unauthorized", { status: 401 });



  const body = (await req.json().catch(() => ({}))) as { filters?: SampleFilters; limit?: number; org?: string };

  const org = orgFromParam(body.org);

  if (!canAccessOrg(org, session.user.email)) return new Response("Forbidden", { status: 403 });



  try {

    const raw = Number(body.limit ?? 100);

    const limit = Math.min(Math.max(Number.isFinite(raw) ? raw : 100, 1), 500);

    const incoming = body.filters ?? {};

    let conversationIds = incoming.conversationIds;



    const needAnalyzed = Boolean(incoming.analyzedOnly && !incoming.reviewStatus);

    const needReview =

      incoming.reviewStatus === "completed" || incoming.reviewStatus === "incomplete";

    const needHighRisk = Boolean(incoming.highRiskOnly);

    const needMine = Boolean(incoming.mineOnly);

    const needSttPresent = incoming.sttStatus === "present";



    const [rules, recentAnalyzed, reviewPool, highRiskResult, sttPool] = await Promise.all([

      listHighRiskFlagRules(),

      needAnalyzed ? listRecentAnalyzedConversationIds(org, limit) : Promise.resolve(null as string[] | null),

      needReview

        ? listRecentConversationIdsByReview(org, {

            reviewCompleted: incoming.reviewStatus === "completed",

            limit,

          })

        : Promise.resolve(null as string[] | null),

      needHighRisk

        ? listHighRiskConversationIds(org, {

            limit: Math.max(limit, 500),

            callDateStart: incoming.callDateStart,

            callDateEnd: incoming.callDateEnd,

            teams: incoming.teams,

          })

        : Promise.resolve(null as { ids: string[]; longCallIds: string[] } | null),

      needSttPresent ? listRecentConversationIdsWithStt(limit) : Promise.resolve(null as string[] | null),

    ]);



    const longRule = rules.find((r) => r.enabled && r.kind === "long_call_percentile");

    let longCallIds = new Set<string>();

    if (longRule) {

      const ids = await listLongCallConversationIds({

        percentile: Number(longRule.params.percentile ?? 10),

        minMinutes: longRule.params.minMinutes ?? null,

        limit: Math.max(limit, 500),

        callDateStart: incoming.callDateStart,

        callDateEnd: incoming.callDateEnd,

        teams: incoming.teams,

      });

      longCallIds = new Set(ids);

    }



    if (needAnalyzed) {

      const recent = recentAnalyzed ?? [];

      if (!recent.length) return Response.json({ samples: [] });

      conversationIds = restrictIds(conversationIds, recent);

      if (!conversationIds.length) return Response.json({ samples: [] });

    }



    if (needReview) {

      const pool = reviewPool ?? [];

      if (!pool.length) return Response.json({ samples: [] });

      conversationIds = restrictIds(conversationIds, pool);

      if (!conversationIds.length) return Response.json({ samples: [] });

    }



    if (needMine) {

      const minePool = await listMyEvalQueueConversationIds({

        email: session.user.email,

        org,

        limit: Math.max(limit, 200),

      });

      if (!minePool.length) return Response.json({ samples: [] });

      conversationIds = restrictIds(conversationIds, minePool);

      if (!conversationIds.length) return Response.json({ samples: [] });

    }



    if (needHighRisk && highRiskResult) {

      longCallIds = new Set([...longCallIds, ...highRiskResult.longCallIds]);

      if (!highRiskResult.ids.length) return Response.json({ samples: [] });

      conversationIds = restrictIds(conversationIds, highRiskResult.ids);

      if (!conversationIds.length) return Response.json({ samples: [] });

    }



    if (needSttPresent) {

      const pool = sttPool ?? [];

      if (!pool.length) return Response.json({ samples: [] });

      conversationIds = restrictIds(conversationIds, pool);

      if (!conversationIds.length) return Response.json({ samples: [] });

    }



    const { analyzedOnly: _a, reviewStatus: _r, highRiskOnly: _h, mineOnly: _m, sttStatus: _s, ...rest } = incoming;

    const filters: SampleFilters = {

      ...rest,

      ...(conversationIds ? { conversationIds } : {}),

    };

    const samples = await listEvaluationSamples(filters, limit);

    const sampleIds = samples.map((s) => s.conversationId);

    const [flags, claims, sttPresence] = await Promise.all([

      listEvalFlagsByConversationIds(org, sampleIds),

      listActiveClaimsByConversationIds(sampleIds),

      listSttPresenceByConversationIds(sampleIds),

    ]);



    let withFlags = samples.map((s) => {

      const f = flags.get(s.conversationId);

      const keys = new Set(f?.highRiskFlagKeys ?? []);

      if (longCallIds.has(s.conversationId)) keys.add("long_call");

      const stt = sttPresence.get(s.conversationId);

      return {

        ...s,

        analyzed: flags.has(s.conversationId),

        reviewCompleted: f?.reviewCompleted ?? false,

        aiLabel: f?.aiLabel ?? null,

        humanResult: f?.humanResult ?? null,

        highRiskFlagKeys: [...keys],

        reviewClaimedBy: claims.get(s.conversationId)?.claimedBy ?? null,

        reviewClaimedAt: claims.get(s.conversationId)?.claimedAt ?? null,

        hasStt: stt?.hasStt ?? false,

        sttSource: stt?.sttSource ?? null,

      };

    });

    rememberEvalSamples(withFlags);

    if (needMine && conversationIds?.length) {

      const have = new Set(withFlags.map((s) => s.conversationId));

      const missing = conversationIds.filter((id) => !have.has(id));

      const extras = cachedEvalSamplesFor(missing);

      if (extras.length) {

        const extraIds = extras.map((s) => s.conversationId);

        const [extraFlags, extraClaims, extraStt] = await Promise.all([

          listEvalFlagsByConversationIds(org, extraIds),

          listActiveClaimsByConversationIds(extraIds),

          listSttPresenceByConversationIds(extraIds),

        ]);

        for (const s of extras) {

          const f = extraFlags.get(s.conversationId);

          const keys = new Set(f?.highRiskFlagKeys ?? s.highRiskFlagKeys ?? []);

          if (longCallIds.has(s.conversationId)) keys.add("long_call");

          const stt = extraStt.get(s.conversationId);

          withFlags.push({

            ...s,

            analyzed: extraFlags.has(s.conversationId) || s.analyzed,

            reviewCompleted: f?.reviewCompleted ?? s.reviewCompleted ?? false,

            aiLabel: f?.aiLabel ?? s.aiLabel ?? null,

            humanResult: f?.humanResult ?? s.humanResult ?? null,

            highRiskFlagKeys: [...keys],

            reviewClaimedBy: extraClaims.get(s.conversationId)?.claimedBy ?? s.reviewClaimedBy ?? null,

            reviewClaimedAt: extraClaims.get(s.conversationId)?.claimedAt ?? s.reviewClaimedAt ?? null,

            hasStt: stt?.hasStt ?? s.hasStt ?? false,

            sttSource: stt?.sttSource ?? s.sttSource ?? null,

          });

        }

      }

    }

    if (incoming.sttStatus === "absent") {

      withFlags = withFlags.filter((s) => !s.hasStt);

    }

    return Response.json({ samples: withFlags });

  } catch (err) {

    console.error("[POST /api/call-quality/samples]", err);

    return Response.json({ error: "샘플 목록 조회에 실패했습니다." }, { status: 500 });

  }

}

