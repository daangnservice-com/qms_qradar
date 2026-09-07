"use client";

import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { cacheInvalidate } from "@/lib/clientCache";
import { useCachedFetch } from "@/lib/useCachedFetch";
import { formatKrw, formatUsd, USD_KRW } from "@/lib/llmPricing";

type LlmUsageStats = {
  days: number;
  totalCalls: number;
  errorCalls: number;
  totalPromptTokens: number;
  totalAudioPromptTokens: number;
  totalTextPromptTokens: number;
  totalCandidatesTokens: number;
  totalCachedTokens: number;
  totalBillableInputTokens: number;
  totalTokens: number;
  avgLatencyMs: number;
  cost: {
    textInputUsd: number;
    audioInputUsd: number;
    inputUsd: number;
    outputUsd: number;
    cachedUsd: number;
    totalUsd: number;
    totalKrw: number;
    usdKrw: number;
    note: string;
  };
  daily: Array<{
    date: string;
    calls: number;
    tokens: number;
    promptTokens: number;
    audioPromptTokens: number;
    candidatesTokens: number;
    cachedTokens: number;
    avgLatencyMs: number;
    errors: number;
    costUsd: number;
  }>;
  byPurpose: Array<{
    purpose: string;
    calls: number;
    tokens: number;
    promptTokens: number;
    audioPromptTokens: number;
    candidatesTokens: number;
    cachedTokens: number;
    avgLatencyMs: number;
    costUsd: number;
  }>;
  byModel: Array<{
    model: string;
    calls: number;
    tokens: number;
    promptTokens: number;
    audioPromptTokens: number;
    candidatesTokens: number;
    cachedTokens: number;
    costUsd: number;
    costKrw: number;
    textInputUsd: number;
    audioInputUsd: number;
    rateKey: string;
    rateMatched: boolean;
  }>;
};

type SttUsageStats = {
  days: number;
  totalCalls: number;
  errorCalls: number;
  totalAudioSec: number;
  totalBillableSec: number;
  totalBillableMin: number;
  avgLatencyMs: number;
  cost: { usd: number; krw: number; usdPerMin: number; note: string };
  daily: Array<{
    date: string;
    calls: number;
    audioSec: number;
    billableSec: number;
    costUsd: number;
    errors: number;
  }>;
};

const EMPTY_COST: LlmUsageStats["cost"] = {
  textInputUsd: 0,
  audioInputUsd: 0,
  inputUsd: 0,
  outputUsd: 0,
  cachedUsd: 0,
  totalUsd: 0,
  totalKrw: 0,
  usdKrw: USD_KRW,
  note: "",
};

function normalizeStats(raw: Partial<LlmUsageStats> | null | undefined): LlmUsageStats | null {
  if (!raw) return null;
  const cost = { ...EMPTY_COST, ...(raw.cost ?? {}) };
  return {
    days: raw.days ?? 30,
    totalCalls: raw.totalCalls ?? 0,
    errorCalls: raw.errorCalls ?? 0,
    totalPromptTokens: raw.totalPromptTokens ?? 0,
    totalAudioPromptTokens: raw.totalAudioPromptTokens ?? 0,
    totalTextPromptTokens:
      raw.totalTextPromptTokens ??
      Math.max(0, (raw.totalPromptTokens ?? 0) - (raw.totalAudioPromptTokens ?? 0)),
    totalCandidatesTokens: raw.totalCandidatesTokens ?? 0,
    totalCachedTokens: raw.totalCachedTokens ?? 0,
    totalBillableInputTokens:
      raw.totalBillableInputTokens ??
      Math.max(0, (raw.totalPromptTokens ?? 0) - (raw.totalCachedTokens ?? 0)),
    totalTokens: raw.totalTokens ?? 0,
    avgLatencyMs: raw.avgLatencyMs ?? 0,
    cost,
    daily: (raw.daily ?? []).map((d) => ({
      date: d.date,
      calls: d.calls ?? 0,
      tokens: d.tokens ?? 0,
      promptTokens: d.promptTokens ?? 0,
      audioPromptTokens: d.audioPromptTokens ?? 0,
      candidatesTokens: d.candidatesTokens ?? 0,
      cachedTokens: d.cachedTokens ?? 0,
      avgLatencyMs: d.avgLatencyMs ?? 0,
      errors: d.errors ?? 0,
      costUsd: d.costUsd ?? 0,
    })),
    byPurpose: (raw.byPurpose ?? []).map((r) => ({
      purpose: r.purpose,
      calls: r.calls ?? 0,
      tokens: r.tokens ?? 0,
      promptTokens: r.promptTokens ?? 0,
      audioPromptTokens: r.audioPromptTokens ?? 0,
      candidatesTokens: r.candidatesTokens ?? 0,
      cachedTokens: r.cachedTokens ?? 0,
      avgLatencyMs: r.avgLatencyMs ?? 0,
      costUsd: r.costUsd ?? 0,
    })),
    byModel: (raw.byModel ?? []).map((r) => ({
      model: r.model,
      calls: r.calls ?? 0,
      tokens: r.tokens ?? 0,
      promptTokens: r.promptTokens ?? 0,
      audioPromptTokens: r.audioPromptTokens ?? 0,
      candidatesTokens: r.candidatesTokens ?? 0,
      cachedTokens: r.cachedTokens ?? 0,
      costUsd: r.costUsd ?? 0,
      costKrw: r.costKrw ?? 0,
      textInputUsd: r.textInputUsd ?? 0,
      audioInputUsd: r.audioInputUsd ?? 0,
      rateKey: r.rateKey ?? r.model,
      rateMatched: r.rateMatched ?? false,
    })),
  };
}

function normalizeStt(raw: Partial<SttUsageStats> | null | undefined): SttUsageStats | null {
  if (!raw) return null;
  return {
    days: raw.days ?? 30,
    totalCalls: raw.totalCalls ?? 0,
    errorCalls: raw.errorCalls ?? 0,
    totalAudioSec: raw.totalAudioSec ?? 0,
    totalBillableSec: raw.totalBillableSec ?? 0,
    totalBillableMin: raw.totalBillableMin ?? 0,
    avgLatencyMs: raw.avgLatencyMs ?? 0,
    cost: {
      usd: raw.cost?.usd ?? 0,
      krw: raw.cost?.krw ?? 0,
      usdPerMin: raw.cost?.usdPerMin ?? 0.024,
      note: raw.cost?.note ?? "",
    },
    daily: raw.daily ?? [],
  };
}

const CACHE_KEY = (days: number) => `llmStats:v3:${days}`;

function formatMin(sec: number): string {
  const m = sec / 60;
  if (m < 1) return `${sec.toFixed(0)}초`;
  return `${m.toFixed(1)}분`;
}

function TokenBars({ daily }: { daily: LlmUsageStats["daily"] }) {
  const max = Math.max(1, ...daily.map((d) => d.tokens));
  if (!daily.length) return <p className="py-8 text-center text-[13px] text-[var(--fg-tertiary)]">데이터 없음</p>;
  return (
    <div className="flex items-end gap-1 overflow-x-auto pb-1" style={{ height: 160 }}>
      {daily.map((d) => (
        <div
          key={d.date}
          className="flex min-w-[14px] flex-1 flex-col items-center justify-end gap-1"
          title={`${d.date} · text ${Math.max(0, d.promptTokens - d.audioPromptTokens).toLocaleString()} / audio ${d.audioPromptTokens.toLocaleString()} / out ${d.candidatesTokens.toLocaleString()} · ${formatUsd(d.costUsd)}`}
        >
          <div
            className="w-full rounded-t bg-[var(--brand)]/80 transition hover:bg-[var(--brand)]"
            style={{ height: `${(d.tokens / max) * 130}px` }}
          />
          <span className="whitespace-nowrap text-[9px] text-[var(--fg-tertiary)]">{d.date.slice(5)}</span>
        </div>
      ))}
    </div>
  );
}

export default function LlmUsageDashboard() {
  const [days, setDays] = useState(30);
  const { data, loading, error, refresh } = useCachedFetch<{ stats: LlmUsageStats; stt: SttUsageStats }>({
    key: CACHE_KEY(days),
    fetcher: async () => {
      const r = await fetch(`/api/stats/llm?days=${days}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "통계 로드 실패");
      const stats = normalizeStats(d.stats);
      if (!stats) throw new Error("통계 데이터 없음");
      return { stats, stt: normalizeStt(d.stt) ?? normalizeStt({ days })! };
    },
  });

  const stats = normalizeStats(data?.stats);
  const stt = normalizeStt(data?.stt);
  const combinedUsd = (stats?.cost.totalUsd ?? 0) + (stt?.cost.usd ?? 0);
  const combinedKrw = combinedUsd * USD_KRW;

  return (
    <div className="qms-page-body space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--fg-tertiary)]">평가 설계 · 관측</div>
          <h1 className="mt-1 text-[22px] font-extrabold tracking-tight">AI 호출 사용량</h1>
          <p className="mt-1 text-[13px] text-[var(--fg-secondary)]">
            Gemini(텍스트·오디오 인풋 분리) · STT(분당) · 추정 비용
          </p>
        </div>
        <div className="flex gap-2">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              type="button"
              className={days === d ? "qms-btn-primary" : "qms-btn-ghost"}
              onClick={() => setDays(d)}
            >
              {d}일
            </button>
          ))}
          <button
            type="button"
            className="qms-btn-ghost"
            onClick={() => {
              cacheInvalidate(CACHE_KEY(days));
              void refresh();
            }}
          >
            <RefreshCw className={`inline h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      {error && (
        <div className="rounded-[var(--radius-md)] bg-[var(--danger-subtle)] px-3 py-2 text-[13px] text-[var(--danger)]">
          {error}
        </div>
      )}

      {loading && !stats ? (
        <div className="flex justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : stats ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { label: "Gemini 호출", value: stats.totalCalls.toLocaleString() },
              { label: "STT 호출", value: (stt?.totalCalls ?? 0).toLocaleString() },
              { label: "합산 추정 (USD)", value: formatUsd(combinedUsd) },
              { label: "합산 추정 (KRW)", value: formatKrw(combinedKrw) },
            ].map((c) => (
              <div key={c.label} className="qms-card p-4">
                <div className="text-[11px] font-semibold text-[var(--fg-tertiary)]">{c.label}</div>
                <div className="mt-1 text-[22px] font-extrabold tabular-nums">{c.value}</div>
              </div>
            ))}
          </div>

          <section className="qms-card p-4">
            <h2 className="text-[14px] font-bold">Gemini 토큰 · 비용</h2>
            <p className="mt-1 text-[12px] text-[var(--fg-tertiary)]">
              인풋 합계 {stats.totalPromptTokens.toLocaleString()} (텍스트{" "}
              {stats.totalTextPromptTokens.toLocaleString()} · 오디오 {stats.totalAudioPromptTokens.toLocaleString()}) ·
              캐시 {stats.totalCachedTokens.toLocaleString()} · 아웃풋 {stats.totalCandidatesTokens.toLocaleString()} ·
              평균 latency {Math.round(stats.avgLatencyMs)} ms
            </p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-[13px]">
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-muted)] px-3 py-2">
                <div className="text-[11px] text-[var(--fg-tertiary)]">텍스트 인풋</div>
                <div className="font-bold tabular-nums">{formatUsd(stats.cost.textInputUsd)}</div>
              </div>
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-muted)] px-3 py-2">
                <div className="text-[11px] text-[var(--fg-tertiary)]">오디오 인풋</div>
                <div className="font-bold tabular-nums">{formatUsd(stats.cost.audioInputUsd)}</div>
              </div>
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-muted)] px-3 py-2">
                <div className="text-[11px] text-[var(--fg-tertiary)]">캐시 · 아웃풋</div>
                <div className="font-bold tabular-nums">
                  {formatUsd(stats.cost.cachedUsd)} · {formatUsd(stats.cost.outputUsd)}
                </div>
              </div>
              <div className="rounded-[var(--radius-md)] bg-[var(--bg-muted)] px-3 py-2">
                <div className="text-[11px] text-[var(--fg-tertiary)]">Gemini 합계</div>
                <div className="font-bold tabular-nums">
                  {formatUsd(stats.cost.totalUsd)} · {formatKrw(stats.cost.totalKrw)}
                </div>
              </div>
            </div>
            <p className="mt-3 text-[11px] text-[var(--fg-tertiary)]">{stats.cost.note}</p>
            <p className="mt-1 text-[11px] text-[var(--fg-tertiary)]">
              참고: <code>promptTokenCount</code>에 오디오가 포함되며,{" "}
              <code>promptTokensDetails.modality=AUDIO</code>로 분리합니다. Flash 오디오 인풋은 텍스트보다 단가가
              높습니다($1/M vs $0.30/M).
            </p>
          </section>

          {stt && (
            <section className="qms-card p-4">
              <h2 className="text-[14px] font-bold">STT (Cloud Speech-to-Text)</h2>
              <p className="mt-1 text-[12px] text-[var(--fg-tertiary)]">
                호출 {stt.totalCalls.toLocaleString()} · 오디오 {formatMin(stt.totalAudioSec)} · 청구{" "}
                {formatMin(stt.totalBillableSec)} (채널×초) · 평균 latency {Math.round(stt.avgLatencyMs)} ms · 에러{" "}
                {stt.errorCalls}
              </p>
              <div className="mt-3 grid gap-2 sm:grid-cols-3 text-[13px]">
                <div className="rounded-[var(--radius-md)] bg-[var(--bg-muted)] px-3 py-2">
                  <div className="text-[11px] text-[var(--fg-tertiary)]">청구 분</div>
                  <div className="font-bold tabular-nums">{stt.totalBillableMin.toFixed(2)}분</div>
                </div>
                <div className="rounded-[var(--radius-md)] bg-[var(--bg-muted)] px-3 py-2">
                  <div className="text-[11px] text-[var(--fg-tertiary)]">추정 USD</div>
                  <div className="font-bold tabular-nums">{formatUsd(stt.cost.usd)}</div>
                </div>
                <div className="rounded-[var(--radius-md)] bg-[var(--bg-muted)] px-3 py-2">
                  <div className="text-[11px] text-[var(--fg-tertiary)]">추정 KRW</div>
                  <div className="font-bold tabular-nums">{formatKrw(stt.cost.krw)}</div>
                </div>
              </div>
              <p className="mt-3 text-[11px] text-[var(--fg-tertiary)]">{stt.cost.note}</p>
            </section>
          )}

          <section className="qms-card p-4">
            <h2 className="text-[14px] font-bold">일별 Gemini 토큰</h2>
            <div className="mt-4">
              <TokenBars daily={stats.daily} />
            </div>
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            <section className="qms-card p-4">
              <h2 className="mb-3 text-[14px] font-bold">purpose별</h2>
              <table className="qms-table">
                <thead>
                  <tr>
                    <th>purpose</th>
                    <th>calls</th>
                    <th>text / audio / out</th>
                    <th>cost</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.byPurpose.map((r) => (
                    <tr key={r.purpose} className="cursor-default">
                      <td className="font-semibold">{r.purpose}</td>
                      <td>{r.calls}</td>
                      <td className="text-[11px] tabular-nums text-[var(--fg-secondary)]">
                        {Math.max(0, r.promptTokens - r.audioPromptTokens).toLocaleString()} /{" "}
                        {r.audioPromptTokens.toLocaleString()} / {r.candidatesTokens.toLocaleString()}
                      </td>
                      <td className="tabular-nums">{formatUsd(r.costUsd)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className="qms-card p-4">
              <h2 className="mb-3 text-[14px] font-bold">model별 · 요금표</h2>
              <table className="qms-table">
                <thead>
                  <tr>
                    <th>model</th>
                    <th>text$ / audio$</th>
                    <th>USD</th>
                    <th>KRW</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.byModel.map((r) => (
                    <tr key={r.model} className="cursor-default">
                      <td>
                        <div className="font-semibold">{r.model}</div>
                        <div className="text-[10px] text-[var(--fg-tertiary)]">
                          rate {r.rateKey}
                          {!r.rateMatched ? " (기본요금 추정)" : ""} · {r.calls} calls · audio tok{" "}
                          {r.audioPromptTokens.toLocaleString()}
                        </div>
                      </td>
                      <td className="text-[11px] tabular-nums text-[var(--fg-secondary)]">
                        {formatUsd(r.textInputUsd)} / {formatUsd(r.audioInputUsd)}
                      </td>
                      <td className="tabular-nums">{formatUsd(r.costUsd)}</td>
                      <td className="tabular-nums">{formatKrw(r.costKrw)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}
