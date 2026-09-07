import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "./auth";
import { getEvalOpsAccessLevel, type EvalOpsAccessLevel } from "./adminEmails";

export async function requireEvalOps(min: "roster" | "full"): Promise<
  | { ok: true; email: string; level: EvalOpsAccessLevel }
  | { ok: false; response: NextResponse }
> {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? "";
  const level = getEvalOpsAccessLevel(email);
  if (level === "none" || (min === "full" && level !== "full")) {
    return { ok: false, response: NextResponse.json({ error: "권한이 없습니다" }, { status: 403 }) };
  }
  return { ok: true, email, level };
}
