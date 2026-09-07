"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Phone } from "lucide-react";
import type { EvaluationResult, SampleFilters } from "@/lib/types";
import { ORG_LABEL, type CallQualityOrg } from "@/lib/callQualityOrg";
import { parseCallQualityDeepLink } from "@/lib/callQualityDeepLink";
import SampleList from "@/components/SampleList";
import ResultDrawer from "@/components/ResultDrawer";
import EvalProgressWorkbench from "@/components/EvalProgressWorkbench";
import CallObserveWorkbench from "@/components/CallObserveWorkbench";

/** 성장문화실 = 평가 진행 3열 워크벤치, 페이 = 기존 목록+드로어 */
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

  if (org === "growth" && observe) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <CallObserveWorkbench org={org} />
      </div>
    );
  }

  if (org === "growth") {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <EvalProgressWorkbench org={org} defaultFilters={defaultFilters} />
      </div>
    );
  }

  return <PayCallQuality org={org} />;
}

function PayCallQuality({ org }: { org: CallQualityOrg }) {
  const [results, setResults] = useState<Record<string, EvaluationResult>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loadingResult, setLoadingResult] = useState(false);

  const openFor = (id: string) => {
    setActiveId(id);
    setDrawerOpen(true);
    if (results[id]) return;
    setLoadingResult(true);
    fetch(`/api/call-quality/results?conversationId=${encodeURIComponent(id)}&org=${org}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ result: EvaluationResult }>) : null))
      .then((data) => {
        if (data?.result) setResults((prev) => ({ ...prev, [id]: { ...data.result, conversationId: id } }));
      })
      .catch(() => {})
      .finally(() => setLoadingResult(false));
  };

  return (
    <div className="qms-page flex min-h-0 flex-1 flex-col">
      <header className="border-b border-[var(--border-subtle)] px-5 py-4">
        <h1 className="flex items-center gap-2 text-[20px] font-extrabold tracking-tight text-[var(--fg-primary)]">
          <Phone className="h-5 w-5 text-[var(--brand)]" />
          콜 분석
          <span className="rounded-full bg-[var(--brand-subtle)] px-2 py-0.5 text-[11px] font-semibold text-[var(--brand-hover)]">
            {ORG_LABEL[org]}
          </span>
        </h1>
        <p className="mt-1 text-[12.5px] text-[var(--fg-secondary)]">
          샘플에서 통화를 고르면 Genesys에서 녹취를 받아 AI가 통화 품질을 분석하고 공백(검색 대기) 구간을 초 단위로
          살펴봐요.
        </p>
      </header>
      <div className="qms-page-body">
        <SampleList
          org={org}
          onResult={(r) => {
            const id = r.conversationId ?? "";
            setResults((prev) => ({ ...prev, [id]: r }));
            setActiveId(id);
            setDrawerOpen(true);
          }}
          evaluatedIds={new Set(Object.keys(results))}
          onView={openFor}
        />
      </div>
      <ResultDrawer
        open={drawerOpen}
        result={activeId ? results[activeId] ?? null : null}
        loading={loadingResult}
        org={org}
        onClose={() => setDrawerOpen(false)}
      />
    </div>
  );
}
