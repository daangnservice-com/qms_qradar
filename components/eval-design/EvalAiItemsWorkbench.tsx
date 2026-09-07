"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Save } from "lucide-react";
import type {
  CriterionPrompt,
  CriterionReviewScope,
  PromptFieldKey,
  SourceCriterion,
} from "@/lib/promptTypes";
import { DEFAULT_CRITERION_REVIEW_SCOPE, DEFAULT_FIELD_KEYS } from "@/lib/promptTypes";
import { cacheInvalidate } from "@/lib/clientCache";
import { useCachedFetch } from "@/lib/useCachedFetch";
import { buildCriterionVersionLabel, formatUpdatedAtKst } from "@/lib/criterionVersionLabel";

type Payload = {
  source: SourceCriterion[];
  prompts: CriterionPrompt[];
  fieldKeys: PromptFieldKey[];
};

export default function EvalAiItemsWorkbench() {
  const { data, loading, error, refresh } = useCachedFetch<Payload>({
    key: "criterionPromptsFull:v2",
    fetcher: async () => {
      const r = await fetch("/api/prompts/criteria");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "로드 실패");
      return {
        source: d.source ?? [],
        prompts: d.prompts ?? [],
        fieldKeys: d.fieldKeys?.length ? d.fieldKeys : DEFAULT_FIELD_KEYS,
      };
    },
  });

  const source = data?.source ?? [];
  const prompts = data?.prompts ?? [];
  const fieldKeys = data?.fieldKeys ?? DEFAULT_FIELD_KEYS;

  const categories = useMemo(() => {
    const set = new Set(source.map((s) => s.parentName || "기타"));
    return Array.from(set).sort();
  }, [source]);

  const [cat, setCat] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(null);
  /** true면 히스토리 선택 없이 빈/복사 초안 편집 (저장 전까지) */
  const [draftingNew, setDraftingNew] = useState(false);
  const [fieldDraft, setFieldDraft] = useState<Record<string, string>>({});
  /** 저장 시 라벨 맨 뒤에 붙는 선택 문구 */
  const [versionNote, setVersionNote] = useState("");
  const [reviewScope, setReviewScope] = useState<CriterionReviewScope>(DEFAULT_CRITERION_REVIEW_SCOPE);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const activeCat = cat ?? categories[0] ?? null;
  const list = source.filter((s) => (activeCat ? (s.parentName || "기타") === activeCat : true));

  const versions = useMemo(
    () =>
      selectedId == null
        ? []
        : prompts
            .filter((p) => p.criterionId === selectedId)
            .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [prompts, selectedId],
  );

  const selectedSource =
    source.find((s) => s.id === (selectedId ?? list[0]?.id)) ?? list[0] ?? source[0] ?? null;

  const previewLabel = useMemo(
    () => buildCriterionVersionLabel(versionNote, versions.map((v) => v.versionLabel)),
    [versionNote, versions],
  );

  useEffect(() => {
    if (!selectedSource) return;
    if (selectedId == null) setSelectedId(selectedSource.id);
  }, [selectedSource, selectedId]);

  useEffect(() => {
    if (selectedId == null) return;
    if (list.length && !list.some((s) => s.id === selectedId)) {
      setSelectedId(list[0]?.id ?? null);
      setSelectedPromptId(null);
      setDraftingNew(false);
    }
  }, [activeCat]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (selectedId == null || draftingNew) return;
    const pick =
      (selectedPromptId && versions.find((p) => p.promptId === selectedPromptId)) || versions[0] || null;
    if (pick) {
      setSelectedPromptId(pick.promptId);
      setVersionNote("");
      setReviewScope(pick.reviewScope ?? DEFAULT_CRITERION_REVIEW_SCOPE);
      const next: Record<string, string> = {};
      for (const f of fieldKeys.filter((k) => k.enabled)) next[f.key] = pick.fields?.[f.key] ?? "";
      setFieldDraft(next);
    } else {
      setSelectedPromptId(null);
      setVersionNote("");
      setReviewScope(DEFAULT_CRITERION_REVIEW_SCOPE);
      const next: Record<string, string> = {};
      for (const f of fieldKeys.filter((k) => k.enabled)) next[f.key] = "";
      setFieldDraft(next);
    }
  }, [selectedId, selectedPromptId, versions, fieldKeys, draftingNew]); // eslint-disable-line react-hooks/exhaustive-deps

  const startNew = () => {
    setDraftingNew(true);
    setSelectedPromptId(null);
    setVersionNote("");
    const base = versions[0];
    setReviewScope(base?.reviewScope ?? DEFAULT_CRITERION_REVIEW_SCOPE);
    const next: Record<string, string> = {};
    for (const f of fieldKeys.filter((k) => k.enabled)) {
      next[f.key] = base?.fields?.[f.key] ?? "";
    }
    setFieldDraft(next);
  };

  const save = async () => {
    if (!selectedSource) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await fetch("/api/prompts/criteria", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "saveCriterion",
          criterionId: selectedSource.id,
          category: selectedSource.parentName,
          label: selectedSource.name,
          fields: fieldDraft,
          reviewScope,
          versionNote,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "저장 실패");
      setMsg(`새 버전 저장: ${d.prompt?.versionLabel ?? previewLabel}`);
      setDraftingNew(false);
      cacheInvalidate("criterionPrompts");
      cacheInvalidate("criterionPromptsFull");
      cacheInvalidate("criterionPromptsFull:v2");
      cacheInvalidate("sourceCriteriaBundle");
      await refresh();
      if (d.prompt?.promptId) setSelectedPromptId(d.prompt.promptId);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="qms-page-body space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--fg-tertiary)]">평가 설계</div>
          <h1 className="mt-1 text-[22px] font-extrabold tracking-tight">AI 평가 항목</h1>
          <p className="mt-1 text-[13px] text-[var(--fg-secondary)]">
            버전 라벨 <code className="text-[11px]">YYMMDD_verN[_추가문구]</code> · 생성자 이메일 기록 · 최신=업데이트 시각
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="qms-btn-ghost" disabled={!selectedSource || busy} onClick={startNew}>
            <Plus className="mr-1 inline h-3.5 w-3.5" />
            새 버전
          </button>
          <button type="button" className="qms-btn-primary" disabled={!selectedSource || busy} onClick={() => void save()}>
            {busy ? <Loader2 className="inline h-4 w-4 animate-spin" /> : <Save className="mr-1 inline h-3.5 w-3.5" />}
            새 버전 저장
          </button>
        </div>
      </header>

      {(error || err) && (
        <div className="rounded-[var(--radius-md)] bg-[var(--danger-subtle)] px-3 py-2 text-[13px] text-[var(--danger)]">
          {error ?? err}
        </div>
      )}
      {msg && (
        <div className="rounded-[var(--radius-md)] bg-[var(--success-subtle)] px-3 py-2 text-[13px] text-[var(--c-green-600)]">{msg}</div>
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
                  setSelectedPromptId(null);
                  setDraftingNew(false);
                }}
                className={`mb-1 w-full rounded-[var(--radius-md)] px-3 py-2 text-left text-[13px] font-semibold ${
                  activeCat === c
                    ? "bg-[var(--brand-subtle)] text-[var(--brand-hover)]"
                    : "text-[var(--fg-secondary)] hover:bg-[var(--bg-muted)]"
                }`}
              >
                {c}
                <span className="ml-1 text-[11px] font-normal text-[var(--fg-tertiary)]">
                  ({source.filter((s) => (s.parentName || "기타") === c).length})
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
                <th>AI 항목</th>
                <th>대분류</th>
                <th>버전수</th>
                <th>최근 버전</th>
              </tr>
            </thead>
            <tbody>
              {loading && !source.length ? (
                <tr>
                  <td colSpan={5} className="py-10 text-center">
                    <Loader2 className="inline h-5 w-5 animate-spin" />
                  </td>
                </tr>
              ) : list.length ? (
                list.map((s) => {
                  const vers = prompts
                    .filter((p) => p.criterionId === s.id)
                    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
                  const latest = vers[0];
                  const active = selectedSource?.id === s.id;
                  return (
                    <tr
                      key={s.id}
                      className={active ? "qms-row-active" : ""}
                      onClick={() => {
                        setSelectedId(s.id);
                        setSelectedPromptId(null);
                        setDraftingNew(false);
                      }}
                    >
                      <td className="font-mono text-[12px]">{s.id}</td>
                      <td className="font-semibold">{s.name}</td>
                      <td>
                        <span className="qms-chip">{s.parentName}</span>
                      </td>
                      <td>{vers.length}</td>
                      <td className="text-[12px]">
                        {latest ? (
                          <div>
                            <div className="font-semibold">{latest.versionLabel}</div>
                            <div className="text-[11px] text-[var(--fg-tertiary)]">
                              {formatUpdatedAtKst(latest.updatedAt)}
                              {latest.updatedBy ? ` · ${latest.updatedBy}` : ""}
                            </div>
                          </div>
                        ) : (
                          <span className="text-[var(--fg-tertiary)]">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-[var(--fg-tertiary)]">
                    이 카테고리에 항목 없음
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <aside className="qms-card sticky top-4 h-fit max-h-[calc(100vh-6rem)] space-y-3 overflow-y-auto p-4">
          {selectedSource ? (
            <>
              <div>
                <div className="text-[11px] font-semibold text-[var(--fg-tertiary)]">연결된 평가 항목</div>
                <h2 className="text-[16px] font-extrabold">
                  [{selectedSource.id}] {selectedSource.name}
                </h2>
                <span className="qms-chip mt-1">{selectedSource.parentName}</span>
                {draftingNew ? (
                  <span className="qms-chip ml-1 mt-1 bg-[var(--brand-subtle)] text-[var(--brand-hover)]">
                    새 버전 작성 중
                  </span>
                ) : null}
              </div>

              <div>
                <div className="mb-1 text-[11px] font-bold text-[var(--fg-tertiary)]">
                  버전 히스토리 (최신 ↑)
                </div>
                <div className="max-h-52 space-y-1 overflow-y-auto">
                  {versions.map((p, idx) => {
                    const active = selectedPromptId === p.promptId;
                    const isLatest = idx === 0;
                    return (
                      <button
                        key={p.promptId}
                        type="button"
                        onClick={() => {
                          setDraftingNew(false);
                          setSelectedPromptId(p.promptId);
                        }}
                        className={`w-full rounded-[var(--radius-md)] border px-2.5 py-2 text-left ${
                          active && !draftingNew
                            ? "border-[var(--brand)] bg-[var(--brand-subtle)]"
                            : "border-[var(--border-subtle)] hover:bg-[var(--bg-muted)]"
                        }`}
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-[12px] font-bold">{p.versionLabel}</span>
                          {isLatest ? <span className="qms-chip-prod qms-chip">최신</span> : null}
                        </div>
                        <div className="mt-0.5 text-[11px] text-[var(--fg-tertiary)]">
                          {formatUpdatedAtKst(p.updatedAt)}
                          {p.updatedBy ? ` · ${p.updatedBy}` : " · (생성자 없음)"}
                        </div>
                      </button>
                    );
                  })}
                  {!versions.length && (
                    <span className="text-[12px] text-[var(--fg-tertiary)]">아직 없음</span>
                  )}
                </div>
              </div>

              <label className="block text-[12px] font-semibold">
                추가 문구 (선택)
                <input
                  className="qms-input mt-1"
                  value={versionNote}
                  placeholder="비우면 YYMMDD_verN 만 저장"
                  onChange={(e) => setVersionNote(e.target.value)}
                />
              </label>
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-muted)] px-3 py-2 text-[12px]">
                <span className="text-[var(--fg-tertiary)]">저장될 라벨 </span>
                <code className="font-semibold">{previewLabel}</code>
              </div>

              <label className="block text-[12px] font-semibold">
                수기 검수 적용 범위
                <select
                  className="qms-select mt-1"
                  value={reviewScope}
                  onChange={(e) => setReviewScope(e.target.value as CriterionReviewScope)}
                >
                  <option value="occurrence">발화별 — 각 발생 건을 따로 판정</option>
                  <option value="conversation">상담 전체 — 모든 발생 건에 동일 적용</option>
                </select>
                <span className="mt-1 block text-[11px] font-normal text-[var(--fg-tertiary)]">
                  상담 전체를 선택하면 한 상담 안의 같은 평가항목에 수기 판정과 코멘트가 일괄 적용됩니다.
                </span>
              </label>

              {fieldKeys
                .filter((f) => f.enabled)
                .sort((a, b) => a.sortOrder - b.sortOrder)
                .map((f) => (
                  <label key={f.key} className="block text-[12px] font-semibold">
                    {f.label}
                    <textarea
                      className="qms-textarea mt-1"
                      value={fieldDraft[f.key] ?? ""}
                      placeholder={f.key === "definition" ? "필수에 가깝지만, 사례는 비워도 됩니다" : "선택"}
                      onChange={(e) => setFieldDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                    />
                  </label>
                ))}
            </>
          ) : (
            <p className="text-[13px] text-[var(--fg-tertiary)]">항목을 선택하세요</p>
          )}
        </aside>
      </div>
    </div>
  );
}
