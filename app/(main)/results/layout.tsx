import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { canAccessAnyCallQuality } from "@/lib/adminEmails";

async function gate() {
  const session = await getServerSession(authOptions);
  if (!canAccessAnyCallQuality(session?.user?.email)) redirect("/");
}

export default async function ResultsLayout({ children }: { children: React.ReactNode }) {
  await gate();
  return <div className="qms-page min-h-full">{children}</div>;
}
