"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, Loader2, RefreshCw, Sparkles, Save } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCachedFetch } from "@/lib/useCachedFetch";
import { cacheInvalidate } from "@/lib/clientCache";
import type { CriterionPrompt, PromptFieldKey } from "@/lib/promptTypes";
import { DEFAULT_CRITERION_REVIEW_SCOPE, DEFAULT_FIELD_KEYS } from "@/lib/promptTypes";
import { formatUpdatedAtKst, buildImprovedVersionLabel } from "@/lib/criterionVersionLabel";
import {
  PROMPT_IMPROVE_KIND_LABEL,
  type PromptImproveCriterionGroup,
  type PromptImproveExample,
  type PromptImproveKind,
  type PromptImproveSet,
} from "@/lib/promptImproveTypes";
import {
  buildCallQualityDeepLink,
  loadPromptImproveDraft,
  savePromptImproveCheckout,
  savePromptImproveDraft,
} from "@/lib/promptImproveSession";

type MismatchPayload = {
  set: PromptImproveSet;
  groups: PromptImproveCriterionGroup[];
  totalCriteria: number;
  totalExamples: number;
};

type CriteriaPayload = {
  prompts: CriterionPrompt[];
  fieldKeys: PromptFieldKey[];
};

const FIELD_ORDER = ["definition", "good", "bad", "exception"];
const EMPTY_GROUPS: PromptImproveCriterionGroup[] = [];

export default function PromptImproveWorkbench() {
  const router = useRouter();
  const initialDraft = useMemo(() => loadPromptImproveDraft(), []);
  const [setTab, setSetTab] = useState<PromptImproveSet>(initialDraft?.setTab ?? "train");
  const [selectedCriterionId, setSelectedCriterionId] = useState<number | null>(
    initialDraft?.selectedCriterionId ?? null,
  );
  const [selectedPromptId, setSelectedPromptId] = useState<string | null>(
    initialDraft?.selectedPromptId ?? null,
  );
  const [checkedIds, setCheckedIds] = useState<Set<string>>(
    () => new Set(initialDraft?.checkedIds ?? []),
  );
  const [kindFilter, setKindFilter] = useState<"all" | PromptImproveKind>(
    initialDraft?.kindFilter ?? "all",
  );
  const [userNote, setUserNote] = useState(initialDraft?.userNote ?? "");
  const [proposed, setProposed] = useState<Record<string, string> | null>(initialDraft?.proposed ?? null);
  const [rationale, setRationale] = useState<string | null>(initialDraft?.rationale ?? null);
  const [busy, setBusy] = useState(false);
  const [saveBusy, setSaveBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const prevTab = useRef(setTab);
  const prevCriterion = useRef<number | null | undefined>(undefined);
  const persistReady = useRef(false);

  const cacheKey = `promptImprove:mismatches:v2:${setTab}`;
  const { data, loading, validating, error, refresh } = useCachedFetch<MismatchPayload>({
    key: cacheKey,
    fetcher: async () => {
      const r = await fetch(`/api/eval-design/prompt-improve/mismatches?set=${setTab}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "불일치 로드 실패");
      return d as MismatchPayload;
    },
  });

  const { data: criteriaData, refresh: refreshCriteria } = useCachedFetch<CriteriaPayload>({
    key: "criterionPromptsFull:v2",
    fetcher: async () => {
      const r = await fetch("/api/prompts/criteria");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "평가 항목 로드 실패");
      return {
        prompts: d.prompts ?? [],
        fieldKeys: d.fieldKeys?.length ? d.fieldKeys : DEFAULT_FIELD_KEYS,
      };
    },
  });

  const groups = data?.groups ?? EMPTY_GROUPS;
  const fieldKeys = (criteriaData?.fieldKeys ?? DEFAULT_FIELD_KEYS).filter((f) => f.enabled);

  // 탭 전환 시에만 리셋 (마운트·초안 복원 시에는 스킵)
  useEffect(() => {
    if (prevTab.current === setTab) return;
    prevTab.current = setTab;
    setCheckedIds(new Set());
    setProposed(null);
    setRationale(null);
    setMsg(null);
    setErr(null);
    setKindFilter("all");
    setSelectedCriterionId(null);
    setSelectedPromptId(null);
  }, [setTab]);

  useEffect(() => {
    const list = data?.groups;
    if (!list?.length) return;
    setSelectedCriterionId((prev) =>
      prev != null && list.some((g) => g.criterionId === prev) ? prev : list[0].criterionId,
    );
  }, [data?.groups]);

  const selectedGroup = groups.find((g) => g.criterionId === selectedCriterionId) ?? null;

  const filteredExamples = useMemo(() => {
    if (!selectedGroup) return [];
    if (kindFilter === "all") return selectedGroup.examples;
    return selectedGroup.examples.filter((e) => e.kind === kindFilter);
  }, [selectedGroup, kindFilter]);

  const versions = useMemo(() => {
    if (selectedCriterionId == null || !criteriaData?.prompts) return [];
    return criteriaData.prompts
      .filter((p) => p.criterionId === selectedCriterionId)
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }, [criteriaData?.prompts, selectedCriterionId]);

  // 항목이 실제로 바뀔 때만 최신 버전·초안 리셋 (복원 시 proposed 유지)
  useEffect(() => {
    if (prevCriterion.current === undefined) {
      prevCriterion.current = selectedCriterionId;
      return;
    }
    if (prevCriterion.current === selectedCriterionId) return;
    prevCriterion.current = selectedCriterionId;
    setSelectedPromptId(versions[0]?.promptId ?? null);
    setProposed(null);
    setRationale(null);
  }, [selectedCriterionId, versions]);

  useEffect(() => {
    if (!versions.length) {
      if (selectedCriterionId != null) setSelectedPromptId(null);
      return;
    }
    setSelectedPromptId((prev) =>
      prev && versions.some((p) => p.promptId === prev) ? prev : versions[0].promptId,
    );
  }, [versions, selectedCriterionId]);

  const selectedPrompt =
    (selectedPromptId ? versions.find((p) => p.promptId === selectedPromptId) : null) ??
    versions[0] ??
    null;

  const beforeFields = selectedPrompt?.fields ?? {};
  const afterFields = proposed ?? {};

  const nextVersionLabel = useMemo(
    () =>
      buildImprovedVersionLabel(
        selectedPrompt?.versionLabel,
        versions.map((v) => v.versionLabel),
      ),
    [selectedPrompt?.versionLabel, versions],
  );

  const fieldKeyList = fieldKeys.length ? fieldKeys.map((f) => f.key) : FIELD_ORDER;

  const selectedExamples = useMemo(
    () => filteredExamples.filter((e) => checkedIds.has(e.id)),
    [filteredExamples, checkedIds],
  );

  // 초안 자동 저장 (평가 진행 왕복 시 After 필드 유지)
  useEffect(() => {
    if (!persistReady.current) {
      persistReady.current = true;
      return;
    }
    savePromptImproveDraft({
      setTab,
      selectedCriterionId,
      selectedPromptId,
      checkedIds: [...checkedIds],
      kindFilter,
      userNote,
      proposed,
      rationale,
    });
  }, [
    setTab,
    selectedCriterionId,
    selectedPromptId,
    checkedIds,
    kindFilter,
    userNote,
    proposed,
    rationale,
  ]);

  function snapshotDraft() {
    savePromptImproveDraft({
      setTab,
      selectedCriterionId,
      selectedPromptId,
      checkedIds: [...checkedIds],
      kindFilter,
      userNote,
      proposed,
      rationale,
    });
  }

  function openInEvalProgress(example: PromptImproveExample) {
    snapshotDraft();
    savePromptImproveCheckout({
      example,
      openedAt: new Date().toISOString(),
    });
    router.push(buildCallQualityDeepLink(example.conversationId));
  }

  function toggleExample(id: string) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllFiltered(on: boolean) {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      for (const e of filteredExamples) {
        if (on) next.add(e.id);
        else next.delete(e.id);
      }
      return next;
    });
  }

  async function runGenerate() {
    if (selectedCriterionId == null || !selectedExamples.length) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await fetch("/api/eval-design/prompt-improve/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          criterionId: selectedCriterionId,
          examples: selectedExamples,
          promptId: selectedPrompt?.promptId ?? null,
          currentFields: selectedPrompt?.fields ?? {},
          userNote: userNote.trim() || null,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "생성 실패");
      setProposed(d.fields ?? {});
      setRationale(d.rationale ?? null);
      setMsg(`초안 생성 완료 (${d.model ?? "model"}) · 기반 ${selectedPrompt?.versionLabel ?? "빈 필드"}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveAsNewVersion() {
    if (selectedCriterionId == null || !proposed) return;
    const group = selectedGroup;
    if (!group) return;
    setSaveBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const versionLabel = buildImprovedVersionLabel(
        selectedPrompt?.versionLabel,
        versions.map((v) => v.versionLabel),
      );
      const r = await fetch("/api/prompts/criteria", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "saveCriterion",
          criterionId: selectedCriterionId,
          category: group.category || selectedPrompt?.category || "",
          label: group.label || selectedPrompt?.label || String(selectedCriterionId),
          fields: proposed,
          reviewScope: selectedPrompt?.reviewScope ?? DEFAULT_CRITERION_REVIEW_SCOPE,
          versionLabel,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "저장 실패");
      cacheInvalidate("criterionPromptsFull");
      await refreshCriteria();
      setMsg(`새 버전 저장됨: ${d.prompt?.versionLabel ?? versionLabel}`);
      if (d.prompt?.promptId) setSelectedPromptId(String(d.prompt.promptId));
      setProposed(null);
      setRationale(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaveBusy(false);
    }
  }

  const kindOptions: Array<"all" | PromptImproveKind> =
    setTab === "train"
      ? ["all", "fp", "fn"]
      : ["all", "ai_corrected_fp", "ai_corrected_fn", "human_added", "considered_hot"];

  return (
    <div className="qms-page-body space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--fg-tertiary)]">평가 설계</div>
          <h1 className="mt-1 text-[22px] font-extrabold tracking-tight">프롬프트 개선</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-[var(--fg-secondary)]">
            수기 ≠ AI 불일치 사례를 모아 기존 항목 프롬프트와 함께 LLM에 넣어 개선 초안을 만듭니다. Train은 AI
            비교·개선 레퍼런스, Test는 평가 진행 수기 정정·추가입니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/eval-design/ai-items" className="qms-btn-ghost inline-flex items-center no-underline !px-3">
            AI 평가 항목 →
          </Link>
          <Link href="/eval-design/compare" className="qms-btn-ghost inline-flex items-center no-underline !px-3">
            AI 비교·개선 →
          </Link>
          <button
            type="button"
            className="qms-btn-ghost inline-flex items-center"
            onClick={() => {
              cacheInvalidate(cacheKey);
              void refresh();
            }}
          >
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${validating ? "animate-spin" : ""}`} />
            새로고침
          </button>
        </div>
      </header>

      <div className="flex flex-wrap gap-1">
        <button
          type="button"
          className={setTab === "train" ? "qms-btn-primary" : "qms-btn-ghost"}
          onClick={() => setSetTab("train")}
        >
          Train · AI 비교 셋
        </button>
        <button
          type="button"
          className={setTab === "test" ? "qms-btn-primary" : "qms-btn-ghost"}
          onClick={() => setSetTab("test")}
        >
          Test · 평가 진행 셋
        </button>
        <span className="ml-2 self-center text-[12px] text-[var(--fg-tertiary)]">
          {data
            ? `항목 ${data.totalCriteria} · 사례 ${data.totalExamples}`
            : loading
              ? "불러오는 중…"
              : ""}
        </span>
      </div>

      {error || err ? (
        <div className="rounded-[var(--radius-md)] bg-[var(--danger-subtle)] px-3 py-2 text-[13px] text-[var(--danger)]">
          {error || err}
        </div>
      ) : null}
      {msg ? (
        <div className="rounded-[var(--radius-md)] bg-[var(--accent-subtle)] px-3 py-2 text-[13px] text-[var(--accent)]">
          {msg}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,0.7fr)_minmax(0,1.85fr)]">
        {/* 항목 목록 */}
        <section className="qms-card flex max-h-[calc(100vh-14rem)] flex-col p-3">
          <div className="mb-2 text-[12px] font-bold text-[var(--fg-secondary)]">불일치 평가항목</div>
          {loading && !groups.length ? (
            <div className="flex flex-1 items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : groups.length === 0 ? (
            <p className="py-8 text-center text-[12px] text-[var(--fg-tertiary)]">
              {setTab === "train"
                ? "Train 불일치가 없어요. AI 비교·개선에서 평가를 먼저 돌려 주세요."
                : "Test 불일치가 없어요. 평가 진행에서 AI 정정·수기 추가를 남겨 주세요."}
            </p>
          ) : (
            <ul className="space-y-0.5 overflow-y-auto">
              {groups.map((g) => {
                const active = g.criterionId === selectedCriterionId;
                const countLabel = Object.entries(g.counts)
                  .map(([k, n]) => `${PROMPT_IMPROVE_KIND_LABEL[k as PromptImproveKind].split(" · ")[0]} ${n}`)
                  .join(" · ");
                return (
                  <li key={g.criterionId}>
                    <button
                      type="button"
                      className={`w-full rounded-[var(--radius-md)] px-2.5 py-2 text-left ${
                        active ? "bg-[var(--brand-subtle)]" : "hover:bg-[var(--bg-muted)]"
                      }`}
                      onClick={() => {
                        setSelectedCriterionId(g.criterionId);
                        setCheckedIds(new Set());
                        setProposed(null);
                        setRationale(null);
                      }}
                    >
                      <div className="text-[12.5px] font-semibold">
                        <span className="font-mono text-[11px] text-[var(--fg-tertiary)]">{g.criterionId}</span>{" "}
                        {g.label}
                      </div>
                      <div className="mt-0.5 text-[10.5px] text-[var(--fg-tertiary)]">
                        {g.category || "—"} · {g.examples.length}건
                        {countLabel ? ` · ${countLabel}` : ""}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* 사례 */}
        <section className="qms-card flex max-h-[calc(100vh-14rem)] flex-col p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-[14px] font-bold">불일치 사례</h2>
              <p className="mt-0.5 text-[11px] text-[var(--fg-tertiary)]">
                선택한 사례가 LLM 생성 파라미터로 들어갑니다 · 선택 {selectedExamples.length}건
              </p>
            </div>
            <div className="flex flex-wrap gap-1">
              {kindOptions.map((k) => (
                <button
                  key={k}
                  type="button"
                  className={
                    kindFilter === k
                      ? "qms-btn-primary !h-7 !px-2 text-[11px]"
                      : "qms-btn-ghost !h-7 !px-2 text-[11px]"
                  }
                  onClick={() => setKindFilter(k)}
                >
                  {k === "all" ? "전체" : PROMPT_IMPROVE_KIND_LABEL[k].split(" · ")[0]}
                </button>
              ))}
            </div>
          </div>

          <div className="mb-2 flex gap-2">
            <button
              type="button"
              className="qms-btn-ghost !h-7 !px-2 text-[11px]"
              onClick={() => toggleAllFiltered(true)}
              disabled={!filteredExamples.length}
            >
              필터 전체 선택
            </button>
            <button
              type="button"
              className="qms-btn-ghost !h-7 !px-2 text-[11px]"
              onClick={() => toggleAllFiltered(false)}
              disabled={!checkedIds.size}
            >
              선택 해제
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
            {!filteredExamples.length ? (
              <p className="py-10 text-center text-[13px] text-[var(--fg-tertiary)]">표시할 사례가 없어요</p>
            ) : (
              filteredExamples.map((e) => (
                <ExampleCard
                  key={e.id}
                  example={e}
                  checked={checkedIds.has(e.id)}
                  onToggle={() => toggleExample(e.id)}
                  onOpenEval={() => openInEvalProgress(e)}
                />
              ))
            )}
          </div>
        </section>

        {/* 프롬프트 + 생성 */}
        <section className="qms-card flex max-h-[calc(100vh-14rem)] flex-col p-4">
          <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h2 className="text-[14px] font-bold">항목 프롬프트</h2>
              <label className="mt-2 block text-[12px]">
                <span className="font-semibold text-[var(--fg-secondary)]">기반 버전</span>
                <select
                  className="qms-input mt-1 !h-8 text-[12px]"
                  value={selectedPrompt?.promptId ?? ""}
                  disabled={!versions.length}
                  onChange={(e) => {
                    const id = e.target.value;
                    if (!id || id === selectedPromptId) return;
                    setSelectedPromptId(id);
                    setProposed(null);
                    setRationale(null);
                    setMsg(null);
                  }}
                >
                  {!versions.length ? <option value="">저장된 버전 없음</option> : null}
                  {versions.map((p, idx) => (
                    <option key={p.promptId} value={p.promptId}>
                      {p.versionLabel || p.promptId.slice(0, 8)}
                      {idx === 0 ? " (최신)" : ""}
                      {p.updatedAt ? ` · ${formatUpdatedAtKst(p.updatedAt)}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <p className="mt-1 text-[11px] text-[var(--fg-tertiary)]">
                {selectedPrompt
                  ? `선택한 버전 필드를 기반으로 개선합니다`
                  : selectedCriterionId
                    ? "저장된 프롬프트 없음 — 빈 필드에서 생성"
                    : "항목을 선택하세요"}
                {proposed ? " · 아래는 LLM 초안(미저장)" : ""}
              </p>
            </div>
            <button
              type="button"
              className="qms-btn-primary inline-flex items-center gap-1"
              disabled={busy || !selectedExamples.length || selectedCriterionId == null}
              onClick={() => void runGenerate()}
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              LLM으로 개선 초안
            </button>
          </div>

          <label className="mb-3 block text-[12px]">
            <span className="font-semibold text-[var(--fg-secondary)]">추가 지시 (선택)</span>
            <textarea
              className="qms-textarea mt-1 !min-h-[64px] text-[12px]"
              value={userNote}
              onChange={(e) => setUserNote(e.target.value)}
              placeholder="예: FP가 많으니 exception을 더 구체화해 주세요"
            />
          </label>

          {rationale ? (
            <div className="mb-3 rounded-[var(--radius-md)] bg-[var(--bg-muted)] px-3 py-2 text-[12px] text-[var(--fg-secondary)]">
              <span className="font-bold">수정 이유 · </span>
              {rationale}
            </div>
          ) : null}

          <div className="mb-2 grid grid-cols-2 gap-3 text-[11px] font-bold text-[var(--fg-secondary)]">
            <div>
              Before
              <span className="ml-1 font-normal text-[var(--fg-tertiary)]">
                {selectedPrompt?.versionLabel ?? "(없음)"}
              </span>
            </div>
            <div>
              After
              <span className="ml-1 font-normal text-[var(--fg-tertiary)]">
                {proposed ? "LLM 초안 (편집 가능)" : "생성 전"}
              </span>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {fieldKeyList.map((key) => {
              const meta = fieldKeys.find((f) => f.key === key);
              const label = meta?.label ?? key;
              return (
                <div key={key}>
                  <div className="mb-1 text-[12px] font-semibold text-[var(--fg-secondary)]">{label}</div>
                  <div className="grid grid-cols-2 gap-3">
                    <textarea
                      className="qms-textarea !min-h-[100px] whitespace-pre-wrap bg-[var(--bg-muted)] text-[12px]"
                      value={beforeFields[key] ?? ""}
                      readOnly
                      disabled={selectedCriterionId == null}
                    />
                    <textarea
                      className="qms-textarea !min-h-[100px] whitespace-pre-wrap text-[12px]"
                      value={afterFields[key] ?? ""}
                      placeholder={proposed ? "" : "LLM으로 개선 초안을 생성하면 여기에 표시됩니다"}
                      onChange={(e) => {
                        const v = e.target.value;
                        setProposed((prev) => ({ ...(prev ?? {}), [key]: v }));
                      }}
                      disabled={selectedCriterionId == null || !proposed}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-[var(--border-subtle)] pt-3">
            <div className="min-w-[12rem] flex-1 text-[12px]">
              <div className="font-semibold text-[var(--fg-secondary)]">저장 버전명</div>
              <code className="mt-1 block break-all rounded-[var(--radius-md)] bg-[var(--bg-muted)] px-2 py-1.5 text-[11px] text-[var(--fg-primary)]">
                {nextVersionLabel}
              </code>
              <p className="mt-1 text-[10.5px] text-[var(--fg-tertiary)]">
                참조 버전 + <span className="font-mono">_improved_verN</span>
              </p>
            </div>
            <button
              type="button"
              className="qms-btn-primary inline-flex items-center gap-1"
              disabled={saveBusy || !proposed || selectedCriterionId == null}
              onClick={() => void saveAsNewVersion()}
            >
              {saveBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              새 버전으로 저장
            </button>
            {proposed ? (
              <button
                type="button"
                className="qms-btn-ghost"
                onClick={() => {
                  setProposed(null);
                  setRationale(null);
                }}
              >
                초안 버리기
              </button>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function ExampleCard({
  example,
  checked,
  onToggle,
  onOpenEval,
}: {
  example: PromptImproveExample;
  checked: boolean;
  onToggle: () => void;
  onOpenEval: () => void;
}) {
  return (
    <div
      className={`flex gap-2.5 rounded-[var(--radius-md)] border px-3 py-2.5 ${
        checked ? "border-[var(--brand)] bg-[var(--brand-subtle)]" : "border-[var(--border-subtle)]"
      }`}
    >
      <input
        type="checkbox"
        className="mt-1 shrink-0"
        checked={checked}
        onChange={onToggle}
        aria-label="개선 사례로 선택"
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="qms-chip !px-2 !py-0.5 text-[10.5px]">{PROMPT_IMPROVE_KIND_LABEL[example.kind]}</span>
          <code className="text-[10.5px] text-[var(--fg-tertiary)]">{example.conversationId.slice(0, 12)}…</code>
        </div>
        <div className="mt-1 text-[12px] text-[var(--fg-primary)]">{example.humanNote}</div>
        <div className="mt-0.5 text-[11.5px] text-[var(--fg-secondary)]">{example.aiNote}</div>
        {example.quote ? (
          <div className="mt-1 line-clamp-2 text-[11px] italic text-[var(--fg-tertiary)]">“{example.quote}”</div>
        ) : null}
        <button
          type="button"
          className="qms-btn-ghost mt-2 inline-flex !h-7 items-center gap-1 !px-2 text-[11px]"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onOpenEval();
          }}
        >
          <ExternalLink className="h-3 w-3" />
          평가 진행에서 보기
        </button>
      </div>
    </div>
  );
}
