import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessQualityEval } from "@/lib/sessionAccessServer";
import {
  deleteReplyPolishTemplate,
  duplicateReplyPolishTemplate,
  listReplyPolishTemplates,
  upsertReplyPolishTemplate,
} from "@/lib/replyPolishStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAccess() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email;
  if (!email || !(await ensureSessionCanAccessQualityEval(session))) {
    return { error: NextResponse.json({ error: "권한이 없습니다" }, { status: 403 }) };
  }
  return { email };
}

export async function GET() {
  const access = await requireAccess();
  if (access.error) return access.error;
  try {
    const templates = await listReplyPolishTemplates(access.email);
    return NextResponse.json({ templates });
  } catch (e) {
    console.error("[GET /api/eval-design/reply-polish/templates]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const access = await requireAccess();
  if (access.error) return access.error;
  try {
    const body = (await req.json()) as Record<string, unknown>;
    if (body.duplicateId) {
      const template = await duplicateReplyPolishTemplate(String(body.duplicateId), access.email);
      return NextResponse.json({ template });
    }
    const template = await upsertReplyPolishTemplate(
      {
        id: body.id != null ? String(body.id) : undefined,
        name: String(body.name ?? ""),
        body: String(body.body ?? ""),
      },
      access.email,
    );
    return NextResponse.json({ template });
  } catch (e) {
    console.error("[POST /api/eval-design/reply-polish/templates]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const access = await requireAccess();
  if (access.error) return access.error;
  try {
    const id = new URL(req.url).searchParams.get("id")?.trim();
    if (!id) return NextResponse.json({ error: "id 필요" }, { status: 400 });
    await deleteReplyPolishTemplate(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[DELETE /api/eval-design/reply-polish/templates]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
