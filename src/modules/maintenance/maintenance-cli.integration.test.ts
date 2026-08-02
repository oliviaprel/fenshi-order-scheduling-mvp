import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../server/db/client";
import { resetTestDatabase } from "../../server/db/test-database";

type SubprocessResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

function runMaintenanceSubprocess(env: NodeJS.ProcessEnv): Promise<SubprocessResult> {
  const command = process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const args =
    process.platform === "win32"
      ? ["/d", "/s", "/c", "npm.cmd run --silent maintenance:daily"]
      : ["run", "--silent", "maintenance:daily"];
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
}

describe("maintenance npm command", () => {
  beforeEach(resetTestDatabase);
  afterAll(() => prisma.$disconnect());

  it("emits exactly one parseable stdout JSON line for success and safe failure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "fenshi-maintenance-command-"));
    const secret = "malformed-secret-archive-key";
    const baseEnv: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: "test",
      APP_ORIGIN: "http://localhost:3000",
      AUDIT_ARCHIVE_DIR: directory,
    };

    try {
      const success = await runMaintenanceSubprocess({
        ...baseEnv,
        AUDIT_ARCHIVE_KEY: randomBytes(32).toString("base64"),
      });
      expect(success.exitCode).toBe(0);
      expect(success.stderr).toBe("");
      expect(success.stdout.trimEnd().split(/\r?\n/)).toHaveLength(1);
      expect(JSON.parse(success.stdout)).toMatchObject({ archiveId: null });

      const failure = await runMaintenanceSubprocess({
        ...baseEnv,
        AUDIT_ARCHIVE_KEY: secret,
      });
      expect(failure.exitCode).toBe(1);
      expect(failure.stderr).not.toContain(secret);
      expect(failure.stdout.trimEnd().split(/\r?\n/)).toHaveLength(1);
      expect(JSON.parse(failure.stdout)).toEqual({ error: "MAINTENANCE_FAILED" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
