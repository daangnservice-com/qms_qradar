import { AudioLines } from "lucide-react";
import { formatClock } from "@/lib/format";
import type { Silence, SilenceSummary } from "@/lib/types";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface px-4 py-3">
      <div className="text-lg font-bold text-navy">{value}</div>
      <div className="mt-0.5 text-xs text-gray-500">{label}</div>
    </div>
  );
}

export default function SilenceTimeline({
  durationSec,
  silences,
  summary,
  comments,
}: {
  durationSec: number;
  silences: Silence[];
  summary: SilenceSummary;
  comments: { atSec: number; note: string }[];
}) {
  const span = durationSec > 0 ? durationSec : 1;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
          <AudioLines className="h-4 w-4 text-navy" />
          공백 타임라인
        </h3>
        <span className="text-xs text-gray-400">총 길이 {formatClock(durationSec)}</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="공백 횟수" value={`${summary.count}회`} />
        <Stat label="총 공백" value={`${summary.totalSec.toFixed(1)}초`} />
        <Stat label="최장 공백" value={`${summary.longestSec.toFixed(1)}초`} />
        <Stat label="공백 비율" value={`${(summary.silenceRatio * 100).toFixed(1)}%`} />
      </div>

      {/* 타임라인 트랙 */}
      <div className="relative mt-5 h-3 w-full overflow-hidden rounded-full bg-surface ring-1 ring-inset ring-gray-200">
        {silences.map((s, i) => (
          <div
            key={i}
            className="absolute top-0 h-3 bg-gap"
            style={{
              left: `${(s.startSec / span) * 100}%`,
              width: `${Math.max(0.4, ((s.endSec - s.startSec) / span) * 100)}%`,
            }}
            title={`${formatClock(s.startSec)}~${formatClock(s.endSec)} (${s.durationSec.toFixed(1)}초)`}
          />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-[11px] text-gray-400">
        <span>00:00</span>
        <span>{formatClock(durationSec)}</span>
      </div>

      {/* 목록 */}
      {silences.length === 0 ? (
        <p className="mt-5 rounded-xl bg-surface px-4 py-6 text-center text-sm text-gray-400">
          기준({summary.count === 0 ? "설정값" : ""}) 이상 길이의 공백이 감지되지 않았어요.
        </p>
      ) : (
        <ul className="mt-5 divide-y divide-gray-100">
          {silences.map((s, i) => {
            const c = comments.find((c) => Math.abs(c.atSec - s.startSec) < 1.5);
            return (
              <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
                <span className="inline-flex items-center rounded-md bg-gap/10 px-2 py-0.5 font-mono text-xs font-medium text-gap">
                  {formatClock(s.startSec)}~{formatClock(s.endSec)} ({s.durationSec.toFixed(1)}초)
                </span>
                {c && <span className="text-sm text-gray-600">{c.note}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
