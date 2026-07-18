import { formatClock } from "@/lib/format";
import type { Silence, SilenceSummary } from "@/lib/types";

export default function SilenceTimeline({
  durationSec, silences, summary, comments,
}: {
  durationSec: number;
  silences: Silence[];
  summary: SilenceSummary;
  comments: { atSec: number; note: string }[];
}) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">공백 타임라인</h3>
        <span className="text-sm text-gray-500">
          {summary.count}회 · 총 {summary.totalSec.toFixed(1)}초 · 최장 {summary.longestSec.toFixed(1)}초 · {(summary.silenceRatio * 100).toFixed(1)}%
        </span>
      </div>
      <div className="relative mt-3 h-3 w-full rounded bg-gray-100">
        {silences.map((s, i) => (
          <div key={i} className="absolute h-3 rounded bg-red-400"
            style={{ left: `${(s.startSec / durationSec) * 100}%`, width: `${((s.endSec - s.startSec) / durationSec) * 100}%` }}
            title={`${formatClock(s.startSec)}~${formatClock(s.endSec)} (${s.durationSec.toFixed(1)}초)`} />
        ))}
      </div>
      <ul className="mt-3 space-y-1 text-sm">
        {silences.map((s, i) => {
          const c = comments.find((c) => Math.abs(c.atSec - s.startSec) < 0.5);
          return (
            <li key={i} className="flex gap-2">
              <span className="font-mono">{formatClock(s.startSec)}~{formatClock(s.endSec)} ({s.durationSec.toFixed(1)}초)</span>
              {c && <span className="text-gray-500">— {c.note}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
