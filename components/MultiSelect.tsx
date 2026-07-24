"use client";

import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, X } from "lucide-react";

// 실제 고유값 목록에서 여러 개를 고르는 드롭다운(검색 지원). 정확 일치 필터에 사용.
export default function MultiSelect({
  options,
  selected,
  onChange,
  placeholder = "선택",
  disabled,
}: {
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const filtered = options.filter((o) => o.toLowerCase().includes(q.toLowerCase()));
  const toggle = (v: string) => onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs transition hover:border-gray-300 disabled:opacity-50"
      >
        <span className={selected.length ? "text-gray-800" : "text-gray-400"}>
          {selected.length ? `${selected.length}개 선택됨` : placeholder}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-gray-400" />
      </button>

      {open && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          <div className="sticky top-0 border-b border-gray-100 bg-white p-1.5">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="검색"
              className="w-full rounded border border-gray-200 px-2 py-1 text-xs focus-visible:outline-2 focus-visible:outline-navy"
            />
          </div>
          {filtered.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-400">값이 없어요</p>
          ) : (
            filtered.map((o) => {
              const on = selected.includes(o);
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => toggle(o)}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition hover:bg-gray-50"
                >
                  <span
                    className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                      on ? "border-navy bg-navy text-white" : "border-gray-300"
                    }`}
                  >
                    {on && <Check className="h-2.5 w-2.5" />}
                  </span>
                  <span className="truncate">{o}</span>
                </button>
              );
            })
          )}
        </div>
      )}

      {selected.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {selected.map((s) => (
            <span key={s} className="inline-flex items-center gap-0.5 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-600">
              <span className="max-w-[120px] truncate">{s}</span>
              <button type="button" onClick={() => toggle(s)} aria-label={`${s} 제거`}>
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
