"use client";

import { useState, type FormEvent } from "react";
import {
  ApiClientError,
  listAdminUsers,
  updateAdminUser,
  type ManagedUserDto,
  type ManagedUserList,
} from "../../lib/api-client";
import { StatusBadge } from "../ui/status-badge";
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

export function UserList({ initialData }: Readonly<{ initialData: ManagedUserList }>) {
  const [data, setData] = useState(initialData);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [currentCursor, setCurrentCursor] = useState<string | null>(null);
  const [cursorHistory, setCursorHistory] = useState<Array<string | null>>([]);
  const [editingUser, setEditingUser] = useState<ManagedUserDto | null | undefined>(undefined);
  const [resetUser, setResetUser] = useState<ManagedUserDto | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function load(nextQuery: string, cursor: string | null) {
    setIsLoading(true);
    setError(null);
    try {
      const result = await listAdminUsers({
        ...(nextQuery.length === 0 ? {} : { query: nextQuery }),
        ...(cursor === null ? {} : { cursor }),
        limit: PAGE_SIZE,
      });
      setData(result);
      setActiveQuery(nextQuery);
      setCurrentCursor(cursor);
    } catch (caught) {
      setError(caught instanceof ApiClientError ? caught.message : "加载失败，请稍后重试");
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshCurrent() {
    await load(activeQuery, currentCursor);
  }

  async function handleSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCursorHistory([]);
    await load(query.trim(), null);
  }

  async function handleNext() {
    if (data.nextCursor === null) return;
    const nextCursor = data.nextCursor;
    setCursorHistory((history) => [...history, currentCursor]);
    await load(activeQuery, nextCursor);
  }

  async function handlePrevious() {
    const previousCursor = cursorHistory.at(-1);
    if (previousCursor === undefined) return;
    setCursorHistory((history) => history.slice(0, -1));
    await load(activeQuery, previousCursor);
  }

  function mergeUser(user: ManagedUserDto) {
    setData((current) => {
      const existing = current.items.some((item) => item.id === user.id);
      return {
        ...current,
        items: existing
          ? current.items.map((item) => (item.id === user.id ? user : item))
          : [user, ...current.items].slice(0, PAGE_SIZE),
      };
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
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.code === "USER_VERSION_CONFLICT") {
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
        <div className="error-summary list-error" role="alert">
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
          onSaved={mergeUser}
          onRefresh={refreshCurrent}
        />
      )}
      {resetUser === null ? null : (
        <ResetPasswordDialog user={resetUser} onClose={() => setResetUser(null)} onReset={refreshCurrent} />
      )}
      {confirmation === null ? null : (
        <div className="dialog-backdrop" role="presentation">
          <section className="admin-dialog" role="alertdialog" aria-modal="true" aria-labelledby="disable-title">
            <h2 id="disable-title">确认禁用{confirmation.user.displayName}吗？</h2>
            <p>禁用后，该用户的所有现有登录会话会立即失效。</p>
            <div className="dialog-actions">
              <button className="secondary-button" type="button" onClick={() => setConfirmation(null)}>取消</button>
              <button className="danger-button" type="button" disabled={isLoading} onClick={() => void disableUser(confirmation.user)}>确认禁用</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
