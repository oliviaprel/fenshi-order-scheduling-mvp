import { pathToFileURL } from "node:url";
import { runMaintenanceCli } from "../src/modules/maintenance/maintenance-cli";

type MaintenanceScriptRuntime = {
  env: NodeJS.ProcessEnv;
  stdout: { write(message: string): unknown };
  stderr: { write(message: string): unknown };
  runCli?: typeof runMaintenanceCli;
  disconnectDatabase?: () => Promise<void>;
};

export async function runMaintenanceScript(runtime: MaintenanceScriptRuntime): Promise<number> {
  let databaseClientLoaded = false;
  try {
    return await (runtime.runCli ?? runMaintenanceCli)({
      env: runtime.env,
      now: new Date(),
      onDatabaseAccess: () => {
        databaseClientLoaded = true;
      },
      write: (message) => runtime.stdout.write(message),
      writeError: (message) => runtime.stderr.write(message),
    });
  } finally {
    if (databaseClientLoaded) {
      try {
        if (runtime.disconnectDatabase) {
          await runtime.disconnectDatabase();
        } else {
          const { prisma } = await import("../src/server/db/client");
          await prisma.$disconnect();
        }
      } catch {
        // Maintenance has already completed and emitted its single result.
        // Process exit releases a pool that could not be cleanly disconnected.
      }
    }
  }
}

async function main(): Promise<void> {
  process.exitCode = await runMaintenanceScript({
    env: process.env,
    stdout: process.stdout,
    stderr: process.stderr,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => {
    process.stderr.write(`${JSON.stringify({ error: "MAINTENANCE_FAILED" })}\n`);
    process.exitCode = 1;
  });
}
