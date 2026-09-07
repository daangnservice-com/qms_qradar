"use client";

import { useCallback, useMemo, useState } from "react";
import { ArrowLeft, ClipboardList, FilePlus, Loader2, Save, Star } from "lucide-react";
import {
  DEFAULT_BASE_PROMPT,
  DEFAULT_CHECKLIST_TEMPLATE,
  DEFAULT_TEXT_BASE_PROMPT,
  DEFAULT_TEXT_CHECKLIST_TEMPLATE,
  PROMPT_TEMPLATE_KEYS,
  PROMPT_CHANNEL_CONFIG,
  defaultPromptSeed,
  promptChannelForTemplateKey,
  type PromptTemplateKey,
  type PromptChannel,
} from "@/lib/promptDefaults";
import type {
  AudioPipelineConfig,
  CriterionPrompt,
  EvalCriterionBinding,
  OutputSchemaConfig,
  PromptVersion,
  ResultParseConfig,
  SchemaField,
  SourceCriterion,
} from "@/lib/promptTypes";
import {
  DEFAULT_AUDIO_PIPELINE_CONFIG,
  DEFAULT_OUTPUT_SCHEMA_CONFIG,
  DEFAULT_RESULT_PARSE_CONFIG,
  DEFAULT_SCORE_FIELDS,
  RECOMMENDED_METRIC_FIELDS,
  TEXT_AUDIO_PIPELINE_CONFIG,
} from "@/lib/promptTypes";
import type { SchemaFieldSource, SchemaValueType } from "@/lib/promptTypes";
import { SCHEMA_FIELD_KEY_RE } from "@/lib/outputSchema";
import {
  AUDIO_STEP_LABELS,
  DEFAULT_INJECT_VARS,
  INJECT_VAR_LABELS,
  parseAudioPipelineConfig,
  type AudioPipelineStepId,
} from "@/lib/audioPipeline";
import { previewFinalPrompt } from "@/lib/promptRender";
import type { CsCriterion } from "@/lib/csChecklist";
import { buildCriterionVersionLabel } from "@/lib/criterionVersionLabel";
import { cacheInvalidate } from "@/lib/clientCache";
import { useCachedFetch } from "@/lib/useCachedFetch";

type EvalPayload = {
  templateKeys: PromptTemplateKey[];
  vars: { name: string; desc: string }[];
  versions: PromptVersion[];
  production: PromptVersion;
};

type CriteriaPayload = {
  source: SourceCriterion[];
  prompts: CriterionPrompt[];
};

type SheetRow = PromptVersion & { templateKey: PromptTemplateKey };

type ListPayload = {
  templateKeys: PromptTemplateKey[];
  rows: SheetRow[];
};

const SHEET_LABEL: Record<PromptTemplateKey, string> = {
  call_eval_growth: "그로스 CS 체크리스트",
  call_eval_pay: "페이 콜 품질",
  feedback_eval: "인앱 문의 텍스트 평가",
  chatcs_eval: "채팅상담 텍스트 평가",
};

const TEMPLATE_CARDS: {
  key: PromptTemplateKey | "blank";
  name: string;
  desc: string;
  meta: string;
}[] = [
  {
    key: "call_eval_growth",
    name: "그로스 CS 체크리스트",
    desc: "Hot/Cold 판정 + CS 감점 체크리스트가 포함된 기본 평가표",
    meta: "다회 사용 템플릿",
  },
  {
    key: "call_eval_pay",
    name: "페이 콜 품질",
    desc: "페이 조직용 점수 중심 평가표 (체크리스트 선택)",
    meta: "다회 사용 템플릿",
  },
  {
    key: "feedback_eval",
    name: "인앱 문의 텍스트 평가",
    desc: "문의·답변 원문을 근거로 평가하는 인앱 문의 전용 평가표",
    meta: "텍스트 채널",
  },
  {
    key: "chatcs_eval",
    name: "채팅상담 텍스트 평가",
    desc: "채팅 대화 원문을 근거로 평가하는 채팅상담 전용 평가표",
    meta: "텍스트 채널",
  },
  {
    key: "blank",
    name: "빈 평가표",
    desc: "항목·프롬프트를 처음부터 구성합니다",
    meta: "초안부터",
  },
];

const CHANNEL_TABS: { key: PromptChannel; label: string; description: string }[] = [
  { key: "phone", label: "콜", description: "녹취·STT·신호 분석을 사용하는 전화 평가셋" },
  { key: "feedback", label: "인앱문의", description: "문의·상담사 답변 원문을 사용하는 평가셋" },
  { key: "chatcs", label: "채팅", description: "채팅 대화 원문을 사용하는 평가셋" },
];

function copyOutputCfg(cfg: OutputSchemaConfig = DEFAULT_OUTPUT_SCHEMA_CONFIG): OutputSchemaConfig {
  return {
    ...cfg,
    checklistFields: { ...cfg.checklistFields },
    scoreFields: (cfg.scoreFields?.length ? cfg.scoreFields : DEFAULT_SCORE_FIELDS).map((f) => ({ ...f })),
    overallSummaryFields: (cfg.overallSummaryFields ?? []).map((f) => ({ ...f })),
  };
}

function nextFieldKey(fields: SchemaField[], prefix: string): string {
  const used = new Set(fields.map((f) => f.key));
  if (!used.has(prefix)) return prefix;
  let i = 2;
  while (used.has(`${prefix}${i}`)) i += 1;
  return `${prefix}${i}`;
}

function reindexFields(fields: SchemaField[]): SchemaField[] {
  return fields.map((f, i) => ({ ...f, sortOrder: i + 1 }));
}

function SchemaFieldList({
  fields,
  onChange,
  keyPrefix,
  emptyHint,
  showMetricMeta,
}: {
  fields: SchemaField[];
  onChange: (next: SchemaField[]) => void;
  keyPrefix: string;
  emptyHint?: string;
  /** 점수 항목: type/source/definition 편집 */
  showMetricMeta?: boolean;
}) {
  const sorted = [...fields].sort((a, b) => a.sortOrder - b.sortOrder);
  const update = (i: number, patch: Partial<SchemaField>) => {
    const next = sorted.map((f, idx) => (idx === i ? { ...f, ...patch } : f));
    onChange(reindexFields(next));
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= sorted.length) return;
    const next = [...sorted];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(reindexFields(next));
  };
  return (
    <div className="mt-2 space-y-1.5">
      {sorted.length === 0 && emptyHint ? (
        <p className="text-[11px] leading-snug text-[var(--fg-tertiary)]">{emptyHint}</p>
      ) : null}
      {sorted.map((f, i) => (
        <div key={`${f.key}-${i}`} className="space-y-1 rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-1.5">
          <div className="flex items-center gap-1">
            <input
              className="qms-input !h-7 min-w-0 flex-1 !px-1.5 !text-[11px]"
              value={f.label}
              placeholder="라벨"
              onChange={(e) => update(i, { label: e.target.value })}
            />
            <input
              className="qms-input !h-7 w-[5.5rem] shrink-0 !px-1.5 !font-mono !text-[11px]"
              value={f.key}
              placeholder="key"
              onChange={(e) => update(i, { key: e.target.value.trim() })}
              onBlur={() => {
                if (!SCHEMA_FIELD_KEY_RE.test(f.key) || sorted.filter((x) => x.key === f.key).length > 1) {
                  update(i, { key: nextFieldKey(sorted.filter((_, idx) => idx !== i), keyPrefix) });
                }
              }}
            />
            <button type="button" className="qms-btn-ghost !h-7 !px-1.5 text-[11px]" disabled={i === 0} onClick={() => move(i, -1)}>
              ↑
            </button>
            <button
              type="button"
              className="qms-btn-ghost !h-7 !px-1.5 text-[11px]"
              disabled={i === sorted.length - 1}
              onClick={() => move(i, 1)}
            >
              ↓
            </button>
            <button
              type="button"
              className="qms-btn-ghost !h-7 !px-1.5 text-[11px] text-[var(--danger)]"
              onClick={() => onChange(reindexFields(sorted.filter((_, idx) => idx !== i)))}
            >
              삭제
            </button>
          </div>
          {showMetricMeta ? (
            <>
              <div className="flex flex-wrap gap-1">
                <select
                  className="qms-input !h-7 !w-auto !px-1.5 !text-[11px]"
                  value={f.valueType ?? "score"}
                  onChange={(e) => update(i, { valueType: e.target.value as SchemaValueType })}
                >
                  <option value="score">score 1~5</option>
                  <option value="percent">percent</option>
                  <option value="bool">bool</option>
                  <option value="label">label</option>
                </select>
                <select
                  className="qms-input !h-7 !w-auto !px-1.5 !text-[11px]"
                  value={f.source ?? "llm"}
                  onChange={(e) => update(i, { source: e.target.value as SchemaFieldSource })}
                >
                  <option value="llm">llm</option>
                  <option value="signal">signal</option>
                </select>
              </div>
              <textarea
                className="qms-input !min-h-[2.5rem] w-full !px-1.5 !py-1 !text-[11px]"
                value={f.definition ?? ""}
                placeholder="정의·판정 기준 (프롬프트 {{score_items}}에 주입)"
                onChange={(e) => update(i, { definition: e.target.value })}
              />
            </>
          ) : null}
        </div>
      ))}
      <button
        type="button"
        className="qms-btn-ghost !h-7 !px-2 text-[11px]"
        onClick={() =>
          onChange(
            reindexFields([
              ...sorted,
              {
                key: nextFieldKey(sorted, keyPrefix),
                label: keyPrefix === "summary" && !sorted.length ? "총평" : "",
                sortOrder: sorted.length + 1,
                ...(showMetricMeta ? { valueType: "score" as const, source: "llm" as const } : {}),
              },
            ]),
          )
        }
      >
        필드 추가
      </button>
    </div>
  );
}

function bindingCount(v: PromptVersion): number {
  return v.criterionBindings?.filter((b) => b.enabled).length ?? v.selectedCriterionIds?.length ?? 0;
}

export default function EvalSheetsWorkbench() {
  const [view, setView] = useState<"list" | "detail">("list");
  const [channelTab, setChannelTab] = useState<PromptChannel>("phone");
  const [templateKey, setTemplateKey] = useState<PromptTemplateKey>("call_eval_growth");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [versionLabel, setVersionLabel] = useState("");
  /** 저장 시 YYMMDD_verN 뒤에 붙는 선택 문구 */
  const [versionNote, setVersionNote] = useState("");
  const [basePrompt, setBasePrompt] = useState("");
  const [checklistTemplate, setChecklistTemplate] = useState("");
  const [useChecklist, setUseChecklist] = useState(true);
  const [bindings, setBindings] = useState<EvalCriterionBinding[]>([]);
  const [outputCfg, setOutputCfg] = useState<OutputSchemaConfig>(DEFAULT_OUTPUT_SCHEMA_CONFIG);
  const [resultParseCfg, setResultParseCfg] = useState<ResultParseConfig>(DEFAULT_RESULT_PARSE_CONFIG);
  const [audioCfg, setAudioCfg] = useState<AudioPipelineConfig>(DEFAULT_AUDIO_PIPELINE_CONFIG);
  const [changeNote, setChangeNote] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  /** 기존 버전을 연 게 아니라 템플릿/새로 만들기로 연 초안 */
  const [isNewDraft, setIsNewDraft] = useState(false);
  /** 포함 항목 카테고리 필터 ("all" = 전체) */
  const [itemCategory, setItemCategory] = useState<string>("all");

  const fetchList = useCallback(async (): Promise<ListPayload> => {
    const parts = await Promise.all(
      PROMPT_TEMPLATE_KEYS.map(async (k) => {
        const r = await fetch(`/api/prompts?templateKey=${encodeURIComponent(k)}`);
        const data = await r.json();
        if (!r.ok) throw new Error(data.error ?? `${k} 로드 실패`);
        return { key: k, versions: (data.versions ?? []) as PromptVersion[] };
      }),
    );
    const rows: SheetRow[] = parts.flatMap((p) =>
      p.versions.map((v) => ({ ...v, templateKey: p.key })),
    );
    rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    return { templateKeys: [...PROMPT_TEMPLATE_KEYS], rows };
  }, []);

  const {
    data: listData,
    loading: listLoading,
    error: listErr,
    refresh: refreshList,
  } = useCachedFetch<ListPayload>({
    key: "promptVersions:all:v1",
    fetcher: fetchList,
  });

  const fetchEval = useCallback(async () => {
    const r = await fetch(`/api/prompts?templateKey=${encodeURIComponent(templateKey)}`);
    const data = await r.json();
    if (!r.ok) throw new Error(data.error ?? "평가표 로드 실패");
    return data as EvalPayload;
  }, [templateKey]);

  const {
    data: evalMeta,
    loading,
    error: loadErr,
    refresh,
  } = useCachedFetch<EvalPayload>({
    key: `promptVersions:${templateKey}`,
    fetcher: fetchEval,
  });

  const { data: criteriaData } = useCachedFetch<CriteriaPayload>({
    key: "criterionPrompts",
    fetcher: async () => {
      const r = await fetch("/api/prompts/criteria");
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "항목 로드 실패");
      return { source: data.source ?? [], prompts: data.prompts ?? [] };
    },
  });

  const applyVersion = useCallback((v: PromptVersion, key: PromptTemplateKey) => {
    const channel = promptChannelForTemplateKey(key);
    const textChannel = PROMPT_CHANNEL_CONFIG[channel].modality === "text";
    setChannelTab(channel);
    setTemplateKey(key);
    setSelectedVersionId(v.versionId);
    setVersionLabel(v.versionLabel);
    setVersionNote("");
    setBasePrompt(v.basePrompt);
    setChecklistTemplate(v.checklistTemplate);
    setUseChecklist(v.useChecklist);
    setBindings(
      v.criterionBindings?.length
        ? v.criterionBindings
        : (v.selectedCriterionIds ?? []).map((id) => ({
            criterionId: id,
            promptId: "",
            enabled: true,
          })),
    );
    const nextOutputCfg = copyOutputCfg(v.outputSchemaConfig ?? DEFAULT_OUTPUT_SCHEMA_CONFIG);
    if (textChannel) {
      nextOutputCfg.includeSilenceComments = false;
      nextOutputCfg.includeAgentSpeakerTag = false;
    }
    setOutputCfg(nextOutputCfg);
    setResultParseCfg(v.resultParseConfig ?? DEFAULT_RESULT_PARSE_CONFIG);
    setAudioCfg(
      parseAudioPipelineConfig(
        textChannel ? TEXT_AUDIO_PIPELINE_CONFIG : (v.audioPipelineConfig ?? DEFAULT_AUDIO_PIPELINE_CONFIG),
      ),
    );
    setChangeNote("");
    setIsNewDraft(false);
  }, []);

  const applyTemplateSeed = useCallback((key: PromptTemplateKey | "blank") => {
    if (key === "blank") {
      const blankTemplateKey = PROMPT_CHANNEL_CONFIG[channelTab].defaultTemplateKey;
      setTemplateKey(blankTemplateKey);
      setSelectedVersionId(null);
      setVersionLabel("");
      setVersionNote("");
      setBasePrompt("");
      setChecklistTemplate("");
      setUseChecklist(true);
      setBindings([]);
      setOutputCfg(copyOutputCfg());
      setResultParseCfg({ ...DEFAULT_RESULT_PARSE_CONFIG });
      setAudioCfg(
        parseAudioPipelineConfig(
          PROMPT_CHANNEL_CONFIG[channelTab].modality === "text"
            ? TEXT_AUDIO_PIPELINE_CONFIG
            : DEFAULT_AUDIO_PIPELINE_CONFIG,
        ),
      );
      setChangeNote("빈 평가표에서 생성");
      setIsNewDraft(true);
      return;
    }
    const seed = defaultPromptSeed(key);
    const channel = promptChannelForTemplateKey(key);
    setChannelTab(channel);
    setTemplateKey(key);
    setSelectedVersionId(null);
    setVersionLabel("");
    setVersionNote("");
    setBasePrompt(seed.basePrompt);
    setChecklistTemplate(seed.checklistTemplate);
    setUseChecklist(seed.useChecklist);
    setBindings(
      seed.selectedCriterionIds.map((id) => ({
        criterionId: id,
        promptId: "",
        enabled: true,
      })),
    );
    setOutputCfg(copyOutputCfg(seed.outputSchemaConfig));
    setResultParseCfg(seed.resultParseConfig);
    setAudioCfg(
      parseAudioPipelineConfig(
        PROMPT_CHANNEL_CONFIG[channel].modality === "text"
          ? TEXT_AUDIO_PIPELINE_CONFIG
          : DEFAULT_AUDIO_PIPELINE_CONFIG,
      ),
    );
    setChangeNote(`${SHEET_LABEL[key]} 템플릿으로 생성`);
    setIsNewDraft(true);
  }, [channelTab]);

  const openDetailFromRow = (row: SheetRow) => {
    applyVersion(row, row.templateKey);
    setView("detail");
    setOk(null);
    setError(null);
  };

  const openFromTemplate = (key: PromptTemplateKey | "blank") => {
    applyTemplateSeed(key);
    setView("detail");
    setOk(null);
    setError(null);
  };

  const backToList = () => {
    setView("list");
    setOk(null);
    setError(null);
    void refreshList();
  };

  const source = criteriaData?.source ?? [];
  const prompts = criteriaData?.prompts ?? [];
  const promptsByCrit = useMemo(() => {
    const m = new Map<number, CriterionPrompt[]>();
    for (const p of prompts) {
      const list = m.get(p.criterionId) ?? [];
      list.push(p);
      m.set(p.criterionId, list);
    }
    for (const [, list] of m) list.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    return m;
  }, [prompts]);

  const itemCategories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of source) {
      const cat = (s.parentName || "").trim() || "(미분류)";
      counts.set(cat, (counts.get(cat) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [source]);

  const filteredSource = useMemo(() => {
    if (itemCategory === "all") return source;
    return source.filter((s) => ((s.parentName || "").trim() || "(미분류)") === itemCategory);
  }, [source, itemCategory]);

  const previewCriteria: CsCriterion[] = useMemo(() => {
    return bindings
      .filter((b) => b.enabled)
      .map((b) => {
        const src = source.find((s) => s.id === b.criterionId);
        const p =
          (b.promptId && prompts.find((x) => x.promptId === b.promptId)) ||
          promptsByCrit.get(b.criterionId)?.[0];
        return {
          id: b.criterionId,
          category: src?.parentName ?? p?.category ?? "",
          label: src?.name ?? p?.label ?? String(b.criterionId),
          hint: p?.fields?.definition ?? "",
          fields: p?.fields ?? {},
        };
      });
  }, [bindings, source, prompts, promptsByCrit]);

  const previewText = useMemo(
    () =>
      previewFinalPrompt({
        basePrompt,
        checklistTemplate,
        criteria: previewCriteria,
        useChecklist,
        outputSchemaConfig: outputCfg,
      }),
    [basePrompt, checklistTemplate, previewCriteria, useChecklist, outputCfg],
  );

  const existingVersionLabels = useMemo(
    () => (evalMeta?.versions ?? []).map((v) => v.versionLabel),
    [evalMeta?.versions],
  );
  const previewVersionLabel = useMemo(
    () => buildCriterionVersionLabel(versionNote, existingVersionLabels),
    [versionNote, existingVersionLabels],
  );

  const toggleStep = (id: AudioPipelineStepId) => {
    setAudioCfg((prev) => ({
      steps: prev.steps.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)),
    }));
  };

  const updateStepParam = (id: AudioPipelineStepId, patch: Partial<(typeof audioCfg.steps)[0]>) => {
    setAudioCfg((prev) => ({
      steps: prev.steps.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    }));
  };

  const toggleInjectVarGroup = (group: "silences" | "stt_script" | "overlaps") => {
    setAudioCfg((prev) => ({
      steps: prev.steps.map((s) => {
        if (s.id !== "inject_prompt_vars") return s;
        const cur = new Set(s.vars?.length ? s.vars : DEFAULT_INJECT_VARS);
        if (group === "silences") {
          const on = cur.has("silences") || cur.has("silence_summary");
          if (on) {
            cur.delete("silences");
            cur.delete("silence_summary");
          } else {
            cur.add("silences");
            cur.add("silence_summary");
          }
        } else if (cur.has(group)) cur.delete(group);
        else cur.add(group);
        return { ...s, vars: DEFAULT_INJECT_VARS.filter((v) => cur.has(v)) };
      }),
    }));
  };

  const afterSaveRefresh = async () => {
    cacheInvalidate(`promptVersions:${templateKey}`);
    cacheInvalidate("promptVersions:all:v1");
    await Promise.all([refresh(), refreshList()]);
  };

  const saveEval = async (promote: boolean) => {
    setBusy(true);
    setError(null);
    setOk(null);
    const outputSchemaConfig = isTextChannel
      ? { ...outputCfg, includeSilenceComments: false, includeAgentSpeakerTag: false }
      : outputCfg;
    try {
      const r = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save",
          templateKey,
          versionNote,
          basePrompt,
          checklistTemplate,
          useChecklist,
          criterionBindings: bindings,
          outputSchemaConfig,
          resultParseConfig: resultParseCfg,
          audioPipelineConfig: isTextChannel ? TEXT_AUDIO_PIPELINE_CONFIG : audioCfg,
          changeNote,
          promote,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "저장 실패");
      setOk(
        promote
          ? `저장 후 운영 지정됨 · ${data.version?.versionLabel ?? previewVersionLabel}`
          : `draft 저장됨 · ${data.version?.versionLabel ?? previewVersionLabel}`,
      );
      setIsNewDraft(false);
      setVersionNote("");
      if (data.version?.versionId) setSelectedVersionId(data.version.versionId);
      if (data.version?.versionLabel) setVersionLabel(data.version.versionLabel);
      await afterSaveRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const promoteSelected = async () => {
    if (!selectedVersionId || selectedVersionId === "hardcoded-fallback") {
      setError("저장된 버전을 선택하세요");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "setProduction",
          templateKey,
          versionId: selectedVersionId,
          note: changeNote || "운영 버전 지정",
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "운영 지정 실패");
      setOk("운영 버전으로 지정됨");
      await afterSaveRefresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const seedDraft = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "seedChecklistDraft", templateKey, promote: true }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "초안 시드 실패");
      setOk(`CS_CHECKLIST 초안 시드: ${data.version?.versionLabel ?? ""}`);
      cacheInvalidate("criterionPrompts");
      await afterSaveRefresh();
      if (data.version) applyVersion(data.version as PromptVersion, templateKey);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const err = error ?? (view === "list" ? listErr : loadErr);
  const sheetTitle = SHEET_LABEL[templateKey] ?? templateKey;
  const itemCount = bindings.filter((b) => b.enabled).length;
  const promptChannel = promptChannelForTemplateKey(templateKey);
  const channelConfig = PROMPT_CHANNEL_CONFIG[promptChannel];
  const isTextChannel = channelConfig.modality === "text";
  const channelRows = (listData?.rows ?? []).filter((row) =>
    channelConfig.templateKeys.includes(row.templateKey),
  );
  const channelTemplateCards = TEMPLATE_CARDS.filter(
    (card) => card.key === "blank" || channelConfig.templateKeys.includes(card.key),
  );

  if (view === "list") {
    return (
      <div className="qms-page-body space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--fg-tertiary)]">평가 설계</div>
            <h1 className="mt-1 text-[22px] font-extrabold tracking-tight">평가표</h1>
            <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-[var(--fg-secondary)]">
              <strong className="font-semibold text-[var(--fg-primary)]">평가표</strong>는 다회 사용하는 평가 기준·프롬프트
              모음 템플릿입니다.{" "}
              <strong className="font-semibold text-[var(--fg-primary)]">평가 세션</strong>은 1회 평가를 위해 평가표
              스냅샷(기준·프롬프트)과 관련 정보를 고정한 실행 단위입니다. 아래 목록에서 버전을 고르거나 템플릿으로 새
              평가표를 만드세요.
            </p>
          </div>
        </header>

        <div className="qms-card flex flex-wrap items-center gap-1 p-1.5">
          {CHANNEL_TABS.map((tab) => {
            const active = channelTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                className={`flex-1 rounded-[var(--radius-md)] px-3 py-2 text-left transition ${
                  active
                    ? "bg-[var(--brand-subtle)] text-[var(--brand)]"
                    : "text-[var(--fg-secondary)] hover:bg-[var(--bg-muted)]"
                }`}
                onClick={() => {
                  setChannelTab(tab.key);
                  setTemplateKey(PROMPT_CHANNEL_CONFIG[tab.key].defaultTemplateKey);
                  setItemCategory("all");
                }}
              >
                <span className="block text-[13px] font-bold">{tab.label}</span>
                <span className="mt-0.5 block text-[11px] text-[var(--fg-tertiary)]">{tab.description}</span>
              </button>
            );
          })}
        </div>

        {err && (
          <div className="rounded-[var(--radius-md)] bg-[var(--danger-subtle)] px-3 py-2 text-[13px] text-[var(--danger)]">
            {err}
          </div>
        )}
        {ok && (
          <div className="rounded-[var(--radius-md)] bg-[var(--success-subtle)] px-3 py-2 text-[13px] text-[var(--c-green-600)]">
            {ok}
          </div>
        )}

        <section>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <h2 className="text-[15px] font-bold">새로 만들기</h2>
            <span className="text-[12px] text-[var(--fg-tertiary)]">템플릿을 고르거나 빈 평가표로 시작</span>
            <button
              type="button"
              className="qms-btn-primary ml-auto"
              onClick={() => openFromTemplate("blank")}
            >
              <FilePlus className="mr-1 inline h-3.5 w-3.5" />
              새 평가표
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {channelTemplateCards.map((tp) => (
              <button
                key={tp.key}
                type="button"
                onClick={() => openFromTemplate(tp.key)}
                className="qms-card flex flex-col p-4 text-left transition hover:border-[var(--brand)]"
              >
                <div className="flex items-center gap-2">
                  <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[var(--brand-subtle)] text-[var(--brand-hover)]">
                    <ClipboardList className="h-4 w-4" />
                  </span>
                  <span className="text-[14px] font-bold">{tp.name}</span>
                </div>
                <p className="mt-2 flex-1 text-[13px] leading-relaxed text-[var(--fg-secondary)]">{tp.desc}</p>
                <div className="mt-3 flex items-center text-[12px] text-[var(--fg-tertiary)]">
                  <span>{tp.meta}</span>
                  <span className="ml-auto font-semibold text-[var(--fg-primary)]">이 템플릿으로 →</span>
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="qms-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--border-subtle)] px-4 py-3">
            <h2 className="text-[14px] font-bold">버전 선택</h2>
            {listLoading && <Loader2 className="h-4 w-4 animate-spin text-[var(--fg-tertiary)]" />}
          </div>
          <div className="overflow-x-auto">
            <table className="qms-table">
              <thead>
                <tr>
                  <th>평가표</th>
                  <th>버전</th>
                  <th>항목</th>
                  <th>상태</th>
                  <th>수정일</th>
                </tr>
              </thead>
              <tbody>
                {listLoading && !(listData?.rows.length) ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center">
                      <Loader2 className="inline h-5 w-5 animate-spin" />
                    </td>
                  </tr>
                ) : listData?.rows.length ? (
                  channelRows.map((row) => (
                    <tr key={`${row.templateKey}:${row.versionId}`} onClick={() => openDetailFromRow(row)}>
                      <td className="font-semibold">{SHEET_LABEL[row.templateKey] ?? row.templateKey}</td>
                      <td>{row.versionLabel}</td>
                      <td>{bindingCount(row)}</td>
                      <td>
                        <span className={`qms-chip ${row.status === "production" ? "qms-chip-prod" : "qms-chip-draft"}`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="text-[12px] text-[var(--fg-tertiary)]">{row.createdAt?.slice(0, 16)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-[var(--fg-tertiary)]">
                      아직 버전이 없습니다. 템플릿으로 새 평가표를 만드세요.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="qms-page-body space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <button type="button" className="qms-btn-ghost mb-2 h-8 px-2 text-[13px]" onClick={backToList}>
            <ArrowLeft className="mr-1 inline h-3.5 w-3.5" />
            목록
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[20px] font-extrabold tracking-tight">{sheetTitle}</h1>
            <span className="qms-chip">
              {versionLabel || previewVersionLabel || "—"}
              {selectedVersionId && evalMeta?.production?.versionId === selectedVersionId
                ? " · production"
                : isNewDraft
                  ? " · 새 초안"
                  : ""}
            </span>
            <span className="text-[12px] text-[var(--fg-tertiary)]">항목 {itemCount}개</span>
          </div>
          <p className="mt-1 text-[13px] text-[var(--fg-secondary)]">
            {isTextChannel
              ? "평가표 상세 · 항목 바인딩 · 판정 · 텍스트 원문. 운영 지정된 버전은 평가 세션에서 스냅샷으로 고정됩니다."
              : "평가표 상세 · 항목 바인딩 · 판정 · 오디오. 운영 지정된 버전은 평가 세션에서 스냅샷으로 고정됩니다."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {!isTextChannel && (
            <button type="button" className="qms-btn-ghost" disabled={busy} onClick={() => void seedDraft()}>
              CS_CHECKLIST 초안 시드
            </button>
          )}
          <button type="button" className="qms-btn-ghost" disabled={busy} onClick={() => void saveEval(false)}>
            <Save className="mr-1 inline h-3.5 w-3.5" />
            draft 저장
          </button>
          <button type="button" className="qms-btn-primary" disabled={busy} onClick={() => void saveEval(true)}>
            {busy ? <Loader2 className="inline h-4 w-4 animate-spin" /> : null} 변경 저장 · 새 버전 발행
          </button>
        </div>
      </header>

      {err && (
        <div className="rounded-[var(--radius-md)] bg-[var(--danger-subtle)] px-3 py-2 text-[13px] text-[var(--danger)]">
          {err}
        </div>
      )}
      {ok && (
        <div className="rounded-[var(--radius-md)] bg-[var(--success-subtle)] px-3 py-2 text-[13px] text-[var(--c-green-600)]">
          {ok}
        </div>
      )}

      <div className="qms-layout-split">
        <div className="space-y-4">
          <section className="qms-card space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[14px] font-bold">평가표 상세</h2>
              {loading && <Loader2 className="h-4 w-4 animate-spin text-[var(--fg-tertiary)]" />}
            </div>
            <div>
              <div className="text-[12px] font-semibold text-[var(--fg-secondary)]">버전 라벨</div>
              <p className="mt-1 text-[11.5px] text-[var(--fg-tertiary)]">
                저장 시 <code className="text-[11px]">YYMMDD_verN</code> 형식으로 자동 부여합니다. 같은 날 저장할수록
                ver 번호가 올라갑니다.
              </p>
              <label className="mt-2 block text-[12px] font-semibold text-[var(--fg-secondary)]">
                추가 문구 (선택)
                <input
                  className="qms-input mt-1"
                  value={versionNote}
                  placeholder="비우면 YYMMDD_verN 만 저장"
                  onChange={(e) => setVersionNote(e.target.value)}
                />
              </label>
              <div className="mt-2 rounded-[var(--radius-md)] bg-[var(--bg-muted)] px-3 py-2 text-[12px]">
                <span className="text-[var(--fg-tertiary)]">저장될 라벨 </span>
                <code className="font-semibold">{previewVersionLabel}</code>
                {versionLabel ? (
                  <span className="ml-2 text-[11px] text-[var(--fg-tertiary)]">
                    (현재 {versionLabel})
                  </span>
                ) : null}
              </div>
            </div>
            <label className="block text-[12px] font-semibold text-[var(--fg-secondary)]">
              변경 메모
              <input className="qms-input mt-1" value={changeNote} onChange={(e) => setChangeNote(e.target.value)} />
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" checked={useChecklist} onChange={(e) => setUseChecklist(e.target.checked)} />
              AI 평가 항목(체크리스트) 사용
            </label>
            <label className="block text-[12px] font-semibold text-[var(--fg-secondary)]">
              기본 프롬프트
              <textarea
                className="qms-textarea mt-1 min-h-[160px]"
                value={basePrompt}
                onChange={(e) => setBasePrompt(e.target.value)}
                placeholder={(isTextChannel ? DEFAULT_TEXT_BASE_PROMPT : DEFAULT_BASE_PROMPT).slice(0, 80) + "…"}
              />
              <span className="mt-1 block text-[11px] font-normal text-[var(--fg-tertiary)]">
                {"{{score_items}}"} · {"{{overall_fields}}"} 로 출력 스키마 항목을 넣을 수 있습니다
              </span>
            </label>
            <label className="block text-[12px] font-semibold text-[var(--fg-secondary)]">
              체크리스트 템플릿
              <textarea
                className="qms-textarea mt-1 min-h-[100px]"
                value={checklistTemplate}
                onChange={(e) => setChecklistTemplate(e.target.value)}
                placeholder={(isTextChannel ? DEFAULT_TEXT_CHECKLIST_TEMPLATE : DEFAULT_CHECKLIST_TEMPLATE).slice(0, 60) + "…"}
              />
            </label>

            <div className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="text-[12px] font-bold text-[var(--fg-secondary)]">최종 프롬프트 미리보기</div>
                  <div className="mt-0.5 text-[11px] text-[var(--fg-tertiary)]">
                    기본 프롬프트 · 체크리스트 템플릿 · 포함 항목 변경 시 즉시 반영
                  </div>
                </div>
                <button type="button" className="qms-btn-ghost shrink-0" onClick={() => setShowPreview((v) => !v)}>
                  {showPreview ? "숨기기" : "보기"}
                </button>
              </div>
              {showPreview && (
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-[var(--radius-md)] bg-[var(--bg-muted)] p-3 text-[11px] leading-relaxed">
                  {previewText || "(미리보기 없음)"}
                </pre>
              )}
            </div>

            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="text-[12px] font-bold text-[var(--fg-secondary)]">포함 항목</div>
                <div className="text-[11px] text-[var(--fg-tertiary)]">
                  선택 {bindings.filter((b) => b.enabled).length} / {source.length}
                  {itemCategory !== "all" ? ` · 이 탭 ${filteredSource.length}` : ""}
                </div>
              </div>
              <div className="mb-2 flex flex-wrap gap-1">
                <button
                  type="button"
                  className={itemCategory === "all" ? "qms-btn-primary !h-7 !px-2.5 text-[11px]" : "qms-btn-ghost !h-7 !px-2.5 text-[11px]"}
                  onClick={() => setItemCategory("all")}
                >
                  전체
                  <span className="ml-1 opacity-70">{source.length}</span>
                </button>
                {itemCategories.map((cat) => {
                  const active = itemCategory === cat.name;
                  return (
                    <button
                      key={cat.name}
                      type="button"
                      className={active ? "qms-btn-primary !h-7 !px-2.5 text-[11px]" : "qms-btn-ghost !h-7 !px-2.5 text-[11px]"}
                      onClick={() => setItemCategory(cat.name)}
                    >
                      {cat.name}
                      <span className="ml-1 opacity-70">{cat.count}</span>
                    </button>
                  );
                })}
              </div>
              <div className="max-h-[28rem] space-y-0.5 overflow-y-auto rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-1.5">
                {filteredSource.length === 0 ? (
                  <p className="px-2 py-6 text-center text-[12px] text-[var(--fg-tertiary)]">이 카테고리에 항목이 없어요</p>
                ) : (
                  filteredSource.map((s) => {
                    const b = bindings.find((x) => x.criterionId === s.id);
                    const vers = promptsByCrit.get(s.id) ?? [];
                    return (
                      <div
                        key={s.id}
                        className="grid grid-cols-[auto_minmax(0,1fr)_9.5rem] items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--bg-muted)]"
                      >
                        <input
                          type="checkbox"
                          className="shrink-0"
                          checked={b?.enabled ?? false}
                          onChange={(e) => {
                            setBindings((prev) => {
                              const others = prev.filter((x) => x.criterionId !== s.id);
                              if (!e.target.checked) {
                                return [...others, { criterionId: s.id, promptId: b?.promptId ?? "", enabled: false }];
                              }
                              return [
                                ...others,
                                {
                                  criterionId: s.id,
                                  promptId: b?.promptId || vers[0]?.promptId || "",
                                  enabled: true,
                                },
                              ];
                            });
                          }}
                        />
                        <span className="truncate text-[12.5px] font-semibold text-[var(--fg-primary)]" title={`[${s.id}] ${s.name}`}>
                          <span className="font-mono text-[11px] text-[var(--fg-tertiary)]">[{s.id}]</span> {s.name}
                        </span>
                        <select
                          className="qms-select !h-7 !w-full !min-w-0 !py-0 text-[11.5px]"
                          value={b?.promptId ?? ""}
                          title="프롬프트 버전"
                          onChange={(e) => {
                            const promptId = e.target.value;
                            setBindings((prev) => {
                              const others = prev.filter((x) => x.criterionId !== s.id);
                              return [...others, { criterionId: s.id, promptId, enabled: b?.enabled ?? true }];
                            });
                          }}
                        >
                          <option value="">(최신/힌트)</option>
                          {vers.map((p) => (
                            <option key={p.promptId} value={p.promptId}>
                              {p.versionLabel}
                            </option>
                          ))}
                        </select>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </section>
        </div>

        <aside className="space-y-4">
          <section className="qms-card space-y-3 p-4">
            <h2 className="text-[14px] font-bold">판정 방식</h2>
            <p className="text-[12px] text-[var(--fg-tertiary)]">체크리스트 위반 1개 이상 → 검토 필요</p>
            <label className="block text-[12px] font-semibold">
              trueLabel (검토 필요)
              <input
                className="qms-input mt-1"
                value={resultParseCfg.trueLabel}
                onChange={(e) => setResultParseCfg({ ...resultParseCfg, trueLabel: e.target.value })}
              />
            </label>
            <label className="block text-[12px] font-semibold">
              falseLabel (검토 불필요)
              <input
                className="qms-input mt-1"
                value={resultParseCfg.falseLabel}
                onChange={(e) => setResultParseCfg({ ...resultParseCfg, falseLabel: e.target.value })}
              />
            </label>
            <button type="button" className="qms-btn-ghost w-full" disabled={busy} onClick={() => void promoteSelected()}>
              <Star className="mr-1 inline h-3.5 w-3.5" />
              선택 버전을 운영으로
            </button>
          </section>

          {isTextChannel ? (
            <section className="qms-card space-y-3 p-4">
              <h2 className="text-[14px] font-bold">텍스트 입력</h2>
              <p className="text-[12px] leading-relaxed text-[var(--fg-tertiary)]">
                {channelConfig.label} 채널은 문의 원문과 상담사 답변을 시간순으로 주입해 평가합니다.
              </p>
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-muted)] p-3 text-[12px] leading-relaxed">
                <div className="font-semibold text-[var(--fg-primary)]">고정 입력</div>
                <code className="mt-1 block text-[11px] text-[var(--brand)]">{"{{conversation_text}}"}</code>
                <p className="mt-1 text-[11px] text-[var(--fg-tertiary)]">
                  평가 실행 시 서버가 원천 데이터를 다시 조회해 원문을 주입합니다.
                </p>
              </div>
              <ul className="space-y-1 text-[11.5px] text-[var(--fg-secondary)]">
                <li>✓ 오디오 파일 첨부 안 함</li>
                <li>✓ STT·무음·말 겹침 분석 안 함</li>
                <li>✓ 상담원 화자 번호 판정 안 함</li>
              </ul>
            </section>
          ) : (
          <section className="qms-card space-y-3 p-4">
            <h2 className="text-[14px] font-bold">오디오 · 신호 분석</h2>
            <p className="text-[12px] leading-relaxed text-[var(--fg-tertiary)]">
              어떤 분석을 돌리고, 프롬프트·Gemini에 무엇을 넣을지 설정합니다.
            </p>
            {audioCfg.steps.map((s) => {
              const meta = AUDIO_STEP_LABELS[s.id];
              return (
                <div key={s.id} className="rounded-[var(--radius-md)] border border-[var(--border-subtle)] p-3">
                  <label className="flex cursor-pointer items-start gap-2">
                    <input type="checkbox" className="mt-0.5" checked={s.enabled} onChange={() => toggleStep(s.id)} />
                    <span>
                      <span className="block text-[13px] font-bold">{meta.title}</span>
                      <span className="text-[11.5px] text-[var(--fg-tertiary)]">{meta.desc}</span>
                    </span>
                  </label>
                  {s.id === "silence_ffmpeg" && s.enabled && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <label className="text-[11px] font-semibold">
                        minSilenceSec
                        <input
                          type="number"
                          className="qms-input mt-1"
                          value={s.minSilenceSec ?? 3}
                          onChange={(e) => updateStepParam(s.id, { minSilenceSec: Number(e.target.value) })}
                        />
                      </label>
                      <label className="text-[11px] font-semibold">
                        noiseDb
                        <input
                          type="number"
                          className="qms-input mt-1"
                          value={s.noiseDb ?? -30}
                          onChange={(e) => updateStepParam(s.id, { noiseDb: Number(e.target.value) })}
                        />
                      </label>
                    </div>
                  )}
                  {s.id === "overlap_ffmpeg" && s.enabled && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <label className="text-[11px] font-semibold">
                        noiseDb
                        <input
                          type="number"
                          className="qms-input mt-1"
                          value={s.noiseDb ?? -30}
                          onChange={(e) => updateStepParam(s.id, { noiseDb: Number(e.target.value) })}
                        />
                      </label>
                      <label className="flex items-center gap-2 text-[11px] font-semibold">
                        <input
                          type="checkbox"
                          checked={s.preferOverFfmpeg !== false}
                          onChange={(e) => updateStepParam(s.id, { preferOverFfmpeg: e.target.checked })}
                        />
                        STT 겹침 우선
                      </label>
                    </div>
                  )}
                  {s.id === "inject_prompt_vars" && s.enabled && (
                    <div className="mt-2 space-y-1.5 border-t border-[var(--border-subtle)] pt-2">
                      {(
                        [
                          ["silences", "사일런스", INJECT_VAR_LABELS.silences.desc],
                          ["stt_script", "STT 스크립트", INJECT_VAR_LABELS.stt_script.desc],
                          ["overlaps", "말 겹침 구간", INJECT_VAR_LABELS.overlaps.desc],
                        ] as const
                      ).map(([key, title, desc]) => {
                        const vars = s.vars?.length ? s.vars : DEFAULT_INJECT_VARS;
                        const checked =
                          key === "silences"
                            ? vars.includes("silences") || vars.includes("silence_summary")
                            : vars.includes(key);
                        return (
                          <label key={key} className="flex cursor-pointer items-start gap-2 text-[12px]">
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={checked}
                              onChange={() => toggleInjectVarGroup(key)}
                            />
                            <span>
                              <span className="font-semibold">{title}</span>
                              <span className="ml-1 text-[11px] text-[var(--fg-tertiary)]">{desc}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </section>
          )}

          <section className="qms-card space-y-2 p-4">
            <h2 className="text-[14px] font-bold">출력 스키마</h2>
            {(
              [
                ["includeScores", "점수"],
                ["includeOverallSummary", "총평"],
                ["includeSilenceComments", "공백 코멘트"],
                ["includeAgentSpeakerTag", "상담원 화자"],
                ["includeCsChecklist", "체크리스트"],
              ] as const
            ).filter(([k]) => !isTextChannel || (k !== "includeSilenceComments" && k !== "includeAgentSpeakerTag")).map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-[12.5px]">
                <input
                  type="checkbox"
                  checked={Boolean(outputCfg[k])}
                  onChange={(e) => setOutputCfg({ ...outputCfg, [k]: e.target.checked })}
                />
                {label}
              </label>
            ))}
            {outputCfg.includeScores ? (
              <div className="border-t border-[var(--border-subtle)] pt-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-[11px] font-semibold text-[var(--fg-secondary)]">점수·메트릭 항목</div>
                  <button
                    type="button"
                    className="qms-btn-ghost !h-7 !px-2 text-[11px]"
                    onClick={() =>
                      setOutputCfg({
                        ...outputCfg,
                        scoreFields: RECOMMENDED_METRIC_FIELDS.map((f) => ({ ...f })),
                      })
                    }
                  >
                    하이브리드 권장값
                  </button>
                </div>
                <p className="text-[11px] text-[var(--fg-tertiary)]">
                  type·source·정의를 적으면 프롬프트/스키마에 반영됩니다. signal은 LLM이 채우지 않습니다.
                </p>
                <SchemaFieldList
                  fields={outputCfg.scoreFields}
                  keyPrefix="score"
                  showMetricMeta
                  onChange={(scoreFields) => setOutputCfg({ ...outputCfg, scoreFields })}
                />
              </div>
            ) : null}
            {outputCfg.includeOverallSummary ? (
              <div className="border-t border-[var(--border-subtle)] pt-2">
                <div className="text-[11px] font-semibold text-[var(--fg-secondary)]">총평 필드</div>
                <SchemaFieldList
                  fields={outputCfg.overallSummaryFields}
                  keyPrefix="summary"
                  emptyHint="지금 총평은 단일 문자열입니다. 필드를 추가하면 항목별로 받습니다."
                  onChange={(overallSummaryFields) => setOutputCfg({ ...outputCfg, overallSummaryFields })}
                />
              </div>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  );
}
