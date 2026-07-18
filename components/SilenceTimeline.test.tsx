// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import SilenceTimeline from "./SilenceTimeline";

describe("SilenceTimeline", () => {
  it("renders each silence as mm:ss~mm:ss with duration", () => {
    render(
      <SilenceTimeline
        durationSec={1000}
        silences={[{ startSec: 135.2, endSec: 160.4, durationSec: 25.2 }]}
        summary={{ count: 1, totalSec: 25.2, longestSec: 25.2, silenceRatio: 0.025 }}
        comments={[]}
      />,
    );
    expect(screen.getByText(/02:15/)).toBeDefined();
    expect(screen.getByText(/02:40/)).toBeDefined();
    // NOTE: deviation from plan verbatim text — with this fixture, totalSec === longestSec === 25.2,
    // so "25.2" legitimately renders in both the summary badge and the timeline list item.
    // getByText throws on multiple matches; getAllByText preserves the same intent (text is present).
    expect(screen.getAllByText(/25.2/).length).toBeGreaterThan(0);
  });
});
