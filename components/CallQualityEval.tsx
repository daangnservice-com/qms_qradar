"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import type { SampleFilters } from "@/lib/types";
import type { CallQualityOrg } from "@/lib/callQualityOrg";
import { parseCallQualityDeepLink } from "@/lib/callQualityDeepLink";
import EvalProgressWorkbench from "@/components/EvalProgressWorkbench";
import CallObserveWorkbench from "@/components/CallObserveWorkbench";

/** 콜 평가 진행 3열 워크벤치 (observe=1이면 청취 전용). */
export default function CallQualityEval({
  org,
  defaultFilters,
}: {
  org: CallQualityOrg;
  defaultFilters?: SampleFilters;
}) {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-0 flex-1 items-center justify-center text-[13px] text-[var(--fg-tertiary)]">
          불러오는 중…
        </div>
      }
    >
      <CallQualityEvalInner org={org} defaultFilters={defaultFilters} />
    </Suspense>
  );
}

function CallQualityEvalInner({
  org,
  defaultFilters,
}: {
  org: CallQualityOrg;
  defaultFilters?: SampleFilters;
}) {
  const searchParams = useSearchParams();
  const { observe } = parseCallQualityDeepLink(searchParams);

  if (observe) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <CallObserveWorkbench org={org} />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EvalProgressWorkbench org={org} defaultFilters={defaultFilters} />
    </div>
  );
}
