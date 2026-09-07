import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { orgFromParam, canAccessCallQualityPlayback } from "@/lib/callQualityOrg";
import { loadStereoWav } from "@/lib/callAudioCache";
import { extractStereoPeaks } from "@/lib/wavPeaks";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

// stereo 마스터 WAV에서 L/R peaks JSON. /api/call-quality/audio 와 동일 캐시 공유.

export async function GET(req: Request): Promise<Response> {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return new Response("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const org = orgFromParam(url.searchParams.get("org"));
  if (!canAccessCallQualityPlayback(org, session.user.email)) return new Response("Forbidden", { status: 403 });

  const conversationId = url.searchParams.get("conversationId") ?? "";
  if (!conversationId) return new Response("conversationId required", { status: 400 });

  const bucketsRaw = Number(url.searchParams.get("buckets") ?? "400");
  const buckets = Number.isFinite(bucketsRaw) ? bucketsRaw : 400;

  try {
    const stereo = await loadStereoWav(conversationId);
    const peaks = extractStereoPeaks(stereo, buckets);
    return Response.json(peaks, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (err) {
    console.error("[GET /api/call-quality/audio/peaks]", err);
    return new Response("peaks failed", { status: 502 });
  }
}
