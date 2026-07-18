import type { ScoreDetail } from "@/lib/types";

export default function ScoreCard({
  title,
  detail,
}: {
  title: string;
  detail: ScoreDetail;
}) {
  const score = Math.max(0, Math.min(5, detail.score));
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
        <span className="text-2xl font-bold leading-none text-navy">
          {detail.score}
          <span className="text-sm font-medium text-gray-300">/5</span>
        </span>
      </div>

      <div className="mt-3 flex gap-1" aria-hidden>
        {[1, 2, 3, 4, 5].map((i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full ${
              i <= score ? "bg-navy" : "bg-gray-200"
            }`}
          />
        ))}
      </div>

      <p className="mt-3 text-sm leading-relaxed text-gray-600">
        {detail.comment || <span className="text-gray-400">코멘트 없음</span>}
      </p>
    </div>
  );
}
