import { redirect } from "next/navigation";
import { getCurrentUser } from "../server/auth/current-user";

export default async function RootPage() {
  const user = await getCurrentUser();
  if (user === null) {
    redirect("/login");
  }
  if (user.mustChangePassword) {
    redirect("/change-password");
  }
  redirect("/home");
}
