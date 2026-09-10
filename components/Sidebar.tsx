"use client";

import { useEffect, useState } from "react";
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
  Rocket,
  Bookmark,
  AudioLines,
  type LucideIcon,
} from "lucide-react";
import { isAdmin, canAccessEvalOps, canAccessEvalOpsFull } from "@/lib/adminEmails";
import {
  sessionCanAccessAnyCallQuality,
  sessionCanAccessCallQuality,
} from "@/lib/sessionAccess";
import { isCallQualityObserveMode } from "@/lib/callQualityDeepLink";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  children?: NavItem[];
};
type NavGroup = { label: string; items: NavItem[] };
type EvaluationChannel = "phone" | "feedback";

const EVALUATION_LAST_CHANNEL_KEY = "qms-evaluation-last-channel";

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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const email = session?.user?.email;
  const admin = isAdmin(email);
  const cq = sessionCanAccessAnyCallQuality(session);
  const evalOps = canAccessEvalOps(email);
  const evalOpsFull = canAccessEvalOpsFull(email);
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

  const toolItems: NavItem[] = [
    ...(sessionCanAccessCallQuality(session)
      ? [
          {
            label: "전체 평가",
            href: "/call-quality",
            icon: ClipboardCheck,
            children: [
              { label: "고위험군 평가", href: "/call-quality/high-risk", icon: AlertTriangle },
              { label: "수기 평가 필요", href: "/call-quality/needs-review", icon: ClipboardPen },
              { label: "내 평가", href: "/call-quality/mine", icon: Bookmark },
            ],
          } satisfies NavItem,
        ]
      : []),
  ];

  const evalOpsItems: NavItem[] = [
    ...(session?.user?.email ? [{ label: "평가 스케줄", href: "/eval-ops/schedule", icon: CalendarClock }] : []),
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
          { label: "자동 평가 실행", href: "/eval-ops/auto-run", icon: Rocket },
          ...(evalOpsFull
            ? [{ label: "STT 배치 스케줄", href: "/eval-ops/stt-batch", icon: AudioLines } satisfies NavItem]
            : []),
        ]
      : []),
    ...(sessionCanAccessCallQuality(session)
      ? [{ label: "검수 현황", href: "/eval-ops/review-status", icon: ListChecks }]
      : []),
  ];

  const groups: NavGroup[] = [
    ...(toolItems.length ? [{ label: "평가 진행", items: toolItems } satisfies NavGroup] : []),
    ...(evalOpsItems.length ? [{ label: "평가 운영", items: evalOpsItems } satisfies NavGroup] : []),
    ...(cq
      ? [
          {
            label: "평가 설계",
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
              { label: "AI 호출 사용량", href: "/eval-design/llm-usage", icon: Cpu },
            ],
          } satisfies NavGroup,
          {
            label: "품질평가",
            items: [
              { label: "리포트", href: "/results/report", icon: LineChart },
              { label: "평가 현황", href: "/results/status", icon: ListChecks },
              { label: "케이스 상세", href: "/results/cases", icon: FileSearch },
              { label: "월별 집계", href: "/results/aggregate", icon: PieChart },
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
    const lastChannel = lastEvaluationChannels[hrefPath(href)] ?? "phone";
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
        </Link>
        {!collapsed && (
          <div className="mr-2 flex shrink-0 items-center gap-0.5 rounded-[8px] bg-[var(--bg-canvas)] p-0.5">
            <Link
              href={channelHref(href, "phone")}
              onClick={() => rememberEvaluationChannel(href, "phone")}
              className={miniClass("phone")}
              aria-label={`${label} 콜 검수`}
            >
              콜
            </Link>
            <Link
              href={channelHref(href, "feedback")}
              onClick={() => rememberEvaluationChannel(href, "feedback")}
              className={miniClass("feedback")}
              aria-label={`${label} 문의 검수`}
            >
              문의
            </Link>
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
              <div className="mb-1.5 px-3 text-[11px] font-bold text-[var(--fg-tertiary)]">{g.label}</div>
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
