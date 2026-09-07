import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { canAccessAnyCallQuality } from "@/lib/adminEmails";
import { listHighRiskFlagRules, upsertHighRiskFlagRules } from "@/lib/highRiskFlagStore";
import type { HighRiskFlagKind } from "@/lib/highRiskFlags";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response("Unauthorized", { status: 401 });
  if (!canAccessAnyCallQuality(session.user.email)) return new Response("Forbidden", { status: 403 });

  try {
    const rules = await listHighRiskFlagRules({ seedBy: session.user.email });
    return Response.json({ rules });
  } catch (err) {
    console.error("[GET /api/eval-design/high-risk-flags]", err);
    return Response.json({ error: "고위험군 플래그 조회 실패" }, { status: 500 });
  }
}

export async function PUT(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response("Unauthorized", { status: 401 });
  if (!canAccessAnyCallQuality(session.user.email)) return new Response("Forbidden", { status: 403 });

  try {
    const body = (await req.json().catch(() => ({}))) as {
      rules?: Array<{
        ruleId?: string;
        key: string;
        label: string;
        enabled: boolean;
        kind: HighRiskFlagKind;
        params: {
          percentile?: number | null;
          minMinutes?: number | null;
          minPercent?: number | null;
          metricKey?: string | null;
        };
        sortOrder: number;
      }>;
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
