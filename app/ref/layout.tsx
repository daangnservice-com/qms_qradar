import { EvalStatusRefSidebar } from "@/components/results/EvalStatusRefSidebar";

export default function RefLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="app-shell flex min-h-screen">
      <EvalStatusRefSidebar />
      <div className="app-shell__main flex min-h-0 min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
