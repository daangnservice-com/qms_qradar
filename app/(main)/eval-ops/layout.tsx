import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { authOptions } from "@/lib/auth";async function gate() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) redirect("/login");
}

export default async function EvalOpsLayout({ children }: { children: React.ReactNode }) {
  await gate();
  return <div className="qms-page min-h-full">{children}</div>;
}
