import { ThemeControls } from "@/components/theme-controls";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-slate-50 to-slate-100 p-4 dark:from-slate-950 dark:to-slate-900">
      <div className="absolute end-4 top-4">
        <ThemeControls />
      </div>
      {children}
    </div>
  );
}