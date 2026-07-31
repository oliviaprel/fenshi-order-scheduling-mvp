"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ApiClientError,
  createAdminUser,
  updateAdminUser,
  type ManagedUserDto,
} from "../../lib/api-client";
import { ModalDialog } from "../ui/modal-dialog";

type UserFormDialogProps = {
  user: ManagedUserDto | null;
  onClose: () => void;
  onSaved: (user: ManagedUserDto) => void | Promise<void>;
  onRefresh: () => Promise<void>;
};

export function UserFormDialog({ user, onClose, onSaved, onRefresh }: Readonly<UserFormDialogProps>) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(null);
  const [pendingDisabledInput, setPendingDisabledInput] = useState<{
    displayName: string;
    phone: string;
    status: ManagedUserDto["status"];
    version: number;
  } | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const isEditing = user !== null;

  useEffect(() => {
    if (error !== null) errorRef.current?.focus();
  }, [error]);

  function closeAndForget() {
    setTemporaryPassword(null);
    setPendingDisabledInput(null);
    setError(null);
    onClose();
  }

  async function refreshAfterConflict() {
    closeAndForget();
    await onRefresh();
  }

  async function saveEdit(input: NonNullable<typeof pendingDisabledInput>) {
    if (user === null) return;
    setIsSubmitting(true);
    setError(null);
    try {
      const updated = await updateAdminUser(user.id, input);
      await onSaved(updated);
      closeAndForget();
    } catch (caught) {
      setPendingDisabledInput(null);
      if (caught instanceof ApiClientError && caught.code === "USER_VERSION_CONFLICT") {
        setError("该用户已被其他管理员修改，请刷新后重试");
      } else {
        setError(caught instanceof ApiClientError ? caught.message : "保存失败，请稍后重试");
      }
      setIsSubmitting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    const data = new FormData(event.currentTarget);
    const input = {
      displayName: String(data.get("displayName") ?? ""),
      phone: String(data.get("phone") ?? ""),
    };

    if (user !== null) {
      const editInput = {
        ...input,
        status: String(data.get("status")) as ManagedUserDto["status"],
        version: user.version,
      };
      if (editInput.status === "DISABLED" && user.status !== "DISABLED") {
        setPendingDisabledInput(editInput);
        return;
      }
      await saveEdit(editInput);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    try {
      const created = await createAdminUser(input);
      await onSaved(created.user);
      setTemporaryPassword(created.temporaryPassword);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "创建失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  }

  if (temporaryPassword !== null) {
    return (
      <ModalDialog key="created-secret" labelledBy="password-title" onDismiss={closeAndForget}>
          <p className="eyebrow">安全信息</p>
          <h2 id="password-title">临时密码仅显示一次</h2>
          <p>请立即通过安全方式交给用户，关闭后无法再次查看。</p>
          <code className="temporary-password" aria-label="临时密码">{temporaryPassword}</code>
          <div className="dialog-actions">
            <button className="primary-button" type="button" onClick={closeAndForget}>我已保存</button>
          </div>
      </ModalDialog>
    );
  }

  if (pendingDisabledInput !== null) {
    return (
      <ModalDialog key="edit-disable-confirmation" role="alertdialog" labelledBy="disable-from-edit-title" onDismiss={() => setPendingDisabledInput(null)}>
          <h2 id="disable-from-edit-title">确认禁用{pendingDisabledInput.displayName}吗？</h2>
          <p>禁用后，该用户的所有现有登录会话会立即失效。</p>
          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={() => setPendingDisabledInput(null)}>取消</button>
            <button className="danger-button" type="button" disabled={isSubmitting} onClick={() => void saveEdit(pendingDisabledInput)}>确认禁用</button>
          </div>
      </ModalDialog>
    );
  }

  return (
    <ModalDialog key="user-form" labelledBy="user-form-title" onDismiss={closeAndForget}>
        <p className="eyebrow">{isEditing ? "账户资料" : "创建账户"}</p>
        <h2 id="user-form-title">{isEditing ? `编辑${user.displayName}` : "新增用户"}</h2>
        {error === null ? null : (
          <div className="error-summary list-error" role="alert" tabIndex={-1} ref={errorRef}>
            <span>{error}</span>
            {error === "该用户已被其他管理员修改，请刷新后重试" ? (
              <button className="text-button" type="button" onClick={() => void refreshAfterConflict()}>刷新列表</button>
            ) : null}
          </div>
        )}
        <form className="admin-form" onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="managed-display-name">账户名称</label>
            <input id="managed-display-name" name="displayName" defaultValue={user?.displayName ?? ""} maxLength={50} required autoFocus />
          </div>
          <div className="field">
            <label htmlFor="managed-phone">手机号</label>
            <input id="managed-phone" name="phone" type="tel" inputMode="numeric" defaultValue={user?.phone ?? ""} required />
          </div>
          {user === null ? null : (
            <div className="field">
              <label htmlFor="managed-status">状态</label>
              <select id="managed-status" name="status" defaultValue={user.status}>
                <option value="ACTIVE">正常</option>
                <option value="PAUSED">已暂停</option>
                <option value="DISABLED">已禁用</option>
              </select>
            </div>
          )}
          <div className="dialog-actions">
            <button className="secondary-button" type="button" onClick={closeAndForget}>取消</button>
            <button className="primary-button" type="submit" disabled={isSubmitting}>
              {isSubmitting ? "提交中…" : isEditing ? "保存修改" : "确认创建"}
            </button>
          </div>
        </form>
    </ModalDialog>
  );
}
