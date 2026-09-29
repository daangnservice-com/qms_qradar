import ResultsCasesWorkbench from "@/components/results/ResultsCasesWorkbench";
import { gateQualityEval } from "../qualityEvalGate";

export default async function Page() {
  await gateQualityEval();
  return <ResultsCasesWorkbench />;
}
