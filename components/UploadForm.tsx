"use client";
import { useState } from "react";
import type { EvaluationResult } from "@/lib/types";
import ThresholdSlider from "./ThresholdSlider";

export default function UploadForm({ onResult }: { onResult: (r: EvaluationResult) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [minSilenceSec, setMinSilenceSec] = useState(3);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    setLoading(true); setError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("minSilenceSec", String(minSilenceSec));
      const res = await fetch("/api/evaluate", { method: "POST", body: fd });
      if (!res.ok) throw new Error((await res.json()).error ?? "실패");
      onResult(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "실패");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <input type="file" accept=".m4a,audio/mp4" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <ThresholdSlider value={minSilenceSec} onChange={setMinSilenceSec} />
      <button type="submit" disabled={!file || loading} className="rounded bg-brand px-4 py-2 text-white disabled:opacity-50">
        {loading ? "평가 중…" : "품질 평가 시작"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
