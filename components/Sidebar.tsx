"use client";

import { useState } from "react";
import {
  BookOpen,
  PanelLeftClose,
  PanelLeftOpen,
  Home,
  FileText,
  ClipboardList,
  Scale,
  Mail,
  BarChart3,
  Bot,
  TrendingUp,
  Phone,
  type LucideIcon,
} from "lucide-react";

type NavItem = { label: string; icon: LucideIcon; active?: boolean };

// 대외민원팀 스위트의 네비게이션 — 이 페이지(콜 품질 평가)가 활성.
const NAV: NavItem[] = [
  { label: "홈 화면", icon: Home },
  { label: "회의록", icon: FileText },
  { label: "케이스 분석", icon: ClipboardList },
  { label: "판단기준", icon: Scale },
  { label: "Gmail 분류", icon: Mail },
  { label: "통계 현황", icon: BarChart3 },
  { label: "AI 챗봇", icon: Bot },
  { label: "인사이트 분석", icon: TrendingUp },
  { label: "콜 품질 평가", icon: Phone, active: true },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <aside
      className={`${
        collapsed ? "w-16" : "w-64"
      } shrink-0 border-r border-gray-200 bg-surface flex flex-col transition-[width] duration-200`}
    >
      <div className="flex h-16 items-center gap-2 px-4">
        <BookOpen className="h-5 w-5 shrink-0 text-brand" strokeWidth={2.2} />
        {!collapsed && (
          <span className="truncate text-[15px] font-bold tracking-tight text-gray-900">
            대외민원팀
          </span>
        )}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
          className="ml-auto rounded-md p-1.5 text-gray-400 transition hover:bg-gray-200/70 hover:text-gray-600 focus-visible:outline-2 focus-visible:outline-navy"
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4.5 w-4.5" />
          ) : (
            <PanelLeftClose className="h-4.5 w-4.5" />
          )}
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
        {NAV.map(({ label, icon: Icon, active }) => (
          <a
            key={label}
            href="#"
            aria-current={active ? "page" : undefined}
            title={collapsed ? label : undefined}
            className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
              active
                ? "bg-navy font-semibold text-white shadow-sm"
                : "font-medium text-gray-600 hover:bg-gray-200/70 hover:text-gray-900"
            } ${collapsed ? "justify-center px-0" : ""}`}
          >
            <Icon
              className="h-[18px] w-[18px] shrink-0"
              strokeWidth={active ? 2.2 : 1.9}
            />
            {!collapsed && <span className="truncate">{label}</span>}
          </a>
        ))}
      </nav>

      {!collapsed && (
        <div className="px-4 py-4 text-[11px] leading-relaxed text-gray-400">
          통화 품질 평가 · 1단계
        </div>
      )}
    </aside>
  );
}
