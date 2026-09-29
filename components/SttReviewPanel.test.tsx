// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@seed-design/react", () => ({
  Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import SttReviewPanel from "./SttReviewPanel";

const versions = [
  {
    versionId: "batch",
    analyzedAt: "2026-09-18T03:00:00.000Z",
    sttSource: "local" as const,
    segmentCount: 1,
    durationSec: 12,
    origin: "batch" as const,
  },
  {
    versionId: "eval:a1",
    analyzedAt: "2026-09-17T03:00:00.000Z",
    sttSource: "gcp" as const,
    segmentCount: 1,
    durationSec: 12,
    origin: "eval" as const,
    analysisId: "a1",
  },
];

describe("SttReviewPanel version select", () => {
  it("lists STT versions and notifies when another version is chosen", async () => {
    const onSelect = vi.fn();
    render(
      <SttReviewPanel
        conversationId="c1"
        segments={[{ atSec: 0, speaker: "상담원", text: "안녕하세요" }]}
        reviews={[]}
        sttSource="local"
        sttVersions={versions}
        selectedSttVersionId="batch"
        onSelectSttVersion={onSelect}
      />,
    );
    const select = screen.getByLabelText("STT 버전") as HTMLSelectElement;
    expect(select.value).toBe("batch");
    expect(select.options).toHaveLength(2);
    fireEvent.change(select, { target: { value: "eval:a1" } });
    expect(onSelect).toHaveBeenCalledWith("eval:a1");
  });
});
