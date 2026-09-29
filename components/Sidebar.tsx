"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import {
  PanelLeftClose,
  PanelLeftOpen,
  BarChart3,
  LogOut,
  ClipboardList,
  ClipboardCheck,
  ClipboardPen,
  ListTree,
  Sparkles,
  Target,
  GitCompare,
  Cpu,
  Radar,
  Wand2,
  PenLine,
  BookOpen,
  CalendarClock,
  FileSearch,
  PieChart,
  LineChart,
  Shuffle,
  ListChecks,
  Flag,
  Users,
  Eye,
  AlertTriangle,
  BadgeCheck,
  Bookmark,
  AudioLines,
  Inbox,
  CircleAlert,
  type LucideIcon,
} from "lucide-react";
import { isAdmin, canAccessEvalOps, canAccessEvalOpsFull } from "@/lib/adminEmails";
import {
  sessionCanAccessEvalProgress,
  sessionCanAccessMonthlyReport,
  sessionCanAccessQualityEval,
} from "@/lib/sessionAccess";
import { isCallQualityObserveMode } from "@/lib/callQualityDeepLink";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  children?: NavItem[];
  badge?: number | null;
};
type NavHint = { label: string; desc: string };
type NavGroup = { label: string; hint?: NavHint[]; items: NavItem[] };
type EvaluationChannel = "phone" | "feedback";

function NavGroupHint({ label, items }: { label: string; items: NavHint[] }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLSpanElement>(null);
  const hideTimer = useRef<number>(0);

  const updatePos = () => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    const tipH = tipRef.current?.offsetHeight ?? 0;
    const left = Math.min(r.right + 8, window.innerWidth - 16 - 288);
    let top = r.top;
    if (tipH > 0 && top + tipH > window.innerHeight - 8) {
      top = Math.max(8, window.innerHeight - tipH - 8);
    }
    setPos({ top: Math.max(8, top), left: Math.max(8, left) });
  };

  const show = () => {
    window.clearTimeout(hideTimer.current);
    updatePos();
    setOpen(true);
  };

  const hide = () => {
    hideTimer.current = window.setTimeout(() => setOpen(false), 120);
  };

  useEffect(() => {
    if (!open) return;
    const id = window.requestAnimationFrame(updatePos);
    window.addEventListener("scroll", updatePos, true);
    window.addEventListener("resize", updatePos);
    return () => {
      window.cancelAnimationFrame(id);
      window.removeEventListener("scroll", updatePos, true);
      window.removeEventListener("resize", updatePos);
    };
  }, [open]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={`${label} 안내`}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[var(--fg-tertiary)] hover:bg-[var(--bg-muted)] hover:text-[var(--fg-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--brand)]"
      >
        <CircleAlert className="h-3 w-3" strokeWidth={2.25} aria-hidden />
      </button>
      {open
        ? createPortal(
            <span
              ref={tipRef}
              role="tooltip"
              onMouseEnter={show}
              onMouseLeave={hide}
              className="fixed z-[80] w-[min(20rem,calc(100vw-2rem))] max-h-[calc(100vh-1rem)] overflow-y-auto rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-3 py-2.5 text-left shadow-lg ring-1 ring-black/5"
              style={{ top: pos.top, left: pos.left }}
            >
              <ul className="space-y-1.5 text-[11.5px] leading-snug text-[var(--fg-secondary)]">
                {items.map((item) => (
                  <li key={item.label}>
                    <span className="font-bold text-[var(--fg-primary)]">{item.label}</span>
                    <span className="mt-0.5 block">{item.desc}</span>
                  </li>
                ))}
              </ul>
            </span>,
            document.body,
          )
        : null}
    </>
  );
}

const EVALUATION_LAST_CHANNEL_KEY = "qms-evaluation-last-channel";
const REVIEW_REMAINING_TTL_MS = 30_000;
const REVIEW_REMAINING_POLL_MS = 60_000;
let reviewRemainingCache: { remaining: number; at: number } | null = null;

function hrefPath(href: string) {
  return href.split("?")[0] || href;
}

function hrefParams(href: string) {
  const q = href.includes("?") ? href.slice(href.indexOf("?") + 1) : "";
  return new URLSearchParams(q);
}

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const [lastEvaluationChannels, setLastEvaluationChannels] = useState<Record<string, EvaluationChannel>>({});
  const [reviewRemaining, setReviewRemaining] = useState<number | null>(null);
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const email = session?.user?.email;
  const admin = isAdmin(email);
  const qualityEval = sessionCanAccessQualityEval(session);
  const monthlyReport = sessionCanAccessMonthlyReport(session);
  // 평가 진행은 도메인 전체 — 콜·인앱문의 채널 모두 같은 권한.
  const evalProgress = sessionCanAccessEvalProgress(session);
  const callEval = evalProgress;
  const feedbackEval = evalProgress;
  const evalOps = canAccessEvalOps(email);
  const evalOpsFull = canAccessEvalOpsFull(email);
  const evalOpsNav = evalOps || qualityEval;
  const hideForObserve =
    (pathname === "/call-quality" || pathname.startsWith("/call-quality/")) &&
    isCallQualityObserveMode(searchParams);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(EVALUATION_LAST_CHANNEL_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const valid = Object.fromEntries(
        Object.entries(parsed).filter(([, value]) => value === "phone" || value === "feedback"),
      ) as Record<string, EvaluationChannel>;
      setLastEvaluationChannels(valid);
    } catch {
      // localStorage가 막힌 환경에서도 사이드바 탐색은 계속 가능해야 한다.
    }
  }, []);

  useEffect(() => {
    if (!callEval) return;
    let cancelled = false;
    const apply = (remaining: number) => {
      if (!cancelled) setReviewRemaining(remaining);
    };
    const load = (opts?: { force?: boolean }) => {
      if (document.hidden) return;
      const now = Date.now();
      if (!opts?.force && reviewRemainingCache && now - reviewRemainingCache.at < REVIEW_REMAINING_TTL_MS) {
        apply(reviewRemainingCache.remaining);
        return;
      }
      fetch("/api/call-quality/review-requests", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { remaining?: number } | null) => {
          if (d && typeof d.remaining === "number") {
            reviewRemainingCache = { remaining: d.remaining, at: Date.now() };
            apply(d.remaining);
          }
        })
        .catch(() => {});
    };
    load();
    const t = window.setInterval(() => load({ force: true }), REVIEW_REMAINING_POLL_MS);
    const onVis = () => {
      if (!document.hidden) load();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      window.clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [callEval]);

  const rememberEvaluationChannel = (itemHref: string, channel: EvaluationChannel) => {
    const key = hrefPath(itemHref);
    const next = { ...lastEvaluationChannels, [key]: channel };
    setLastEvaluationChannels(next);
    try {
      window.localStorage.setItem(EVALUATION_LAST_CHANNEL_KEY, JSON.stringify(next));
    } catch {
      // 저장 실패 시 현재 세션의 상태만 사용한다.
    }
  };

  const availableChannels: EvaluationChannel[] = [
    ...(callEval ? (["phone"] as const) : []),
    ...(feedbackEval ? (["feedback"] as const) : []),
  ];

  const toolItems: NavItem[] = [
    ...(evalProgress
      ? [
          {
            label: "전체 평가",
            href: "/call-quality",
            icon: ClipboardCheck,
            children: [
              { label: "고위험군", href: "/call-quality/high-risk", icon: AlertTriangle },
              { label: "미검수건", href: "/call-quality/needs-review", icon: ClipboardPen },
              {
                label: "검수 요청",
                href: "/call-quality/review-requests",
                icon: Inbox,
                badge: reviewRemaining,
              },
              { label: "내 평가", href: "/call-quality/mine", icon: Bookmark },
            ],
          } satisfies NavItem,
        ]
      : []),
  ];

  const evalOpsItems: NavItem[] = [
    ...(evalOpsNav ? [{ label: "평가 스케줄", href: "/eval-ops/schedule", icon: CalendarClock }] : []),
    ...(evalOps
      ? [
          {
            label: "평가 배분",
            href: "/eval-ops/assign",
            icon: Shuffle,
            children: [
              {
                label: "확정 배분",
                href: "/eval-ops/assign?tab=assign&confirmed=1",
                icon: BadgeCheck,
              },
            ],
          } satisfies NavItem,
          ...(evalOpsFull
            ? [
                { label: "수기 검수 할당", href: "/eval-ops/auto-run", icon: ClipboardPen } satisfies NavItem,
                {
                  label: "AI 평가 배치",
                  href: "/eval-ops/eval-batch",
                  icon: Sparkles,
                } satisfies NavItem,
                {
                  label: "STT 배치 스케줄",
                  href: "/eval-ops/stt-batch",
                  icon: AudioLines,
                  children: [{ label: "STT 이슈", href: "/eval-ops/stt-batch/issues", icon: Flag }],
                } satisfies NavItem,
              ]
            : []),
        ]
      : []),
    ...(evalOpsNav ? [{ label: "검수 현황", href: "/eval-ops/review-status", icon: ListChecks }] : []),
  ];

  const groups: NavGroup[] = [
    ...(toolItems.length
      ? [
          {
            label: "평가 진행",
            hint: [
              { label: "전체 평가", desc: "기간·필터 기본값으로 전체 콜·문의를 보여줍니다." },
              { label: "고위험군", desc: "고위험군 플래그가 하나라도 붙은 건만 보여줍니다." },
              { label: "미검수건", desc: "AI 평가는 끝났고 수기 검수가 아직인 건만 보여줍니다." },
              { label: "검수 요청", desc: "수기 검수 대상으로 할당된 공용 건입니다. 누구나 이어서 검수합니다." },
              { label: "내 평가", desc: "내가 검수했거나 찜한, 아직 완료되지 않은 건만 보여줍니다." },
            ],
            items: toolItems,
          } satisfies NavGroup,
        ]
      : []),
    ...(evalOpsItems.length
      ? [
          {
            label: "평가 운영",
            hint: [
              ...(evalOpsNav
                ? [{ label: "평가 스케줄", desc: "월별 평가 일정을 배치하고 완료·리더검토·본인확정을 추적합니다." }]
                : []),
              ...(evalOps
                ? [
                    { label: "평가 배분", desc: "재직자 → 팀 확정 → AQT 일감 → 평가자 배분을 진행합니다." },
                    { label: "확정 배분", desc: "이미 확정된 배분 결과를 조회합니다. 수정은 할 수 없습니다." },
                  ]
                : []),
              ...(evalOpsFull
                ? [
                    { label: "수기 검수 할당", desc: "AI 평가가 끝난 콜을 골라 「검수 요청」 공용 대기열에 넣습니다." },
                    { label: "AI 평가 배치", desc: "스케줄 시각에 대상 콜을 골라 Gemini 품질평가를 돌립니다." },
                    { label: "STT 배치 스케줄", desc: "하루 콜을 구성원당 N건 모아 로컬 STT 큐에 넣습니다." },
                    { label: "STT 이슈", desc: "평가 진행에서 리포팅한 STT 이상을 모읍니다." },
                  ]
                : []),
              ...(evalOpsNav
                ? [{ label: "검수 현황", desc: "수기 검수 완료 건의 AI vs 수기 오탐·미탐을 집계합니다." }]
                : []),
            ],
            items: evalOpsItems,
          } satisfies NavGroup,
        ]
      : []),
    ...(qualityEval
      ? [
          {
            label: "평가 설계",
            hint: [
              { label: "평가표", desc: "평가 기준·프롬프트 묶음을 버전(draft/production)으로 관리합니다." },
              { label: "고위험군 플래그", desc: "평가 진행 「고위험군」 필터에 쓰는 선별 규칙을 채널별로 관리합니다." },
              { label: "평가 항목", desc: "평가 항목 마스터(카테고리·항목 정의)를 조회합니다." },
              { label: "AI 평가 항목", desc: "AI가 읽는 항목별 프롬프트(정의·예시)를 편집합니다." },
              { label: "정확도 대시보드", desc: "Train 수기 vs AI 라벨의 정확도·미탐·오탐을 평가표 버전별로 봅니다." },
              { label: "AI 비교·개선", desc: "Train 레퍼런스 콜에서 수기 vs AI 불일치를 비교·재평가합니다." },
              { label: "프롬프트 개선", desc: "불일치 사례로 항목 프롬프트 개선 초안을 만듭니다." },
              { label: "답변 다듬기 테스트", desc: "당근이 문의 답변의 톤앤매너 프롬프트를 실제 스레드로 비교합니다." },
              { label: "AI 호출 사용량", desc: "LLM·STT 호출량과 추정 비용을 목적·모델별로 봅니다." },
            ],
            items: [
              { label: "평가표", href: "/eval-design/sheets", icon: ClipboardList },
              { label: "고위험군 플래그", href: "/eval-design/high-risk", icon: Flag },
              {
                label: "평가 항목",
                href: "/eval-design/items",
                icon: ListTree,
                children: [{ label: "AI 평가 항목", href: "/eval-design/ai-items", icon: Sparkles }],
              },
              { label: "정확도 대시보드", href: "/eval-design/accuracy", icon: Target },
              { label: "AI 비교·개선", href: "/eval-design/compare", icon: GitCompare },
              { label: "프롬프트 개선", href: "/eval-design/prompt-improve", icon: Wand2 },
              { label: "답변 다듬기 테스트", href: "/eval-design/reply-polish", icon: PenLine },
              { label: "AI 호출 사용량", href: "/eval-design/llm-usage", icon: Cpu },
            ],
          } satisfies NavGroup,
        ]
      : []),
    ...(monthlyReport
      ? [
          {
            label: "품질평가",
            // 리더(L4·L5)는 월간 리포트만, quality eval은 전체.
            hint: [
              ...(qualityEval ? [{ label: "리포트", desc: "구성원 기준 Hot/Cold를 집계합니다." }] : []),
              { label: "월간 리포트", desc: "월마감 대시보드와 보고서 초안을 봅니다." },
              ...(qualityEval
                ? [
                    { label: "평가 현황", desc: "월별 평가표·대상·케이스 진행 상태를 봅니다." },
                    { label: "케이스 상세", desc: "사람 평가 케이스를 월·구성원·템플릿 단위로 봅니다." },
                    { label: "월별 집계", desc: "월·팀별 품질평가 결과를 집계합니다." },
                  ]
                : []),
            ],
            items: [
              ...(qualityEval ? [{ label: "리포트", href: "/results/report", icon: LineChart }] : []),
              { label: "월간 리포트", href: "/results/monthly-report", icon: CalendarClock },
              ...(qualityEval
                ? [
                    { label: "평가 현황", href: "/results/status", icon: ListChecks },
                    { label: "케이스 상세", href: "/results/cases", icon: FileSearch },
                    { label: "월별 집계", href: "/results/aggregate", icon: PieChart },
                  ]
                : []),
            ],
          } satisfies NavGroup,
        ]
      : []),
    ...(admin
      ? [
          {
            label: "시스템",
            items: [
              { label: "사용량", href: "/usage", icon: BarChart3 },
              { label: "AI 평가 job", href: "/admin/eval-schedule", icon: CalendarClock },
              { label: "Slack 유저", href: "/admin/slack-users", icon: Users },
              { label: "sudo", href: "/admin/sudo", icon: Eye },
            ],
          } satisfies NavGroup,
        ]
      : []),
  ];

  const isActive = (href: string) => {
    const path = hrefPath(href);
    const want = hrefParams(href);

    if (path === "/call-quality" || path.startsWith("/call-quality/")) {
      const feedbackPath = path.replace(/^\/call-quality(?=\/|$)/, "/feedback");
      const matches = (candidate: string) => pathname === candidate || pathname.startsWith(candidate + "/");
      return matches(path) || matches(feedbackPath);
    }
    if (path === "/eval-ops/assign") {
      if (pathname !== "/eval-ops/assign" && !pathname.startsWith("/eval-ops/assign/")) return false;
      const wantConfirmed = want.get("confirmed") === "1";
      const haveConfirmed = searchParams.get("confirmed") === "1";
      if (wantConfirmed) return haveConfirmed;
      // 부모「평가 배분」: 확정 딥링크가 아닐 때
      return !haveConfirmed;
    }
    return pathname === path || pathname.startsWith(path + "/");
  };

  const isEvaluationNavItem = (item: NavItem) => hrefPath(item.href).startsWith("/call-quality");

  const channelHref = (itemHref: string, channel: EvaluationChannel) => {
    if (channel === "phone") return itemHref;
    return itemHref.replace(/^\/call-quality(?=\/|$)/, "/feedback");
  };

  const renderEvaluationLink = (item: NavItem, opts?: { nested?: boolean }) => {
    const { label, href, icon: Icon } = item;
    const active = isActive(href);
    const nested = opts?.nested ?? false;
    const lastStored = lastEvaluationChannels[hrefPath(href)];
    const lastChannel =
      lastStored && availableChannels.includes(lastStored)
        ? lastStored
        : (availableChannels[0] ?? "phone");
    const miniClass = (channel: EvaluationChannel) => {
      const channelPath = hrefPath(channelHref(href, channel));
      const channelActive = pathname === channelPath || pathname.startsWith(channelPath + "/");
      return `rounded-[7px] px-1.5 py-0.5 text-[10px] font-bold transition ${
        channelActive
          ? "bg-[var(--brand-subtle)] text-[var(--brand)]"
          : "text-[var(--fg-tertiary)] hover:bg-[var(--bg-muted)] hover:text-[var(--fg-secondary)]"
      }`;
    };

    return (
      <div key={href} className={`flex items-center rounded-[12px] transition ${active ? "bg-[var(--brand-subtle)]" : "hover:bg-[var(--bg-muted)]"}`}>
        <Link
          href={channelHref(href, lastChannel)}
          aria-current={active ? "page" : undefined}
          title={collapsed ? label : undefined}
          className={`group flex min-w-0 flex-1 items-center gap-3 text-[13px] ${
            collapsed ? "justify-center px-0 py-2.5" : nested ? "py-2 pl-9 pr-1.5" : "px-3 py-2.5"
          } ${active ? "font-bold text-[var(--brand)]" : "font-medium text-[var(--fg-secondary)]"}`}
        >
          <Icon className="h-[17px] w-[17px] shrink-0" strokeWidth={active ? 2.2 : 1.9} />
          {!collapsed && <span className="truncate">{label}</span>}
          {!collapsed && item.badge != null && item.badge > 0 ? (
            <span className="ml-auto shrink-0 rounded-full bg-[var(--brand)] px-1.5 py-0.5 text-[10px] font-bold leading-none text-white">
              {item.badge > 99 ? "99+" : item.badge}
            </span>
          ) : null}
        </Link>
        {!collapsed && availableChannels.length > 1 && (
          <div className="mr-2 flex shrink-0 items-center gap-0.5 rounded-[8px] bg-[var(--bg-canvas)] p-0.5">
            {callEval && (
              <Link
                href={channelHref(href, "phone")}
                onClick={() => rememberEvaluationChannel(href, "phone")}
                className={miniClass("phone")}
                aria-label={`${label} 콜 검수`}
              >
                콜
              </Link>
            )}
            {feedbackEval && (
              <Link
                href={channelHref(href, "feedback")}
                onClick={() => rememberEvaluationChannel(href, "feedback")}
                className={miniClass("feedback")}
                aria-label={`${label} 문의 검수`}
              >
                문의
              </Link>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderLink = (item: NavItem, opts?: { nested?: boolean }) => {
    if (isEvaluationNavItem(item)) return renderEvaluationLink(item, opts);
    const { label, href, icon: Icon } = item;
    const active = isActive(href);
    const nested = opts?.nested ?? false;
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        title={collapsed ? label : undefined}
        className={`group flex items-center gap-3 rounded-[12px] text-[13px] transition ${
          nested ? "py-2 pl-9 pr-3" : "px-3 py-2.5"
        } ${
          active
            ? "bg-[var(--brand-subtle)] font-bold text-[var(--brand)]"
            : "font-medium text-[var(--fg-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--fg-primary)]"
        } ${collapsed ? "justify-center px-0" : ""}`}
      >
        <Icon className="h-[17px] w-[17px] shrink-0" strokeWidth={active ? 2.2 : 1.9} />
        {!collapsed && <span className="truncate">{label}</span>}
      </Link>
    );
  };

  if (hideForObserve) return null;

  return (
    <aside
      className={`${collapsed ? "w-[72px]" : "w-[248px]"} seed-sidebar sticky top-0 flex h-dvh max-h-dvh shrink-0 flex-col self-start overflow-hidden transition-[width] duration-200`}
    >
      <div className="flex h-[64px] items-center gap-2.5 px-4">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-[var(--brand)] text-white">
          <Radar className="h-[18px] w-[18px]" strokeWidth={2.2} />
        </div>
        {!collapsed && (
          <div className="min-w-0">
            <span className="block truncate text-[15px] font-bold tracking-tight text-[var(--fg-primary)]">
              QRadar
            </span>
            <span className="block truncate text-[11px] font-medium text-[var(--fg-tertiary)]">콜 품질 평가</span>
          </div>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
          className="ml-auto rounded-[10px] p-1.5 text-[var(--fg-tertiary)] transition hover:bg-[var(--bg-muted)] hover:text-[var(--fg-secondary)]"
        >
          {collapsed ? <PanelLeftOpen className="h-4.5 w-4.5" /> : <PanelLeftClose className="h-4.5 w-4.5" />}
        </button>
      </div>

      <nav className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-2">
        {groups.map((g) => (
          <div key={g.label}>
            {!collapsed && (
              <div className="mb-1.5 flex items-center gap-0.5 px-3">
                <span className="text-[11px] font-bold text-[var(--fg-tertiary)]">{g.label}</span>
                {g.hint?.length ? <NavGroupHint label={g.label} items={g.hint} /> : null}
              </div>
            )}
            <div className="flex flex-col gap-0.5">
              {g.items.map((item) => (
                <div key={item.href}>
                  {renderLink(item)}
                  {!collapsed && item.children?.length
                    ? item.children.map((child) => renderLink(child, { nested: true }))
                    : null}
                  {collapsed && item.children?.length
                    ? item.children.map((child) => renderLink(child))
                    : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="shrink-0 border-t border-[var(--border-subtle)] px-3 py-2">
        {!collapsed && (
          <div className="mb-1 px-3 text-[11px] font-bold text-[var(--fg-tertiary)]">도움말</div>
        )}
        <Link
          href="/guide"
          aria-current={isActive("/guide") ? "page" : undefined}
          title={collapsed ? "이용 설명서" : undefined}
          className={`group flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-[13px] transition ${
            isActive("/guide")
              ? "bg-[var(--brand-subtle)] font-bold text-[var(--brand)]"
              : "font-medium text-[var(--fg-secondary)] hover:bg-[var(--bg-muted)] hover:text-[var(--fg-primary)]"
          } ${collapsed ? "justify-center px-0" : ""}`}
        >
          <BookOpen className="h-[17px] w-[17px] shrink-0" strokeWidth={isActive("/guide") ? 2.2 : 1.9} />
          {!collapsed && <span className="truncate">이용 설명서</span>}
        </Link>
      </div>

      <div className="shrink-0 border-t border-[var(--border-subtle)] p-3">
        {!collapsed && session?.user?.email && (
          <p className="truncate px-2 pb-1 text-[11px] text-[var(--fg-tertiary)]">{session.user.email}</p>
        )}
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          title={collapsed ? "로그아웃" : undefined}
          className={`flex items-center gap-2 rounded-[12px] px-2 py-2 text-[12px] font-medium text-[var(--fg-secondary)] transition hover:bg-[var(--bg-muted)] hover:text-[var(--fg-primary)] ${
            collapsed ? "w-full justify-center px-0" : "w-full"
          }`}
        >
          <LogOut className="h-4 w-4 shrink-0" />
          {!collapsed && <span>로그아웃</span>}
        </button>
      </div>
    </aside>
  );
}
