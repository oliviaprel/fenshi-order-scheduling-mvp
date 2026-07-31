import { forbidden } from "next/navigation";
import { UserList } from "../../../../components/admin/user-list";
import { listManagedUsers } from "../../../../modules/users/admin-user.service";
import { requireAdmin } from "../../../../server/auth/guards";
import { ApiError } from "../../../../server/http/api-error";

const PAGE_SIZE = 10;

export default async function AdminUsersPage() {
  try {
    await requireAdmin();
  } catch (error) {
    if (error instanceof ApiError && error.code === "ADMIN_REQUIRED") {
      forbidden();
    }
    throw error;
  }
  const initial = await listManagedUsers({ limit: PAGE_SIZE });
  const initialData = {
    items: initial.items.map((user) => ({
      ...user,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
    })),
    nextCursor: initial.nextCursor,
  };

  return (
    <main className="admin-users-page">
      <header className="admin-page-heading">
        <div>
          <p className="eyebrow">管理员工作台</p>
          <h1>用户管理</h1>
          <p className="lede">创建普通用户，维护账户状态，并安全重置临时密码。</p>
        </div>
      </header>
      <UserList initialData={initialData} />
    </main>
  );
}
