import { redirect } from "next/navigation";
import { getSessionContext } from "@/lib/workspace";

export default async function ConnectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile, workspace } = await getSessionContext();
  if (!user || !profile || !workspace) {
    redirect("/login");
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--ink)",
        padding: 24,
      }}
    >
      {children}
    </div>
  );
}
