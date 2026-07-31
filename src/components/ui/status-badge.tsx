import type { ManagedUserDto } from "../../lib/api-client";

export const USER_STATUS_LABELS = {
  ACTIVE: "正常",
  PAUSED: "已暂停",
  DISABLED: "已禁用",
} as const;

export function StatusBadge({ status }: Readonly<{ status: ManagedUserDto["status"] }>) {
  return (
    <strong className={`status-badge status-${status.toLowerCase()}`}>
      {USER_STATUS_LABELS[status]}
    </strong>
  );
}
