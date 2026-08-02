import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError, resetAdminUserPassword } from "../../lib/api-client";
import { ResetPasswordDialog } from "./reset-password-dialog";

vi.mock("../../lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api-client")>();
  return { ...actual, resetAdminUserPassword: vi.fn() };
});

const resetPasswordMock = vi.mocked(resetAdminUserPassword);

const user = {
  id: "00000000-0000-4000-8000-000000000001",
  role: "USER" as const,
  displayName: "清和堂",
  phone: "13800138000",
  status: "ACTIVE" as const,
  mustChangePassword: true,
  version: 7,
  createdAt: "2026-08-02T00:00:00.000Z",
  updatedAt: "2026-08-02T00:00:00.000Z",
};

describe("ResetPasswordDialog", () => {
  beforeEach(() => {
    resetPasswordMock.mockReset();
  });

  it("submits the currently displayed user version", async () => {
    resetPasswordMock.mockResolvedValue({ temporaryPassword: "temporary-password" });
    const onReset = vi.fn().mockResolvedValue(undefined);

    render(createElement(ResetPasswordDialog, { user, onClose: vi.fn(), onReset }));
    fireEvent.click(screen.getByRole("button", { name: "确认重置" }));

    await waitFor(() => {
      expect(resetPasswordMock).toHaveBeenCalledWith(user.id, user.version);
    });
  });

  it("refreshes the existing list path after a version conflict", async () => {
    resetPasswordMock.mockRejectedValue(
      new ApiClientError({
        code: "USER_VERSION_CONFLICT",
        message: "用户已被其他管理员修改，请刷新后重试",
        requestId: "reset-conflict",
      }),
    );
    const onReset = vi.fn().mockResolvedValue(undefined);

    render(createElement(ResetPasswordDialog, { user, onClose: vi.fn(), onReset }));
    fireEvent.click(screen.getByRole("button", { name: "确认重置" }));

    await waitFor(() => {
      expect(onReset).toHaveBeenCalledTimes(1);
    });
  });
});
