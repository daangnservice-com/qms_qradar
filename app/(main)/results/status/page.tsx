import { Suspense } from "react";
import EvalStatusWorkbench from "@/components/results/EvalStatusWorkbench";

export default function Page() {
  return (
    <Suspense>
      <EvalStatusWorkbench />
    </Suspense>
  );
}
