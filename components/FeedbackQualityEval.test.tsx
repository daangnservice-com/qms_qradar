// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("@seed-design/react", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("@/components/QmsLoadingOverlay", () => ({
  default: ({ show, label }: { show: boolean; label?: string }) =>
    show ? (
      <div role="status" aria-busy="true">
        {label}
      </div>
    ) : null,
}));

vi.mock("@/components/SampleListQuickFilters", () => ({
  default: () => null,
}));

vi.mock("@/components/FeedbackFilterPanel", () => ({
  default: () => null,
}));

import FeedbackQualityEval from "./FeedbackQualityEval";

const sample = {
  channel: "feedback" as const,
  sourceSystem: "fixture",
  sourceId: "1409590",
  threadId: "1409590",
  adminId: "1",
  adminName: "상담사",
  participatingAdmins: [],
  lastReplyAdminId: "1",
  lastReplyAdminName: "상담사",
  team: "팀",
  category: "분류",
  internalCategory: null,
  feedbackDate: "2026-09-01",
  firstFeedbackAt: "2026-09-01 10:00:00",
  lastEventAt: "2026-09-01 10:10:00",
  firstReplyAt: "2026-09-01 10:05:00",
  lastReplyAt: "2026-09-01 10:10:00",
  feedbackCount: 1,
  replyCount: 1,
  responseTimeSec: 300,
  threadDurationSec: 600,
  contentSnippet: "환불해주세요",
  turns: [
    {
      turnId: "t1",
      speaker: "customer" as const,
      speakerLabel: "고객",
      text: "환불해주세요",
      occurredAt: "2026-09-01 10:00:00",
    },
  ],
  csat: { id: null, rate: null, comment: null },
  hasHtmlReply: false,
  analyzed: true,
  analysisId: "a1",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("/api/evaluations/feedback/samples")) {
        return new Response(JSON.stringify({ samples: [sample], rules: [] }), { status: 200 });
      }
      if (url.includes("/api/evaluations/feedback/filter-options")) {
        return new Response(JSON.stringify({ teamAgents: [], categories: [] }), { status: 200 });
      }
      if (url.includes("/api/evaluations/feedback/results?sourceId=1409590")) {
        return new Response(
          JSON.stringify({
            result: {
              evaluation: {
                scores: {},
                overallSummary: "공감이 부족합니다",
                csChecklist: [{ id: 415, violated: true, reason: "감정 재진술 없음", evidence: [] }],
                error: null,
              },
              promptConfig: {
                version: { versionId: "draft-1", versionLabel: "260916_ver1", status: "draft" },
                criteria: [{ id: 415, category: "공감과 경청", label: "공감 미흡" }],
              },
            },
            meta: { promptVersion: "260916_ver1", promptVersionStatus: "draft", analysisId: "a1" },
          }),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    }),
  );
});

describe("FeedbackQualityEval stored results", () => {
  it("loads a stored AI result into the evaluation panel", async () => {
    render(<FeedbackQualityEval />);
    await waitFor(() => expect(screen.getByText("공감이 부족합니다")).toBeTruthy());
    expect(screen.getByText("공감 미흡")).toBeTruthy();
    expect(screen.getByText(/260916_ver1/)).toBeTruthy();
    expect(screen.getByText("AI 평가 완료")).toBeTruthy();
    expect(screen.getByText("고객 설문 (CSAT)")).toBeTruthy();
    expect(screen.getByText("설문 미참여")).toBeTruthy();
  });

  it("high-risk mode requests the high-risk filter on first load", async () => {
    render(<FeedbackQualityEval mode="high-risk" />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls.find(([input]) =>
      String(input).includes("/api/evaluations/feedback/samples"),
    );
    expect(call).toBeTruthy();
    const body = JSON.parse(String((call?.[1] as RequestInit | undefined)?.body ?? "{}")) as {
      filters?: { highRiskOnly?: boolean };
    };
    expect(body.filters?.highRiskOnly).toBe(true);
  });
});
