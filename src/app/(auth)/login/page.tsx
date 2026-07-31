import { redirect } from "next/navigation";
import { LoginForm } from "../../../components/auth/login-form";
import { getCurrentUser } from "../../../server/auth/current-user";

export default async function LoginPage() {
  const user = await getCurrentUser();
  if (user?.mustChangePassword) {
    redirect("/change-password");
  }
  if (user !== null) {
    redirect("/home");
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="login-title">
        <div className="brand-mark" aria-hidden="true">焚</div>
        <p className="eyebrow">焚烧订单排期系统</p>
        <h1 id="login-title">登录</h1>
        <p className="lede">使用已分配的手机号和密码进入系统。</p>
        <LoginForm />
      </section>
    </main>
  );
}
