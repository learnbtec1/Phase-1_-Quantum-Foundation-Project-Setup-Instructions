import { ReactNode } from "react";

export function Field({
  label,
  type = "text",
  placeholder,
}: {
  label: string;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs tracking-wider uppercase text-muted-foreground">
        {label}
      </span>
      <input
        type={type}
        placeholder={placeholder}
        className="w-full rounded-lg border bg-white/5 px-3 py-2 text-sm outline-none transition focus:border-[color:var(--neon-cyan)]"
        style={{ borderColor: "var(--glass-border)" }}
      />
    </label>
  );
}

export function NeonButton({ children }: { children: ReactNode }) {
  return (
    <button
      type="button"
      className="w-full rounded-lg px-4 py-2.5 text-sm font-medium tracking-wide transition hover:scale-[1.01]"
      style={{
        background:
          "linear-gradient(135deg, var(--neon-cyan), var(--neon-emerald))",
        color: "oklch(0.16 0.03 250)",
        boxShadow: "0 0 24px -6px var(--neon-cyan)",
      }}
    >
      {children}
    </button>
  );
}
