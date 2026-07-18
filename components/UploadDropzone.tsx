"use client";

import { useRef, useState } from "react";
import { UploadCloud, FileAudio, X } from "lucide-react";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isM4a(file: File): boolean {
  return file.name.toLowerCase().endsWith(".m4a");
}

export default function UploadDropzone({
  file,
  onFile,
  disabled,
}: {
  file: File | null;
  onFile: (file: File | null) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);

  function accept(f: File | undefined) {
    if (!f) return;
    if (!isM4a(f)) {
      setRejected(`${f.name} — .m4a 형식만 올릴 수 있어요`);
      return;
    }
    setRejected(null);
    onFile(f);
  }

  function openPicker() {
    if (!disabled) inputRef.current?.click();
  }

  // 파일이 선택된 상태 — 파일 카드
  if (file) {
    return (
      <div className="flex items-center gap-4 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-navy/10 text-navy">
          <FileAudio className="h-6 w-6" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-gray-900">{file.name}</p>
          <p className="mt-0.5 text-xs text-gray-500">{formatBytes(file.size)} · m4a</p>
        </div>
        <button
          type="button"
          onClick={openPicker}
          disabled={disabled}
          className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
        >
          변경
        </button>
        <button
          type="button"
          onClick={() => onFile(null)}
          disabled={disabled}
          aria-label="파일 제거"
          className="rounded-lg p-1.5 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 disabled:opacity-50"
        >
          <X className="h-4 w-4" />
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".m4a,audio/mp4,audio/x-m4a"
          className="sr-only"
          onChange={(e) => accept(e.target.files?.[0])}
        />
      </div>
    );
  }

  // 비어있는 상태 — 드롭존
  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="파일을 드래그하거나 클릭해서 업로드"
        onClick={openPicker}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openPicker();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled) accept(e.dataTransfer.files?.[0]);
        }}
        className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-16 text-center transition ${
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
        } ${
          dragging
            ? "border-navy bg-navy/[0.04]"
            : "border-gray-300 bg-surface/60 hover:border-navy/50 hover:bg-surface"
        } focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy`}
      >
        <div
          className={`mb-5 flex h-14 w-14 items-center justify-center rounded-full transition ${
            dragging ? "bg-navy text-white" : "bg-white text-navy shadow-sm ring-1 ring-gray-200"
          }`}
        >
          <UploadCloud className="h-7 w-7" strokeWidth={1.8} />
        </div>
        <p className="text-[15px] font-semibold text-gray-800">
          파일을 드래그하거나 클릭해서 업로드
        </p>
        <p className="mt-1.5 text-[13px] text-gray-400">통화 녹음 .m4a 형식 지원</p>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            openPicker();
          }}
          disabled={disabled}
          className="mt-6 inline-flex items-center gap-2 rounded-xl bg-navy px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-navy-hover disabled:opacity-50"
        >
          <UploadCloud className="h-4 w-4" />
          파일 선택
        </button>
      </div>

      {rejected && (
        <p className="mt-3 text-sm text-gap">{rejected}</p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".m4a,audio/mp4,audio/x-m4a"
        className="sr-only"
        onChange={(e) => accept(e.target.files?.[0])}
      />
    </div>
  );
}
