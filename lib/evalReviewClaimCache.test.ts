import { describe, it, expect, beforeEach } from "vitest";
import type { EvaluationSample } from "./types";
import {
  applyClaimOverlayToActiveMap,
  cachedEvalSamplesFor,
  hydrateClaim,
  mergeClaimLatest,
  mergeMyActiveClaimIds,
  rememberClaim,
  rememberEvalSamples,
  resetEvalReviewClaimCacheForTests,
} from "./evalReviewClaimCache";

beforeEach(() => resetEvalReviewClaimCacheForTests());

describe("evalReviewClaimCache", () => {
  it("lets a fresh claim win over empty BQ (streaming lag)", () => {
    rememberClaim({
      conversationId: "c1",
      claimedBy: "karla@daangnservice.com",
      claimedAt: "2026-08-26T07:00:00.000Z",
      active: true,
    });
    expect(mergeClaimLatest(null, "c1")?.claimedBy).toBe("karla@daangnservice.com");
    expect(mergeMyActiveClaimIds("karla@daangnservice.com", [])).toEqual(["c1"]);
  });

  it("keeps a newer release over stale BQ still-active", () => {
    rememberClaim({
      conversationId: "c1",
      claimedBy: "karla@daangnservice.com",
      claimedAt: "2026-08-26T08:00:00.000Z",
      active: false,
    });
    hydrateClaim({
      conversationId: "c1",
      claimedBy: "karla@daangnservice.com",
      claimedAt: "2026-08-26T07:00:00.000Z",
      active: true,
    });
    expect(mergeMyActiveClaimIds("karla@daangnservice.com", ["c1"])).toEqual([]);
    expect(mergeClaimLatest({ conversationId: "c1", claimedBy: "karla@daangnservice.com", claimedAt: "2026-08-26T07:00:00.000Z", active: true }, "c1")?.active).toBe(
      false,
    );
  });

  it("does not let older BQ overwrite a newer overlay write", () => {
    rememberClaim({
      conversationId: "c1",
      claimedBy: "karla@daangnservice.com",
      claimedAt: "2026-08-26T09:00:00.000Z",
      active: true,
    });
    hydrateClaim({
      conversationId: "c1",
      claimedBy: "other@daangnservice.com",
      claimedAt: "2026-08-26T01:00:00.000Z",
      active: true,
    });
    const map = applyClaimOverlayToActiveMap(new Map());
    expect(map.get("c1")?.claimedBy).toBe("karla@daangnservice.com");
  });

  it("fills 내 평가 from remembered sample snapshots", () => {
    rememberEvalSamples([
      { conversationId: "c9", phoneInquiryId: "p", adminName: "상담사", team: "t", category: "", callDate: "2026-08-01", contentSnippet: "", callDurationSec: 10, analyzed: true },
    ] as EvaluationSample[]);
    expect(cachedEvalSamplesFor(["c9", "missing"])).toHaveLength(1);
    expect(cachedEvalSamplesFor(["c9"])[0].adminName).toBe("상담사");
  });
});
