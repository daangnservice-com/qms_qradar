import ResultsReportWorkbench from "@/components/results/ResultsReportWorkbench";
import { gateQualityEval } from "../qualityEvalGate";

export default async function Page() {
  await gateQualityEval();
  return <ResultsReportWorkbench />;
}
