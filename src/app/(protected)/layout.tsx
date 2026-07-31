import { redirect } from "next/navigation";
import { AppShell } from "../../components/app-shell";
import { requireUser } from "../../server/auth/guards";
import { ApiError } from "../../server/http/api-error";

export default async function ProtectedLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  let user;
  try {
    user = await requireUser();
  } catch (error) {
    if (error instanceof ApiError && error.code === "UNAUTHENTICATED") {
      redirect("/login");
    }
    if (error instanceof ApiError && error.code === "PASSWORD_CHANGE_REQUIRED") {
      redirect("/change-password");
    }
    throw error;
  }

  return (
    <AppShell user={{ displayName: user.displayName, status: user.status, role: user.role }}>
      {children}
    </AppShell>
  );
}
