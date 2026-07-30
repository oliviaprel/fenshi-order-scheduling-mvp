import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import { runAdminCreation } from "../src/modules/users/admin-cli";

type ScriptRuntime = {
  stdin: { isTTY?: boolean };
  stdout: { isTTY?: boolean; write: (message: string) => unknown };
  stderr: { write: (message: string) => unknown };
  argv: readonly string[];
  createReadline: () => ReturnType<typeof createInterface>;
};

async function readHiddenPassword(): Promise<string> {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Password input requires an interactive TTY.");
  }

  process.stdout.write("Password: ");
  process.stdin.setRawMode(true);
  process.stdin.resume();

  return new Promise((resolve, reject) => {
    let password = "";

    const onData = (chunk: Buffer) => {
      const input = chunk.toString("utf8");

      for (const character of input) {
        if (character === "\r" || character === "\n") {
          cleanup();
          process.stdout.write("\n");
          resolve(password);
          return;
        }
        if (character === "\u0003") {
          cleanup();
          reject(new Error("Input cancelled."));
          return;
        }
        if (character === "\b" || character === "\u007f") {
          password = password.slice(0, -1);
          continue;
        }
        if (character >= " ") {
          password += character;
        }
      }
    };

    const cleanup = () => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
    };

    process.stdin.on("data", onData);
  });
}

export async function runCreateAdminScript(runtime: ScriptRuntime): Promise<number> {
  const isInteractive = Boolean(runtime.stdin.isTTY && runtime.stdout.isTTY);
  const hasArguments = runtime.argv.length !== 2;

  if (!isInteractive || hasArguments) {
    return runAdminCreation({
      isInteractive,
      hasArguments,
      question: async () => "",
      readHiddenPassword: async () => "",
      write: (message) => runtime.stdout.write(message),
      writeError: (message) => runtime.stderr.write(message),
    });
  }

  const readline = runtime.createReadline();
  let databaseClientLoaded = false;

  try {
    return await runAdminCreation({
      isInteractive,
      hasArguments,
      question: (prompt) => readline.question(prompt),
      readHiddenPassword: async () => {
        readline.close();
        return readHiddenPassword();
      },
      onDatabaseAccess: () => {
        databaseClientLoaded = true;
      },
      write: (message) => runtime.stdout.write(message),
      writeError: (message) => runtime.stderr.write(message),
    });
  } finally {
    readline.close();
    if (databaseClientLoaded) {
      const { prisma } = await import("../src/server/db/client");
      await prisma.$disconnect();
    }
  }
}

async function main(): Promise<void> {
  process.exitCode = await runCreateAdminScript({
    stdin: process.stdin,
    stdout: process.stdout,
    stderr: process.stderr,
    argv: process.argv,
    createReadline: () => createInterface({ input: process.stdin, output: process.stdout }),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(() => {
    console.error("Administrator creation failed.");
    process.exitCode = 1;
  });
}
