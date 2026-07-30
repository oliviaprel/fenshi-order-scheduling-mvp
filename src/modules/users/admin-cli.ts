import { ApiError } from "../../server/http/api-error";

export type AdminCliIo = {
  isInteractive: boolean;
  hasArguments: boolean;
  question: (prompt: string) => Promise<string>;
  readHiddenPassword: () => Promise<string>;
  onDatabaseAccess?: () => void;
  write: (message: string) => void;
  writeError: (message: string) => void;
};

const interactiveOnlyMessage = "Run this command interactively in a TTY without command-line arguments.\n";

export async function runAdminCreation(io: AdminCliIo): Promise<number> {
  if (!io.isInteractive || io.hasArguments) {
    io.writeError(interactiveOnlyMessage);
    return 1;
  }

  try {
    const displayName = await io.question("Display name: ");
    const phone = await io.question("Phone: ");
    const password = await io.readHiddenPassword();
    io.onDatabaseAccess?.();
    const { createAdmin } = await import("./user.service");
    const admin = await createAdmin({ displayName, phone, password }, { requestId: "cli-admin-create" });

    io.write(`${admin.id} ${admin.displayName} ${admin.phone}\n`);
    return 0;
  } catch (error) {
    io.writeError(`${error instanceof ApiError ? error.code : "Administrator creation failed."}\n`);
    return 1;
  }
}
