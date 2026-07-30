import { describe, expect, it } from "vitest";
import { runCreateAdminScript } from "../../../scripts/create-admin";

describe("create-admin script startup", () => {
  it("does not initialize readline before rejecting non-interactive input", async () => {
    let readlineCreated = false;
    const output: string[] = [];

    const exitCode = await runCreateAdminScript({
      stdin: { isTTY: false },
      stdout: { isTTY: false, write: (message: string) => output.push(message) },
      stderr: { write: (message: string) => output.push(message) },
      argv: ["node", "scripts/create-admin.ts"],
      createReadline: () => {
        readlineCreated = true;
        throw new Error("readline must not be initialized");
      },
    });

    expect(exitCode).toBe(1);
    expect(readlineCreated).toBe(false);
    expect(output).toEqual(["Run this command interactively in a TTY without command-line arguments.\n"]);
  });
});
