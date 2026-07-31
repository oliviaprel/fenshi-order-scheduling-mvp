"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ApiClientError, changePassword } from "../../lib/api-client";

export function ChangePasswordForm() {
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
      await changePassword({
        currentPassword: String(data.get("currentPassword") ?? ""),
        newPassword: String(data.get("newPassword") ?? ""),
      });
      router.replace("/home");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "修改失败，请稍后重试");
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
        <label htmlFor="current-password">当前密码</label>
        <input
          id="current-password"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
        />
      </div>
      <div className="field">
        <label htmlFor="new-password">新密码</label>
        <input
          id="new-password"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          minLength={10}
          maxLength={72}
          aria-describedby="password-hint"
          required
        />
        <p className="field-hint" id="password-hint">使用 10–72 个字符。</p>
      </div>
      <button className="primary-button" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "修改中…" : "修改密码"}
      </button>
    </form>
  );
}
