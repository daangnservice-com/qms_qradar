"use client";

import { useState } from "react";
import { Phone } from "lucide-react";
import type { EvaluationResult } from "@/lib/types";
import { ORG_LABEL, type CallQualityOrg } from "@/lib/callQualityOrg";
import SampleList from "@/components/SampleList";
import ResultDrawer from "@/components/ResultDrawer";

export default function CallQualityEval({ org }: { org: CallQualityOrg }) {
  // 분석 결과를 conversationId별로 모두 보관해, 다른 항목을 분석해도 완료 표시가 유지되게 한다.
  const [results, setResults] = useState<Record<string, EvaluationResult>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [loadingResult, setLoadingResult] = useState(false);

  // 패널을 즉시 열고(반응 빠르게), 세션에 없으면 저장 결과를 백그라운드로 불러온다.
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
    <div className="mx-auto w-full max-w-4xl px-6 py-8 sm:px-10">
      <header className="border-b border-gray-100 pb-6">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-gray-900">
          <Phone className="h-5 w-5 text-navy" />
          콜 분석
          <span className="rounded-full bg-navy/10 px-2 py-0.5 text-xs font-semibold text-navy">{ORG_LABEL[org]}</span>
        </h1>
        <p className="mt-1.5 text-sm text-gray-500">
          샘플에서 통화를 고르면 Genesys에서 녹취를 받아 AI가 통화 품질을 분석하고 공백(검색 대기) 구간을 초 단위로 살펴봐요 (AI 자동 분석)
        </p>
      </header>
      <div className="mt-8">
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
