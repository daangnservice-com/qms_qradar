import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { canAccessAnyCallQuality } from "@/lib/adminEmails";
import {
  listSourceCriteria,
  listCriterionPrompts,
  saveCriterionPrompt,
  listFieldKeys,
  saveFieldKeys,
} from "@/lib/criterionStore";
import {
  DEFAULT_FIELD_KEYS,
  parseCriterionReviewScope,
  type PromptFieldKey,
} from "@/lib/promptTypes";
import { cached, cacheInvalidate, SERVER_CACHE_TTL } from "@/lib/serverCache";

export const runtime = "nodejs";
export const maxDuration = 60;

async function requireAccess() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!canAccessAnyCallQuality(email)) {
    return { error: NextResponse.json({ error: "권한이 없습니다" }, { status: 403 }) };
  }
  return { email: email! };
}

export async function GET(req: Request) {
  const gate = await requireAccess();
  if ("error" in gate) return gate.error;
  const url = new URL(req.url);
  const part = url.searchParams.get("part");

  try {
    if (part === "source") {
      const source = await cached("criteria:source", SERVER_CACHE_TTL.criteriaBundle, () => listSourceCriteria());
      return NextResponse.json({ source });
    }

    const payload = await cached("criteria:full", SERVER_CACHE_TTL.criteriaBundle, async () => {
      const [source, prompts, fieldKeys] = await Promise.all([
        listSourceCriteria(),
        listCriterionPrompts(),
        listFieldKeys(),
      ]);
      return {
        source,
        prompts,
        fieldKeys: fieldKeys.length ? fieldKeys : DEFAULT_FIELD_KEYS,
      };
    });
    return NextResponse.json(payload);
  } catch (e) {
    console.error("[api/prompts/criteria]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const gate = await requireAccess();
  if ("error" in gate) return gate.error;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const action = String(body.action ?? "saveCriterion");

    if (action === "saveFieldKeys") {
      const fields = body.fields as PromptFieldKey[];
      if (!Array.isArray(fields)) {
        return NextResponse.json({ error: "fields 배열 필요" }, { status: 400 });
      }
      await saveFieldKeys(fields, gate.email);
      cacheInvalidate("criteria:");
      return NextResponse.json({ fieldKeys: await listFieldKeys() });
    }

    const criterionId = Number(body.criterionId);
    if (!Number.isFinite(criterionId)) {
      return NextResponse.json({ error: "criterionId 필요" }, { status: 400 });
    }
    const fields = (body.fields as Record<string, string>) ?? {};
    const prompt = await saveCriterionPrompt({
      criterionId,
      category: String(body.category ?? ""),
      label: String(body.label ?? ""),
      fields,
      reviewScope: parseCriterionReviewScope(body.reviewScope),
      versionLabel: body.versionLabel != null ? String(body.versionLabel) : undefined,
      versionNote: body.versionNote != null ? String(body.versionNote) : "",
      updatedBy: gate.email,
    });
    cacheInvalidate("criteria:");
    return NextResponse.json({ prompt });
  } catch (e) {
    console.error("[api/prompts/criteria POST]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
