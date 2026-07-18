import type { EvaluationResult } from "@/lib/types";
import ScoreCard from "./ScoreCard";
import ReportView from "./ReportView";
import SilenceTimeline from "./SilenceTimeline";

export default function ResultView({ result }: { result: EvaluationResult }) {
  const { evaluation: e } = result;
  return (
    <section className="mt-8 space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-bold tracking-tight text-gray-900">평가 결과</h2>
        <span className="h-px flex-1 bg-gray-100" />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <ScoreCard title="응대 태도" detail={e.scores.attitude} />
        <ScoreCard title="문제 해결력" detail={e.scores.resolution} />
        <ScoreCard title="대화 흐름·공백" detail={e.scores.flow} />
      </div>
      <ReportView summary={e.overallSummary} error={e.error} />
      <SilenceTimeline
        durationSec={result.durationSec}
        silences={result.silences}
        summary={result.silenceSummary}
        comments={e.silenceComments}
      />
    </section>
  );
}
