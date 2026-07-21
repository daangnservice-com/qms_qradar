import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/bigquery", () => ({ getChatStats: vi.fn(), deleteChatTurn: vi.fn() }));

import { getServerSession } from "next-auth";
import { deleteChatTurn } from "@/lib/bigquery";
import { DELETE } from "./route";

const ADMIN = "karla@daangnservice.com";
const del = (body: unknown) =>
  new Request("http://localhost/api/stats/chat", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => vi.clearAllMocks());

describe("DELETE /api/stats/chat", () => {
  it("401 without a session", async () => {
    (getServerSession as any).mockResolvedValue(null);
    expect((await DELETE(del({ messageId: "m" }))).status).toBe(401);
  });

  it("403 for a non-admin", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: "someone@daangnservice.com" } });
    expect((await DELETE(del({ messageId: "m" }))).status).toBe(403);
  });

  it("400 without messageId", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: ADMIN } });
    expect((await DELETE(del({}))).status).toBe(400);
  });

  it("tombstones the chat turn for an admin", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: ADMIN } });
    const res = await DELETE(del({ messageId: "msg-9" }));
    expect(res.status).toBe(200);
    expect(deleteChatTurn).toHaveBeenCalledWith("msg-9", ADMIN);
  });
});
