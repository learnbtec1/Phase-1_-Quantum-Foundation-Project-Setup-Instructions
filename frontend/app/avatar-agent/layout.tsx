/**
 * Avatar agent pulls Three/R3F + heavy client bundles — must not static-prerender (Docker/next build).
 */
export const dynamic = "force-dynamic";

export default function AvatarAgentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
