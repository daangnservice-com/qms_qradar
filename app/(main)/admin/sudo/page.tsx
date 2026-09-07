"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { Eye, EyeOff } from "lucide-react";
import { isAdmin } from "@/lib/adminEmails";
import type { SlackUserRow } from "@/lib/slackUsers";

type SudoState = {
  sudoActive: boolean;
  effectiveEmail: string;
  realEmail: string;
  sudoTarget: string | null;
};

export default function SudoAdminPage() {
  const { data: session } = useSession();
  const admin = isAdmin(session?.user?.email);
  const [state, setState] = useState<SudoState | null>(null);
  const [slackUsers, setSlackUsers] = useState<SlackUserRow[]>([]);
  const [pick, setPick] = useState("");
  const [custom, setCustom] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [sudoRes, slackRes] = await Promise.all([
        fetch("/api/admin/sudo"),
        fetch("/api/admin/slack-users"),
      ]);
      const sudoJson = await sudoRes.json();
      const slackJson = await slackRes.json();
      if (!sudoRes.ok) throw new Error(sudoJson.error || "sudo 상태 조회 실패");
      setState(sudoJson);
      if (slackRes.ok) {
        setSlackUsers((slackJson.users ?? []).filter((u: SlackUserRow) => u.email && !u.deleted && !u.isBot));
      }
      if (sudoJson.sudoTarget) setPick(sudoJson.sudoTarget);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (admin) void load();
  }, [admin, load]);

  const options = useMemo(() => {
    const emails = new Map<string, string>();
    for (const u of slackUsers) {
      if (u.email) emails.set(u.email, u.displayName || u.realName || u.email);
    }
    return [...emails.entries()].sort((a, b) => a[1].localeCompare(b[1], "ko"));
  }, [slackUsers]);

  const apply = async (email: string | null) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/sudo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "sudo 설정 실패");
      setState((s) =>
        s
          ? {
              ...s,
              sudoActive: json.sudoActive,
              effectiveEmail: json.effectiveEmail,
              sudoTarget: json.sudoActive ? json.effectiveEmail : null,
            }
          : null,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!admin) {
    return <div className="p-8 text-center text-sm text-gray-500">관리자만 접근할 수 있습니다.</div>;
  }

  return (
    <div className="mx-auto max-w-[720px] space-y-4 p-6">
      <div>
        <div className="flex items-center gap-2">
          <Eye className="h-6 w-6 text-navy" />
          <h1 className="text-2xl font-bold text-gray-900">sudo (화면 미리보기)</h1>
        </div>
        <p className="mt-1 text-sm text-gray-500">
          다른 평가자 이메일로 평가 스케줄 등 화면을 미리 봅니다. 본인 세션은 유지됩니다.
        </p>
      </div>

      {state?.sudoActive && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          현재 <strong>{state.effectiveEmail}</strong> 로 보는 중 (관리자: {state.realEmail})
        </div>
      )}

      {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>}

      <div className="space-y-3 rounded-xl border border-gray-200 bg-white p-4">
        <label className="block text-xs font-semibold text-gray-500">Slack 유저에서 선택</label>
        <select
          className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm"
          value={pick}
          disabled={loading || busy}
          onChange={(e) => setPick(e.target.value)}
        >
          <option value="">— 선택 —</option>
          {options.map(([email, label]) => (
            <option key={email} value={email}>
              {label} ({email})
            </option>
          ))}
        </select>

        <label className="block text-xs font-semibold text-gray-500">또는 이메일 직접 입력</label>
        <input
          type="email"
          className="h-10 w-full rounded-lg border border-gray-200 px-3 text-sm"
          placeholder="evaluator@daangnservice.com"
          value={custom}
          disabled={busy}
          onChange={(e) => setCustom(e.target.value)}
        />

        <div className="flex flex-wrap gap-2 pt-2">
          <button
            type="button"
            className="rounded-lg bg-navy px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            disabled={busy || (!pick && !custom.trim())}
            onClick={() => void apply(pick || custom.trim())}
          >
            sudo 시작
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-4 py-2 text-sm disabled:opacity-50"
            disabled={busy || !state?.sudoActive}
            onClick={() => void apply(null)}
          >
            <EyeOff className="h-4 w-4" /> sudo 해제
          </button>
          <a href="/eval-ops/schedule" className="ml-auto self-center text-sm text-navy underline">
            평가 스케줄 열기 →
          </a>
        </div>
      </div>
    </div>
  );
}
