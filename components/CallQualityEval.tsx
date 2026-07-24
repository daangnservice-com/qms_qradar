"use client";

import { useState } from "react";
import { Phone } from "lucide-react";
import type { EvaluationResult } from "@/lib/types";
import SampleList from "@/components/SampleList";
import ResultDrawer from "@/components/ResultDrawer";

export default function CallQualityEval() {
  // 평가한 결과를 conversationId별로 모두 보관해, 다른 항목을 평가해도 완료 표시가 유지되게 한다.
  const [results, setResults] = useState<Record<string, EvaluationResult>>({});
  const [activeId, setActiveId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const openFor = (id: string) => {
    setActiveId(id);
    setDrawerOpen(true);
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8 sm:px-10">
      <header className="border-b border-gray-100 pb-6">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-gray-900">
          <Phone className="h-5 w-5 text-navy" />
          콜 품질 평가
        </h1>
        <p className="mt-1.5 text-sm text-gray-500">
          BigQuery 평가 샘플에서 통화를 고르면 Genesys에서 녹취를 받아 AI가 품질을 평가하고 공백(검색 대기) 구간을 초 단위로 분석해요
        </p>
      </header>
      <div className="mt-8">
        <SampleList
          onResult={(r) => {
            const id = r.conversationId ?? "";
            setResults((prev) => ({ ...prev, [id]: r }));
            openFor(id);
          }}
          evaluatedIds={new Set(Object.keys(results))}
          onView={openFor}
        />
      </div>
      <ResultDrawer open={drawerOpen} result={activeId ? results[activeId] ?? null : null} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}
