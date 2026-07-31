import { redirect } from "next/navigation";
import { getCurrentUser } from "../../../server/auth/current-user";

const statusLabels = {
  ACTIVE: "正常",
  PAUSED: "已暂停",
  DISABLED: "已停用",
} as const;

export default async function UserHomePage() {
  const user = await getCurrentUser();
  if (user === null) {
    redirect("/login");
  }
  if (user.mustChangePassword) {
    redirect("/change-password");
  }

  return (
    <main className="home-content">
      <p className="eyebrow">用户首页</p>
      <h1>{user.displayName}</h1>
      <div className="status-row">
        <span>账户状态</span>
        <strong className={`status-badge status-${user.status.toLowerCase()}`}>
          {statusLabels[user.status]}
        </strong>
      </div>
      <section className="empty-state" aria-labelledby="orders-heading">
        <div className="empty-state-icon" aria-hidden="true">排</div>
        <h2 id="orders-heading">订单功能将在下一阶段开放</h2>
        <p>当前可先完成账户登录与安全设置。</p>
      </section>
    </main>
  );
}
