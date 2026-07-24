import type { EvaluationResult } from "@/lib/types";
import { maskPII } from "@/lib/pii";
import ScoreCard from "./ScoreCard";
import ReportView from "./ReportView";
import ChecklistView from "./ChecklistView";
import SilenceTimeline from "./SilenceTimeline";
import Transcript from "./Transcript";

export default function ResultView({ result, org }: { result: EvaluationResult; org?: string }) {
  // 표시 경계에서 PII 마스킹(멱등). 신규 저장분은 이미 마스킹됨, 기존 원본 저장분은 여기서 가려짐.
  // Transcript는 자체적으로 세그먼트를 마스킹하므로 여기선 채점 텍스트만 처리.
  const ev = result.evaluation;
  const e = {
    ...ev,
    scores: {
      attitude: { ...ev.scores.attitude, comment: maskPII(ev.scores.attitude.comment) },
      resolution: { ...ev.scores.resolution, comment: maskPII(ev.scores.resolution.comment) },
      flow: { ...ev.scores.flow, comment: maskPII(ev.scores.flow.comment) },
    },
    overallSummary: maskPII(ev.overallSummary),
    silenceComments: ev.silenceComments.map((c) => ({ ...c, note: maskPII(c.note) })),
    csChecklist: ev.csChecklist?.map((c) => ({
      ...c,
      reason: maskPII(c.reason),
      evidence: c.evidence.map((x) => ({ ...x, quote: maskPII(x.quote) })),
    })),
  };
  // 성장문화실(growth)은 CS 체크리스트가 평가의 핵심 → 3점 채점·총평은 표시하지 않는다.
  // (에러는 여전히 표시해야 하므로 에러가 있을 때만 안내 박스 노출.)
  const isGrowth = org === "growth";
  return (
    <section className="mt-8 space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-bold tracking-tight text-gray-900">분석 결과</h2>
        <span className="h-px flex-1 bg-gray-100" />
      </div>

      {isGrowth ? (
        e.error ? <ReportView summary="" error={e.error} /> : null
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <ScoreCard title="응대 태도" detail={e.scores.attitude} />
            <ScoreCard title="문제 해결력" detail={e.scores.resolution} />
            <ScoreCard title="대화 흐름·공백" detail={e.scores.flow} />
          </div>
          <ReportView summary={e.overallSummary} error={e.error} />
        </>
      )}
      <ChecklistView items={e.csChecklist} />
      <SilenceTimeline
        durationSec={result.durationSec}
        silences={result.silences}
        summary={result.silenceSummary}
        comments={e.silenceComments}
      />
      <Transcript segments={e.transcript} conversationId={result.conversationId} org={org} />
    </section>
  );
}
