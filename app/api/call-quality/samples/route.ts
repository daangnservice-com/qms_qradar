import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";

import { ensureSessionCanAccessOrg } from "@/lib/sessionAccessServer";

import { orgFromParam } from "@/lib/callQualityOrg";

import { listEvaluationSamples } from "@/lib/evaluationSamples";

import {

  listEvalFlagsByConversationIds,

  listRecentAnalyzedConversationIds,

  listRecentConversationIdsByReview,

} from "@/lib/analysisStore";

import {

  listConversationIdsByCsatRates,

  listHighRiskConversationIds,

  listHighRiskFlagRules,

} from "@/lib/highRiskFlagStore";

import { resolveDsatRule } from "@/lib/highRiskFlags";

import { isLongCallDuration } from "@/lib/longCallThreshold";

import { getOrRefreshLongCallThreshold } from "@/lib/longCallThresholdStore";

import { isDsatRate, listCsatRatesByPhoneInquiryIds } from "@/lib/csat";

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

  if (!await ensureSessionCanAccessOrg(org, session)) return new Response("Forbidden", { status: 403 });

  try {

    const raw = Number(body.limit ?? 100);

    const limit = Math.min(Math.max(Number.isFinite(raw) ? raw : 100, 1), 500);

    const incoming = body.filters ?? {};

    let conversationIds = incoming.conversationIds;

    const needAnalyzed = Boolean(incoming.analyzedOnly && !incoming.reviewStatus);

    const needReview =

      incoming.reviewStatus === "completed" || incoming.reviewStatus === "incomplete";

    const pickedFlagKeys = (incoming.highRiskFlagKeys ?? []).map((k) => k.trim()).filter(Boolean);

    // 개별 플래그를 하나라도 고르면 그것만, 아니면 「고위험군」 전체 토글을 따른다.

    const needHighRisk = Boolean(incoming.highRiskOnly) || pickedFlagKeys.length > 0;

    const csatRates = (incoming.csatRates ?? []).filter((r) => Number.isInteger(r) && r >= 1 && r <= 5);

    const csatIncludeNone = incoming.csatIncludeNone === true;

    const needCsat = csatRates.length > 0 || csatIncludeNone;

    const needMine = Boolean(incoming.mineOnly);

    const needSttPresent = incoming.sttStatus === "present";

    const [rules, recentAnalyzed, reviewPool, highRiskResult, sttPool, csatPool] = await Promise.all([

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

            keys: pickedFlagKeys,

          })

        : Promise.resolve(null as { ids: string[]; longCallIds: Iterable<string> } | null),

      needSttPresent ? listRecentConversationIdsWithStt(limit) : Promise.resolve(null as string[] | null),

      needCsat

        ? listConversationIdsByCsatRates({

            rates: csatRates,

            includeNone: csatIncludeNone,

            limit: Math.max(limit, 500),

            callDateStart: incoming.callDateStart,

            callDateEnd: incoming.callDateEnd,

            teams: incoming.teams,

          })

        : Promise.resolve(null as string[] | null),

    ]);

    const longRule = rules.find((r) => r.enabled && r.kind === "long_call_percentile");

    const dsatRule = resolveDsatRule(rules);

    // 장콜: 요청마다 percent_rank 대신, 당일 제외 직전 7일 MA 임계분(DB 스냅샷)으로 판정.
    const longCallSnap = longRule
      ? await getOrRefreshLongCallThreshold({
          percentile: Number(longRule.params.percentile ?? 10),
          ruleKey: longRule.key,
        })
      : null;
    const longCallThresholdMinutes = longCallSnap?.thresholdMinutes ?? null;
    const longCallKey = longRule?.key || "long_call";
    const longCallMinMinutes = longRule?.params.minMinutes ?? null;

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



    if (needCsat) {

      const pool = csatPool ?? [];

      if (!pool.length) return Response.json({ samples: [] });

      conversationIds = restrictIds(conversationIds, pool);

      if (!conversationIds.length) return Response.json({ samples: [] });

    }

    const {

      analyzedOnly: _a,

      reviewStatus: _r,

      highRiskOnly: _h,

      highRiskFlagKeys: _hk,

      mineOnly: _m,

      sttStatus: _s,

      csatRates: _cr,

      csatIncludeNone: _cn,

      ...rest

    } = incoming;

    const filters: SampleFilters = {

      ...rest,

      ...(conversationIds ? { conversationIds } : {}),

    };

    const samples = await listEvaluationSamples(filters, limit);

    const sampleIds = samples.map((s) => s.conversationId);

    // CSAT은 상담이력 ID(=inquiry_id)로 붙는다. 설문 미참여 통화는 맵에 없다(정상).

    const [flags, claims, sttPresence, csatRateMap] = await Promise.all([

      listEvalFlagsByConversationIds(org, sampleIds, { liveHuman: false }),

      listActiveClaimsByConversationIds(sampleIds),

      listSttPresenceByConversationIds(sampleIds),

      listCsatRatesByPhoneInquiryIds(samples.map((s) => s.phoneInquiryId)),

    ]);

    let withFlags = samples.map((s) => {

      const f = flags.get(s.conversationId);

      const keys = new Set(f?.highRiskFlagKeys ?? []);

      if (
        longCallThresholdMinutes != null &&
        isLongCallDuration(s.callDurationSec, longCallThresholdMinutes, longCallMinMinutes)
      ) {
        keys.add(longCallKey);
      }

      const csatRate = csatRateMap.get(s.phoneInquiryId) ?? null;

      if (dsatRule.enabled && isDsatRate(csatRate, dsatRule.maxRate)) keys.add(dsatRule.key);

      const stt = sttPresence.get(s.conversationId);

      return {

        ...s,

        csatRate,

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

        const [extraFlags, extraClaims, extraStt, extraCsat] = await Promise.all([

          listEvalFlagsByConversationIds(org, extraIds, { liveHuman: false }),

          listActiveClaimsByConversationIds(extraIds),

          listSttPresenceByConversationIds(extraIds),

          listCsatRatesByPhoneInquiryIds(extras.map((s) => s.phoneInquiryId)),

        ]);

        for (const s of extras) {

          const f = extraFlags.get(s.conversationId);

          const keys = new Set(f?.highRiskFlagKeys ?? s.highRiskFlagKeys ?? []);

          if (
            longCallThresholdMinutes != null &&
            isLongCallDuration(s.callDurationSec, longCallThresholdMinutes, longCallMinMinutes)
          ) {
            keys.add(longCallKey);
          }

          const csatRate = extraCsat.get(s.phoneInquiryId) ?? s.csatRate ?? null;

          if (dsatRule.enabled && isDsatRate(csatRate, dsatRule.maxRate)) keys.add(dsatRule.key);

          const stt = extraStt.get(s.conversationId);

          withFlags.push({

            ...s,

            csatRate,

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



    // 풀은 후보를 좁히는 용도라, 마지막에 실제 뱃지·점수로 한 번 더 거른다.

    if (pickedFlagKeys.length) {

      const want = new Set(pickedFlagKeys);

      withFlags = withFlags.filter((s) => (s.highRiskFlagKeys ?? []).some((k) => want.has(k)));

    }



    if (needCsat) {

      const want = new Set(csatRates);

      withFlags = withFlags.filter((s) =>

        s.csatRate == null ? csatIncludeNone : want.has(Math.round(s.csatRate)),

      );

    }

    return Response.json({ samples: withFlags });

  } catch (err) {

    console.error("[POST /api/call-quality/samples]", err);

    return Response.json({ error: "샘플 목록 조회에 실패했습니다." }, { status: 500 });

  }

}

