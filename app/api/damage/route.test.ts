import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/vision", () => ({ runDamageDetection: vi.fn() }));
vi.mock("@/lib/audio", () => ({ saveTempFile: vi.fn(), cleanupTempFile: vi.fn() }));

import { runDamageDetection } from "@/lib/vision";
import { saveTempFile, cleanupTempFile } from "@/lib/audio";
import { POST } from "./route";

function form(files: { name: string; type: string; body: string }[]) {
  const fd = new FormData();
  for (const f of files) fd.append("images", new File([f.body], f.name, { type: f.type }));
  return new Request("http://localhost/api/damage", { method: "POST", body: fd });
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/damage", () => {
  it("rejects zero images with 400", async () => {
    const res = await POST(new Request("http://localhost/api/damage", { method: "POST", body: new FormData() }));
    expect(res.status).toBe(400);
  });

  it("rejects an unsupported format with 400", async () => {
    const res = await POST(form([{ name: "a.gif", type: "image/gif", body: "x" }]));
    expect(res.status).toBe(400);
  });

  it("returns the damage result on success", async () => {
    (saveTempFile as any).mockResolvedValue("/tmp/x.jpg");
    (runDamageDetection as any).mockResolvedValue({
      verdict: "정상", confidence: 0.9, summary: "이상 없음", findings: [], perPhoto: [{ index: 0, note: "정면" }],
    });
    const res = await POST(form([{ name: "a.jpg", type: "image/jpeg", body: "x" }]));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.verdict).toBe("정상");
    expect(cleanupTempFile).toHaveBeenCalledWith("/tmp/x.jpg");
    expect((runDamageDetection as any).mock.calls[0][0]).toEqual([{ path: "/tmp/x.jpg", mimeType: "image/jpeg" }]);
  });
});
