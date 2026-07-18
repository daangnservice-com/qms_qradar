import type { ScoreDetail } from "@/lib/types";
export default function ScoreCard({ title, detail }: { title: string; detail: ScoreDetail }) {
  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-baseline justify-between">
        <h3 className="font-semibold">{title}</h3>
        <span className="text-2xl font-bold">{detail.score}<span className="text-sm text-gray-400">/5</span></span>
      </div>
      <p className="mt-2 text-sm text-gray-600">{detail.comment}</p>
    </div>
  );
}
