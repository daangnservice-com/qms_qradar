import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { canAccessAnyCallQuality } from "@/lib/adminEmails";
import { listQaReferenceSamples, listLatestQaResults } from "@/lib/qaStore";
import { getProductionPrompt, listPromptVersions, ensurePromptTables } from "@/lib/promptStore";
import { growthBq } from "@/lib/bqRefs";
import { classifyMatchGrade, MATCH_GRADE_LABEL, type MatchGrade } from "@/lib/scoreDetailParse";
import type { ChecklistResult } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const TEMPLATE_KEY = "call_eval_growth" as const;

function parseChecklist(json: string): ChecklistResult[] {
  try {
    const v = JSON.parse(json) as ChecklistResult[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!canAccessAnyCallQuality(session?.user?.email)) {
    return NextResponse.json({ error: "권한이 없습니다" }, { status: 403 });
  }
  try {
    // ensure 1회만 → ALTER 폭주 방지. 이후 읽기는 ensure:false
    await ensurePromptTables();
    const [refs, latest, production, versions] = await Promise.all([
      listQaReferenceSamples(),
      listLatestQaResults(),
      getProductionPrompt(TEMPLATE_KEY, { ensure: false }),
      listPromptVersions(TEMPLATE_KEY, { ensure: false }),
    ]);

    const labelById = new Map(versions.map((v) => [v.versionId, v.versionLabel]));
    const currentVersionId = production.version.versionId;

    const gradeCounts: Record<MatchGrade, number> = {
      full: 0,
      partial_items: 0,
      result_only: 0,
      result_mismatch: 0,
      unevaluated: 0,
    };

    const samples = refs.map((r) => {
      const qa = latest.get(r.conversationId) ?? null;
      const promptVersionId = qa?.promptVersionId ?? null;
      const promptVersionLabel = promptVersionId
        ? (labelById.get(promptVersionId) ?? promptVersionId.slice(0, 8))
        : null;
      const isCurrentSheet = Boolean(
        promptVersionId && currentVersionId && promptVersionId === currentVersionId,
      );

      const checklist = qa ? parseChecklist(qa.checklistJson) : [];
      const humanItemIds = r.humanScoreItems.map((h) => h.id);
      const aiViolatedIds = checklist.filter((c) => c.violated).map((c) => c.id);
      const matchGrade = classifyMatchGrade({
        humanResult: r.humanResult,
        aiLabel: qa?.aiLabel ?? null,
        humanItemIds,
        aiViolatedIds,
        hasAiResult: Boolean(qa && !qa.error),
      });
      gradeCounts[matchGrade] += 1;

      return {
        conversationId: r.conversationId,
        phoneInquiryId: r.phoneInquiryId,
        humanResult: r.humanResult,
        aiLabel: qa?.aiLabel ?? null,
        match: qa?.match ?? null,
        matchGrade,
        matchGradeLabel: MATCH_GRADE_LABEL[matchGrade],
        itemOverlap: aiViolatedIds.filter((id) => humanItemIds.includes(id)).length,
        humanItemCount: humanItemIds.length,
        aiItemCount: aiViolatedIds.length,
        qaRunId: qa?.qaRunId ?? null,
        analyzedAt: qa?.analyzedAt ?? null,
        error: qa?.error ?? null,
        hasQaResult: Boolean(qa),
        promptVersionId,
        promptVersionLabel,
        isCurrentSheet,
        isStaleSheet: Boolean(qa && promptVersionId && !isCurrentSheet),
      };
    });

    return NextResponse.json({
      samples,
      gradeCounts,
      source: growthBq.qaReferencesView
        ? `${growthBq.projectId}.${growthBq.qaReferencesView}`
        : "",
      activeSheet: {
        templateKey: TEMPLATE_KEY,
        versionId: production.version.versionId,
        versionLabel: production.version.versionLabel,
        status: production.version.status,
        changeNote: production.version.changeNote,
        createdAt: production.version.createdAt,
        createdBy: production.version.createdBy,
        criteriaCount: production.criteria?.length ?? 0,
      },
      sheets: versions.map((v) => ({
        versionId: v.versionId,
        versionLabel: v.versionLabel,
        status: v.status,
        changeNote: v.changeNote,
        createdAt: v.createdAt,
        isProduction: v.versionId === currentVersionId,
        criteriaCount: (() => {
          try {
            const c = JSON.parse(v.criteriaJson || "[]") as unknown[];
            return Array.isArray(c) ? c.length : 0;
          } catch {
            return 0;
          }
        })(),
      })),
    });
  } catch (e) {
    console.error("[api/qa/samples]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
