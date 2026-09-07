"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { ArrowUpToLine, GripVertical, Pause, Play } from "lucide-react";
import { Badge } from "@seed-design/react";
import { formatClock } from "@/lib/format";
import {
  hotColdLabel,
  hotColdTone,
  hotColdTrackColor,
  SOURCE_AI_TONE,
  SOURCE_HUMAN_TONE,
} from "@/lib/judgmentUi";
import type { CallQualityOrg } from "@/lib/callQualityOrg";
import {
  isIntervalOverlay,
  isSeriesOverlay,
  overlayBandClass,
  type WaveformOverlay,
} from "@/lib/waveformOverlays";

export type PlaybackMarker = {
  key: string;
  atSec: number;
  /** cold / hot / best 재생바 색 */
  tone: "cold" | "hot" | "best";
  /** 접근성/폴백용 한 줄 텍스트 */
  tip: string;
  /** 툴팁 패널용 */
  source?: "ai" | "human" | "best";
  criterionId?: number | string | null;
  label?: string | null;
  body?: string | null;
};

type MarkerHoverTip = {
  x: number;
  y: number;
  place: "above" | "below";
  timeSec: number;
  tone?: PlaybackMarker["tone"];
  source?: NonNullable<PlaybackMarker["source"]>;
  criterionId?: number | string | null;
  label?: string | null;
  body?: string | null;
  tip?: string;
};

type StereoPeaksState = {
  peaksLeft: number[];
  peaksRight: number[];
  durationSec: number;
};

type BarChromeProps = {
  conversationId: string;
  pos: number;
  dur: number;
  playing: boolean;
  markers: PlaybackMarker[];
  overlays: WaveformOverlay[];
  peaks: StereoPeaksState | null;
  trackRef: RefObject<HTMLDivElement | null>;
  hoverTip: MarkerHoverTip | null;
  setHoverTip: (v: MarkerHoverTip | null) => void;
  togglePlay: () => void;
  seekTo: (sec: number) => void;
  seekFromClientX: (clientX: number) => void;
  className?: string;
  /** 플로팅 위젯용 축소 헤더(드래그 핸들 옆) */
  compact?: boolean;
};

function MarkerTipPanel({ tip }: { tip: MarkerHoverTip }) {
  const sourceTone = tip.source === "ai" ? SOURCE_AI_TONE : tip.source === "human" ? SOURCE_HUMAN_TONE : "warning";
  const sourceLabel = tip.source === "ai" ? "AI" : tip.source === "human" ? "수기" : "Best";
  if (typeof document === "undefined") return null;

  const pad = 8;
  const maxW = 280;
  const left = Math.min(window.innerWidth - maxW / 2 - pad, Math.max(maxW / 2 + pad, tip.x));
  const style: CSSProperties =
    tip.place === "above"
      ? { left, bottom: window.innerHeight - tip.y + 8, top: "auto" }
      : { left, top: tip.y + 8 };
  const judgmentTone =
    tip.tone == null
      ? null
      : tip.tone === "best"
        ? ("warning" as const)
        : hotColdTone(tip.tone === "cold" ? "cold" : "hot");
  const judgmentLabel =
    tip.tone == null
      ? null
      : tip.tone === "best"
        ? "Best"
        : tip.source === "ai"
          ? tip.tone === "cold"
            ? "검토 필요"
            : "검토 불필요"
          : hotColdLabel(tip.tone === "cold" ? "cold" : "hot");

  return createPortal(
    <div
      className="pointer-events-none fixed z-[120] w-[min(280px,calc(100vw-16px))] -translate-x-1/2"
      style={style}
      role="tooltip"
    >
      <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-2.5 shadow-lg ring-1 ring-black/5">
        <div className="flex flex-wrap items-center gap-1">
          <span className="font-mono text-[12px] font-bold tabular-nums text-[var(--fg-primary)]">
            {formatClock(tip.timeSec)}
          </span>
          <span className="text-[11px] tabular-nums text-[var(--fg-tertiary)]">({tip.timeSec.toFixed(1)}초)</span>
          {tip.source && judgmentTone && judgmentLabel ? (
            <>
              <Badge size="medium" variant="solid" tone={sourceTone}>
                {sourceLabel}
              </Badge>
              <Badge size="medium" variant="solid" tone={judgmentTone} className="uppercase">
                {judgmentLabel}
              </Badge>
            </>
          ) : null}
          {tip.criterionId != null && tip.criterionId !== "" && (
            <Badge size="medium" variant="weak" tone="neutral" className="font-mono tabular-nums">
              {tip.criterionId}
            </Badge>
          )}
        </div>
        {tip.label ? (
          <div className="mt-1.5 text-[12.5px] font-semibold leading-snug text-[var(--fg-primary)]">{tip.label}</div>
        ) : null}
        {tip.body ? (
          <div className="mt-1 line-clamp-3 text-[11.5px] leading-snug text-[var(--fg-secondary)]">
            {tip.body}
          </div>
        ) : !tip.label && tip.tip ? (
          <div className="mt-1.5 whitespace-pre-wrap text-[11.5px] leading-snug text-[var(--fg-secondary)]">
            {tip.tip}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

function PeakLane({
  peaks,
  playedPct,
  mirror,
}: {
  peaks: number[];
  playedPct: number;
  /** true면 아래로 자라는 레인(고객/R) */
  mirror?: boolean;
}) {
  if (!peaks.length) return null;
  return (
    <div className={`pointer-events-none absolute inset-x-3 flex items-stretch gap-px ${mirror ? "bottom-1 top-1/2" : "bottom-1/2 top-1"}`}>
      {peaks.map((p, i) => {
        const h = Math.max(8, Math.round(p * 100));
        const barPct = ((i + 0.5) / peaks.length) * 100;
        const played = barPct <= playedPct;
        return (
          <div
            key={i}
            className={`min-w-0 flex-1 ${mirror ? "flex items-start" : "flex items-end"}`}
          >
            <div
              className={`w-full rounded-[1px] ${played ? "bg-[var(--brand)]/55" : "bg-[var(--fg-tertiary)]/35"}`}
              style={{ height: `${h}%` }}
            />
          </div>
        );
      })}
    </div>
  );
}

function PlaybackLegend({ compact }: { compact: boolean }) {
  return (
    <div
      className={`flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] text-[var(--fg-tertiary)] ${
        compact ? "mb-1" : "mt-2"
      }`}
      aria-label="재생바 색상 범례"
    >
      <span className="font-semibold text-[var(--fg-secondary)]">범례</span>
      <span className="inline-flex items-center gap-1">
        <span className="h-2.5 w-3 rounded-sm bg-[var(--warning)]/60" aria-hidden />
        오버랩
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-2.5 w-3 rounded-sm bg-[var(--danger)]/60" aria-hidden />
        감정 격양
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-2.5 w-3 rounded-sm bg-[var(--fg-tertiary)]/45" aria-hidden />
        공백
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-3 w-0.5 rounded-full bg-[var(--info)]" aria-hidden />
        Cold
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-3 w-0.5 rounded-full bg-[var(--c-carrot-500)]" aria-hidden />
        Hot
      </span>
      <span className="inline-flex items-center gap-1">
        <span className="h-3 w-0.5 rounded-full bg-[var(--warning)]" aria-hidden />
        Best
      </span>
    </div>
  );
}

function OverlayBands({
  overlays,
  dur,
  compact,
}: {
  overlays: WaveformOverlay[];
  dur: number;
  compact: boolean;
}) {
  const intervals = useMemo(
    () =>
      overlays.filter(isIntervalOverlay).filter((o) => o.endSec > o.startSec && dur > 0),
    [overlays, dur],
  );
  if (!intervals.length || !(dur > 0)) return null;

  return (
    <>
      {intervals.map((o) => {
        const left = Math.min(100, Math.max(0, (o.startSec / dur) * 100));
        const right = Math.min(100, Math.max(0, (o.endSec / dur) * 100));
        const width = Math.max(0.3, right - left);
        const ch = o.channel ?? "both";
        const vert =
          ch === "left"
            ? compact
              ? "top-1 h-[42%]"
              : "top-1.5 h-[42%]"
            : ch === "right"
              ? compact
                ? "bottom-1 h-[42%]"
                : "bottom-1.5 h-[42%]"
              : compact
                ? "inset-y-1"
                : "inset-y-1.5";
        const opacity =
          o.intensity != null && Number.isFinite(o.intensity)
            ? Math.min(1, Math.max(0.2, o.intensity))
            : undefined;
        return (
          <div
            key={o.id}
            className={`pointer-events-none absolute z-[5] rounded-sm ${vert} ${overlayBandClass(o.kind)}`}
            style={{
              left: `calc(0.75rem + (100% - 1.5rem) * ${left / 100})`,
              width: `calc((100% - 1.5rem) * ${width / 100})`,
              opacity,
            }}
            title={o.label}
          />
        );
      })}
    </>
  );
}

function SentimentSeries({
  overlays,
  dur,
}: {
  overlays: WaveformOverlay[];
  dur: number;
}) {
  const series = useMemo(() => overlays.filter(isSeriesOverlay).filter((s) => s.points.length >= 2), [overlays]);
  if (!series.length || !(dur > 0)) return null;

  return (
    <svg className="pointer-events-none absolute inset-x-3 inset-y-1 z-[6] h-[calc(100%-0.5rem)] w-[calc(100%-1.5rem)] overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
      {series.map((s) => {
        const pts = s.points
          .map((p) => {
            const x = Math.min(100, Math.max(0, (p.atSec / dur) * 100));
            // value -1..1 → y 100..0 (center 50)
            const y = 50 - Math.min(1, Math.max(-1, p.value)) * 40;
            return `${x},${y}`;
          })
          .join(" ");
        return (
          <polyline
            key={s.id}
            fill="none"
            stroke="var(--danger)"
            strokeWidth="1.2"
            strokeOpacity="0.75"
            vectorEffect="non-scaling-stroke"
            points={pts}
          />
        );
      })}
    </svg>
  );
}

function PlaybackBarChrome({
  conversationId,
  pos,
  dur,
  playing,
  markers,
  overlays,
  peaks,
  trackRef,
  hoverTip,
  setHoverTip,
  togglePlay,
  seekTo,
  seekFromClientX,
  className = "",
  compact = false,
}: BarChromeProps) {
  const placed = useMemo(() => {
    if (!(dur > 0)) return [];
    return markers
      .filter((m) => Number.isFinite(m.atSec) && m.atSec >= 0)
      .map((m) => ({
        ...m,
        leftPct: Math.min(100, Math.max(0, (m.atSec / dur) * 100)),
      }));
  }, [markers, dur]);

  const playedPct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;
  const hasPeaks = Boolean(peaks?.peaksLeft?.length && peaks?.peaksRight?.length);
  const updateTrackHoverTip = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!(dur > 0) || (e.target as HTMLElement).closest("button")) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const timeSec = ratio * dur;
      const place: "above" | "below" = rect.top < 120 ? "below" : "above";
      setHoverTip({
        x: e.clientX,
        y: place === "above" ? rect.top : rect.bottom,
        place,
        timeSec,
      });
    },
    [dur, setHoverTip],
  );

  return (
    <div className={`qms-run-panel flex-none p-4 ${className}`.trim()}>
      {!compact && (
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-[13px] font-bold tabular-nums">{conversationId}</div>
            <div className="mt-0.5 text-[11px] text-[var(--fg-tertiary)]">
              스테레오 파형 · 뱃지 기준선 · 클릭하여 이동 · Space 재생/일시정지
            </div>
          </div>
          <button
            type="button"
            onClick={togglePlay}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-white shadow-sm hover:bg-[var(--brand-hover)]"
            aria-label={playing ? "일시정지" : "재생"}
          >
            {playing ? <Pause className="h-5 w-5 fill-current" /> : <Play className="h-5 w-5 fill-current pl-0.5" />}
          </button>
        </div>
      )}

      {compact && (
        <div className="mb-2 flex items-center gap-2">
          <button
            type="button"
            onClick={togglePlay}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--brand)] text-white shadow-sm hover:bg-[var(--brand-hover)]"
            aria-label={playing ? "일시정지" : "재생"}
          >
            {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current pl-0.5" />}
          </button>
          <div className="min-w-0 flex-1 text-[11px] tabular-nums text-[var(--fg-tertiary)]">
            <b className="text-[var(--fg-primary)]">{formatClock(pos)}</b>
            <span className="mx-1">/</span>
            <span>{dur > 0 ? formatClock(dur) : "—"}</span>
          </div>
        </div>
      )}

      {!compact && (
        <div className="mt-3 px-1 text-[10px] text-[var(--fg-tertiary)]">
          상단 상담원(L) · 하단 고객(R)
        </div>
      )}

      <PlaybackLegend compact={compact} />

      <div
        ref={trackRef}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={Math.round(dur)}
        aria-valuenow={Math.round(pos)}
        tabIndex={0}
        className={`relative cursor-pointer select-none overflow-hidden rounded-[var(--radius-md)] bg-[var(--bg-muted)] ${
          compact ? "mt-0 h-14" : "mt-1 h-[4.5rem]"
        }`}
        onPointerMove={updateTrackHoverTip}
        onPointerLeave={() => setHoverTip(null)}
        onClick={(e) => seekFromClientX(e.clientX)}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") seekTo(pos + 5);
          if (e.key === "ArrowLeft") seekTo(pos - 5);
        }}
      >
        {/* mid divider */}
        <div className="pointer-events-none absolute inset-x-3 top-1/2 z-[1] h-px -translate-y-1/2 bg-[var(--border-subtle)]" />

        {hasPeaks && peaks ? (
          <>
            <PeakLane peaks={peaks.peaksLeft} playedPct={playedPct} />
            <PeakLane peaks={peaks.peaksRight} playedPct={playedPct} mirror />
          </>
        ) : (
          <>
            <div className="pointer-events-none absolute inset-x-3 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[var(--bg-sunken)]" />
            <div
              className="pointer-events-none absolute left-3 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-[var(--brand)]/40"
              style={{
                width: `calc(${playedPct}% - 0px)`,
                maxWidth: "calc(100% - 1.5rem)",
              }}
            />
          </>
        )}

        <OverlayBands overlays={overlays} dur={dur} compact={Boolean(compact)} />
        <SentimentSeries overlays={overlays} dur={dur} />

        {placed.map((m) => (
          <button
            key={m.key}
            type="button"
            className={`absolute top-1 z-10 w-1 -translate-x-1/2 rounded-sm ${
              compact ? "h-12" : "h-16"
            } ${hotColdTrackColor(m.tone)}`}
            style={{ left: `calc(0.75rem + (100% - 1.5rem) * ${m.leftPct / 100})` }}
            aria-label={m.tip}
            onClick={(e) => {
              e.stopPropagation();
              seekTo(m.atSec);
            }}
            onMouseEnter={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const place: "above" | "below" = rect.top < 120 ? "below" : "above";
              setHoverTip({
                x: rect.left + rect.width / 2,
                y: place === "above" ? rect.top : rect.bottom,
                place,
                timeSec: m.atSec,
                tone: m.tone,
                source: m.source ?? (m.tone === "best" ? "best" : "ai"),
                criterionId: m.criterionId,
                label: m.label,
                body: m.body,
                tip: m.tip,
              });
            }}
            onMouseLeave={() => setHoverTip(null)}
          />
        ))}

        <span
          className={`pointer-events-none absolute top-1 z-20 w-0.5 -translate-x-1/2 bg-[var(--fg-primary)] ${
            compact ? "h-12" : "h-16"
          }`}
          style={{
            left: `calc(0.75rem + (100% - 1.5rem) * ${playedPct / 100})`,
          }}
        >
          <span className="absolute -top-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-[var(--fg-primary)]" />
        </span>
      </div>

      {hoverTip ? <MarkerTipPanel tip={hoverTip} /> : null}

      {!compact && (
        <div className="mt-2 flex justify-between text-[11px] tabular-nums text-[var(--fg-tertiary)]">
          <b className="text-[var(--fg-primary)]">{formatClock(pos)}</b>
          <span>기준선 = AI/수기 뱃지 시점</span>
          <span>{dur > 0 ? formatClock(dur) : "—"}</span>
        </div>
      )}
    </div>
  );
}

const FLOAT_W = 280;
const FLOAT_PAD = 8;

function clampPos(x: number, y: number, w: number, h: number): { x: number; y: number } {
  const maxX = Math.max(FLOAT_PAD, window.innerWidth - w - FLOAT_PAD);
  const maxY = Math.max(FLOAT_PAD, window.innerHeight - h - FLOAT_PAD);
  return {
    x: Math.min(maxX, Math.max(FLOAT_PAD, x)),
    y: Math.min(maxY, Math.max(FLOAT_PAD, y)),
  };
}

function findScrollParent(el: HTMLElement | null): HTMLElement | null {
  let cur: HTMLElement | null = el?.parentElement ?? null;
  while (cur) {
    const { overflowY } = getComputedStyle(cur);
    if (
      (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") &&
      cur.scrollHeight > cur.clientHeight + 1
    ) {
      return cur;
    }
    cur = cur.parentElement;
  }
  return null;
}

/** 클릭 시크 + 스테레오 파형 + 오버레이 슬롯 + 뱃지 마커. 네이티브 controls 숨김. */
export default function CallPlaybackBar({
  conversationId,
  org,
  durationSec,
  markers,
  overlays = [],
  onSeekReady,
}: {
  conversationId: string;
  org: CallQualityOrg;
  durationSec?: number | null;
  markers: PlaybackMarker[];
  /** 말겹침·감성 등 분석 구간/시계열 (없으면 빈 배열) */
  overlays?: WaveformOverlay[];
  onSeekReady: (seek: (sec: number) => void) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const floatRef = useRef<HTMLDivElement>(null);
  const inlineTrackRef = useRef<HTMLDivElement>(null);
  const dockTrackRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ ox: number; oy: number; px: number; py: number } | null>(null);
  const userMovedFloat = useRef(false);

  const [pos, setPos] = useState(0);
  const [dur, setDur] = useState(durationSec ?? 0);
  const [playing, setPlaying] = useState(false);
  const [docked, setDocked] = useState(false);
  const [floatPos, setFloatPos] = useState({ x: 16, y: 120 });
  const [inlineHoverTip, setInlineHoverTip] = useState<MarkerHoverTip | null>(null);
  const [dockHoverTip, setDockHoverTip] = useState<MarkerHoverTip | null>(null);
  const [peaks, setPeaks] = useState<StereoPeaksState | null>(null);

  const audioSrc = `/api/call-quality/audio?conversationId=${encodeURIComponent(conversationId)}&org=${encodeURIComponent(org)}`;

  const seekTo = useCallback(
    (sec: number) => {
      const a = audioRef.current;
      if (!a) return;
      const target = Math.max(0, dur > 0 ? Math.min(sec, dur) : sec);
      const doSeek = () => {
        try {
          a.currentTime = target;
        } catch {
          /* ignore */
        }
        setPos(target);
        a.play().catch(() => {});
      };
      if (a.readyState >= 1) doSeek();
      else {
        a.addEventListener("loadedmetadata", doSeek, { once: true });
        a.load();
      }
    },
    [dur],
  );

  const togglePlay = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) a.play().catch(() => {});
    else a.pause();
  }, []);

  useEffect(() => {
    onSeekReady(seekTo);
  }, [onSeekReady, seekTo]);

  useEffect(() => {
    if (durationSec != null && durationSec > 0) setDur(durationSec);
  }, [durationSec]);

  useEffect(() => {
    setPos(0);
    setPlaying(false);
    setDocked(false);
    setInlineHoverTip(null);
    setDockHoverTip(null);
    setPeaks(null);
  }, [conversationId]);

  // stereo peaks (동일 서버 캐시 — 오디오와 병렬)
  useEffect(() => {
    const ac = new AbortController();
    const url = `/api/call-quality/audio/peaks?conversationId=${encodeURIComponent(conversationId)}&org=${encodeURIComponent(org)}&buckets=320`;
    fetch(url, { signal: ac.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`peaks ${res.status}`);
        return res.json() as Promise<StereoPeaksState>;
      })
      .then((data) => {
        if (!data?.peaksLeft?.length || !data?.peaksRight?.length) return;
        setPeaks(data);
        if (data.durationSec > 0) setDur((d) => (d > 0 ? d : data.durationSec));
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        /* thin-track fallback */
      });
    return () => ac.abort();
  }, [conversationId, org]);

  // 기본 위치: 녹취 선정(왼쪽) 사이드 패널 위. 사용자가 드래그한 뒤에는 유지.
  useEffect(() => {
    if (!docked || userMovedFloat.current) return;
    const placeDefault = () => {
      const aside = document.querySelector(".qms-layout-run > aside");
      const appSidebar = document.querySelector(".seed-sidebar");
      const asideRect = aside?.getBoundingClientRect();
      const sidebarW = appSidebar?.getBoundingClientRect().width ?? 248;
      const x = asideRect ? asideRect.left + 8 : sidebarW + 16;
      const y = asideRect ? Math.max(FLOAT_PAD, asideRect.top + 56) : 120;
      const h = floatRef.current?.offsetHeight ?? 160;
      setFloatPos(clampPos(x, y, FLOAT_W, h));
    };
    requestAnimationFrame(placeDefault);
  }, [docked]);

  useEffect(() => {
    const el = anchorRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        setDocked(!entry.isIntersecting);
      },
      { threshold: 0, rootMargin: "0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [conversationId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== " ") return;
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement | null;
      if (!t) return;
      const tag = t.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable) return;
      if (t.closest("[role='textbox'], [contenteditable='true']")) return;
      e.preventDefault();
      togglePlay();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [togglePlay]);

  useEffect(() => {
    const onResize = () => {
      setFloatPos((p) => {
        const h = floatRef.current?.offsetHeight ?? 160;
        return clampPos(p.x, p.y, FLOAT_W, h);
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if ((e.target as HTMLElement).closest("button,a,[role='slider']")) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { ox: e.clientX, oy: e.clientY, px: floatPos.x, py: floatPos.y };
    },
    [floatPos.x, floatPos.y],
  );

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    userMovedFloat.current = true;
    const h = floatRef.current?.offsetHeight ?? 160;
    setFloatPos(clampPos(d.px + (e.clientX - d.ox), d.py + (e.clientY - d.oy), FLOAT_W, h));
  }, []);

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (drag.current) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
    drag.current = null;
  }, []);

  const scrollToTop = useCallback(() => {
    const scrollParent = findScrollParent(anchorRef.current);
    if (scrollParent) {
      scrollParent.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    const page = document.querySelector(".qms-page");
    if (page instanceof HTMLElement) {
      page.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const seekFromClientX = useCallback(
    (clientX: number, trackEl: HTMLDivElement | null) => {
      if (!trackEl || !(dur > 0)) return;
      const rect = trackEl.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      seekTo(ratio * dur);
    },
    [dur, seekTo],
  );

  const chromeProps = {
    conversationId,
    pos,
    dur,
    playing,
    markers,
    overlays,
    peaks,
    togglePlay,
    seekTo,
  };

  return (
    <>
      <audio
        ref={audioRef}
        preload="metadata"
        src={audioSrc}
        className="hidden"
        onTimeUpdate={(e) => setPos(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDur(e.currentTarget.duration || dur)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />

      <div ref={anchorRef}>
        <PlaybackBarChrome
          {...chromeProps}
          trackRef={inlineTrackRef}
          hoverTip={inlineHoverTip}
          setHoverTip={setInlineHoverTip}
          seekFromClientX={(x) => seekFromClientX(x, inlineTrackRef.current)}
        />
      </div>

      {docked && (
        <div
          ref={floatRef}
          className="fixed z-[70] w-[280px] select-none rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-canvas)] shadow-lg"
          style={{ left: floatPos.x, top: floatPos.y }}
          role="complementary"
          aria-label="재생 컨트롤"
        >
          <div
            className="flex cursor-grab items-center gap-1.5 border-b border-[var(--border-subtle)] px-2.5 py-2 active:cursor-grabbing"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            <GripVertical className="h-4 w-4 shrink-0 text-[var(--fg-tertiary)]" />
            <div className="min-w-0 flex-1 truncate font-mono text-[11px] font-bold tabular-nums text-[var(--fg-primary)]">
              {conversationId}
            </div>
            <button
              type="button"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--fg-secondary)] transition hover:bg-[var(--bg-muted)] hover:text-[var(--fg-primary)]"
              title="맨 위로"
              aria-label="맨 위로 스크롤"
              onClick={scrollToTop}
            >
              <ArrowUpToLine className="h-3.5 w-3.5" />
            </button>
            <span className="shrink-0 text-[10px] text-[var(--fg-tertiary)]">Space</span>
          </div>
          <div className="px-2.5 py-2.5">
            <PlaybackBarChrome
              {...chromeProps}
              compact
              className="!overflow-visible !border-0 !bg-transparent !p-0 !shadow-none"
              trackRef={dockTrackRef}
              hoverTip={dockHoverTip}
              setHoverTip={setDockHoverTip}
              seekFromClientX={(x) => seekFromClientX(x, dockTrackRef.current)}
            />
          </div>
        </div>
      )}
    </>
  );
}
