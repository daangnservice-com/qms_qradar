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

    <div className="rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-muted)]/60 p-3.5">

      <div className="flex items-baseline justify-between">

        <label htmlFor="threshold" className="text-[13px] font-semibold text-[var(--fg-primary)]">

          공백 감지 기준

        </label>

        <span className="text-[13px] text-[var(--fg-secondary)]">

          <b className="text-[var(--brand)]">{value}초</b> 이상

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

        className="mt-3 h-1.5 w-full cursor-pointer appearance-none rounded-full disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"

        style={{

          background: `linear-gradient(to right, var(--brand) ${pct}%, var(--bg-sunken) ${pct}%)`,

        }}

      />

      <p className="mt-2 text-[11px] leading-relaxed text-[var(--fg-tertiary)]">

        이 길이 이상 조용한 구간만 공백(검색 대기)으로 셉니다. 자연스러운 대화 텀은 제외돼요.

      </p>

    </div>

  );

}


