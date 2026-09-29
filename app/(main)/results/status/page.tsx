import { Suspense } from "react";
import EvalStatusWorkbench from "@/components/results/EvalStatusWorkbench";
import { gateQualityEval } from "../qualityEvalGate";

export default async function Page() {
  await gateQualityEval();
  return (
    <Suspense>
      <EvalStatusWorkbench />
    </Suspense>
  );
}
