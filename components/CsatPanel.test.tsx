// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
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

import CsatPanel from "./CsatPanel";
import type { CsatRecord } from "@/lib/csat";

function csat(over: Partial<CsatRecord>): CsatRecord {
  return {
    csatId: "552840",
    adminUserId: "615360097",
    phoneInquiryId: "436433",
    createdAt: "2026-09-01 10:00:00",
    rate: 2,
    comment: "",
    choices: [],
    issueType: "",
    resolved: null,
    isProfane: false,
    ...over,
  };
}

function mockCsat(record: CsatRecord | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ csat: record }),
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("CsatPanel DSAT 도구", () => {
  it("1~3점이면 DSAT 보기 딥링크를 붙인다", async () => {
    mockCsat(csat({ rate: 2 }));
    render(<CsatPanel conversationId="c1" org="growth" />);
    const links = await waitFor(() => {
      const found = screen.getAllByRole("link", { name: /DSAT 보기/ });
      expect(found.length).toBeGreaterThan(0);
      return found;
    });
    expect(links[0]).toHaveAttribute(
      "href",
      "http://172.17.3.56.nip.io:3000/?page=dsat&csatId=552840&adminUserId=615360097",
    );
    expect(screen.queryByText("DSAT 아님")).toBeNull();
  });

  it("4~5점이면 링크 대신 DSAT 아님 뱃지만 보여 준다", async () => {
    mockCsat(csat({ rate: 5 }));
    render(<CsatPanel conversationId="c1" org="growth" />);
    await waitFor(() => {
      expect(screen.getAllByText("DSAT 아님").length).toBeGreaterThan(0);
    });
    expect(screen.queryByRole("link", { name: /DSAT 보기/ })).toBeNull();
  });

  it("인앱 문의는 csatId로 feedback CSAT API를 친다", async () => {
    mockCsat(csat({ rate: 2 }));
    render(<CsatPanel csatId="552840" inquiryLabel="문의" />);
    await waitFor(() => {
      expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/evaluations/feedback/csat?csatId=552840");
    });
    expect(await screen.findAllByRole("link", { name: /DSAT 보기/ })).not.toHaveLength(0);
  });

  it("다른 콜로 바꾸면 새 응답 전까지 로딩 마스크를 띄운다", async () => {
    mockCsat(csat({ rate: 2 }));
    const { rerender } = render(<CsatPanel conversationId="c1" org="growth" />);
    await waitFor(() => {
      expect(screen.getAllByRole("link", { name: /DSAT 보기/ }).length).toBeGreaterThan(0);
    });

    let resolveNext: ((v: { ok: boolean; json: () => Promise<{ csat: CsatRecord | null }> }) => void) | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveNext = resolve;
          }),
      ),
    );

    rerender(<CsatPanel conversationId="c2" org="growth" />);
    expect(screen.getByRole("status")).toHaveTextContent("고객 설문 불러오는 중");
    expect(screen.getAllByRole("link", { name: /DSAT 보기/ }).length).toBeGreaterThan(0);

    resolveNext?.({
      ok: true,
      json: async () => ({ csat: csat({ rate: 5, csatId: "9" }) }),
    });
    await waitFor(() => {
      expect(screen.queryByRole("status")).toBeNull();
      expect(screen.getAllByText("DSAT 아님").length).toBeGreaterThan(0);
    });
  });
});
