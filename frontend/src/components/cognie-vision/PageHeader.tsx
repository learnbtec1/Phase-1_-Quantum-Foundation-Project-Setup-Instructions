interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
}

export function PageHeader({ eyebrow, title, description }: PageHeaderProps) {
  return (
    <div className="mb-8">
      {eyebrow && (
        <p className="mb-2 text-[10px] tracking-[0.4em] uppercase text-muted-foreground">
          {eyebrow}
        </p>
      )}
      <h1
        className="text-3xl font-semibold tracking-tight md:text-4xl"
        style={{
          background: "linear-gradient(135deg, var(--neon-cyan), var(--neon-emerald))",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}
      >
        {title}
      </h1>
      {description && (
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>
      )}
    </div>
  );
}
