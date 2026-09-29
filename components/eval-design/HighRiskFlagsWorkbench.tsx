"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import type { EvaluationChannel } from "@/lib/evaluationChannel";
import {
  FEEDBACK_COUNT_TARGET_LABEL,
  HIGH_RISK_CHANNEL_KINDS,
  type FeedbackCountTarget,
  type HighRiskFlagKind,
  type HighRiskFlagRule,
} from "@/lib/highRiskFlags";

type Draft = Pick<
  HighRiskFlagRule,
  "key" | "label" | "enabled" | "channel" | "kind" | "params" | "sortOrder"
> & { ruleId?: string };

const CHANNEL_TABS: { key: EvaluationChannel; label: string; description: string }[] = [
  { key: "phone", label: "콜", description: "통화시간·발화비율·감정·CSAT 신호" },
  { key: "feedback", label: "피드백", description: "스레드의 문의·답변 건수" },
  { key: "chatcs", label: "채팅", description: "추후 지원 예정" },
];

const KIND_OPTIONS: { value: HighRiskFlagKind; label: string; hint: string }[] = [
  {
    value: "long_call_percentile",
    label: "장콜 (퍼센타일)",
    hint: "당일 제외 직전 7일 일별 상위 N% 통화시간의 MA(분) 이상이면 장콜",
  },
  {
    value: "agent_speak_ratio",
    label: "상담사 발화 비율",
    hint: "signal 메트릭 agentSpeakRatio ≥ N%",
  },
  {
    value: "sentiment_agitated",
    label: "격앙 감지",
    hint: "LLM bool 메트릭(agitated 등)이 true",
  },
  {
    value: "csat_dsat",
    label: "DSAT (고객 설문)",
    hint: "상담이력 ID로 매칭한 CSAT 점수가 기준 이하. 설문 미참여 통화는 해당 없음",
  },
  {
    value: "feedback_message_count",
    label: "문의·답변 건수",
    hint: "스레드의 문의/답변/합계 건수가 기준 이상. AI 평가 없이 목록에서 바로 판정",
  },
];

const COUNT_TARGETS: FeedbackCountTarget[] = ["feedback", "reply", "total"];

/** 채널 탭을 옮기면 그 채널에 없는 종류는 첫 허용 종류로 되돌린다. */
function defaultDraft(channel: EvaluationChannel, sortOrder: number): Draft {
  if (channel === "feedback") {
    return {
      key: `feedback_flag_${sortOrder}`,
      label: "새 플래그",
      enabled: true,
      channel,
      kind: "feedback_message_count",
      params: { countTarget: "total", minCount: 5 },
      sortOrder,
    };
  }
  return {
    key: `flag_${sortOrder}`,
    label: "새 플래그",
    enabled: true,
    channel,
    kind: "long_call_percentile",
    params: { percentile: 10, minMinutes: null },
    sortOrder,
  };
}

function toDraft(r: HighRiskFlagRule): Draft {
  return {
    ruleId: r.ruleId,
    key: r.key,
    label: r.label,
    enabled: r.enabled,
    channel: r.channel,
    kind: r.kind,
    params: { ...r.params },
    sortOrder: r.sortOrder,
  };
}

export default function HighRiskFlagsWorkbench() {
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [channelTab, setChannelTab] = useState<EvaluationChannel>("phone");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [longCallThreshold, setLongCallThreshold] = useState<{
    thresholdMinutes: number;
    percentile: number;
    windowStart: string;
    windowEnd: string;
    asOfDate: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/eval-design/high-risk-flags");
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as {
        rules: HighRiskFlagRule[];
        longCallThreshold?: {
          thresholdMinutes: number;
          percentile: number;
          windowStart: string;
          windowEnd: string;
          asOfDate: string;
        } | null;
      };
      setDrafts((data.rules ?? []).map(toDraft));
      setLongCallThreshold(data.longCallThreshold ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (i: number, patch: Partial<Draft>) => {
    setDrafts((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  };

  const updateParams = (i: number, patch: Draft["params"]) => {
    setDrafts((prev) =>
      prev.map((d, idx) => (idx === i ? { ...d, params: { ...d.params, ...patch } } : d)),
    );
  };

  const add = () => {
    setDrafts((prev) => [...prev, defaultDraft(channelTab, prev.length + 1)]);
  };

  const remove = (i: number) => {
    setDrafts((prev) => prev.filter((_, idx) => idx !== i).map((d, idx) => ({ ...d, sortOrder: idx + 1 })));
  };

  // 탭으로 걸러도 저장은 전 채널 draft를 함께 보낸다(다른 탭 규칙이 사라지지 않게).
  const visible = useMemo(
    () => drafts.map((d, index) => ({ draft: d, index })).filter((row) => row.draft.channel === channelTab),
    [drafts, channelTab],
  );
  const kindOptions = useMemo(
    () => KIND_OPTIONS.filter((o) => HIGH_RISK_CHANNEL_KINDS[channelTab].includes(o.value)),
    [channelTab],
  );

  const save = async () => {
    setSaving(true);
    setError(null);
    setOk(null);
    try {
      const res = await fetch("/api/eval-design/high-risk-flags", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: drafts }),
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { rules: HighRiskFlagRule[] };
      setDrafts((data.rules ?? []).map(toDraft));
      setOk("저장했습니다.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[18px] font-bold tracking-tight">고위험군 플래그</h1>
          <p className="mt-1 text-[12px] leading-relaxed text-[var(--fg-secondary)]">
            평가 진행 필터의 「고위험군만」 토글에 쓰입니다. 채널마다 쓸 수 있는 신호가 달라서 탭으로
            나눠 관리합니다. 장콜·문의 건수는 목록 조회에서 실시간 계산하고, 발화 비율·격앙은 AI 평가
            결과 metrics에 붙습니다.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="qms-btn-ghost !h-8 text-[12px]"
            onClick={add}
            disabled={loading || !kindOptions.length}
          >
            <Plus className="mr-1 inline h-3.5 w-3.5" />
            규칙 추가
          </button>
          <button type="button" className="qms-btn-primary !h-8 text-[12px]" onClick={() => void save()} disabled={loading || saving}>
            {saving ? <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1 inline h-3.5 w-3.5" />}
            저장
          </button>
        </div>
      </div>

      <div className="qms-card flex flex-wrap items-center gap-1 p-1.5">
        {CHANNEL_TABS.map((tab) => {
          const active = channelTab === tab.key;
          const count = drafts.filter((d) => d.channel === tab.key).length;
          return (
            <button
              key={tab.key}
              type="button"
              className={`flex-1 rounded-[var(--radius-md)] px-3 py-2 text-left transition ${
                active
                  ? "bg-[var(--brand-subtle)] text-[var(--brand)]"
                  : "text-[var(--fg-secondary)] hover:bg-[var(--bg-muted)]"
              }`}
              onClick={() => setChannelTab(tab.key)}
            >
              <span className="block text-[13px] font-bold">
                {tab.label}
                {count > 0 && <span className="ml-1 font-medium">{count}</span>}
              </span>
              <span className="mt-0.5 block text-[11px] text-[var(--fg-tertiary)]">{tab.description}</span>
            </button>
          );
        })}
      </div>

      {error && <p className="text-[12px] text-red-600">{error}</p>}
      {ok && <p className="text-[12px] text-[var(--fg-secondary)]">{ok}</p>}

      {loading ? (
        <div className="flex items-center gap-2 text-[12px] text-[var(--fg-tertiary)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          불러오는 중…
        </div>
      ) : (
        <div className="space-y-3">
          {!kindOptions.length && (
            <p className="qms-card p-4 text-[12px] leading-relaxed text-[var(--fg-secondary)]">
              채팅 채널은 아직 쓸 수 있는 신호가 없어서 규칙을 만들 수 없습니다. 채팅 원문 적재가 붙으면
              여기에 종류가 생깁니다.
            </p>
          )}
          {kindOptions.length > 0 && !visible.length && (
            <p className="qms-card p-4 text-[12px] text-[var(--fg-secondary)]">
              이 채널에 저장된 규칙이 없습니다. 「규칙 추가」로 시작하세요.
            </p>
          )}
          {visible.map(({ draft: d, index: i }) => (
            <section key={`${d.ruleId ?? d.key}-${i}`} className="qms-card space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  role="switch"
                  aria-checked={d.enabled}
                  onClick={() => update(i, { enabled: !d.enabled })}
                  className={`relative h-5 w-9 shrink-0 rounded-full transition ${
                    d.enabled ? "bg-[var(--brand)]" : "bg-[var(--border-strong)]"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition ${
                      d.enabled ? "translate-x-4" : ""
                    }`}
                  />
                </button>
                <input
                  className="qms-input !h-8 min-w-0 flex-1 !text-[13px]"
                  value={d.label}
                  onChange={(e) => update(i, { label: e.target.value })}
                  placeholder="표시 라벨"
                />
                <input
                  className="qms-input !h-8 w-36 !font-mono !text-[12px]"
                  value={d.key}
                  onChange={(e) => update(i, { key: e.target.value.trim() })}
                  placeholder="key"
                />
                <button type="button" className="qms-btn-ghost !h-8 !px-2 text-[12px]" onClick={() => remove(i)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <label className="space-y-1 text-[11px] text-[var(--fg-tertiary)]">
                  종류
                  <select
                    className="qms-input !h-8 w-full !text-[12px]"
                    value={d.kind}
                    onChange={(e) => {
                      const kind = e.target.value as HighRiskFlagKind;
                      // 건수 규칙은 최소 건수가 비면 아무것도 안 걸리므로 기본값을 채워 준다.
                      update(i, {
                        kind,
                        params:
                          kind === "feedback_message_count"
                            ? {
                                ...d.params,
                                countTarget: d.params.countTarget ?? "total",
                                minCount: d.params.minCount ?? 5,
                              }
                            : d.params,
                      });
                    }}
                  >
                    {kindOptions.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="self-end text-[11px] leading-snug text-[var(--fg-tertiary)]">
                  {KIND_OPTIONS.find((o) => o.value === d.kind)?.hint}
                </p>
              </div>

              {d.kind === "long_call_percentile" && (
                <div className="space-y-2">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label className="space-y-1 text-[11px] text-[var(--fg-tertiary)]">
                      상위 퍼센타일 (%)
                      <input
                        type="number"
                        className="qms-input !h-8 w-full !text-[12px]"
                        value={d.params.percentile ?? 10}
                        min={1}
                        max={50}
                        onChange={(e) =>
                          updateParams(i, { percentile: e.target.value === "" ? null : Number(e.target.value) })
                        }
                      />
                    </label>
                    <label className="space-y-1 text-[11px] text-[var(--fg-tertiary)]">
                      최소 통화(분, AND · 비우면 미적용)
                      <input
                        type="number"
                        className="qms-input !h-8 w-full !text-[12px]"
                        value={d.params.minMinutes ?? ""}
                        min={0}
                        placeholder="예: 15"
                        onChange={(e) =>
                          updateParams(i, { minMinutes: e.target.value === "" ? null : Number(e.target.value) })
                        }
                      />
                    </label>
                  </div>
                  {longCallThreshold && (
                    <p className="rounded-md border border-[var(--border)] bg-[var(--bg-secondary)] px-2.5 py-2 text-[11px] text-[var(--fg-secondary)]">
                      적용 임계값:{" "}
                      <span className="font-medium text-[var(--fg)]">
                        {longCallThreshold.thresholdMinutes.toFixed(1)}분
                      </span>
                      {" · "}상위 {longCallThreshold.percentile}% 일별 값의 MA
                      {" · "}
                      {longCallThreshold.windowStart} ~ {longCallThreshold.windowEnd} (당일 제외)
                      {" · "}as of {longCallThreshold.asOfDate}
                    </p>
                  )}
                </div>
              )}

              {d.kind === "agent_speak_ratio" && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1 text-[11px] text-[var(--fg-tertiary)]">
                    최소 발화 비율 (%)
                    <input
                      type="number"
                      className="qms-input !h-8 w-full !text-[12px]"
                      value={d.params.minPercent ?? 70}
                      min={0}
                      max={100}
                      onChange={(e) =>
                        updateParams(i, { minPercent: e.target.value === "" ? null : Number(e.target.value) })
                      }
                    />
                  </label>
                  <label className="space-y-1 text-[11px] text-[var(--fg-tertiary)]">
                    메트릭 키
                    <input
                      className="qms-input !h-8 w-full !font-mono !text-[12px]"
                      value={d.params.metricKey ?? "agentSpeakRatio"}
                      onChange={(e) => updateParams(i, { metricKey: e.target.value.trim() || "agentSpeakRatio" })}
                    />
                  </label>
                </div>
              )}

              {d.kind === "csat_dsat" && (
                <label className="block space-y-1 text-[11px] text-[var(--fg-tertiary)]">
                  DSAT 기준 점수 (이하)
                  <input
                    type="number"
                    className="qms-input !h-8 w-full !text-[12px]"
                    value={d.params.maxRate ?? 2}
                    min={1}
                    max={5}
                    onChange={(e) =>
                      updateParams(i, { maxRate: e.target.value === "" ? null : Number(e.target.value) })
                    }
                  />
                </label>
              )}

              {d.kind === "sentiment_agitated" && (
                <label className="block space-y-1 text-[11px] text-[var(--fg-tertiary)]">
                  bool 메트릭 키
                  <input
                    className="qms-input !h-8 w-full !font-mono !text-[12px]"
                    value={d.params.metricKey ?? "agitated"}
                    onChange={(e) => updateParams(i, { metricKey: e.target.value.trim() || "agitated" })}
                  />
                </label>
              )}

              {d.kind === "feedback_message_count" && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="space-y-1 text-[11px] text-[var(--fg-tertiary)]">
                    변수
                    <select
                      className="qms-input !h-8 w-full !text-[12px]"
                      value={d.params.countTarget ?? "total"}
                      onChange={(e) => updateParams(i, { countTarget: e.target.value as FeedbackCountTarget })}
                    >
                      {COUNT_TARGETS.map((target) => (
                        <option key={target} value={target}>
                          {FEEDBACK_COUNT_TARGET_LABEL[target]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1 text-[11px] text-[var(--fg-tertiary)]">
                    최소 건수 (이상)
                    <input
                      type="number"
                      className="qms-input !h-8 w-full !text-[12px]"
                      value={d.params.minCount ?? ""}
                      min={1}
                      placeholder="예: 5"
                      onChange={(e) =>
                        updateParams(i, { minCount: e.target.value === "" ? null : Number(e.target.value) })
                      }
                    />
                  </label>
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
