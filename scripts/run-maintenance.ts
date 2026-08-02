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
  const bufferedOutput: string[] = [];
  let exitCode = 1;
  let disconnectFailed = false;
  try {
    exitCode = await (runtime.runCli ?? runMaintenanceCli)({
      env: runtime.env,
      now: new Date(),
      onDatabaseAccess: () => {
        databaseClientLoaded = true;
      },
      write: (message) => bufferedOutput.push(message),
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
        disconnectFailed = true;
      }
    }
  }
  if (exitCode === 0 && disconnectFailed) {
    runtime.stdout.write(`${JSON.stringify({ error: "MAINTENANCE_DISCONNECT" })}\n`);
    return 1;
  }
  runtime.stdout.write(bufferedOutput[0] ?? `${JSON.stringify({ error: "MAINTENANCE_CONFIG" })}\n`);
  return exitCode;
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
    process.stdout.write(`${JSON.stringify({ error: "MAINTENANCE_CONFIG" })}\n`);
    process.exitCode = 1;
  });
}
