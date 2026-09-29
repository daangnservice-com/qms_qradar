import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessQualityEval } from "@/lib/sessionAccessServer";
import { listHighRiskFlagRules, upsertHighRiskFlagRules } from "@/lib/highRiskFlagStore";
import type { HighRiskFlagRule } from "@/lib/highRiskFlags";
import { getOrRefreshLongCallThreshold } from "@/lib/longCallThresholdStore";
import type { LongCallThresholdSnapshot } from "@/lib/longCallThreshold";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response("Unauthorized", { status: 401 });
  if (!await ensureSessionCanAccessQualityEval(session)) return new Response("Forbidden", { status: 403 });

  try {
    // 화면이 채널 탭으로 나눠 보여주므로 전 채널 규칙을 그대로 넘긴다.
    const rules = await listHighRiskFlagRules({ seedBy: session.user.email });
    const longRule = rules.find((r) => r.enabled && r.kind === "long_call_percentile");
    let longCallThreshold: LongCallThresholdSnapshot | null = null;
    if (longRule) {
      longCallThreshold = await getOrRefreshLongCallThreshold({
        percentile: Number(longRule.params.percentile ?? 10),
        ruleKey: longRule.key,
      });
    }
    return Response.json({ rules, longCallThreshold });
  } catch (err) {
    console.error("[GET /api/eval-design/high-risk-flags]", err);
    return Response.json({ error: "고위험군 플래그 조회 실패" }, { status: 500 });
  }
}

export async function PUT(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response("Unauthorized", { status: 401 });
  if (!await ensureSessionCanAccessQualityEval(session)) return new Response("Forbidden", { status: 403 });

  try {
    const body = (await req.json().catch(() => ({}))) as {
      rules?: Array<
        Pick<HighRiskFlagRule, "key" | "label" | "enabled" | "channel" | "kind" | "params" | "sortOrder"> & {
          ruleId?: string;
        }
      >;
    };
    if (!Array.isArray(body.rules) || !body.rules.length) {
      return Response.json({ error: "rules가 필요합니다." }, { status: 400 });
    }
    const rules = await upsertHighRiskFlagRules(body.rules, session.user.email);
    return Response.json({ rules });
  } catch (err) {
    console.error("[PUT /api/eval-design/high-risk-flags]", err);
    return Response.json({ error: "고위험군 플래그 저장 실패" }, { status: 500 });
  }
}
