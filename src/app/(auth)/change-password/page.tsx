import { redirect } from "next/navigation";
import { ChangePasswordForm } from "../../../components/auth/change-password-form";
import { requireUser } from "../../../server/auth/guards";
import { ApiError } from "../../../server/http/api-error";

export default async function ChangePasswordPage() {
  let user;
  try {
    user = await requireUser({ allowPasswordChangeRequired: true });
  } catch (error) {
    if (error instanceof ApiError && error.code === "UNAUTHENTICATED") {
      redirect("/login");
    }
    throw error;
  }
  if (!user.mustChangePassword) {
    redirect("/home");
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="change-password-title">
        <p className="eyebrow">首次登录安全设置</p>
        <h1 id="change-password-title">修改密码</h1>
        <p className="lede">为保护账户安全，请先设置仅你本人知道的新密码。</p>
        <ChangePasswordForm />
      </section>
    </main>
  );
}
