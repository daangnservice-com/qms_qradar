// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import VerdictBadge from "./VerdictBadge";

describe("VerdictBadge", () => {
  it("renders each verdict label with confidence", () => {
    const { rerender } = render(<VerdictBadge verdict="파손됨" confidence={0.87} />);
    expect(screen.getByText("파손됨")).toBeDefined();
    expect(screen.getByText(/87%/)).toBeDefined();
    rerender(<VerdictBadge verdict="정상" confidence={0.5} />);
    expect(screen.getByText("정상")).toBeDefined();
    rerender(<VerdictBadge verdict="불확실" confidence={0.2} />);
    expect(screen.getByText("불확실")).toBeDefined();
  });
});
