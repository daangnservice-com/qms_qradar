import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/bigquery", () => ({ getFeedbackStats: vi.fn(), deleteFeedback: vi.fn() }));
vi.mock("@/lib/storage", () => ({ deleteFeedbackImages: vi.fn() }));

import { getServerSession } from "next-auth";
import { deleteFeedback } from "@/lib/bigquery";
import { deleteFeedbackImages } from "@/lib/storage";
import { DELETE } from "./route";

const ADMIN = "karla@daangnservice.com";
const del = (body: unknown) =>
  new Request("http://localhost/api/stats/feedback", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => vi.clearAllMocks());

describe("DELETE /api/stats/feedback", () => {
  it("401 without a session", async () => {
    (getServerSession as any).mockResolvedValue(null);
    expect((await DELETE(del({ feedbackId: "x" }))).status).toBe(401);
  });

  it("403 for a non-admin", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: "someone@daangnservice.com" } });
    expect((await DELETE(del({ feedbackId: "x" }))).status).toBe(403);
  });

  it("400 without feedbackId", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: ADMIN } });
    expect((await DELETE(del({}))).status).toBe(400);
  });

  it("tombstones the feedback and deletes its images for an admin", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: ADMIN } });
    const res = await DELETE(del({ feedbackId: "abc-123" }));
    expect(res.status).toBe(200);
    expect(deleteFeedback).toHaveBeenCalledWith("abc-123", ADMIN);
    expect(deleteFeedbackImages).toHaveBeenCalledWith("abc-123");
  });
});
