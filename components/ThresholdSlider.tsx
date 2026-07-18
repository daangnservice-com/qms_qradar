"use client";
export default function ThresholdSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="text-sm">공백 최소 길이: <b>{value}초</b> 이상</span>
      <input type="range" min={1} max={10} step={1} value={value}
        onChange={(e) => onChange(Number(e.target.value))} className="w-full" />
    </label>
  );
}
