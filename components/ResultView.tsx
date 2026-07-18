import type { EvaluationResult } from "@/lib/types";
import ScoreCard from "./ScoreCard";
import ReportView from "./ReportView";
import SilenceTimeline from "./SilenceTimeline";

export default function ResultView({ result }: { result: EvaluationResult }) {
  const { evaluation: e } = result;
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-3">
        <ScoreCard title="응대 태도" detail={e.scores.attitude} />
        <ScoreCard title="문제 해결력" detail={e.scores.resolution} />
        <ScoreCard title="대화 흐름·공백" detail={e.scores.flow} />
      </div>
      <ReportView summary={e.overallSummary} error={e.error} />
      <SilenceTimeline durationSec={result.durationSec} silences={result.silences} summary={result.silenceSummary} comments={e.silenceComments} />
    </div>
  );
}
