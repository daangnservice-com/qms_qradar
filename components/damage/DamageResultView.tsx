"use client";

import { useEffect, useState } from "react";
import { ClipboardList, Images } from "lucide-react";
import type { DamageResult } from "@/lib/types";
import VerdictBadge from "./VerdictBadge";
import AnnotatedImage, { type Overlay } from "./AnnotatedImage";

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

      {/* 사진별 오버레이 */}
      {urls.length > 0 && (
        <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
            <Images className="h-4 w-4 text-navy" />
            사진별 파손 표시
          </h3>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            {urls.map((url, i) => {
              const overlays: Overlay[] = numbered
                .filter((f) => f.photoIndex === i && f.box !== null)
                .map((f) => ({ number: f.number, box: f.box! }));
              const note = result.perPhoto.find((p) => p.index === i)?.note;
              return (
                <div key={i} className="space-y-2">
                  <div className="text-xs font-medium text-gray-400">사진 {i + 1}</div>
                  <AnnotatedImage
                    url={url}
                    alt={`사진 ${i + 1}`}
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
      )}
    </section>
  );
}
