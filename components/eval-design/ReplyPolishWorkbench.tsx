"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, Loader2, Plus, RefreshCw, Save, Sparkles, Trash2 } from "lucide-react";
import { cacheInvalidate } from "@/lib/clientCache";
import { useCachedFetch } from "@/lib/useCachedFetch";
import { addDaysYmd, currentDateKst } from "@/lib/sttBatchKst";
import { categoryCounts, sampleSnippet } from "@/lib/replyPolishSample";
import {
  REPLY_POLISH_DEFAULT_TARGET,
  REPLY_POLISH_DEFAULT_TEAM,
  REPLY_POLISH_MAX_TARGET,
  REPLY_POLISH_VARS,
  type ReplyPolishResult,
  type ReplyPolishRun,
  type ReplyPolishSample,
  type ReplyPolishSampleSet,
  type ReplyPolishSampleSetSummary,
  type ReplyPolishTemplate,
} from "@/lib/replyPolishTypes";
import ReplyPolishDiffText from "@/components/eval-design/ReplyPolishDiffText";

type TabId = "samples" | "templates" | "compare";
type DiffMode = "original" | "templates";

type TemplatesPayload = { templates: ReplyPolishTemplate[] };
type SampleSetsPayload = { sampleSets: ReplyPolishSampleSetSummary[] };
type SampleSetPayload = { sampleSet: ReplyPolishSampleSet };
type RunsPayload = { runs: ReplyPolishRun[]; results: ReplyPolishResult[] };

async function readJson<T>(res: Response): Promise<T> {
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `요청 실패 (${res.status})`);
  return data;
}

export default function ReplyPolishWorkbench() {
  const today = currentDateKst();
  const [tab, setTab] = useState<TabId>("samples");
  const [dateStart, setDateStart] = useState(() => addDaysYmd(today, -14));
  const [dateEnd, setDateEnd] = useState(today);
  const [team, setTeam] = useState(REPLY_POLISH_DEFAULT_TEAM);
  const [target, setTarget] = useState(REPLY_POLISH_DEFAULT_TARGET);
  const [csatRates, setCsatRates] = useState<number[]>([]);
  const [csatIncludeNone, setCsatIncludeNone] = useState(false);
  const [selectedSetId, setSelectedSetId] = useState<string | null>(null);
  const [selectedSampleId, setSelectedSampleId] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [templateA, setTemplateA] = useState<string>("");
  const [templateB, setTemplateB] = useState<string>("");
  const [diffMode, setDiffMode] = useState<DiffMode>("original");
  const [busy, setBusy] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewText, setPreviewText] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<ReplyPolishRun | null>(null);
  const [runResults, setRunResults] = useState<ReplyPolishResult[]>([]);

  const templatesKey = "replyPolish:templates";
  const setsKey = "replyPolish:sampleSets";
  const setDetailKey = selectedSetId ? `replyPolish:sampleSet:${selectedSetId}` : "";
  const runsKey = selectedSetId ? `replyPolish:runs:${selectedSetId}` : "";

  const {
    data: templatesData,
    loading: templatesLoading,
    validating: templatesValidating,
    error: templatesError,
    refresh: refreshTemplates,
  } = useCachedFetch<TemplatesPayload>({
    key: templatesKey,
    fetcher: () => fetch("/api/eval-design/reply-polish/templates").then((r) => readJson<TemplatesPayload>(r)),
  });

  const {
    data: setsData,
    loading: setsLoading,
    validating: setsValidating,
    error: setsError,
    refresh: refreshSets,
  } = useCachedFetch<SampleSetsPayload>({
    key: setsKey,
    fetcher: () => fetch("/api/eval-design/reply-polish/samples").then((r) => readJson<SampleSetsPayload>(r)),
  });

  const {
    data: setDetail,
    loading: setLoading,
    validating: setValidating,
    refresh: refreshSet,
  } = useCachedFetch<SampleSetPayload>({
    key: setDetailKey,
    enabled: Boolean(selectedSetId),
    fetcher: () =>
      fetch(`/api/eval-design/reply-polish/samples?id=${encodeURIComponent(selectedSetId!)}`).then((r) =>
        readJson<SampleSetPayload>(r),
      ),
  });

  const { data: runsData, refresh: refreshRuns } = useCachedFetch<RunsPayload>({
    key: runsKey,
    enabled: Boolean(selectedSetId),
    fetcher: () =>
      fetch(`/api/eval-design/reply-polish/runs?sampleSetId=${encodeURIComponent(selectedSetId!)}&process=0`).then((r) =>
        readJson<RunsPayload>(r),
      ),
  });

  const templates = templatesData?.templates ?? [];
  const sampleSets = setsData?.sampleSets ?? [];
  const sampleSet = setDetail?.sampleSet ?? null;
  const samples = sampleSet?.samples ?? [];
  const selectedSample = samples.find((s) => s.id === selectedSampleId) ?? samples[0] ?? null;
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId) ?? null;

  useEffect(() => {
    if (!selectedSetId && sampleSets[0]) setSelectedSetId(sampleSets[0].id);
  }, [sampleSets, selectedSetId]);

  useEffect(() => {
    if (!selectedTemplateId && templates[0]) {
      setSelectedTemplateId(templates[0].id);
      setDraftName(templates[0].name);
      setDraftBody(templates[0].body);
    }
  }, [templates, selectedTemplateId]);

  useEffect(() => {
    if (selectedTemplate) {
      setDraftName(selectedTemplate.name);
      setDraftBody(selectedTemplate.body);
      setPreviewText(null);
    }
  }, [selectedTemplateId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!templateA && templates[0]) setTemplateA(templates[0].id);
    if (!templateB && templates[1]) setTemplateB(templates[1].id);
  }, [templates, templateA, templateB]);

  useEffect(() => {
    if (runsData?.runs[0] && !activeRun) {
      setActiveRun(runsData.runs[0]);
      setRunResults(runsData.results.filter((r) => r.runId === runsData.runs[0].id));
    }
  }, [runsData, activeRun]);

  const pollRun = useCallback(async (runId: string) => {
    const data = await readJson<{ run: ReplyPolishRun; results: ReplyPolishResult[] }>(
      await fetch(`/api/eval-design/reply-polish/runs?id=${encodeURIComponent(runId)}`),
    );
    setActiveRun(data.run);
    setRunResults(data.results);
    return data.run;
  }, []);

  useEffect(() => {
    if (!activeRun || (activeRun.status !== "pending" && activeRun.status !== "running")) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const run = await pollRun(activeRun.id);
        if (cancelled) return;
        if (run.status === "done" || run.status === "error") {
          cacheInvalidate(runsKey);
          void refreshRuns();
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    };
    const timer = setInterval(() => void tick(), 2000);
    void tick();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [activeRun?.id, activeRun?.status, pollRun, refreshRuns, runsKey]);

  const latestResults = useMemo(() => {
    const map = new Map<string, ReplyPolishResult>();
    const pool = runResults.length ? runResults : (runsData?.results ?? []);
    for (const result of pool) {
      const key = `${result.sampleId}:${result.templateId}`;
      const prev = map.get(key);
      if (!prev || prev.updatedAt < result.updatedAt) map.set(key, result);
    }
    return map;
  }, [runResults, runsData]);

  async function withBusy(label: string, fn: () => Promise<void>) {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await fn();
      setMsg(label);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function handleSample() {
    await withBusy("샘플을 저장했습니다", async () => {
      const data = await readJson<SampleSetPayload>(
        await fetch("/api/eval-design/reply-polish/samples", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dateStart, dateEnd, team, target, csatRates, csatIncludeNone }),
        }),
      );
      cacheInvalidate(setsKey);
      cacheInvalidate(`replyPolish:sampleSet:${data.sampleSet.id}`);
      await refreshSets();
      setSelectedSetId(data.sampleSet.id);
      setSelectedSampleId(data.sampleSet.samples[0]?.id ?? null);
    });
  }

  async function handleSaveTemplate() {
    await withBusy("템플릿을 저장했습니다", async () => {
      const data = await readJson<{ template: ReplyPolishTemplate }>(
        await fetch("/api/eval-design/reply-polish/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: selectedTemplateId,
            name: draftName,
            body: draftBody,
          }),
        }),
      );
      cacheInvalidate(templatesKey);
      await refreshTemplates();
      setSelectedTemplateId(data.template.id);
    });
  }

  async function handleNewTemplate() {
    await withBusy("새 템플릿을 만들었습니다", async () => {
      const data = await readJson<{ template: ReplyPolishTemplate }>(
        await fetch("/api/eval-design/reply-polish/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: "새 템플릿", body: draftBody || "{{inquiry}}\n\n{{answer}}\n\n{{category}}" }),
        }),
      );
      cacheInvalidate(templatesKey);
      await refreshTemplates();
      setSelectedTemplateId(data.template.id);
      setDraftName(data.template.name);
      setDraftBody(data.template.body);
    });
  }

  async function handleDuplicateTemplate() {
    if (!selectedTemplateId) return;
    await withBusy("템플릿을 복제했습니다", async () => {
      const data = await readJson<{ template: ReplyPolishTemplate }>(
        await fetch("/api/eval-design/reply-polish/templates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ duplicateId: selectedTemplateId }),
        }),
      );
      cacheInvalidate(templatesKey);
      await refreshTemplates();
      setSelectedTemplateId(data.template.id);
    });
  }

  async function handleDeleteTemplate() {
    if (!selectedTemplateId) return;
    if (!window.confirm("이 템플릿을 삭제할까요?")) return;
    await withBusy("템플릿을 삭제했습니다", async () => {
      await readJson<{ ok: boolean }>(
        await fetch(`/api/eval-design/reply-polish/templates?id=${encodeURIComponent(selectedTemplateId)}`, {
          method: "DELETE",
        }),
      );
      cacheInvalidate(templatesKey);
      setSelectedTemplateId(null);
      await refreshTemplates();
    });
  }

  async function handlePreview() {
    if (!selectedSetId || !selectedSample) {
      setErr("미리보기할 샘플을 먼저 뽑으세요");
      return;
    }
    setPreviewBusy(true);
    setErr(null);
    try {
      const data = await readJson<{ text: string }>(
        await fetch("/api/eval-design/reply-polish/preview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            templateBody: draftBody,
            sampleSetId: selectedSetId,
            sampleId: selectedSample.id,
          }),
        }),
      );
      setPreviewText(data.text);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewBusy(false);
    }
  }

  async function handleRun() {
    if (!selectedSetId) {
      setErr("샘플셋을 먼저 뽑으세요");
      return;
    }
    const templateIds = [templateA, templateB].filter(Boolean);
    if (!templateIds.length) {
      setErr("비교할 템플릿을 선택하세요");
      return;
    }
    await withBusy("다듬기를 시작했습니다", async () => {
      const data = await readJson<{ run: ReplyPolishRun; results: ReplyPolishResult[] }>(
        await fetch("/api/eval-design/reply-polish/runs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sampleSetId: selectedSetId, templateIds }),
        }),
      );
      setActiveRun(data.run);
      setRunResults(data.results);
      cacheInvalidate(runsKey);
    });
  }

  function insertVar(name: string) {
    setDraftBody((prev) => `${prev}{{${name}}}`);
  }

  const distribution = sampleSet ? categoryCounts(sampleSet.samples) : [];
  const tplA = templates.find((t) => t.id === templateA) ?? null;
  const tplB = templates.find((t) => t.id === templateB) ?? null;
  const resultA = selectedSample && templateA ? latestResults.get(`${selectedSample.id}:${templateA}`) : undefined;
  const resultB = selectedSample && templateB ? latestResults.get(`${selectedSample.id}:${templateB}`) : undefined;
  const runInFlight = activeRun?.status === "pending" || activeRun?.status === "running";

  return (
    <div className="qms-page-body space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--fg-tertiary)]">평가 설계</div>
          <h1 className="mt-1 text-[22px] font-extrabold tracking-tight">답변 다듬기 테스트</h1>
          <p className="mt-1 max-w-2xl text-[13px] text-[var(--fg-secondary)]">
            당근이만 답한 문의 스레드를 뽑아, 저장된 톤앤매너 프롬프트로 답변을 다시 쓰고 템플릿 차이를 비교합니다.
          </p>
        </div>
        <button
          type="button"
          className="qms-btn-ghost inline-flex items-center"
          onClick={() => {
            cacheInvalidate(templatesKey);
            cacheInvalidate(setsKey);
            if (selectedSetId) cacheInvalidate(`replyPolish:sampleSet:${selectedSetId}`);
            void refreshTemplates();
            void refreshSets();
            void refreshSet();
            void refreshRuns();
          }}
        >
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${templatesValidating || setsValidating || setValidating ? "animate-spin" : ""}`} />
          새로고침
        </button>
      </header>

      <div className="flex flex-wrap gap-1">
        {(
          [
            ["samples", "샘플"],
            ["templates", "템플릿"],
            ["compare", "비교"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} type="button" className={tab === id ? "qms-btn-primary" : "qms-btn-ghost"} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {err ? <p className="text-[13px] text-[var(--danger)]">{err}</p> : null}
      {msg ? <p className="text-[13px] text-[var(--accent-fg)]">{msg}</p> : null}
      {templatesError || setsError ? (
        <p className="text-[13px] text-[var(--danger)]">{templatesError || setsError}</p>
      ) : null}

      {tab === "samples" ? (
        <SamplesTab
          dateStart={dateStart}
          dateEnd={dateEnd}
          team={team}
          target={target}
          csatRates={csatRates}
          csatIncludeNone={csatIncludeNone}
          busy={busy}
          setsLoading={setsLoading}
          setLoading={setLoading}
          sampleSets={sampleSets}
          selectedSetId={selectedSetId}
          sampleSet={sampleSet}
          samples={samples}
          selectedSampleId={selectedSample?.id ?? null}
          distribution={distribution}
          onDateStart={setDateStart}
          onDateEnd={setDateEnd}
          onTeam={setTeam}
          onTarget={setTarget}
          onCsat={(patch) => {
            if (patch.csatRates !== undefined) setCsatRates(patch.csatRates);
            if (patch.csatIncludeNone !== undefined) setCsatIncludeNone(patch.csatIncludeNone);
          }}
          onSelectSet={(id) => {
            setSelectedSetId(id);
            setSelectedSampleId(null);
            setActiveRun(null);
            setRunResults([]);
          }}
          onSelectSample={setSelectedSampleId}
          onSample={() => void handleSample()}
        />
      ) : null}

      {tab === "templates" ? (
        <TemplatesTab
          templates={templates}
          loading={templatesLoading}
          selectedId={selectedTemplateId}
          draftName={draftName}
          draftBody={draftBody}
          busy={busy}
          previewBusy={previewBusy}
          previewText={previewText}
          selectedSample={selectedSample}
          onSelect={(id) => {
            const next = templates.find((t) => t.id === id);
            setSelectedTemplateId(id);
            if (next) {
              setDraftName(next.name);
              setDraftBody(next.body);
              setPreviewText(null);
            }
          }}
          onName={setDraftName}
          onBody={setDraftBody}
          onInsertVar={insertVar}
          onSave={() => void handleSaveTemplate()}
          onNew={() => void handleNewTemplate()}
          onDuplicate={() => void handleDuplicateTemplate()}
          onDelete={() => void handleDeleteTemplate()}
          onPreview={() => void handlePreview()}
        />
      ) : null}

      {tab === "compare" ? (
        <CompareTab
          templates={templates}
          samples={samples}
          selectedSample={selectedSample}
          templateA={templateA}
          templateB={templateB}
          tplA={tplA}
          tplB={tplB}
          diffMode={diffMode}
          busy={busy}
          run={activeRun}
          runInFlight={runInFlight}
          resultA={resultA}
          resultB={resultB}
          latestResults={latestResults}
          onTemplateA={setTemplateA}
          onTemplateB={setTemplateB}
          onDiffMode={setDiffMode}
          onSelectSample={setSelectedSampleId}
          onRun={() => void handleRun()}
        />
      ) : null}
    </div>
  );
}

function csatFilterLabel(set: { csatRates?: number[]; csatIncludeNone?: boolean }): string | null {
  const rates = set.csatRates ?? [];
  const none = Boolean(set.csatIncludeNone);
  if (!rates.length && !none) return null;
  const parts = rates.map((rate) => `${rate}점`);
  if (none) parts.push("미참여");
  return `CSAT ${parts.join(", ")}`;
}

function SamplesTab(props: {
  dateStart: string;
  dateEnd: string;
  team: string;
  target: number;
  csatRates: number[];
  csatIncludeNone: boolean;
  busy: boolean;
  setsLoading: boolean;
  setLoading: boolean;
  sampleSets: ReplyPolishSampleSetSummary[];
  selectedSetId: string | null;
  sampleSet: ReplyPolishSampleSet | null;
  samples: ReplyPolishSample[];
  selectedSampleId: string | null;
  distribution: { category: string; count: number }[];
  onDateStart: (v: string) => void;
  onDateEnd: (v: string) => void;
  onTeam: (v: string) => void;
  onTarget: (v: number) => void;
  onCsat: (patch: { csatRates?: number[]; csatIncludeNone?: boolean }) => void;
  onSelectSet: (id: string) => void;
  onSelectSample: (id: string) => void;
  onSample: () => void;
}) {
  return (
    <div className="space-y-4">
      <section className="qms-card grid gap-3 p-4 md:grid-cols-5">
        <label className="text-[12px] font-semibold text-[var(--fg-secondary)]">
          시작일
          <input
            type="date"
            className="qms-input mt-1"
            value={props.dateStart}
            onChange={(e) => props.onDateStart(e.target.value)}
          />
        </label>
        <label className="text-[12px] font-semibold text-[var(--fg-secondary)]">
          종료일
          <input type="date" className="qms-input mt-1" value={props.dateEnd} onChange={(e) => props.onDateEnd(e.target.value)} />
        </label>
        <label className="text-[12px] font-semibold text-[var(--fg-secondary)]">
          work_group_team
          <input className="qms-input mt-1" value={props.team} onChange={(e) => props.onTeam(e.target.value)} />
        </label>
        <label className="text-[12px] font-semibold text-[var(--fg-secondary)]">
          규모
          <input
            type="number"
            min={1}
            max={REPLY_POLISH_MAX_TARGET}
            className="qms-input mt-1"
            value={props.target}
            onChange={(e) => props.onTarget(Number(e.target.value))}
          />
        </label>
        <div className="flex items-end">
          <button type="button" className="qms-btn-primary w-full" disabled={props.busy} onClick={props.onSample}>
            {props.busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "샘플링"}
          </button>
        </div>
        <div className="md:col-span-5">
          <CsatRateFilter
            csatRates={props.csatRates}
            csatIncludeNone={props.csatIncludeNone}
            disabled={props.busy}
            onChange={props.onCsat}
          />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <aside className="qms-card max-h-[32rem] overflow-auto p-2">
          <div className="px-2 py-1 text-[11px] font-bold text-[var(--fg-tertiary)]">저장된 샘플셋</div>
          {props.setsLoading ? <p className="px-2 py-3 text-[12px] text-[var(--fg-tertiary)]">불러오는 중…</p> : null}
          {!props.setsLoading && !props.sampleSets.length ? (
            <p className="px-2 py-3 text-[12px] text-[var(--fg-tertiary)]">아직 샘플셋이 없습니다.</p>
          ) : null}
          {props.sampleSets.map((set) => (
            <button
              key={set.id}
              type="button"
              className={`mb-1 w-full rounded-[8px] px-2 py-2 text-left text-[12px] ${
                set.id === props.selectedSetId ? "bg-[var(--brand-subtle)] font-bold" : "hover:bg-[var(--bg-muted)]"
              }`}
              onClick={() => props.onSelectSet(set.id)}
            >
              <div>
                {set.dateStart} ~ {set.dateEnd}
              </div>
              <div className="text-[11px] font-medium text-[var(--fg-tertiary)]">
                {set.team} · {set.sampleCount}건
                {csatFilterLabel(set) ? ` · ${csatFilterLabel(set)}` : ""}
              </div>
            </button>
          ))}
        </aside>

        <section className="space-y-3">
          {props.setLoading && !props.sampleSet ? (
            <p className="text-[13px] text-[var(--fg-tertiary)]">샘플을 불러오는 중…</p>
          ) : null}
          {props.sampleSet ? (
            <>
              <div className="flex flex-wrap gap-2">
                {props.distribution.slice(0, 12).map((row) => (
                  <span key={row.category} className="qms-chip">
                    {row.category} {row.count}
                  </span>
                ))}
              </div>
              <div className="qms-card overflow-auto">
                <table className="qms-table">
                  <thead>
                    <tr>
                      <th>스레드</th>
                      <th>CSAT</th>
                      <th>카테고리</th>
                      <th>문의</th>
                    </tr>
                  </thead>
                  <tbody>
                    {props.samples.map((sample) => (
                      <tr
                        key={sample.id}
                        className={sample.id === props.selectedSampleId ? "qms-row-active" : "cursor-pointer"}
                        onClick={() => props.onSelectSample(sample.id)}
                      >
                        <td className="font-mono text-[12px]">{sample.threadId}</td>
                        <td>{sample.csatRate != null ? `${Math.round(sample.csatRate)}점` : "—"}</td>
                        <td className="max-w-[14rem] truncate">{sample.category || "(없음)"}</td>
                        <td className="max-w-[28rem] truncate">{sampleSnippet(sample)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {props.samples.find((s) => s.id === props.selectedSampleId) ? (
                <SamplePreview sample={props.samples.find((s) => s.id === props.selectedSampleId)!} />
              ) : null}
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function CsatRateFilter(props: {
  csatRates: number[];
  csatIncludeNone: boolean;
  disabled: boolean;
  onChange: (patch: { csatRates?: number[]; csatIncludeNone?: boolean }) => void;
}) {
  const toggleRate = (rate: number) => {
    const next = props.csatRates.includes(rate)
      ? props.csatRates.filter((value) => value !== rate)
      : [...props.csatRates, rate];
    props.onChange({ csatRates: next });
  };
  return (
    <div className="space-y-1">
      <span className="block text-[10px] font-medium text-[var(--fg-tertiary)]">CSAT</span>
      <div className="flex flex-wrap gap-1">
        {[1, 2, 3, 4, 5].map((rate) => (
          <button
            key={rate}
            type="button"
            aria-pressed={props.csatRates.includes(rate)}
            disabled={props.disabled}
            onClick={() => toggleRate(rate)}
            className={`truncate rounded-full border px-2 py-1 text-[11px] font-semibold transition disabled:opacity-50 ${
              props.csatRates.includes(rate)
                ? "border-[var(--brand)] bg-[var(--brand-subtle)] text-[var(--brand-hover)]"
                : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--fg-secondary)] hover:bg-[var(--bg-muted)]"
            }`}
          >
            {rate}점
          </button>
        ))}
        <button
          type="button"
          aria-pressed={props.csatIncludeNone}
          disabled={props.disabled}
          onClick={() => props.onChange({ csatIncludeNone: !props.csatIncludeNone })}
          className={`truncate rounded-full border px-2 py-1 text-[11px] font-semibold transition disabled:opacity-50 ${
            props.csatIncludeNone
              ? "border-[var(--brand)] bg-[var(--brand-subtle)] text-[var(--brand-hover)]"
              : "border-[var(--border-subtle)] bg-[var(--bg-canvas)] text-[var(--fg-secondary)] hover:bg-[var(--bg-muted)]"
          }`}
        >
          미참여
        </button>
      </div>
      <p className="text-[11px] text-[var(--fg-tertiary)]">선택하지 않으면 점수와 미참여를 모두 포함합니다.</p>
    </div>
  );
}

function SamplePreview({ sample }: { sample: ReplyPolishSample }) {
  return (
    <div className="space-y-3">
      <div className="text-[12px] text-[var(--fg-secondary)]">
        CSAT {sample.csatRate != null ? `${Math.round(sample.csatRate)}점` : "미참여"}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <article className="qms-card p-3">
          <div className="mb-1 text-[11px] font-bold text-[var(--fg-tertiary)]">문의</div>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-[13px]">{sample.inquiry}</pre>
        </article>
        <article className="qms-card p-3">
          <div className="mb-1 text-[11px] font-bold text-[var(--fg-tertiary)]">당근이 답변</div>
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words text-[13px]">{sample.answer}</pre>
        </article>
      </div>
    </div>
  );
}

function TemplatesTab(props: {
  templates: ReplyPolishTemplate[];
  loading: boolean;
  selectedId: string | null;
  draftName: string;
  draftBody: string;
  busy: boolean;
  previewBusy: boolean;
  previewText: string | null;
  selectedSample: ReplyPolishSample | null;
  onSelect: (id: string) => void;
  onName: (v: string) => void;
  onBody: (v: string) => void;
  onInsertVar: (name: string) => void;
  onSave: () => void;
  onNew: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onPreview: () => void;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
      <aside className="qms-card max-h-[40rem] overflow-auto p-2">
        <div className="mb-2 flex items-center justify-between px-1">
          <span className="text-[11px] font-bold text-[var(--fg-tertiary)]">템플릿</span>
          <button type="button" className="qms-btn-ghost !h-7 !px-2" onClick={props.onNew} disabled={props.busy}>
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        {props.loading ? <p className="px-2 py-3 text-[12px] text-[var(--fg-tertiary)]">불러오는 중…</p> : null}
        {props.templates.map((tpl) => (
          <button
            key={tpl.id}
            type="button"
            className={`mb-1 w-full rounded-[8px] px-2 py-2 text-left text-[12px] ${
              tpl.id === props.selectedId ? "bg-[var(--brand-subtle)] font-bold" : "hover:bg-[var(--bg-muted)]"
            }`}
            onClick={() => props.onSelect(tpl.id)}
          >
            {tpl.name}
          </button>
        ))}
      </aside>
      <section className="space-y-3">
        <input className="qms-input font-semibold" value={props.draftName} onChange={(e) => props.onName(e.target.value)} />
        <div className="flex flex-wrap gap-1">
          {REPLY_POLISH_VARS.map((v) => (
            <button key={v.name} type="button" className="qms-btn-ghost !h-7 !text-[11px]" onClick={() => props.onInsertVar(v.name)}>
              {`{{${v.name}}}`}
            </button>
          ))}
        </div>
        <textarea
          className="qms-textarea min-h-[18rem] font-mono text-[12.5px] leading-relaxed"
          value={props.draftBody}
          onChange={(e) => props.onBody(e.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="qms-btn-primary inline-flex items-center" disabled={props.busy} onClick={props.onSave}>
            <Save className="mr-1 h-3.5 w-3.5" />
            저장
          </button>
          <button type="button" className="qms-btn-ghost inline-flex items-center" disabled={props.busy || !props.selectedId} onClick={props.onDuplicate}>
            <Copy className="mr-1 h-3.5 w-3.5" />
            복제
          </button>
          <button type="button" className="qms-btn-ghost inline-flex items-center" disabled={props.busy || !props.selectedId} onClick={props.onDelete}>
            <Trash2 className="mr-1 h-3.5 w-3.5" />
            삭제
          </button>
          <button
            type="button"
            className="qms-btn-ghost inline-flex items-center"
            disabled={props.previewBusy || !props.selectedSample}
            onClick={props.onPreview}
          >
            {props.previewBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
            {props.selectedSample ? `스레드 ${props.selectedSample.threadId}로 미리보기` : "샘플을 먼저 뽑으세요"}
          </button>
        </div>
        {props.previewText != null && props.selectedSample ? (
          <ReplyPolishDiffText
            left={props.selectedSample.answer}
            right={props.previewText}
            leftLabel="원문 (당근이)"
            rightLabel="미리보기"
          />
        ) : null}
      </section>
    </div>
  );
}

function CompareTab(props: {
  templates: ReplyPolishTemplate[];
  samples: ReplyPolishSample[];
  selectedSample: ReplyPolishSample | null;
  templateA: string;
  templateB: string;
  tplA: ReplyPolishTemplate | null;
  tplB: ReplyPolishTemplate | null;
  diffMode: DiffMode;
  busy: boolean;
  run: ReplyPolishRun | null;
  runInFlight: boolean;
  resultA?: ReplyPolishResult;
  resultB?: ReplyPolishResult;
  latestResults: Map<string, ReplyPolishResult>;
  onTemplateA: (id: string) => void;
  onTemplateB: (id: string) => void;
  onDiffMode: (mode: DiffMode) => void;
  onSelectSample: (id: string) => void;
  onRun: () => void;
}) {
  const leftText =
    props.diffMode === "templates" ? (props.resultA?.polishedText ?? "") : (props.selectedSample?.answer ?? "");
  const rightText =
    props.diffMode === "templates"
      ? (props.resultB?.polishedText ?? "")
      : (props.resultA?.polishedText ?? props.resultB?.polishedText ?? "");
  const leftLabel = props.diffMode === "templates" ? (props.tplA?.name ?? "템플릿 A") : "원문 (당근이)";
  const rightLabel =
    props.diffMode === "templates"
      ? (props.tplB?.name ?? "템플릿 B")
      : (props.resultA ? props.tplA?.name : props.tplB?.name) ?? "다듬기 결과";

  return (
    <div className="space-y-4">
      <section className="qms-card grid gap-3 p-4 md:grid-cols-4">
        <label className="text-[12px] font-semibold text-[var(--fg-secondary)]">
          템플릿 A
          <select className="qms-select mt-1" value={props.templateA} onChange={(e) => props.onTemplateA(e.target.value)}>
            <option value="">선택</option>
            {props.templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[12px] font-semibold text-[var(--fg-secondary)]">
          템플릿 B
          <select className="qms-select mt-1" value={props.templateB} onChange={(e) => props.onTemplateB(e.target.value)}>
            <option value="">없음</option>
            {props.templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-[12px] font-semibold text-[var(--fg-secondary)]">
          하이라이트
          <select
            className="qms-select mt-1"
            value={props.diffMode}
            onChange={(e) => props.onDiffMode(e.target.value as DiffMode)}
          >
            <option value="original">원문 대비</option>
            <option value="templates">템플릿끼리</option>
          </select>
        </label>
        <div className="flex items-end">
          <button type="button" className="qms-btn-primary w-full" disabled={props.busy || !props.samples.length} onClick={props.onRun}>
            {props.busy ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : "선택 템플릿으로 다듬기"}
          </button>
        </div>
      </section>

      {props.run ? (
        <p className="text-[13px] text-[var(--fg-secondary)]">
          진행 {props.run.done + props.run.failed}/{props.run.total}
          {props.run.failed ? ` · 실패 ${props.run.failed}` : ""}
          {props.runInFlight ? " · 실행 중" : props.run.status === "done" ? " · 완료" : ""}
        </p>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
        <div className="qms-card max-h-[36rem] overflow-auto">
          <table className="qms-table">
            <thead>
              <tr>
                <th>스레드</th>
                <th>A</th>
                <th>B</th>
              </tr>
            </thead>
            <tbody>
              {props.samples.map((sample) => {
                const a = props.latestResults.get(`${sample.id}:${props.templateA}`);
                const b = props.templateB ? props.latestResults.get(`${sample.id}:${props.templateB}`) : undefined;
                return (
                  <tr
                    key={sample.id}
                    className={sample.id === props.selectedSample?.id ? "qms-row-active" : "cursor-pointer"}
                    onClick={() => props.onSelectSample(sample.id)}
                  >
                    <td className="max-w-[12rem] truncate font-mono text-[12px]">{sample.threadId}</td>
                    <td>{statusMark(a)}</td>
                    <td>{props.templateB ? statusMark(b) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="space-y-3">
          {props.selectedSample ? (
            <>
              <div className="text-[12px] text-[var(--fg-secondary)]">
                {props.selectedSample.category || "(없음)"} · 스레드 {props.selectedSample.threadId}
              </div>
              {props.diffMode === "original" && props.resultA?.polishedText && props.resultB?.polishedText ? (
                <div className="space-y-4">
                  <ReplyPolishDiffText
                    left={props.selectedSample.answer}
                    right={props.resultA.polishedText}
                    leftLabel="원문 (당근이)"
                    rightLabel={props.tplA?.name ?? "템플릿 A"}
                  />
                  <ReplyPolishDiffText
                    left={props.selectedSample.answer}
                    right={props.resultB.polishedText}
                    leftLabel="원문 (당근이)"
                    rightLabel={props.tplB?.name ?? "템플릿 B"}
                  />
                </div>
              ) : leftText || rightText ? (
                <ReplyPolishDiffText left={leftText} right={rightText} leftLabel={leftLabel} rightLabel={rightLabel} />
              ) : (
                <p className="text-[13px] text-[var(--fg-tertiary)]">아직 다듬기 결과가 없습니다. 위에서 실행하세요.</p>
              )}
              {props.resultA?.error ? <p className="text-[12px] text-[var(--danger)]">A: {props.resultA.error}</p> : null}
              {props.resultB?.error ? <p className="text-[12px] text-[var(--danger)]">B: {props.resultB.error}</p> : null}
            </>
          ) : (
            <p className="text-[13px] text-[var(--fg-tertiary)]">샘플 탭에서 샘플을 먼저 뽑으세요.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function statusMark(result?: ReplyPolishResult): string {
  if (!result) return "·";
  if (result.status === "done") return "✓";
  if (result.status === "error") return "!";
  if (result.status === "running") return "…";
  return "○";
}
