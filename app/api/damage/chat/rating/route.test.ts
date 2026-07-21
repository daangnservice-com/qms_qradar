import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/bigquery", () => ({ insertChatRating: vi.fn() }));

import { getServerSession } from "next-auth";
import { insertChatRating } from "@/lib/bigquery";
import { POST } from "./route";

const req = (body: unknown) =>
  new Request("http://localhost/api/damage/chat/rating", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => vi.clearAllMocks());

describe("POST /api/damage/chat/rating", () => {
  it("401 without a session", async () => {
    (getServerSession as any).mockResolvedValue(null);
    expect((await POST(req({ messageId: "m", rating: "good" }))).status).toBe(401);
  });

  it("400 for a bad rating value", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: "karla@daangnservice.com" } });
    expect((await POST(req({ messageId: "m", rating: "meh" }))).status).toBe(400);
  });

  it("400 without messageId", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: "karla@daangnservice.com" } });
    expect((await POST(req({ rating: "good" }))).status).toBe(400);
  });

  it("records the rating for an authed user", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: "karla@daangnservice.com" } });
    const res = await POST(req({ messageId: "msg-1", rating: "bad" }));
    expect(res.status).toBe(200);
    expect(insertChatRating).toHaveBeenCalledWith({ messageId: "msg-1", email: "karla@daangnservice.com", rating: "bad" });
  });
});
