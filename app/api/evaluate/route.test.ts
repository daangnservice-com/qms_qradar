import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/evaluate", () => ({ evaluateFile: vi.fn() }));
vi.mock("@/lib/audio", () => ({ saveTempFile: vi.fn(), cleanupTempFile: vi.fn() }));
vi.mock("@/lib/serverTrack", () => ({ trackServerAction: vi.fn() }));

import { getServerSession } from "next-auth";
import { evaluateFile } from "@/lib/evaluate";
import { saveTempFile, cleanupTempFile } from "@/lib/audio";
import { POST } from "./route";

const KARLA = "karla@daangnservice.com";

function form(fields: Record<string, string>, file?: { name: string; type: string; body: string }) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  if (file) fd.set("file", new File([file.body], file.name, { type: file.type }));
  return new Request("http://localhost/api/evaluate", { method: "POST", body: fd });
}

beforeEach(() => {
  vi.clearAllMocks();
  (getServerSession as any).mockResolvedValue({ user: { email: KARLA } });
});

describe("POST /api/evaluate", () => {
  it("401 without a session", async () => {
    (getServerSession as any).mockResolvedValue(null);
    const res = await POST(form({ minSilenceSec: "3" }, { name: "a.m4a", type: "audio/mp4", body: "x" }));
    expect(res.status).toBe(401);
  });

  it("403 for a non-karla account", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: "someone@daangnservice.com" } });
    const res = await POST(form({ minSilenceSec: "3" }, { name: "a.m4a", type: "audio/mp4", body: "x" }));
    expect(res.status).toBe(403);
  });

  it("rejects non-m4a with 400", async () => {
    const res = await POST(form({ minSilenceSec: "3" }, { name: "a.mp3", type: "audio/mpeg", body: "x" }));
    expect(res.status).toBe(400);
  });

  it("returns evaluation result on success", async () => {
    (saveTempFile as any).mockResolvedValue("/tmp/x.m4a");
    (evaluateFile as any).mockResolvedValue({ durationSec: 10, threshold: { minSilenceSec: 3, noiseDb: -30 }, silences: [], silenceSummary: { count: 0, totalSec: 0, longestSec: 0, silenceRatio: 0 }, evaluation: { scores: { attitude: { score: 1, comment: "" }, resolution: { score: 1, comment: "" }, flow: { score: 1, comment: "" } }, overallSummary: "", silenceComments: [], error: null } });
    const res = await POST(form({ minSilenceSec: "3" }, { name: "a.m4a", type: "audio/mp4", body: "x" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.durationSec).toBe(10);
    expect(cleanupTempFile).toHaveBeenCalledWith("/tmp/x.m4a");
    expect((evaluateFile as any).mock.calls[0][1]).toEqual({ minSilenceSec: 3, noiseDb: -30 });
  });
});
