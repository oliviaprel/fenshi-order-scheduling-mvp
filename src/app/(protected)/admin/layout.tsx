import { forbidden } from "next/navigation";
import { requireAdmin } from "../../../server/auth/guards";
import { ApiError } from "../../../server/http/api-error";

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof ApiError && error.code === "ADMIN_REQUIRED") {
      forbidden();
    }
    throw error;
  }

  return children;
}
