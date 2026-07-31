"use client";

import { useState } from "react";
import {
  ApiClientError,
  resetAdminUserPassword,
  type ManagedUserDto,
} from "../../lib/api-client";
import { ModalDialog } from "../ui/modal-dialog";

export function ResetPasswordDialog({
  user,
  onClose,
  onReset,
}: Readonly<{
  user: ManagedUserDto;
  onClose: () => void;
  onReset: () => Promise<void>;
}>) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);

  function closeAndForget() {
    setTemporaryPassword(null);
    setError(null);
    onClose();
  }

  async function handleReset() {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await resetAdminUserPassword(user.id);
      await onReset();
      setTemporaryPassword(result.temporaryPassword);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "重置失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <ModalDialog
        key={temporaryPassword === null ? "reset-confirmation" : "reset-secret"}
        role={temporaryPassword === null ? "alertdialog" : "dialog"}
        labelledBy="reset-password-title"
        onDismiss={closeAndForget}
        dismissible={!isSubmitting}
    >
        {temporaryPassword === null ? (
          <>
            <h2 id="reset-password-title">确认重置{user.displayName}的密码吗？</h2>
            <p>确认后旧密码和现有登录会话将立即失效。</p>
            {error === null ? null : <div className="error-summary" role="alert">{error}</div>}
            <div className="dialog-actions">
              <button className="secondary-button" type="button" disabled={isSubmitting} onClick={closeAndForget}>取消</button>
              <button className="primary-button" type="button" disabled={isSubmitting} onClick={() => void handleReset()}>
                {isSubmitting ? "重置中…" : "确认重置"}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="eyebrow">安全信息</p>
            <h2 id="reset-password-title">临时密码仅显示一次</h2>
            <p>请立即通过安全方式交给用户，关闭后无法再次查看。</p>
            <code className="temporary-password" aria-label="临时密码">{temporaryPassword}</code>
            <div className="dialog-actions">
              <button className="primary-button" type="button" onClick={closeAndForget}>我已保存</button>
            </div>
          </>
        )}
    </ModalDialog>
  );
}
