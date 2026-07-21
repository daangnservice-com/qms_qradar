import { getServerSession } from "next-auth";
import { authOptions } from "./auth";
import { insertUsageEvent } from "./bigquery";

// 기능 사용(액션)을 서버에서 기록한다. 액션이 실제로 성공한 핸들러에서 호출 —
// 클라이언트 fire-and-forget보다 정확(탭 이탈로 유실되지 않음). 실패는 조용히 무시.
export type ServerAction = "damage_detect" | "call_evaluate" | "chat_ask" | "feedback_submit";

export async function trackServerAction(path: string, event: ServerAction): Promise<void> {
  try {
    const session = await getServerSession(authOptions);
    if (session?.user?.email) await insertUsageEvent({ email: session.user.email, path, type: event });
  } catch (err) {
    console.error("[trackServerAction]", err);
  }
}
