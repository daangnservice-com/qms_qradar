"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  BookOpen,
  ClipboardCheck,
  ClipboardList,
  Cpu,
  GitCompare,
  ListChecks,
  ListTree,
  Sparkles,
  Target,
  Wand2,
  BarChart3,
  type LucideIcon,
} from "lucide-react";

type TocItem = { id: string; label: string; href?: string };

const TOC: TocItem[] = [
  { id: "overview", label: "1. 이 앱이 하는 일" },
  { id: "flow", label: "2. 권장 워크플로" },
  { id: "call-quality", label: "3. 평가 진행", href: "/call-quality" },
  { id: "review-status", label: "4. 검수 현황", href: "/eval-ops/review-status" },
  { id: "sheets", label: "5. 평가표", href: "/eval-design/sheets" },
  { id: "items", label: "6. 평가 항목", href: "/eval-design/items" },
  { id: "ai-items", label: "7. AI 평가 항목", href: "/eval-design/ai-items" },
  { id: "accuracy", label: "8. 정확도 대시보드", href: "/eval-design/accuracy" },
  { id: "compare", label: "9. AI 비교·개선", href: "/eval-design/compare" },
  { id: "prompt-improve", label: "10. 프롬프트 개선", href: "/eval-design/prompt-improve" },
  { id: "llm-usage", label: "11. AI 호출 사용량", href: "/eval-design/llm-usage" },
  { id: "usage", label: "12. 사용량", href: "/usage" },
  { id: "glossary", label: "13. 용어 정리" },
];

function Chapter({
  id,
  num,
  title,
  desc,
  children,
}: {
  id: string;
  num: string;
  title: string;
  desc?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6 border-t border-[var(--border-subtle)] pt-8 first:border-t-0 first:pt-0">
      <div className="mb-5 flex flex-wrap items-baseline gap-3 border-b border-[var(--fg-primary)]/15 pb-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[var(--brand)] text-[13px] font-bold text-white">
          {num}
        </span>
        <h2 className="text-[18px] font-extrabold tracking-tight text-[var(--fg-primary)]">{title}</h2>
        {desc ? <span className="ml-auto text-[12px] text-[var(--fg-tertiary)]">{desc}</span> : null}
      </div>
      <div className="space-y-3 text-[13.5px] leading-relaxed text-[var(--fg-secondary)]">{children}</div>
    </section>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="mt-6 flex items-center gap-2 text-[14.5px] font-bold text-[var(--fg-primary)] first:mt-0">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--brand)]" />
      {children}
    </h3>
  );
}

function Insight({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[10px] border-l-4 border-[var(--brand)] bg-[var(--brand-subtle)] px-4 py-3 text-[13px] leading-relaxed text-[var(--fg-secondary)]">
      {children}
    </div>
  );
}

function Next({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[10px] border-l-4 border-[var(--accent)] bg-[var(--accent-subtle)] px-4 py-3 text-[13px] leading-relaxed text-[var(--fg-secondary)]">
      {children}
    </div>
  );
}

function Warn({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[10px] border-l-4 border-[#E8A93A] bg-[#FFF7E8] px-4 py-3 text-[13px] leading-relaxed text-[var(--fg-secondary)]">
      {children}
    </div>
  );
}

function Flow({ steps }: { steps: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 py-1">
      {steps.map((s, i) => (
        <span key={s} className="flex items-center gap-1.5">
          {i > 0 ? <span className="text-[12px] text-[var(--fg-tertiary)]">→</span> : null}
          <span className="rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-muted)] px-3 py-1.5 text-[12px] font-semibold text-[var(--fg-secondary)]">
            {s}
          </span>
        </span>
      ))}
    </div>
  );
}

function ScreenLink({ href, icon: Icon, label }: { href: string; icon: LucideIcon; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 rounded-[8px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-2.5 py-1 text-[12px] font-semibold text-[var(--fg-secondary)] no-underline transition hover:border-[var(--brand)] hover:text-[var(--brand)]"
    >
      <Icon className="h-3.5 w-3.5" />
      {label} 열기
    </Link>
  );
}

export default function QradarGuide() {
  return (
    <div className="qms-page-body mx-auto w-full max-w-5xl pb-16">
      <header className="relative overflow-hidden rounded-[12px] border border-[var(--border-subtle)] bg-[var(--fg-secondary)] px-6 py-7 text-white sm:px-8">
        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-[var(--brand)]" />
        <div className="mb-3 flex items-center gap-2 text-[12px] font-bold tracking-wide text-white/70">
          <BookOpen className="h-4 w-4" />
          QRadar 화면 가이드
        </div>
        <h1 className="text-[24px] font-extrabold tracking-tight">화면별 기능과 의도</h1>
        <p className="mt-2 max-w-2xl text-[13.5px] leading-relaxed text-white/75">
          콜 품질 AI 평가(QRadar)에서 각 메뉴가 <strong className="font-semibold text-white">무엇을 위해</strong>{" "}
          있는지, 어떤 순서로 쓰는지를 정리한 설명서예요. 역할별 전체 QMS 매뉴얼의 톤을 따르되, 이 앱에 실제로 있는
          화면만 다룹니다.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <span className="rounded-full bg-white/12 px-3 py-1 text-[11.5px] font-bold">검토필요 / 최종 Cold·Hot</span>
          <span className="rounded-full bg-white/12 px-3 py-1 text-[11.5px] font-bold">평가 설계 ↔ 평가 진행</span>
          <span className="rounded-full bg-white/12 px-3 py-1 text-[11.5px] font-bold">Train · Test · 검수 현황</span>
        </div>
      </header>

      <div className="mt-6 grid gap-8 lg:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <div className="rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-muted)] p-3">
            <div className="mb-2 px-2 text-[11px] font-bold uppercase tracking-wider text-[var(--fg-tertiary)]">
              목차
            </div>
            <nav className="flex max-h-[70vh] flex-col gap-0.5 overflow-y-auto">
              {TOC.map((t) => (
                <a
                  key={t.id}
                  href={`#${t.id}`}
                  className="rounded-[8px] px-2.5 py-1.5 text-[12.5px] font-medium text-[var(--fg-secondary)] no-underline hover:bg-[var(--bg-canvas)] hover:text-[var(--fg-primary)]"
                >
                  {t.label}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        <div className="min-w-0 space-y-10 rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-canvas)] px-5 py-7 sm:px-8">
          <Chapter id="overview" num="1" title="이 앱이 하는 일" desc="한 줄 요약">
            <p>
              QRadar는 상담 녹취를 AI로 평가하고, <strong className="text-[var(--fg-primary)]">수기(Train)·운영 검수(Test)</strong>와
              맞춰 프롬프트·평가표를 개선하는 도구예요.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-[10px] border border-[var(--border-subtle)] p-3">
                <div className="text-[13px] font-bold text-[var(--fg-primary)]">평가 설계</div>
                <p className="mt-1 text-[12.5px]">
                  평가표·항목·프롬프트를 만들고, Train 골드로 정확도를 재고, 불일치에서 개선안을 뽑아요.
                </p>
              </div>
              <div className="rounded-[10px] border border-[var(--border-subtle)] p-3">
                <div className="text-[13px] font-bold text-[var(--fg-primary)]">평가 진행</div>
                <p className="mt-1 text-[12.5px]">
                  전체/고위험군 콜을 돌리고, STT에서 수기 검수 후 「검수 완료」로 라벨을 확정해요.
                </p>
              </div>
              <div className="rounded-[10px] border border-[var(--border-subtle)] p-3">
                <div className="text-[13px] font-bold text-[var(--fg-primary)]">평가 운영</div>
                <p className="mt-1 text-[12.5px]">
                  배분·스케줄과 함께, 검수 완료 케이스의 오탐/미탐을 <b>검수 현황</b>에서 집계해요.
                </p>
              </div>
            </div>
            <Insight>
              <b className="text-[var(--fg-primary)]">의도.</b> AI를 “한 번에 완벽한 판정기”로 두지 않고,{" "}
              <b className="text-[var(--fg-primary)]">측정 → 불일치 분석 → 프롬프트/표 개선 → 재측정</b> 루프를
              돌리기 위한 화면 구성이에요.
            </Insight>
          </Chapter>

          <Chapter id="flow" num="2" title="권장 워크플로" desc="어디서 시작할지">
            <SectionTitle>설계 루프 (Train)</SectionTitle>
            <Flow
              steps={["평가표·항목", "AI 비교·개선", "정확도 대시보드", "프롬프트 개선", "평가표 반영"]}
            />
            <SectionTitle>운영 루프 (Test)</SectionTitle>
            <Flow
              steps={["전체/고위험군 평가", "STT 수기 검수", "검수 완료", "검수 현황", "프롬프트 개선(Test)"]}
            />
            <Next>
              <b className="text-[var(--fg-primary)]">다음에.</b> 처음이면{" "}
              <a href="#sheets" className="font-semibold text-[var(--brand)]">
                평가표
              </a>
              에서 production 버전을 확인한 뒤,{" "}
              <a href="#compare" className="font-semibold text-[var(--brand)]">
                AI 비교·개선
              </a>
              으로 Train 샘플을 돌려 보세요.
            </Next>
          </Chapter>

          <Chapter id="call-quality" num="3" title="평가 진행" desc="전체 · 고위험군 · Test">
            <div className="flex flex-wrap items-center gap-2">
              <ScreenLink href="/call-quality" icon={ClipboardCheck} label="전체 평가" />
              <ScreenLink href="/call-quality/high-risk" icon={AlertTriangle} label="고위험군 평가" />
              <ScreenLink href="/call-quality/needs-review" icon={ClipboardCheck} label="수기 평가 필요" />
              <ScreenLink href="/call-quality/mine" icon={ClipboardCheck} label="내 평가" />
            </div>
            <p>
              사이드바 <strong className="text-[var(--fg-primary)]">평가 진행</strong> 그룹의 운영 워크벤치예요.{" "}
              <strong className="text-[var(--fg-primary)]">전체 평가</strong>는 일반 샘플,{" "}
              <strong className="text-[var(--fg-primary)]">고위험군 평가</strong>는 동일 UI에 고위험군 필터가 켜진
              진입점이에요. <strong className="text-[var(--fg-primary)]">내 평가</strong>는 내가 수기 주석을 남겼거나
              검수 찜한, 아직 완료되지 않은 케이스만 모아요. Genesys 녹취 → AI 평가 → STT 위 수기 검수 →{" "}
              <strong className="text-[var(--fg-primary)]">검수 완료</strong> 순으로 씁니다.
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                AI 결과는 통합 결과 테이블에서 <code className="text-[12px]">org</code> 기준 최신 1건
              </li>
              <li>
                항목 정정은 <code className="text-[12px]">eval_human_reviews</code>, 검수 완료 이벤트는{" "}
                <code className="text-[12px]">eval_review_completions</code>. 수기 검토필요·최종 Cold/Hot은 조회 시 파생
              </li>
              <li>프롬프트 개선·검수 현황에서 보낸 케이스는 딥링크 + 복귀 위젯으로 이어져요</li>
            </ul>
            <Insight>
              <b className="text-[var(--fg-primary)]">의도.</b> Train 골드로 표를 키운 뒤, 실제 운영 콜에서 AI를
              검증·보정하는 <b className="text-[var(--fg-primary)]">현장 작업대</b>예요.
            </Insight>
          </Chapter>

          <Chapter id="review-status" num="4" title="검수 현황" desc="평가 운영 · Test 집계">
            <div className="flex flex-wrap items-center gap-2">
              <ScreenLink href="/eval-ops/review-status" icon={ListChecks} label="검수 현황" />
            </div>
            <p>
              지정 기간(기본 당월) 안에 <strong className="text-[var(--fg-primary)]">수기 검수 완료</strong>된
              케이스만 모아, 정확도 대시보드와 <strong className="text-[var(--fg-primary)]">같은 UI</strong>로
              오탐/미탐·matrix·항목 top·평가셋 비중을 보여줘요.
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>미탐(FN)=수기 검토필요·AI 검토불필요 · 오탐(FP)=수기 검토불필요·AI 검토필요</li>
              <li>항목 섹션은 「주로 틀리는 항목」↔「항목별 비교」토글</li>
              <li>케이스 행을 누르면 전체 평가로 이동하고, 검수 현황으로 돌아가는 위젯이 떠요</li>
            </ul>
            <Next>
              Train 골드 정확도는{" "}
              <a href="#accuracy" className="font-semibold text-[var(--brand)]">
                정확도 대시보드
              </a>
              , 운영 검수 집계는 이 화면을 쓰세요.
            </Next>
          </Chapter>

          <Chapter id="sheets" num="5" title="평가표" desc="버전 · production">
            <div className="flex flex-wrap items-center gap-2">
              <ScreenLink href="/eval-design/sheets" icon={ClipboardList} label="평가표" />
            </div>
            <p>
              <strong className="text-[var(--fg-primary)]">평가표</strong>는 다회 쓰는 평가 기준·프롬프트 묶음이고,
              버전(draft / production)으로 관리돼요. 템플릿에서 시작하거나 빈 표로 만들고, 항목 바인딩·판정 규칙·오디오
              파이프라인을 편집한 뒤 production으로 올릴 수 있어요.
            </p>
            <Warn>
              <b className="text-[var(--fg-primary)]">주의.</b> 운영·QA 평가는 보통{" "}
              <b className="text-[var(--fg-primary)]">production 버전</b>을 스냅샷으로 씁니다. 초안만 바꿔 두고
              production을 안 올리면 현장 결과가 안 바뀌어요.
            </Warn>
            <Insight>
              <b className="text-[var(--fg-primary)]">의도.</b> “지금 돌리는 기준”을 버전으로 고정해, 개선 전후를
              공정하게 비교할 수 있게 해요.
            </Insight>
          </Chapter>

          <Chapter id="items" num="6" title="평가 항목" desc="마스터">
            <div className="flex flex-wrap items-center gap-2">
              <ScreenLink href="/eval-design/items" icon={ListTree} label="평가 항목" />
            </div>
            <p>
              CS / 직무 등 카테고리 아래 <strong className="text-[var(--fg-primary)]">평가 항목 마스터</strong>를
              조회·관리하는 화면이에요. 사이드바에서는 그 아래에{" "}
              <strong className="text-[var(--fg-primary)]">AI 평가 항목</strong>이 중첩돼 있어요.
            </p>
            <Next>
              항목 정의·예시를 AI 프롬프트 관점에서 다듬으려면{" "}
              <a href="#ai-items" className="font-semibold text-[var(--brand)]">
                AI 평가 항목
              </a>
              으로 이어가세요.
            </Next>
          </Chapter>

          <Chapter id="ai-items" num="7" title="AI 평가 항목" desc="프롬프트 단위">
            <div className="flex flex-wrap items-center gap-2">
              <ScreenLink href="/eval-design/ai-items" icon={Sparkles} label="AI 평가 항목" />
            </div>
            <p>
              AI가 실제로 읽는 <strong className="text-[var(--fg-primary)]">항목별 프롬프트</strong>(정의·검출
              패턴·Cold/Hot 예시 등)를 편집하는 화면이에요. 표 전체 프롬프트와 항목 단위 문구를 여기서 맞춥니다.
            </p>
            <Insight>
              <b className="text-[var(--fg-primary)]">의도.</b> 불일치가 특정 항목에 몰릴 때, 표 전체를 바꾸기 전에{" "}
              <b className="text-[var(--fg-primary)]">그 항목의 판정 문장</b>부터 고치기 위한 진입점이에요.
            </Insight>
          </Chapter>

          <Chapter id="accuracy" num="8" title="정확도 대시보드" desc="Gate · Train">
            <div className="flex flex-wrap items-center gap-2">
              <ScreenLink href="/eval-design/accuracy" icon={Target} label="정확도" />
            </div>
            <p>
              Train 수기 라벨 vs AI 라벨의 <strong className="text-[var(--fg-primary)]">Accuracy · Recall · Precision</strong>,
              FN/FP, 혼동행렬, 항목별 비교를 평가표 버전별로 보여줘요. 검수 현황과{" "}
              <strong className="text-[var(--fg-primary)]">같은 레이아웃</strong>이에요(데이터만 Train).
            </p>
            <div className="overflow-x-auto">
              <table className="mt-2 w-full border-collapse border border-[var(--fg-primary)]/20 text-[12.5px]">
                <thead>
                  <tr className="bg-[var(--bg-muted)]">
                    <th className="border-b border-[var(--fg-primary)]/20 px-3 py-2 text-left text-[11px] font-bold text-[var(--fg-tertiary)]">
                      용어
                    </th>
                    <th className="border-b border-[var(--fg-primary)]/20 px-3 py-2 text-left text-[11px] font-bold text-[var(--fg-tertiary)]">
                      의미
                    </th>
                  </tr>
                </thead>
                <tbody className="text-[var(--fg-secondary)]">
                  <tr>
                    <td className="border-b border-[var(--border-subtle)] px-3 py-2 font-semibold">검토필요 = positive</td>
                    <td className="border-b border-[var(--border-subtle)] px-3 py-2">
                      검토필요를 양성으로 두고 TP/FP/FN을 계산해요. 수기 최종 Cold/Hot은 따로 둡니다.
                    </td>
                  </tr>
                  <tr>
                    <td className="border-b border-[var(--border-subtle)] px-3 py-2 font-semibold">FN (미탐)</td>
                    <td className="border-b border-[var(--border-subtle)] px-3 py-2">수기 검토필요 · AI 검토불필요</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2 font-semibold">FP (오탐)</td>
                    <td className="px-3 py-2">수기 검토불필요 · AI 검토필요</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <Next>
              Gate 미달이면{" "}
              <a href="#compare" className="font-semibold text-[var(--brand)]">
                AI 비교·개선
              </a>
              에서 불일치 콜을 열어 원인을 보세요. 운영 검수는{" "}
              <a href="#review-status" className="font-semibold text-[var(--brand)]">
                검수 현황
              </a>
              .
            </Next>
          </Chapter>

          <Chapter id="compare" num="9" title="AI 비교·개선" desc="Train 골드">
            <div className="flex flex-wrap items-center gap-2">
              <ScreenLink href="/eval-design/compare" icon={GitCompare} label="AI 비교·개선" />
            </div>
            <p>
              수기 평가가 끝난 <strong className="text-[var(--fg-primary)]">Train 레퍼런스</strong> 콜에 대해 AI 평가를
              돌리고, 수기 vs AI(콜 라벨·항목)를 비교해요. 미평가·불일치만 골라 재평가할 수 있고, 일치 등급(전문항 /
              부분 / 결과만 / 불일치)으로 필터해요.
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>결과는 통합 테이블에 <code className="text-[12px]">purpose=qa_eval</code>로 쌓여요</li>
              <li>평가표 드롭다운으로 <em>어떤 버전으로 돌릴지</em>를 고를 수 있어요</li>
              <li>케이스 상세에서 평가 진행으로 이어갈 수 있어요</li>
            </ul>
            <Insight>
              <b className="text-[var(--fg-primary)]">의도.</b> 정확도 숫자의{" "}
              <b className="text-[var(--fg-primary)]">원재료(콜·항목 불일치)</b>를 모으는 화면이에요. 표를 고치기 전에
              “무슨 말을 놓쳤는지”를 여기서 확인합니다.
            </Insight>
          </Chapter>

          <Chapter id="prompt-improve" num="10" title="프롬프트 개선" desc="불일치 → 초안">
            <div className="flex flex-wrap items-center gap-2">
              <ScreenLink href="/eval-design/prompt-improve" icon={Wand2} label="프롬프트 개선" />
            </div>
            <p>
              Train(QA 불일치) 또는 Test(평가 진행 수기 검수)에서 모은 사례를 바탕으로, 선택한 기준 평가표 프롬프트의{" "}
              <strong className="text-[var(--fg-primary)]">개선 초안</strong>을 생성·비교·저장해요. Before/After를
              나란히 보고, 세션에 담아 평가 진행 쪽에서 이어 볼 수 있어요.
            </p>
            <Flow steps={["불일치 수집", "기준 버전 선택", "개선안 생성", "저장(improved_verN)", "표에 반영"]} />
            <Warn>
              생성 결과는 초안이에요. production 반영 전에 평가표 화면에서 문장·항목을 검토하세요.
            </Warn>
          </Chapter>

          <Chapter id="llm-usage" num="11" title="AI 호출 사용량" desc="비용 · 목적">
            <div className="flex flex-wrap items-center gap-2">
              <ScreenLink href="/eval-design/llm-usage" icon={Cpu} label="AI 호출 사용량" />
            </div>
            <p>
              Gemini 등 LLM 호출 로그를 기간·목적(<code className="text-[12px]">call_eval</code> /{" "}
              <code className="text-[12px]">qa_eval</code> / <code className="text-[12px]">prompt_improve</code> 등)·모델별로
              집계해요. 개선 루프가 호출 비용을 얼마나 쓰는지 볼 때 씁니다.
            </p>
          </Chapter>

          <Chapter id="usage" num="12" title="사용량" desc="시스템 · 관리자">
            <div className="flex flex-wrap items-center gap-2">
              <ScreenLink href="/usage" icon={BarChart3} label="사용량" />
            </div>
            <p>
              관리자용 앱 사용량(이벤트) 화면이에요. AI 호출 전용 대시보드와 달리, 제품 전반의 이용 로그를 봅니다.
            </p>
          </Chapter>

          <Chapter id="glossary" num="13" title="용어 정리" desc="자주 나오는 말">
            <dl className="space-y-3">
              <div>
                <dt className="text-[13px] font-bold text-[var(--fg-primary)]">케이스</dt>
                <dd className="text-[12.5px] text-[var(--fg-secondary)]">1개의 컨버세이션(통화).</dd>
              </div>
              <div>
                <dt className="text-[13px] font-bold text-[var(--fg-primary)]">평가 항목 / 항목 판정 / 위반</dt>
                <dd className="text-[12.5px] text-[var(--fg-secondary)]">
                  평가 항목은 기준표의 정의(예: 인사 누락). 항목 판정은 그 항목이 이 케이스에서 위반인지를 담은
                  체크리스트 JSON 한 줄. 위반은 <code className="text-[12px]">violated=true</code>인 항목 판정이며,
                  9월부터는 최종 Cold가 아니라 <strong>검토 필요</strong>로 읽습니다.
                  고위험군 플래그(장콜 등 선별 규칙)와는 다릅니다.
                </dd>
              </div>
              <div>
                <dt className="text-[13px] font-bold text-[var(--fg-primary)]">AI 평가 / 수기 검수</dt>
                <dd className="text-[12.5px] text-[var(--fg-secondary)]">
                  AI 평가는 STT·오디오·프롬프트를 LLM에 보내는 것. 수기 검수는 AI 완료 후 사람이 다시 평가하는 것.
                </dd>
              </div>
              <div>
                <dt className="text-[13px] font-bold text-[var(--fg-primary)]">미탐 (FN) / 오탐 (FP)</dt>
                <dd className="text-[12.5px] text-[var(--fg-secondary)]">
                  미탐=수기 검토필요·AI 검토불필요(미검출). 오탐=수기 검토불필요·AI 검토필요(과검출). 검토필요=positive.
                </dd>
              </div>
              <div>
                <dt className="text-[13px] font-bold text-[var(--fg-primary)]">검토 필요 / 최종 Hot·Cold</dt>
                <dd className="text-[12.5px] text-[var(--fg-secondary)]">
                  AI는 체크리스트 검출(검토 필요)만 합니다. 수기는 검토 필요 여부와 최종 감안(Cold/Hot)을 따로 남깁니다.
                  대시보드 매트릭스는 검토필요 축입니다.
                </dd>
              </div>
              <div>
                <dt className="text-[13px] font-bold text-[var(--fg-primary)]">Train</dt>
                <dd className="text-[12.5px] text-[var(--fg-secondary)]">
                  수기 평가가 끝난 레퍼런스 뷰 기반 셋. AI 비교·개선·정확도(Train)의 골드예요.
                </dd>
              </div>
              <div>
                <dt className="text-[13px] font-bold text-[var(--fg-primary)]">Test / 평가 진행</dt>
                <dd className="text-[12.5px] text-[var(--fg-secondary)]">
                  운영 샘플 풀에서 돌리는 평가. 수기 검수·검수 완료가 쌓이면 검수 현황·프롬프트 개선(Test) 재료가
                  돼요.
                </dd>
              </div>
              <div>
                <dt className="text-[13px] font-bold text-[var(--fg-primary)]">Gate</dt>
                <dd className="text-[12.5px] text-[var(--fg-secondary)]">
                  정확도 목표 기준선(기본 90%). 미달이면 불일치부터 보고 표를 고칩니다.
                </dd>
              </div>
              <div>
                <dt className="text-[13px] font-bold text-[var(--fg-primary)]">purpose</dt>
                <dd className="text-[12.5px] text-[var(--fg-secondary)]">
                  통합 결과 테이블 구분. <code className="text-[12px]">qa_eval</code>(비교·개선) /{" "}
                  <code className="text-[12px]">call_eval</code>(평가 진행).
                </dd>
              </div>
              <div>
                <dt className="text-[13px] font-bold text-[var(--fg-primary)]">검수 완료</dt>
                <dd className="text-[12.5px] text-[var(--fg-secondary)]">
                  <code className="text-[12px]">eval_review_completions</code>에 완료 이벤트만 append합니다.
                  결과 JSON은 복사하지 않고, 수기 검토필요·최종 Cold/Hot은 조회 시 현재 검수로 계산합니다. 검수 찜하기는 「내가
                  진행 중」표시이고, 찜 없이 완료를 눌러도 완료자가 검수한 것으로 기록됩니다.
                </dd>
              </div>
            </dl>
            <Insight>
              화면이 늘어나도 큰 흐름은 같아요.{" "}
              <b className="text-[var(--fg-primary)]">기준(표)을 고치고 → 골드로 재고 → 현장에서 검수</b>합니다.
            </Insight>
          </Chapter>
        </div>
      </div>
    </div>
  );
}
