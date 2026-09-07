import type { EvaluationResult } from "@/lib/types";
import { maskPII } from "@/lib/pii";
import EvalCaseDetail from "./EvalCaseDetail";
import SilenceTimeline from "./SilenceTimeline";
import Transcript from "./Transcript";

export default function ResultView({
  result,
  org,
  compactHeader,
  humanResult,
  humanFinalLabel,
  match,
}: {
  result: EvaluationResult;
  org?: string;
  compactHeader?: boolean;
  humanResult?: string | null;
  humanFinalLabel?: string | null;
  match?: boolean | null;
}) {
  const ev = result.evaluation;
  const silenceComments = (ev.silenceComments ?? []).map((c) => ({ ...c, note: maskPII(c.note) }));

  return (
    <section className="space-y-4">
      <EvalCaseDetail
        result={result}
        compactHeader={compactHeader}
        humanResult={humanResult}
        humanFinalLabel={humanFinalLabel}
        match={match}
      />
      <SilenceTimeline
        durationSec={result.durationSec}
        silences={result.silences}
        summary={result.silenceSummary}
        comments={silenceComments}
      />
      <Transcript segments={ev.transcript} conversationId={result.conversationId} org={org} />
    </section>
  );
}
