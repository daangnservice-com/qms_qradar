"use client";

import { useState } from "react";
import { Phone } from "lucide-react";
import type { EvaluationResult } from "@/lib/types";
import UploadForm from "@/components/UploadForm";
import ResultView from "@/components/ResultView";

export default function CallQualityEval() {
  const [result, setResult] = useState<EvaluationResult | null>(null);

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-8 sm:px-10">
      <header className="border-b border-gray-100 pb-6">
        <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight text-gray-900">
          <Phone className="h-5 w-5 text-navy" />
          콜 품질 평가
        </h1>
        <p className="mt-1.5 text-sm text-gray-500">
          상담 통화 녹음을 업로드하면 AI가 품질을 평가하고 공백(검색 대기) 구간을 초 단위로 분석해요
        </p>
      </header>
      <div className="mt-8">
        <UploadForm onResult={setResult} />
        {result && <ResultView result={result} />}
      </div>
    </div>
  );
}
