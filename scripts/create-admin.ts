import { createInterface } from "node:readline/promises";
import { runAdminCreation } from "../src/modules/users/admin-cli";

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

async function main(): Promise<void> {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  let databaseClientLoaded = false;

  try {
    process.exitCode = await runAdminCreation({
      isInteractive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
      hasArguments: process.argv.length !== 2,
      question: (prompt) => readline.question(prompt),
      readHiddenPassword: async () => {
        readline.close();
        return readHiddenPassword();
      },
      onDatabaseAccess: () => {
        databaseClientLoaded = true;
      },
      write: (message) => process.stdout.write(message),
      writeError: (message) => process.stderr.write(message),
    });
  } finally {
    readline.close();
    if (databaseClientLoaded) {
      const { prisma } = await import("../src/server/db/client");
      await prisma.$disconnect();
    }
  }
}

void main().catch(() => {
  console.error("Administrator creation failed.");
  process.exitCode = 1;
});
