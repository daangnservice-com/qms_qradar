import { Suspense } from "react";
import type { Metadata } from "next";
import EvalStatusWorkbench from "@/components/results/EvalStatusWorkbench";

export const metadata: Metadata = {
  title: "평가 현황 UI 레퍼런스",
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <div className="qms-page min-h-full">
      <Suspense>
        <EvalStatusWorkbench demo />
      </Suspense>
    </div>
  );
}
