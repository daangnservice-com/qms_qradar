"use client";

import { CircleAlert } from "lucide-react";

/** 평가 진행 헤더용 호버 도움말 (AI 1차·검토필요·수기·Hold) */
export default function CallQualityEvalHelpTip() {
  return (
    <span className="group relative ml-1.5 inline-flex align-middle">
      <button
        type="button"
        aria-label="평가·검수 용어 도움말"
        className="inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full text-[var(--fg-tertiary)] hover:bg-[var(--bg-muted)] hover:text-[var(--fg-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand)]"
      >
        <CircleAlert className="h-3.5 w-3.5" strokeWidth={2.25} aria-hidden />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-40 mt-2 hidden w-[min(22rem,calc(100vw-2rem))] rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] p-3.5 text-left shadow-lg ring-1 ring-black/5 group-hover:block group-focus-within:block"
      >
        <p className="text-[12px] font-bold text-[var(--fg-primary)]">이 화면은 이렇게 진행돼요</p>
        <p className="mt-1 text-[11.5px] leading-snug text-[var(--fg-secondary)]">
          통화 하나를 고르면{" "}
          <span className="font-semibold text-[var(--fg-primary)]">
            ① AI 1차 평가 → ② 수기 검수 → ③ 수기 검수 완료
          </span>{" "}
          순서로 봐요.
        </p>

        <div className="mt-3 space-y-2.5 text-[11.5px] leading-snug text-[var(--fg-secondary)]">
          <div>
            <p className="font-bold text-[var(--fg-primary)]">AI 1차 평가</p>
            <p className="mt-0.5">
              녹취·STT를 AI가 평가 항목 기준으로 먼저 봅니다. 결과는{" "}
              <span className="font-semibold">「검토 필요」</span> 또는{" "}
              <span className="font-semibold">「검토 불필요」</span>예요.
            </p>
            <p className="mt-1 text-[11px] text-[var(--fg-tertiary)]">
              ※ AI 1차 평가는 “사람이 한 번 더 볼지”만 판단하고, 최종 Hot/Cold 결과는 판단하지 않아요.
            </p>
          </div>

          <div>
            <p className="font-bold text-[var(--fg-primary)]">검토 필요 / 검토 불필요</p>
            <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
              <li>
                <span className="font-semibold">검토 필요</span>: 평가 항목 위반이 있어, 사람이 다시 볼 대상
              </li>
              <li>
                <span className="font-semibold">검토 불필요</span>: 위반이 없어, 추가 검수가 없어도 되는 대상
              </li>
            </ul>
          </div>

          <div>
            <p className="font-bold text-[var(--fg-primary)]">수기 검수</p>
            <p className="mt-0.5">AI 1차 평가 후, 사람이 다시 확인·정정하는 단계예요.</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              <li>
                <span className="font-semibold">검토 불필요</span>: 문제 발생 상황이 아닌 경우 선택
              </li>
              <li>
                <span className="font-semibold">검토 필요</span>: 문제 발생 상황인 경우 선택
              </li>
            </ul>
            <p className="mt-1 text-[11px] text-[var(--fg-tertiary)]">
              * AI가 감지 못한 문제 발생 상황이 있으면 + 마크를 클릭해 직접 추가할 수 있어요.
            </p>
          </div>

          <div>
            <p className="font-bold text-[var(--fg-primary)]">최종 Hot / Cold / Hold</p>
            <p className="mt-0.5 text-[11px] text-[var(--fg-tertiary)]">(검토 필요인 경우만)</p>
            <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
              <li>
                <span className="font-semibold">Hot</span>: 문제 발생은 확인되나 상담 전체 흐름 상 감안 가능
                (적합)
              </li>
              <li>
                <span className="font-semibold">Cold</span>: 감안 불가 (부적합)
              </li>
              <li>
                <span className="font-semibold">Hold</span>: 문제 상황은 맞는데 감안 가능 여부를 아직 모르겠음
                (보류)
              </li>
            </ul>
          </div>

          <p>
            모든 항목에 대한 검수가 완료되면 우측 패널의{" "}
            <span className="font-semibold text-[var(--fg-primary)]">「수기 검수 완료」</span>로 결과를
            확정합니다.
          </p>

          <div className="rounded-md bg-[var(--bg-muted)] px-2.5 py-2 text-[11px] leading-snug">
            <p className="font-bold text-[var(--fg-primary)]">한 줄로</p>
            <p className="mt-0.5">AI = 검토할 후보를 찾는 1차 필터</p>
            <p>사람 = 검토 후보가 적합한지 확인하고, 검토 결과로 최종 Cold/Hot/Hold까지 남김</p>
          </div>
        </div>
      </span>
    </span>
  );
}
