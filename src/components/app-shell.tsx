"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { logout } from "../lib/api-client";

export function AppShell({
  children,
  user,
}: Readonly<{
  children: React.ReactNode;
  user: { displayName: string; status: "ACTIVE" | "PAUSED" | "DISABLED" };
}>) {
  const router = useRouter();
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  async function handleLogout() {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await logout();
      router.replace("/login");
      router.refresh();
    } catch {
      setIsLoggingOut(false);
    }
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <a className="brand" href="/home" aria-label="焚烧订单排期系统首页">
          <span className="brand-mark small" aria-hidden="true">焚</span>
          <span>焚烧订单排期系统</span>
        </a>
        <div className="account-actions">
          <span className="account-name">{user.displayName}</span>
          <button className="secondary-button" type="button" onClick={handleLogout} disabled={isLoggingOut}>
            {isLoggingOut ? "退出中…" : "退出登录"}
          </button>
        </div>
      </header>
      {children}
    </div>
  );
}
