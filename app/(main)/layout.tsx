import { Suspense } from "react";
import Sidebar from "@/components/Sidebar";

export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell flex min-h-screen">
      <Suspense fallback={<aside className="seed-sidebar sticky top-0 h-dvh w-[248px] shrink-0 self-start" />}>
        <Sidebar />
      </Suspense>
      <div className="app-shell__main flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
