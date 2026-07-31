"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ApiClientError,
  listAdminUsers,
  updateAdminUser,
  type ManagedUserDto,
  type ManagedUserList,
} from "../../lib/api-client";
import { StatusBadge } from "../ui/status-badge";
import { ModalDialog } from "../ui/modal-dialog";
import { ResetPasswordDialog } from "./reset-password-dialog";
import { UserFormDialog } from "./user-form-dialog";

const PAGE_SIZE = 10;

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai",
  }).format(new Date(value));
}

type Confirmation = { kind: "disable"; user: ManagedUserDto } | null;

type ListView = {
  data: ManagedUserList;
  activeQuery: string;
  currentCursor: string | null;
  cursorHistory: Array<string | null>;
};

export function UserList({ initialData }: Readonly<{ initialData: ManagedUserList }>) {
  const [listView, setListView] = useState<ListView>({
    data: initialData,
    activeQuery: "",
    currentCursor: null,
    cursorHistory: [],
  });
  const [query, setQuery] = useState("");
  const [editingUser, setEditingUser] = useState<ManagedUserDto | null | undefined>(undefined);
  const [resetUser, setResetUser] = useState<ManagedUserDto | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const { data, activeQuery, currentCursor, cursorHistory } = listView;

  useEffect(() => {
    if (error !== null) errorRef.current?.focus();
  }, [error]);

  async function fetchList(nextQuery: string, cursor: string | null): Promise<ManagedUserList | null> {
    setIsLoading(true);
    setError(null);
    try {
      return await listAdminUsers({
        ...(nextQuery.length === 0 ? {} : { query: nextQuery }),
        ...(cursor === null ? {} : { cursor }),
        limit: PAGE_SIZE,
      });
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "加载失败，请稍后重试");
      return null;
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshCurrent(): Promise<boolean> {
    const result = await fetchList(activeQuery, currentCursor);
    if (result === null) return false;
    setListView((current) => ({ ...current, data: result }));
    return true;
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextQuery = query.trim();
    const result = await fetchList(nextQuery, null);
    if (result === null) return;
    setListView({ data: result, activeQuery: nextQuery, currentCursor: null, cursorHistory: [] });
  }

  async function handleNext() {
    if (data.nextCursor === null) return;
    const nextCursor = data.nextCursor;
    const result = await fetchList(activeQuery, nextCursor);
    if (result === null) return;
    setListView((current) => ({
      ...current,
      data: result,
      currentCursor: nextCursor,
      cursorHistory: [...current.cursorHistory, currentCursor],
    }));
  }

  async function handlePrevious() {
    const previousCursor = cursorHistory.at(-1);
    if (previousCursor === undefined) return;
    const result = await fetchList(activeQuery, previousCursor);
    if (result === null) return;
    setListView((current) => ({
      ...current,
      data: result,
      currentCursor: previousCursor,
      cursorHistory: current.cursorHistory.slice(0, -1),
    }));
  }

  function mergeUser(user: ManagedUserDto) {
    setListView((current) => {
      const existing = current.data.items.some((item) => item.id === user.id);
      return {
        ...current,
        data: {
          ...current.data,
          items: existing
            ? current.data.items.map((item) => (item.id === user.id ? user : item))
            : current.data.items,
        },
      };
    });
  }

  async function handleSavedUser() {
    await refreshCurrent();
  }

  async function refreshCurrentForDialog() {
    await refreshCurrent();
  }

  function focusVisibleEditAction(displayName: string) {
    requestAnimationFrame(() => {
      const editAction = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) =>
          button.getAttribute("aria-label") === `编辑${displayName}` && button.offsetParent !== null,
      );
      editAction?.focus();
    });
  }

  async function disableUser(user: ManagedUserDto) {
    setIsLoading(true);
    setError(null);
    try {
      const updated = await updateAdminUser(user.id, {
        displayName: user.displayName,
        phone: user.phone,
        status: "DISABLED",
        version: user.version,
      });
      mergeUser(updated);
      setConfirmation(null);
      focusVisibleEditAction(updated.displayName);
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.code === "USER_VERSION_CONFLICT") {
        setConfirmation(null);
        setError("该用户已被其他管理员修改，请刷新后重试");
      } else {
        setError(caught instanceof ApiClientError ? caught.message : "禁用失败，请稍后重试");
      }
    } finally {
      setIsLoading(false);
    }
  }

  const actionButtons = (user: ManagedUserDto) => (
    <div className="user-actions">
      <button className="text-button" type="button" aria-label={`编辑${user.displayName}`} onClick={() => setEditingUser(user)}>编辑</button>
      <button className="text-button" type="button" aria-label={`重置${user.displayName}密码`} onClick={() => setResetUser(user)}>重置密码</button>
      {user.status === "DISABLED" ? null : (
        <button className="text-button danger-text" type="button" aria-label={`禁用${user.displayName}`} onClick={() => setConfirmation({ kind: "disable", user })}>禁用</button>
      )}
    </div>
  );

  return (
    <>
      <div className="admin-toolbar">
        <form className="search-form" role="search" onSubmit={handleSearch}>
          <label className="sr-only" htmlFor="user-search">搜索用户</label>
          <input id="user-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="姓名或手机号" />
          <button className="secondary-button" type="submit" disabled={isLoading}>搜索</button>
        </form>
        <button className="primary-button add-user-button" type="button" onClick={() => setEditingUser(null)}>新增用户</button>
      </div>

      {error === null ? null : (
        <div className="error-summary list-error" role="alert" tabIndex={-1} ref={errorRef}>
          <span>{error}</span>
          {error.includes("刷新") ? <button className="text-button" type="button" onClick={() => void refreshCurrent()}>刷新列表</button> : null}
        </div>
      )}

      {data.items.length === 0 ? (
        <section className="empty-user-list"><h2>没有找到用户</h2><p>请调整搜索条件，或创建一个普通用户。</p></section>
      ) : (
        <>
          <div className="desktop-user-table">
            <table>
              <thead><tr><th scope="col">账户</th><th scope="col">手机号</th><th scope="col">状态</th><th scope="col">创建时间</th><th scope="col">最后更新</th><th scope="col">操作</th></tr></thead>
              <tbody>
                {data.items.map((user) => (
                  <tr key={user.id}>
                    <th scope="row">{user.displayName}</th><td>{user.phone}</td><td><StatusBadge status={user.status} /></td><td>{formatDate(user.createdAt)}</td><td>{formatDate(user.updatedAt)}</td><td>{actionButtons(user)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mobile-user-cards">
            {data.items.map((user) => (
              <article className="user-card" key={user.id} aria-label={`${user.displayName} ${user.phone} ${user.status === "ACTIVE" ? "正常" : user.status === "PAUSED" ? "已暂停" : "已禁用"}`}>
                <div className="user-card-heading"><h2>{user.displayName}</h2><StatusBadge status={user.status} /></div>
                <p className="user-phone">{user.phone}</p>
                <dl><div><dt>创建时间</dt><dd>{formatDate(user.createdAt)}</dd></div><div><dt>最后更新</dt><dd>{formatDate(user.updatedAt)}</dd></div></dl>
                {actionButtons(user)}
              </article>
            ))}
          </div>
        </>
      )}

      <nav className="pagination" aria-label="用户列表分页">
        <button className="secondary-button" type="button" disabled={isLoading || cursorHistory.length === 0} onClick={() => void handlePrevious()}>上一页</button>
        <button className="secondary-button" type="button" disabled={isLoading || data.nextCursor === null} onClick={() => void handleNext()}>下一页</button>
      </nav>

      {editingUser === undefined ? null : (
        <UserFormDialog
          user={editingUser}
          onClose={() => setEditingUser(undefined)}
          onSaved={handleSavedUser}
          onRefresh={refreshCurrentForDialog}
        />
      )}
      {resetUser === null ? null : (
        <ResetPasswordDialog user={resetUser} onClose={() => setResetUser(null)} onReset={refreshCurrentForDialog} />
      )}
      {confirmation === null ? null : (
        <ModalDialog role="alertdialog" labelledBy="disable-title" onDismiss={() => setConfirmation(null)} dismissible={!isLoading}>
            <h2 id="disable-title">确认禁用{confirmation.user.displayName}吗？</h2>
            <p>禁用后，该用户的所有现有登录会话会立即失效。</p>
            <div className="dialog-actions">
              <button className="secondary-button" type="button" disabled={isLoading} onClick={() => setConfirmation(null)}>取消</button>
              <button className="danger-button" type="button" disabled={isLoading} onClick={() => void disableUser(confirmation.user)}>确认禁用</button>
            </div>
        </ModalDialog>
      )}
    </>
  );
}
