// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./MultiSelect", () => ({
  default: () => null,
}));

import FeedbackFilterPanel from "./FeedbackFilterPanel";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ teamAgents: [], categories: [] }), { status: 200 })),
  );
});

describe("FeedbackFilterPanel", () => {
  it("defaults 답변 담당자 수 to 1 or more", () => {
    render(
      <FeedbackFilterPanel
        defaults={{ replyCountMin: 1, humanCountMin: 1 }}
        onApply={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /필터/ }));
    expect(screen.getByLabelText("답변 담당자 수 최소")).toHaveValue(1);
    expect(screen.getByLabelText("답변 개수 최소")).toHaveValue(1);
  });

  it("clears other filters when a thread id is entered", () => {
    const onApply = vi.fn();
    render(
      <FeedbackFilterPanel
        defaults={{ replyCountMin: 1, humanCountMin: 1, dateStart: "2026-09-01" }}
        onApply={onApply}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /필터/ }));
    fireEvent.change(screen.getByLabelText("문의 스레드 ID"), { target: { value: "1416980" } });
    expect(screen.getByLabelText("답변 담당자 수 최소")).toHaveValue(null);
    expect(screen.getByLabelText("답변 개수 최소")).toHaveValue(null);
    expect(screen.getByLabelText("문의 날짜 시작")).toHaveValue("");
    fireEvent.click(screen.getByRole("button", { name: "필터 적용" }));
    expect(onApply).toHaveBeenCalledWith({ sourceIds: ["1416980"] });
  });
});
