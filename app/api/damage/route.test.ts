import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/vision", () => ({ runDamageDetection: vi.fn() }));
vi.mock("@/lib/audio", () => ({ saveTempFile: vi.fn(), cleanupTempFile: vi.fn() }));
vi.mock("@/lib/serverTrack", () => ({ trackServerAction: vi.fn() }));

import { runDamageDetection } from "@/lib/vision";
import { saveTempFile, cleanupTempFile } from "@/lib/audio";
import { POST } from "./route";

type Img = { name: string; type: string; body: string };
function form(parties: { claimant?: Img[]; respondent?: Img[] }) {
  const fd = new FormData();
  for (const f of parties.claimant ?? []) fd.append("claimantImages", new File([f.body], f.name, { type: f.type }));
  for (const f of parties.respondent ?? []) fd.append("respondentImages", new File([f.body], f.name, { type: f.type }));
  return new Request("http://localhost/api/damage", { method: "POST", body: fd });
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/damage", () => {
  it("rejects zero images with 400", async () => {
    const res = await POST(new Request("http://localhost/api/damage", { method: "POST", body: new FormData() }));
    expect(res.status).toBe(400);
  });

  it("rejects an unsupported format with 400", async () => {
    const res = await POST(form({ claimant: [{ name: "a.gif", type: "image/gif", body: "x" }] }));
    expect(res.status).toBe(400);
  });

  it("rejects more than 5 images for one party with 400", async () => {
    const six = Array.from({ length: 6 }, (_, i) => ({ name: `p${i}.jpg`, type: "image/jpeg", body: "x" }));
    const res = await POST(form({ claimant: six }));
    expect(res.status).toBe(400);
  });

  it("orders claimant images before respondent and tags party", async () => {
    let n = 0;
    (saveTempFile as any).mockImplementation(async () => `/tmp/${n++}.jpg`);
    (runDamageDetection as any).mockResolvedValue({
      verdict: "정상", confidence: 0.9, summary: "이상 없음", comparison: "특이사항 없음",
      findings: [], perPhoto: [], claimantCount: 1, respondentCount: 1, promptVersion: "v1",
    });
    const res = await POST(
      form({
        claimant: [{ name: "c.jpg", type: "image/jpeg", body: "x" }],
        respondent: [{ name: "r.png", type: "image/png", body: "y" }],
      }),
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.verdict).toBe("정상");
    expect(cleanupTempFile).toHaveBeenCalledTimes(2);
    expect((runDamageDetection as any).mock.calls[0][0]).toEqual([
      { path: "/tmp/0.jpg", mimeType: "image/jpeg", party: "claimant" },
      { path: "/tmp/1.jpg", mimeType: "image/png", party: "respondent" },
    ]);
  });
});
