"use client";

import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PrefixIcon, Text } from "@seed-design/react";
import IconArrow2ClockwiseCircularLine from "@karrotmarket/react-monochrome-icon/IconArrow2ClockwiseCircularLine";
import { ActionButton } from "seed-design/ui/action-button";
import { Callout } from "seed-design/ui/callout";
import { DialogBody, DialogContent, DialogFooter, DialogRoot } from "seed-design/ui/dialog";
import { ProgressCircle } from "seed-design/ui/progress-circle";
import { useCachedFetch } from "@/lib/useCachedFetch";
import { Chip } from "seed-design/ui/chip";
import type { EvalStatusResponse, QmsCaseRow, UnconfirmedCurrentMonth } from "@/lib/resultsStore";
import { getEvalStatusFixture, getEvalStatusFixtureCase } from "@/lib/evalStatusFixture";
import { FilterSelect, ResultsStat } from "./ResultsShared";
import { ResultsCaseCard } from "./ResultsCaseCard";
import { EvalStatusTree, filterOpenTree } from "./EvalStatusTree";

type StatusRes = { ok: boolean } & EvalStatusResponse;
type CaseRes = { ok: boolean; row?: QmsCaseRow; error?: string };

export default function EvalStatusWorkbench({ demo = false }: { demo?: boolean }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const monthParam = searchParams.get("month")?.trim() || "";
  const [demoMonth, setDemoMonth] = useState("2026-08");

  const live = useCachedFetch<StatusRes>({
    key: demo ? "" : `evalStatus:v2:${monthParam || "current"}`,
    enabled: !demo,
    fetcher: async () => {
      const q = monthParam ? `month=${encodeURIComponent(monthParam)}` : "";
      const r = await fetch(`/api/results/status${q ? `?${q}` : ""}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "평가 현황 로드 실패");
      return d as StatusRes;
    },
  });

  const data = demo ? getEvalStatusFixture(demoMonth) : live.data;
  const error = demo ? null : live.error;
  const loading = demo ? false : live.loading;
  const validating = demo ? false : live.validating;
  const refresh = live.refresh;

  const month = demo ? demoMonth : data?.month || monthParam;
  const monthOptions = useMemo(
    () => (data?.months ?? []).map((m) => ({ value: m, label: m })),
    [data?.months],
  );

  const [scope, setScope] = useState<"open" | "all">("open");
  const [caseId, setCaseId] = useState<string | null>(null);

  const treeData = useMemo((): UnconfirmedCurrentMonth | null => {
    if (!data) return null;
    if (scope === "all") return data;
    return { ...data, tree: filterOpenTree(data.tree) };
  }, [data, scope]);
  const caseQuery = useCachedFetch<CaseRes>({
    key: demo || !caseId ? "" : `evalStatusCase:${caseId}`,
    fetcher: async () => {
      if (!caseId) return { ok: false };
      const r = await fetch(`/api/results/cases?caseId=${encodeURIComponent(caseId)}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "케이스 로드 실패");
      return d as CaseRes;
    },
    enabled: !demo && Boolean(caseId),
  });
  const caseRow = demo && caseId ? getEvalStatusFixtureCase(caseId) : caseQuery.data?.row;
  const caseLoading = demo ? false : caseQuery.loading && !caseQuery.data;
  const caseError = demo ? null : caseQuery.error;

  const setMonth = (v: string) => {
    if (!v) return;
    if (demo) {
      setDemoMonth(v);
      setCaseId(null);
      return;
    }
    router.replace(`/results/status?month=${encodeURIComponent(v)}`);
  };

  return (
    <div className="qms-page-body mx-auto max-w-[1280px] space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Text as="p" textStyle="t2Bold" color="fg.neutralSubtle">
            품질평가
          </Text>
          <Text as="h1" textStyle="t9Bold" color="fg.neutral">
            평가 현황
          </Text>
          <Text as="p" textStyle="t4Regular" color="fg.neutralMuted">
            월별 평가표·대상·케이스 진행 상태를 봐요. 기본은 당월이고, 과거 월도 고를 수 있어요.
          </Text>
        </div>
        {demo ? null : (
          <ActionButton variant="neutralWeak" size="small" loading={validating} onClick={() => void refresh()}>
            <PrefixIcon svg={<IconArrow2ClockwiseCircularLine />} />
            새로고침
          </ActionButton>
        )}
      </div>

      {demo ? (
        <Callout
          tone="informative"
          title="UI 레퍼런스 · 샘플 데이터"
          description="BigQuery·API에 붙지 않아요. 평가월·미확정/전체·트리 펼침·케이스 팝업만 그대로 써 보세요."
        />
      ) : null}

      {month ? (
        <div className="flex flex-wrap items-end gap-3">
          <FilterSelect
            label="평가월"
            value={month}
            onChange={setMonth}
            options={monthOptions.length ? monthOptions : [{ value: month, label: month }]}
            allLabel="평가월"
            allowEmpty={false}
          />
          <div className="flex flex-col gap-1">
            <Text textStyle="t2Bold" color="fg.neutralSubtle">
              보기
            </Text>
            <Chip.RadioRoot
              value={scope}
              onValueChange={(v) => setScope(v === "all" ? "all" : "open")}
              className="flex flex-wrap gap-1.5"
            >
              <Chip.RadioItem value="open" size="small" variant="outlineWeak">
                <Chip.Label>미확정</Chip.Label>
              </Chip.RadioItem>
              <Chip.RadioItem value="all" size="small" variant="outlineWeak">
                <Chip.Label>전체</Chip.Label>
              </Chip.RadioItem>
            </Chip.RadioRoot>
          </div>
        </div>
      ) : null}

      {error ? (
        <Callout
          tone="critical"
          title="평가 현황을 불러오지 못했어요"
          description={error}
          linkProps={{ children: "다시 시도", onClick: () => void refresh() }}
        />
      ) : null}

      {!data && loading ? (
        <div className="flex items-center justify-center gap-2 py-24">
          <ProgressCircle size="24" />
          <Text textStyle="t4Regular" color="fg.neutralSubtle">
            평가 현황 집계 중…
          </Text>
        </div>
      ) : null}

      {data ? (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            <ResultsStat label="회차" value={`${data.openEvalCount}/${data.evalCount}`} />
            <ResultsStat label="미확정 회차" value={data.openEvalCount} />
            <ResultsStat label="대상" value={`${data.openTargetCount}/${data.targetCount}`} />
            <ResultsStat label="미완료 대상" value={data.openTargetCount} />
            <ResultsStat label="케이스" value={`${data.openCaseCount}/${data.caseCount}`} />
            <ResultsStat label="미완료 케이스" value={data.openCaseCount} />
          </div>
          <EvalStatusTree
            data={treeData ?? data}
            onCaseClick={(id) => setCaseId(id)}
            emptyLabel={scope === "open" ? "이 달에 미확정 평가가 없어요" : "이 달에 표시할 평가가 없어요"}
          />
        </>
      ) : null}

      <DialogRoot
        open={Boolean(caseId)}
        onOpenChange={(next) => {
          const open = typeof next === "boolean" ? next : Boolean((next as { open?: boolean }).open);
          if (!open) setCaseId(null);
        }}
        closeOnInteractOutside
        size="large"
      >
        <DialogContent title={caseId ? `케이스 ${caseId}` : "케이스 상세"} description="케이스 상세와 같은 내용이에요.">
          <DialogBody>
            {caseLoading ? (
              <div className="flex items-center justify-center gap-2 py-10">
                <ProgressCircle size="24" />
                <Text textStyle="t4Regular" color="fg.neutralSubtle">
                  케이스 불러오는 중…
                </Text>
              </div>
            ) : null}
            {caseError ? (
              <Callout tone="critical" title="케이스를 불러오지 못했어요" description={caseError} />
            ) : null}
            {caseRow ? <ResultsCaseCard row={caseRow} /> : null}
          </DialogBody>
          <DialogFooter>
            <ActionButton variant="neutralWeak" onClick={() => setCaseId(null)}>
              닫기
            </ActionButton>
          </DialogFooter>
        </DialogContent>
      </DialogRoot>
    </div>
  );
}
