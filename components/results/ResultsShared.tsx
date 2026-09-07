"use client";

import { useMemo, useState } from "react";
import { Text } from "@seed-design/react";
import {
  flattenJsonEntries,
  isHttpUrl,
  splitTextUrls,
  tryParseJson,
} from "@/lib/resultsCaseContent";

export function ResultsStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="qms-card px-4 py-3">
      <Text textStyle="t2Bold" color="fg.neutralSubtle">
        {label}
      </Text>
      <div className="mt-1">
        <Text as="span" textStyle="t8Bold" color="fg.neutral">
          {value}
        </Text>
      </div>
    </div>
  );
}

function SafeLink({ href, label }: { href: string; label?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="break-all text-[var(--brand)] underline-offset-2 hover:underline"
    >
      {label ?? href}
    </a>
  );
}

export function CaseContentBlock({ title, raw }: { title: string; raw: string }) {
  const parsed = tryParseJson(raw);
  const entries = parsed != null ? flattenJsonEntries(parsed) : null;

  return (
    <div className="rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-subtle)] p-3">
      <div className="mb-2 text-[11px] font-bold text-[var(--fg-tertiary)]">{title}</div>
      {!raw.trim() ? (
        <p className="text-[12px] text-[var(--fg-tertiary)]">(내용 없음)</p>
      ) : entries ? (
        <dl className="space-y-1.5">
          {entries.map((e) => (
            <div key={e.key} className="grid grid-cols-[minmax(100px,160px)_1fr] gap-2 text-[12px]">
              <dt className="font-medium text-[var(--fg-secondary)]">{e.key}</dt>
              <dd className="min-w-0 break-words text-[var(--fg-primary)]">
                {isHttpUrl(e.value) ? (
                  <SafeLink href={e.value.trim()} />
                ) : (
                  splitTextUrls(e.value).map((p, i) =>
                    p.type === "url" ? <SafeLink key={i} href={p.value} /> : <span key={i}>{p.value}</span>,
                  )
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : isHttpUrl(raw) ? (
        <SafeLink href={raw.trim()} />
      ) : (
        <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-[var(--fg-primary)]">
          {splitTextUrls(raw).map((p, i) =>
            p.type === "url" ? <SafeLink key={i} href={p.value} /> : <span key={i}>{p.value}</span>,
          )}
        </p>
      )}
    </div>
  );
}

export function RawToggle({ title, raw }: { title: string; raw: string }) {
  const [open, setOpen] = useState(false);
  const pretty = useMemo(() => {
    if (!raw.trim()) return "";
    const p = tryParseJson(raw);
    return p != null ? JSON.stringify(p, null, 2) : raw;
  }, [raw]);
  if (!raw.trim()) return null;
  return (
    <div className="rounded-[10px] border border-[var(--border-subtle)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2 text-left text-[11px] font-semibold text-[var(--fg-secondary)] hover:bg-[var(--bg-muted)]"
      >
        <span>{title}</span>
        <span className="text-[var(--fg-tertiary)]">{open ? "접기" : "원본"}</span>
      </button>
      {open && (
        <pre className="max-h-64 overflow-auto border-t border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3 text-[11px] leading-snug text-[var(--fg-secondary)]">
          {pretty}
        </pre>
      )}
    </div>
  );
}

export function pct(rate: number) {
  return `${(rate * 100).toFixed(1)}%`;
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel,
  allowEmpty = true,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
  allLabel: string;
  allowEmpty?: boolean;
}) {
  return (
    <label className="flex min-w-[140px] flex-col gap-1">
      <Text textStyle="t2Bold" color="fg.neutralSubtle">
        {label}
      </Text>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="qms-select h-9 px-2.5 text-[13px] font-medium"
      >
        {allowEmpty ? <option value="">{allLabel}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}
