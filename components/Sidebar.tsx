"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { BookOpen, PanelLeftClose, PanelLeftOpen, Phone, ScanSearch, BarChart3, MessageSquareHeart, LogOut, type LucideIcon } from "lucide-react";
import { isAdmin } from "@/lib/adminEmails";

type NavItem = { label: string; href: string; icon: LucideIcon; adminOnly?: boolean };

const NAV: NavItem[] = [
  { label: "콜 품질 평가", href: "/", icon: Phone },
  { label: "파손 판별", href: "/damage", icon: ScanSearch },
  { label: "피드백", href: "/feedback", icon: MessageSquareHeart, adminOnly: true },
  { label: "사용량", href: "/usage", icon: BarChart3, adminOnly: true },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const { data: session } = useSession();
  const admin = isAdmin(session?.user?.email);
  const navItems = NAV.filter((item) => !item.adminOnly || admin);

  return (
    <aside
      className={`${collapsed ? "w-16" : "w-64"} shrink-0 border-r border-gray-200 bg-surface flex flex-col transition-[width] duration-200`}
    >
      <div className="flex h-16 items-center gap-2 px-4">
        <BookOpen className="h-5 w-5 shrink-0 text-brand" strokeWidth={2.2} />
        {!collapsed && <span className="truncate text-[15px] font-bold tracking-tight text-gray-900">X팀</span>}
        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          aria-label={collapsed ? "사이드바 펼치기" : "사이드바 접기"}
          className="ml-auto rounded-md p-1.5 text-gray-400 transition hover:bg-gray-200/70 hover:text-gray-600 focus-visible:outline-2 focus-visible:outline-navy"
        >
          {collapsed ? <PanelLeftOpen className="h-4.5 w-4.5" /> : <PanelLeftClose className="h-4.5 w-4.5" />}
        </button>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 py-2">
        {navItems.map(({ label, href, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              title={collapsed ? label : undefined}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition ${
                active ? "bg-navy font-semibold text-white shadow-sm" : "font-medium text-gray-600 hover:bg-gray-200/70 hover:text-gray-900"
              } ${collapsed ? "justify-center px-0" : ""}`}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={active ? 2.2 : 1.9} />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-gray-200 p-3">
        {!collapsed && session?.user?.email && (
          <p className="truncate px-2 pb-1 text-[11px] text-gray-400">{session.user.email}</p>
        )}
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/login" })}
          title={collapsed ? "로그아웃" : undefined}
          className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium text-gray-500 transition hover:bg-gray-200/70 hover:text-gray-800 ${
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
