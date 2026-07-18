import type { DamageVerdict } from "@/lib/types";

const STYLE: Record<DamageVerdict, string> = {
  파손됨: "bg-gap/10 text-gap ring-gap/30",
  정상: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  불확실: "bg-amber-50 text-amber-700 ring-amber-200",
};

export default function VerdictBadge({ verdict, confidence }: { verdict: DamageVerdict; confidence: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-bold ring-1 ring-inset ${STYLE[verdict]}`}>
        {verdict}
      </span>
      <span className="text-sm text-gray-500">신뢰도 {Math.round(confidence * 100)}%</span>
    </div>
  );
}
