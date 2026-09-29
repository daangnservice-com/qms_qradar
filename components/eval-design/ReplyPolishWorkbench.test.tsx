// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/useCachedFetch", () => ({
  useCachedFetch: () => ({
    data: null,
    loading: false,
    validating: false,
    error: null,
    refresh: async () => {},
    setData: () => {},
  }),
}));

vi.mock("@/lib/clientCache", () => ({
  cacheInvalidate: () => {},
}));

import ReplyPolishWorkbench from "./ReplyPolishWorkbench";

describe("ReplyPolishWorkbench", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 200 })),
    );
  });

  it("shows sampling filters and tab switches", () => {
    render(<ReplyPolishWorkbench />);
    expect(screen.getByRole("heading", { name: "답변 다듬기 테스트" })).toBeInTheDocument();
    expect(screen.getByDisplayValue("중고거래팀")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "샘플링" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "1점" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "미참여" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "템플릿" }));
    expect(screen.getByRole("button", { name: "저장" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "{{inquiry}}" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "비교" }));
    expect(screen.getByRole("button", { name: "선택 템플릿으로 다듬기" })).toBeInTheDocument();
  });
});
