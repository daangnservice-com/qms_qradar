import ResultsAggregateWorkbench from "@/components/results/ResultsAggregateWorkbench";
import { gateQualityEval } from "../qualityEvalGate";

export default async function Page() {
  await gateQualityEval();
  return <ResultsAggregateWorkbench />;
}
