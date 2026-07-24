import { FileText, TriangleAlert } from "lucide-react";

export default function ReportView({
  summary,
  error,
}: {
  summary: string;
  error: string | null;
}) {
  if (error) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
        <div className="text-sm">
          <p className="font-semibold text-amber-900">AI 분석을 불러오지 못했어요</p>
          <p className="mt-1 text-amber-700">{error}</p>
          <p className="mt-1 text-amber-600">아래 공백 측정 결과는 정상적으로 표시됩니다.</p>
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-700">
        <FileText className="h-4 w-4 text-navy" />
        총평
      </h3>
      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-gray-700">
        {summary || <span className="text-gray-400">총평 없음</span>}
      </p>
    </div>
  );
}
