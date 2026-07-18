"use client";
import { useState } from "react";
import type { EvaluationResult } from "@/lib/types";
import UploadForm from "@/components/UploadForm";
import ResultView from "@/components/ResultView";

export default function Home() {
  const [result, setResult] = useState<EvaluationResult | null>(null);
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <header>
        <h1 className="text-xl font-bold">통화 품질 평가</h1>
        <p className="text-sm text-gray-500">m4a 통화 녹음을 올리면 품질 평가 + 공백을 측정합니다.</p>
      </header>
      <UploadForm onResult={setResult} />
      {result && <ResultView result={result} />}
    </main>
  );
}
