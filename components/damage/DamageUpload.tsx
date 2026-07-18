"use client";

import { useRef, useState } from "react";
import { ImagePlus, X } from "lucide-react";

const ACCEPT = ".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp";

function isAllowed(f: File): boolean {
  return /\.(jpe?g|png|webp)$/i.test(f.name);
}

export default function DamageUpload({
  files,
  onFiles,
  disabled,
  max = 8,
}: {
  files: File[];
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  max?: number;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function add(incoming: FileList | null) {
    if (!incoming) return;
    const picked = Array.from(incoming);
    const ok = picked.filter(isAllowed);
    if (ok.length < picked.length) setMsg("jpg/png/webp만 추가돼요.");
    else setMsg(null);
    const merged = [...files, ...ok].slice(0, max);
    onFiles(merged);
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inputRef.current?.click();
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
          if (!disabled) add(e.dataTransfer.files);
        }}
        className={`flex flex-col items-center justify-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition ${
          disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
        } ${dragging ? "border-navy bg-navy/[0.04]" : "border-gray-300 bg-surface/60 hover:border-navy/50 hover:bg-surface"} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-navy`}
      >
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-white text-navy shadow-sm ring-1 ring-gray-200">
          <ImagePlus className="h-6 w-6" strokeWidth={1.8} />
        </div>
        <p className="text-[15px] font-semibold text-gray-800">상품 사진을 드래그하거나 클릭해서 추가</p>
        <p className="mt-1.5 text-[13px] text-gray-400">jpg · png · webp / 최대 {max}장 (여러 각도 권장)</p>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
          disabled={disabled}
          className="mt-5 inline-flex items-center gap-2 rounded-xl bg-navy px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-navy-hover disabled:opacity-50"
        >
          <ImagePlus className="h-4 w-4" />
          사진 선택
        </button>
      </div>

      {msg && <p className="mt-3 text-sm text-gap">{msg}</p>}

      {files.length > 0 && (
        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
          {files.map((f, i) => (
            <div key={i} className="group relative aspect-square overflow-hidden rounded-xl border border-gray-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={URL.createObjectURL(f)} alt={`업로드 ${i + 1}`} className="h-full w-full object-cover" />
              <button
                type="button"
                onClick={() => onFiles(files.filter((_, j) => j !== i))}
                disabled={disabled}
                aria-label="사진 제거"
                className="absolute right-1 top-1 rounded-full bg-black/50 p-1 text-white opacity-0 transition group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="sr-only"
        onChange={(e) => add(e.target.files)}
      />
    </div>
  );
}
