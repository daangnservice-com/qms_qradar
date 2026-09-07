"use client";

import { useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import type { CriterionPrompt, SourceCriterion } from "@/lib/promptTypes";
import { useCachedFetch } from "@/lib/useCachedFetch";

type Payload = { source: SourceCriterion[]; prompts: CriterionPrompt[] };

export default function EvalItemsWorkbench() {
  const { data, loading, error, refresh } = useCachedFetch<Payload>({
    key: "sourceCriteriaBundle",
    fetcher: async () => {
      const r = await fetch("/api/prompts/criteria");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "로드 실패");
      return { source: d.source ?? [], prompts: d.prompts ?? [] };
    },
  });

  const source = data?.source ?? [];
  const prompts = data?.prompts ?? [];

  const categories = useMemo(() => {
    const set = new Set(source.map((s) => s.parentName || "기타"));
    return Array.from(set).sort();
  }, [source]);

  const [cat, setCat] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const activeCat = cat ?? categories[0] ?? null;
  const list = source.filter((s) => (activeCat ? s.parentName === activeCat : true));
  const selected = source.find((s) => s.id === (selectedId ?? list[0]?.id)) ?? null;
  const usedCount = selected
    ? prompts.filter((p) => p.criterionId === selected.id).length
    : 0;
  const latest = selected
    ? prompts
        .filter((p) => p.criterionId === selected.id)
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))[0]
    : null;

  return (
    <div className="qms-page-body space-y-4">
      <header className="flex items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--fg-tertiary)]">평가 설계</div>
          <h1 className="mt-1 text-[22px] font-extrabold tracking-tight">평가 항목 마스터</h1>
          <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-[var(--fg-secondary)]">
            지금은 <strong className="font-semibold text-[var(--fg-primary)]">당근서비스워크 평가 어드민</strong>의
            기준을 읽어 오기만 해서 이 화면에서 카테고리·항목을 추가·수정할 수 없습니다. 향후에는 이 탭에서 평가
            카테고리와 항목을 직접 관리할 예정입니다. AI 프롬프트 편집은 「AI 평가 항목」에서 하세요.
          </p>
        </div>
        <button type="button" className="qms-btn-ghost" onClick={() => void refresh()}>
          <RefreshCw className={`mr-1 inline h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          새로고침
        </button>
      </header>

      {error && (
        <div className="rounded-[var(--radius-md)] bg-[var(--danger-subtle)] px-3 py-2 text-[13px] text-[var(--danger)]">{error}</div>
      )}

      <div className="qms-layout-split-3">
        <aside className="qms-card p-3">
          <div className="mb-2 px-2 text-[11px] font-bold text-[var(--fg-tertiary)]">카테고리</div>
          {loading && !source.length ? (
            <Loader2 className="mx-auto my-6 h-5 w-5 animate-spin text-[var(--fg-tertiary)]" />
          ) : (
            categories.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => {
                  setCat(c);
                  setSelectedId(null);
                }}
                className={`mb-1 w-full rounded-[var(--radius-md)] px-3 py-2 text-left text-[13px] font-semibold ${
                  activeCat === c ? "bg-[var(--brand-subtle)] text-[var(--brand-hover)]" : "text-[var(--fg-secondary)] hover:bg-[var(--bg-muted)]"
                }`}
              >
                {c}
                <span className="ml-1 text-[11px] font-normal text-[var(--fg-tertiary)]">
                  ({source.filter((s) => s.parentName === c).length})
                </span>
              </button>
            ))
          )}
        </aside>

        <section className="qms-card overflow-hidden">
          <table className="qms-table">
            <thead>
              <tr>
                <th>코드</th>
                <th>항목명</th>
                <th>대분류</th>
                <th>AI 버전</th>
              </tr>
            </thead>
            <tbody>
              {list.map((s) => {
                const n = prompts.filter((p) => p.criterionId === s.id).length;
                const active = selected?.id === s.id;
                return (
                  <tr key={s.id} className={active ? "qms-row-active" : ""} onClick={() => setSelectedId(s.id)}>
                    <td className="font-mono text-[12px]">{s.id}</td>
                    <td className="font-semibold">{s.name}</td>
                    <td>
                      <span className="qms-chip">{s.parentName}</span>
                    </td>
                    <td>{n ? `${n}개` : <span className="text-[var(--fg-tertiary)]">미연결</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <aside className="qms-card sticky top-4 h-fit space-y-3 p-4">
          {selected ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[11px] font-semibold text-[var(--fg-tertiary)]">[{selected.id}]</div>
                  <h2 className="text-[16px] font-extrabold">{selected.name}</h2>
                </div>
                <span className="qms-chip">{selected.parentName}</span>
              </div>
              <div className="text-[12.5px] text-[var(--fg-secondary)]">
                AI 프롬프트 버전 <b>{usedCount}</b>개
                {latest && (
                  <div className="mt-1 text-[11.5px] text-[var(--fg-tertiary)]">
                    최근 {latest.versionLabel} · {latest.updatedAt.slice(0, 16)}
                  </div>
                )}
              </div>
              {latest?.fields?.definition && (
                <div>
                  <div className="mb-1 text-[11px] font-bold text-[var(--fg-tertiary)]">평가 기준(초안 definition)</div>
                  <p className="rounded-[var(--radius-md)] bg-[var(--bg-muted)] p-3 text-[12.5px] leading-relaxed">{latest.fields.definition}</p>
                </div>
              )}
              <a href="/eval-design/ai-items" className="qms-btn-primary inline-flex items-center justify-center no-underline">
                AI 평가 항목에서 관리 →
              </a>
            </>
          ) : (
            <p className="text-[13px] text-[var(--fg-tertiary)]">항목을 선택하세요</p>
          )}
        </aside>
      </div>
    </div>
  );
}
