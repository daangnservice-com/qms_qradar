import { ClipboardCheck, AlertTriangle, Check } from "lucide-react";
import { formatClock } from "@/lib/format";
import { CS_CHECKLIST } from "@/lib/csChecklist";
import type { ChecklistResult } from "@/lib/types";

// CS 영역 감점 체크리스트 결과. id로 기준표 라벨/대분류를 join(라벨은 정적).
export default function ChecklistView({ items }: { items?: ChecklistResult[] }) {
  if (!items || items.length === 0) return null;

  const byId = new Map(items.map((r) => [r.id, r]));
  // 기준표 순서(CS_CHECKLIST) 기준으로 정렬, 위반이 위로.
  const rows = CS_CHECKLIST.map((c) => ({ crit: c, res: byId.get(c.id) })).filter((r) => r.res);
  const violated = rows.filter((r) => r.res!.violated);
  const passed = rows.filter((r) => !r.res!.violated);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2">
        <ClipboardCheck className="h-4 w-4 text-navy" />
        <h3 className="text-sm font-semibold text-gray-700">CS 영역 체크리스트</h3>
        <span
          className={`ml-1 rounded-full px-2 py-0.5 text-xs font-medium ${
            violated.length ? "bg-brand/10 text-brand" : "bg-emerald-50 text-emerald-600"
          }`}
        >
          위반 {violated.length} / {rows.length}
        </span>
      </div>

      {violated.length > 0 && (
        <ul className="mt-4 space-y-3">
          {violated.map(({ crit, res }) => (
            <li key={crit.id} className="rounded-xl border border-brand/20 bg-brand/5 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800">
                    <span className="text-gray-400">[{crit.category}]</span> {crit.label}
                  </p>
                  {res!.reason && <p className="mt-0.5 text-xs text-gray-500">{res!.reason}</p>}
                  {res!.evidence.length > 0 && (
                    <ul className="mt-1.5 space-y-0.5">
                      {res!.evidence.map((e, i) => (
                        <li key={i} className="text-xs text-gray-600">
                          <span className="font-mono text-navy">{formatClock(e.atSec)}</span> “{e.quote}”
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {passed.length > 0 && (
        <div className="mt-3">
          <p className="mb-2 text-xs font-medium text-gray-400">이상 없음 {passed.length}개</p>
          <ul className="space-y-1">
            {passed.map(({ crit }) => (
              <li key={crit.id} className="flex items-center gap-1.5 text-xs text-gray-400">
                <Check className="h-3 w-3 shrink-0 text-emerald-400" />
                <span className="text-gray-400">[{crit.category}]</span> {crit.label}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
