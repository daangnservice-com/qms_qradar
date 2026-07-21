import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/bigquery", () => ({ insertDamageFeedback: vi.fn(), insertUsageEvent: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  uploadFeedbackImage: vi.fn(),
  feedbackObjectName: (id: string, party: string, i: number, ext: string) => `damage-feedback/${id}/${party}-${i}${ext}`,
}));

import { getServerSession } from "next-auth";
import { insertDamageFeedback } from "@/lib/bigquery";
import { uploadFeedbackImage } from "@/lib/storage";
import { POST } from "./route";

const RESULT = {
  verdict: "파손됨", confidence: 0.8, summary: "s", comparison: "c",
  findings: [], perPhoto: [], claimantCount: 1, respondentCount: 1, promptVersion: "v1",
};

function form(fields: Record<string, string>, imgs: { field: string; name: string; type: string }[] = []) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  for (const im of imgs) fd.append(im.field, new File(["x"], im.name, { type: im.type }));
  return new Request("http://localhost/api/damage/feedback", { method: "POST", body: fd });
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/damage/feedback", () => {
  it("401 without a session", async () => {
    (getServerSession as any).mockResolvedValue(null);
    const res = await POST(form({ rating: "good", result: JSON.stringify(RESULT) }));
    expect(res.status).toBe(401);
  });

  it("400 for an invalid rating", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: "karla@daangnservice.com" } });
    const res = await POST(form({ rating: "meh", result: JSON.stringify(RESULT) }));
    expect(res.status).toBe(400);
  });

  it("400 when the result JSON is malformed", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: "karla@daangnservice.com" } });
    const res = await POST(form({ rating: "good", result: "not-json" }));
    expect(res.status).toBe(400);
  });

  it("uploads re-attached images and inserts the feedback row", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: "karla@daangnservice.com" } });
    const res = await POST(
      form({ rating: "bad", comment: "박스가 엉뚱해요", result: JSON.stringify(RESULT) }, [
        { field: "claimantImages", name: "c.jpg", type: "image/jpeg" },
        { field: "respondentImages", name: "r.png", type: "image/png" },
      ]),
    );
    expect(res.status).toBe(200);
    expect(uploadFeedbackImage).toHaveBeenCalledTimes(2);
    const arg = (insertDamageFeedback as any).mock.calls[0][0];
    expect(arg.rating).toBe("bad");
    expect(arg.comment).toBe("박스가 엉뚱해요");
    expect(arg.verdict).toBe("파손됨");
    expect(arg.promptVersion).toBe("v1");
    expect(arg.claimantCount).toBe(1);
    expect(arg.imagePaths).toHaveLength(2);
    expect(arg.imagePaths[0]).toContain("/claimant-0.jpg");
    expect(arg.imagePaths[1]).toContain("/respondent-0.png");
  });
});
