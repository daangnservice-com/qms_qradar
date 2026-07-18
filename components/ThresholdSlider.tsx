"use client";

export default function ThresholdSlider({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  const pct = ((value - 1) / (10 - 1)) * 100;
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-baseline justify-between">
        <label htmlFor="threshold" className="text-sm font-semibold text-gray-800">
          공백 감지 기준
        </label>
        <span className="text-sm text-gray-500">
          <b className="text-navy">{value}초</b> 이상
        </span>
      </div>
      <input
        id="threshold"
        type="range"
        min={1}
        max={10}
        step={1}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-3 h-1.5 w-full cursor-pointer appearance-none rounded-full disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy"
        style={{
          background: `linear-gradient(to right, var(--color-navy) ${pct}%, #e5e7eb ${pct}%)`,
        }}
      />
      <p className="mt-2 text-xs text-gray-400">
        이 길이 이상 조용한 구간만 공백(검색 대기)으로 셉니다. 자연스러운 대화 텀은 제외돼요.
      </p>
    </div>
  );
}
