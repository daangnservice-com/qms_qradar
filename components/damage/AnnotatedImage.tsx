"use client";

import type { BoundingBox } from "@/lib/types";

// 0~1000 정규화 좌표 → CSS % (렌더 크기에 자동 대응)
export function boxToStyle(box: BoundingBox): {
  left: string;
  top: string;
  width: string;
  height: string;
} {
  return {
    left: `${box.xmin / 10}%`,
    top: `${box.ymin / 10}%`,
    width: `${(box.xmax - box.xmin) / 10}%`,
    height: `${(box.ymax - box.ymin) / 10}%`,
  };
}

export type Overlay = { number: number; box: BoundingBox };

export default function AnnotatedImage({
  url,
  alt,
  overlays,
  hovered,
  onHover,
}: {
  url: string;
  alt: string;
  overlays: Overlay[];
  hovered: number | null;
  onHover: (n: number | null) => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={alt} className="block w-full" />
      {overlays.map(({ number, box }) => {
        const active = hovered === number;
        return (
          <div
            key={number}
            onMouseEnter={() => onHover(number)}
            onMouseLeave={() => onHover(null)}
            className={`absolute cursor-pointer rounded-[3px] transition ${
              active ? "border-[3px] bg-gap/20" : "border-2 bg-transparent"
            }`}
            style={{ ...boxToStyle(box), borderColor: "var(--color-gap)" }}
          >
            <span className="absolute -left-0.5 -top-6 rounded bg-gap px-1.5 py-0.5 text-xs font-bold text-white shadow">
              {number}
            </span>
          </div>
        );
      })}
    </div>
  );
}
