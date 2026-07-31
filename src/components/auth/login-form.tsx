"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiClientError, login } from "../../lib/api-client";

export function LoginForm() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error !== null) {
      errorRef.current?.focus();
    }
  }, [error]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    const data = new FormData(event.currentTarget);

    try {
      const user = await login({
        phone: String(data.get("phone") ?? ""),
        password: String(data.get("password") ?? ""),
      });
      router.replace(user.mustChangePassword ? "/change-password" : "/home");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "登录失败，请稍后重试");
      setIsSubmitting(false);
    }
  }

  return (
    <form className="auth-form" method="post" onSubmit={handleSubmit} noValidate>
      {error === null ? null : (
        <div className="error-summary" role="alert" tabIndex={-1} ref={errorRef}>
          {error}
        </div>
      )}
      <div className="field">
        <label htmlFor="phone">手机号</label>
        <input id="phone" name="phone" type="tel" inputMode="numeric" autoComplete="tel" required />
      </div>
      <div className="field">
        <label htmlFor="password">密码</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <button className="primary-button" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "登录中…" : "登录"}
      </button>
    </form>
  );
}
