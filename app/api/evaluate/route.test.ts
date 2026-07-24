import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/genesys", () => ({ getConversationAudioUrl: vi.fn(), downloadAudio: vi.fn() }));
vi.mock("@/lib/evaluate", () => ({ evaluateFile: vi.fn() }));
vi.mock("@/lib/audio", () => ({ saveTempFile: vi.fn(), cleanupTempFile: vi.fn(), transcodeToWav: vi.fn() }));
vi.mock("@/lib/analysisStore", () => ({ saveAnalysisResult: vi.fn().mockResolvedValue("aid-1") }));
vi.mock("@/lib/serverTrack", () => ({ trackServerAction: vi.fn() }));

import { getServerSession } from "next-auth";
import { getConversationAudioUrl, downloadAudio } from "@/lib/genesys";
import { evaluateFile } from "@/lib/evaluate";
import { saveTempFile, cleanupTempFile, transcodeToWav } from "@/lib/audio";
import { POST } from "./route";

const KARLA = "karla@daangnservice.com";

function jsonReq(body: unknown) {
  return new Request("http://localhost/api/evaluate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  (getServerSession as any).mockResolvedValue({ user: { email: KARLA } });
});

describe("POST /api/evaluate", () => {
  it("401 without a session", async () => {
    (getServerSession as any).mockResolvedValue(null);
    expect((await POST(jsonReq({ conversationId: "c1" }))).status).toBe(401);
  });

  it("403 for a non-karla account", async () => {
    (getServerSession as any).mockResolvedValue({ user: { email: "someone@daangnservice.com" } });
    expect((await POST(jsonReq({ conversationId: "c1" }))).status).toBe(403);
  });

  it("400 without conversationId", async () => {
    expect((await POST(jsonReq({}))).status).toBe(400);
  });

  it("fetches Genesys audio, transcodes, evaluates, returns result", async () => {
    (getConversationAudioUrl as any).mockResolvedValue("https://rec/audio.webm");
    (downloadAudio as any).mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), contentType: "audio/webm" });
    (saveTempFile as any).mockResolvedValue("/tmp/x.audio");
    (transcodeToWav as any).mockResolvedValue("/tmp/x.wav");
    (evaluateFile as any).mockResolvedValue({
      durationSec: 10,
      threshold: { minSilenceSec: 3, noiseDb: -30 },
      silences: [],
      silenceSummary: { count: 0, totalSec: 0, longestSec: 0, silenceRatio: 0 },
      evaluation: {
        scores: { attitude: { score: 1, comment: "" }, resolution: { score: 1, comment: "" }, flow: { score: 1, comment: "" } },
        overallSummary: "",
        silenceComments: [],
        transcript: [],
        error: null,
      },
    });

    const res = await POST(jsonReq({ conversationId: "conv-1", minSilenceSec: 4 }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.durationSec).toBe(10);
    expect(json.conversationId).toBe("conv-1");
    expect(getConversationAudioUrl).toHaveBeenCalledWith("conv-1");
    expect(evaluateFile).toHaveBeenCalledWith("/tmp/x.wav", { minSilenceSec: 4, noiseDb: -30, org: "growth" }, "/tmp/x.audio");
    // 임시파일 2개(src, wav) 정리
    expect((cleanupTempFile as any).mock.calls.map((c: any[]) => c[0])).toEqual(["/tmp/x.audio", "/tmp/x.wav"]);
  });

  it("500 when Genesys has no recording", async () => {
    (getConversationAudioUrl as any).mockRejectedValue(new Error("녹취를 찾을 수 없어요"));
    const res = await POST(jsonReq({ conversationId: "missing" }));
    expect(res.status).toBe(500);
  });
});
