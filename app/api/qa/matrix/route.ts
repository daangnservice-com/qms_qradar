import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessAnyCallQuality } from "@/lib/sessionAccessServer";
import { resolveCriterionLabelMap } from "@/lib/criterionStore";
import {
  buildConfusionMatrix,
  buildCriterionAccuracy,
  listUsedQaPromptVersions,
} from "@/lib/qaStore";
import { getProductionPrompt, listPromptVersions } from "@/lib/promptStore";

export const runtime = "nodejs";
export const maxDuration = 60;

const TEMPLATE_KEY = "call_eval_growth" as const;

export async function GET(req: Request) {
  const session = await getServerSession(authOptions);
  if (!await ensureSessionCanAccessAnyCallQuality(session)) {
    return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
  }
  try {
    const url = new URL(req.url);
    const requested = (url.searchParams.get("promptVersionId") ?? "").trim() || null;

    const [labelById, used, versions, production] = await Promise.all([
      resolveCriterionLabelMap(),
      listUsedQaPromptVersions(),
      listPromptVersions(TEMPLATE_KEY, { ensure: false }).catch(() => []),
      getProductionPrompt(TEMPLATE_KEY, { ensure: false }).catch(() => null),
    ]);

    const meta = new Map(versions.map((v) => [v.versionId, v]));
    const prodId = production?.version.versionId ?? null;
    const sheets = used.map((u) => {
      const v = meta.get(u.versionId);
      return {
        versionId: u.versionId,
        versionLabel: v?.versionLabel || u.versionId.slice(0, 8),
        status: v?.status ?? null,
        resultCount: u.resultCount,
        isProduction: Boolean(prodId && u.versionId === prodId),
      };
    });

    // 요청 없으면 production(결과가 있는 경우) → 첫 사용 평가표 → null(전체 최신)
    let promptVersionId = requested;
    if (!promptVersionId) {
      const prodInSheets = prodId ? sheets.find((s) => s.versionId === prodId) : null;
      promptVersionId = prodInSheets?.versionId ?? sheets[0]?.versionId ?? null;
    } else if (promptVersionId === "all") {
      promptVersionId = null;
    } else if (sheets.length && !sheets.some((s) => s.versionId === promptVersionId)) {
      const prodInSheets = prodId ? sheets.find((s) => s.versionId === prodId) : null;
      promptVersionId = prodInSheets?.versionId ?? sheets[0]?.versionId ?? null;
    }

    const [matrix, byCriterion] = await Promise.all([
      buildConfusionMatrix({ promptVersionId }),
      buildCriterionAccuracy(labelById, { promptVersionId }),
    ]);
    return NextResponse.json({
      matrix,
      byCriterion,
      sheets,
      selectedPromptVersionId: promptVersionId,
      productionVersionId: prodId,
    });
  } catch (e) {
    console.error("[api/qa/matrix]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
