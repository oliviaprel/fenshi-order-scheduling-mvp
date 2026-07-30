import { describe, expect, it } from "vitest";
import { runAdminCreation } from "./admin-cli";

describe("administrator CLI boundary", () => {
  it("refuses non-interactive input before collecting credentials", async () => {
    const output: string[] = [];
    const exitCode = await runAdminCreation({
      isInteractive: false,
      hasArguments: false,
      question: async () => {
        throw new Error("credentials must not be collected");
      },
      readHiddenPassword: async () => {
        throw new Error("password must not be collected");
      },
      write: (message) => output.push(message),
      writeError: (message) => output.push(message),
    });

    expect(exitCode).toBe(1);
    expect(output).toEqual(["Run this command interactively in a TTY without command-line arguments.\n"]);
  });

  it("refuses command-line arguments before collecting credentials", async () => {
    const output: string[] = [];
    const exitCode = await runAdminCreation({
      isInteractive: true,
      hasArguments: true,
      question: async () => {
        throw new Error("credentials must not be collected");
      },
      readHiddenPassword: async () => {
        throw new Error("password must not be collected");
      },
      write: (message) => output.push(message),
      writeError: (message) => output.push(message),
    });

    expect(exitCode).toBe(1);
    expect(output).toEqual(["Run this command interactively in a TTY without command-line arguments.\n"]);
  });
});
