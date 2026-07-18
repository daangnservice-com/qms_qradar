"use client";

import { useEffect, useState } from "react";
import { ClipboardList, Images } from "lucide-react";
import type { DamageResult } from "@/lib/types";
import VerdictBadge from "./VerdictBadge";

export default function DamageResultView({ result, files }: { result: DamageResult; files: File[] }) {
  // 사진 blob URL: 단일 effect에서 생성+해제(StrictMode 재마운트에도 안전)
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const created = files.map((f) => URL.createObjectURL(f));
    setUrls(created);
    return () => created.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  return (
    <section className="mt-8 space-y-4">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-bold tracking-tight text-gray-900">판정 결과</h2>
        <span className="h-px flex-1 bg-gray-100" />
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <VerdictBadge verdict={result.verdict} confidence={result.confidence} />
        <p className="mt-3 text-sm leading-relaxed text-gray-700">{result.summary}</p>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <ClipboardList className="h-4 w-4 text-navy" />
          파손 근거
        </h3>
        {result.findings.length === 0 ? (
          <p className="mt-3 text-sm text-gray-400">발견된 파손 없음</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {result.findings.map((f, i) => (
              <li key={i} className="text-sm text-gray-700">
                <span className="font-semibold text-gray-900">{f.location}</span>
                <span className="mx-1.5 text-gray-300">·</span>
                <span className="inline-block rounded-md bg-gap/10 px-1.5 py-0.5 text-xs font-medium text-gap">{f.type}</span>
                <span className="ml-2">{f.description}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {urls.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <Images className="h-4 w-4 text-navy" />
            사진별 코멘트
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {urls.map((url, i) => {
              const note = result.perPhoto.find((p) => p.index === i)?.note;
              return (
                <div key={i} className="flex gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={url} alt={`사진 ${i + 1}`} className="h-16 w-16 shrink-0 rounded-lg border border-gray-200 object-cover" />
                  <p className="text-sm text-gray-600">{note ?? "코멘트 없음"}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
