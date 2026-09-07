"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { RefreshCw, Users } from "lucide-react";
import { isAdmin } from "@/lib/adminEmails";
import type { SlackUserRow } from "@/lib/slackUsers";

export default function SlackUsersAdminPage() {
  const { data: session } = useSession();
  const admin = isAdmin(session?.user?.email);
  const [users, setUsers] = useState<SlackUserRow[]>([]);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/slack-users");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "불러오기 실패");
      setUsers(json.users ?? []);
      setConfigured(!!json.configured);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (admin) void load();
  }, [admin, load]);

  const sync = async () => {
    setSyncing(true);
    setError("");
    try {
      const res = await fetch("/api/admin/slack-users", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "동기화 실패");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return users;
    return users.filter(
      (u) =>
        u.email.includes(needle) ||
        u.displayName.toLowerCase().includes(needle) ||
        u.realName.toLowerCase().includes(needle) ||
        u.slackUserId.includes(needle),
    );
  }, [users, q]);

  if (!admin) {
    return (
      <div className="p-8 text-center text-sm text-gray-500">
        관리자만 접근할 수 있습니다.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Users className="h-6 w-6 text-navy" />
            <h1 className="text-2xl font-bold text-gray-900">Slack 유저</h1>
          </div>
          <p className="mt-1 text-sm text-gray-500">
            Slack 워크스페이스 멤버를 동기화해 평가자 이메일 매핑에 사용합니다.
          </p>
        </div>
        <div className="flex gap-2">
          <button type="button" className="rounded-lg border border-gray-200 px-3 py-2 text-sm" onClick={() => void load()} disabled={loading}>
            <RefreshCw className={`inline h-4 w-4 ${loading ? "animate-spin" : ""}`} /> 새로고침
          </button>
          <button
            type="button"
            className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            onClick={() => void sync()}
            disabled={syncing || !configured}
            title={configured ? undefined : "SLACK_BOT_TOKEN 설정 필요"}
          >
            {syncing ? "동기화 중…" : "Slack에서 동기화"}
          </button>
        </div>
      </div>

      {!configured && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <code className="rounded bg-amber-100 px-1">SLACK_BOT_TOKEN</code>이 설정되지 않았습니다. .env.local에 Bot User OAuth Token을 추가한 뒤 동기화하세요.
        </div>
      )}

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      <div className="flex items-center gap-2">
        <input
          type="search"
          placeholder="이름·이메일 검색"
          className="h-9 w-full max-w-sm rounded-lg border border-gray-200 px-3 text-sm"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="text-xs text-gray-400">{filtered.length}명</span>
      </div>

      <div className="overflow-auto rounded-xl border border-gray-200 bg-white">
        <table className="w-full min-w-[720px] border-collapse text-left text-sm">
          <thead>
            <tr className="bg-gray-50 text-xs font-semibold text-gray-500">
              <th className="px-3 py-2">표시 이름</th>
              <th className="px-3 py-2">실명</th>
              <th className="px-3 py-2">이메일</th>
              <th className="px-3 py-2">Slack ID</th>
              <th className="px-3 py-2">상태</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((u) => (
              <tr key={u.slackUserId} className="border-t border-gray-100">
                <td className="px-3 py-2 font-medium">{u.displayName || "—"}</td>
                <td className="px-3 py-2">{u.realName || "—"}</td>
                <td className="px-3 py-2 font-mono text-[12px]">{u.email || "—"}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-gray-400">{u.slackUserId}</td>
                <td className="px-3 py-2 text-xs text-gray-500">
                  {u.deleted ? "삭제" : u.isBot ? "봇" : u.email ? "활성" : "이메일 없음"}
                </td>
              </tr>
            ))}
            {!loading && filtered.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-10 text-center text-gray-400">
                  데이터가 없습니다. Slack에서 동기화해 주세요.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
