import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { ensureSessionCanAccessAnyCallQuality } from "@/lib/sessionAccessServer";
async function gate() {
  const session = await getServerSession(authOptions);
  if (!await ensureSessionCanAccessAnyCallQuality(session)) redirect("/");
}

export default async function ResultsLayout({ children }: { children: React.ReactNode }) {
  await gate();
  return <div className="qms-page min-h-full">{children}</div>;
}
