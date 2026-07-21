"use client";

import { useEffect, useState } from "react";
import { ClipboardList, Images, GitCompareArrows } from "lucide-react";
import type { DamageResult } from "@/lib/types";
import { PARTY_LABEL } from "@/lib/types";
import VerdictBadge from "./VerdictBadge";
import AnnotatedImage, { type Overlay } from "./AnnotatedImage";
import DamageFeedback from "./DamageFeedback";
import DamageChat from "./DamageChat";

export default function DamageResultView({ result, files }: { result: DamageResult; files: File[] }) {
  // 사진 blob URL: 단일 effect에서 생성+해제(StrictMode 재마운트에도 안전)
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const created = files.map((f) => URL.createObjectURL(f));
    setUrls(created);
    return () => created.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);

  // 근거 리스트와 사진 위 박스를 잇는 공유 호버 상태(번호 기준)
  const [hovered, setHovered] = useState<number | null>(null);

  // 각 근거에 1부터 번호 부여
  const numbered = result.findings.map((f, i) => ({ ...f, number: i + 1 }));

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

      {/* 양측 비교 소견 */}
      {result.comparison && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <GitCompareArrows className="h-4 w-4 text-navy" />
            양측 비교
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-gray-700">{result.comparison}</p>
        </div>
      )}

      {/* 파손 근거 (번호 매김 + 호버 강조) */}
      <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <ClipboardList className="h-4 w-4 text-navy" />
          파손 근거
        </h3>
        {numbered.length === 0 ? (
          <p className="mt-3 text-sm text-gray-400">발견된 파손 없음</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {numbered.map((f) => (
              <li
                key={f.number}
                onMouseEnter={() => setHovered(f.number)}
                onMouseLeave={() => setHovered(null)}
                className={`flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm transition ${
                  hovered === f.number ? "bg-gap/10" : ""
                }`}
              >
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gap text-xs font-bold text-white">
                  {f.number}
                </span>
                <span className="text-gray-700">
                  <span className={`mr-1.5 inline-block rounded-md px-1.5 py-0.5 text-xs font-bold ${f.party === "claimant" ? "bg-navy/10 text-navy" : "bg-gray-200 text-gray-600"}`}>
                    {PARTY_LABEL[f.party]}
                  </span>
                  <span className="font-semibold text-gray-900">{f.location}</span>
                  <span className="mx-1.5 text-gray-300">·</span>
                  <span className="inline-block rounded-md bg-gap/10 px-1.5 py-0.5 text-xs font-medium text-gap">{f.type}</span>
                  <span className="ml-2">{f.description}</span>
                  {f.box === null && <span className="ml-2 text-xs text-gray-400">(부위 표시 없음)</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* 사진별 오버레이 — 신청인/피신청인으로 분리 (urls는 신청인 사진 먼저) */}
      {urls.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <Images className="h-4 w-4 text-navy" />
            사진별 파손 표시
          </h3>
          <div className="mt-4 space-y-6">
            {([
              { party: "claimant" as const, start: 0, count: result.claimantCount },
              { party: "respondent" as const, start: result.claimantCount, count: result.respondentCount },
            ]).filter((g) => g.count > 0).map((g) => (
              <div key={g.party}>
                <div className="mb-3 flex items-center gap-2 text-xs font-semibold text-gray-500">
                  <span className={`inline-flex h-5 items-center rounded-md px-2 text-xs font-bold ${g.party === "claimant" ? "bg-navy/10 text-navy" : "bg-gray-200 text-gray-600"}`}>
                    {PARTY_LABEL[g.party]}
                  </span>
                  <span className="h-px flex-1 bg-gray-100" />
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  {Array.from({ length: g.count }, (_, k) => g.start + k).map((i, k) => {
                    const overlays: Overlay[] = numbered
                      .filter((f) => f.photoIndex === i && f.box !== null)
                      .map((f) => ({ number: f.number, box: f.box! }));
                    const note = result.perPhoto.find((p) => p.index === i)?.note;
                    const label = `${PARTY_LABEL[g.party]} 사진 ${k + 1}`;
                    return (
                      <div key={i} className="space-y-2">
                        <div className="text-xs font-medium text-gray-400">{label}</div>
                        <AnnotatedImage
                          url={urls[i]}
                          alt={label}
                          overlays={overlays}
                          hovered={hovered}
                          onHover={setHovered}
                        />
                        {note && <p className="text-sm text-gray-600">{note}</p>}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <DamageChat result={result} files={files} />

      <DamageFeedback result={result} files={files} />
    </section>
  );
}
