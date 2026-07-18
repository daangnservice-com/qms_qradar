export default function ReportView({ summary, error }: { summary: string; error: string | null }) {
  if (error) return <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm">AI 평가 실패: {error} (공백 측정 결과는 아래 유지)</div>;
  return <div className="rounded-lg border p-4"><h3 className="font-semibold">총평</h3><p className="mt-2 whitespace-pre-wrap text-sm text-gray-700">{summary}</p></div>;
}
