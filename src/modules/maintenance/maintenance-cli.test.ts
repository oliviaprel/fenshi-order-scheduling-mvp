import { describe, expect, it, vi } from "vitest";
import { runMaintenanceScript } from "../../../scripts/run-maintenance";
import { runMaintenanceCli } from "./maintenance-cli";

describe("maintenance CLI", () => {
  it("writes exactly one JSON result and exits zero on success", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const result = {
      expiredSessions: 2,
      expiredReservations: 1,
      staleThrottles: 3,
      archivedAuditLogs: 4,
      archiveId: "archive-id",
    };

    const exitCode = await runMaintenanceCli({
      env: {
        NODE_ENV: "test",
        AUDIT_ARCHIVE_DIR: "unused-by-injected-executor",
        AUDIT_ARCHIVE_KEY: Buffer.alloc(32).toString("base64"),
      },
      now: new Date("2026-08-02T00:00:00.000Z"),
      execute: async () => result,
      write: (message) => stdout.push(message),
      writeError: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toEqual([`${JSON.stringify(result)}\n`]);
    expect(stderr).toEqual([]);
  });

  it("writes a safe JSON error and exits non-zero without leaking thrown secrets", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const secret = "raw-key-or-audit-record";

    const exitCode = await runMaintenanceCli({
      env: {
        NODE_ENV: "test",
        AUDIT_ARCHIVE_DIR: "unused-by-injected-executor",
        AUDIT_ARCHIVE_KEY: Buffer.alloc(32).toString("base64"),
      },
      now: new Date("2026-08-02T00:00:00.000Z"),
      execute: async () => {
        throw new Error(secret);
      },
      write: (message) => stdout.push(message),
      writeError: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([`${JSON.stringify({ error: "MAINTENANCE_FAILED" })}\n`]);
    expect(stderr.join("")).not.toContain(secret);
  });

  it("fails before database work when the archive key is malformed even if no rows need archiving", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let executed = false;

    const exitCode = await runMaintenanceCli({
      env: {
        NODE_ENV: "test",
        AUDIT_ARCHIVE_DIR: "configured-directory",
        AUDIT_ARCHIVE_KEY: "malformed-key",
      },
      now: new Date("2026-08-02T00:00:00.000Z"),
      execute: async () => {
        executed = true;
        return {
          expiredSessions: 0,
          expiredReservations: 0,
          staleThrottles: 0,
          archivedAuditLogs: 0,
          archiveId: null,
        };
      },
      write: (message) => stdout.push(message),
      writeError: (message) => stderr.push(message),
    });

    expect(exitCode).toBe(1);
    expect(executed).toBe(false);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual([`${JSON.stringify({ error: "MAINTENANCE_FAILED" })}\n`]);
  });
});

describe("maintenance script lifecycle", () => {
  it("returns one safe failure when database environment parsing fails before the client loads", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];
    vi.stubEnv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/fenshi_test");
    vi.stubEnv("APP_ORIGIN", "invalid-origin");

    try {
      await expect(
        runMaintenanceScript({
          env: {
            NODE_ENV: "test",
            DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/fenshi_test",
            AUDIT_ARCHIVE_DIR: "configured-directory",
            AUDIT_ARCHIVE_KEY: Buffer.alloc(32).toString("base64"),
          },
          stdout: { write: (message) => stdout.push(message) },
          stderr: { write: (message) => stderr.push(message) },
        }),
      ).resolves.toBe(1);
      expect(stdout).toEqual([]);
      expect(stderr).toEqual([`${JSON.stringify({ error: "MAINTENANCE_FAILED" })}\n`]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each([
    {
      exitCode: 0,
      output: `${JSON.stringify({
        expiredSessions: 0,
        expiredReservations: 0,
        staleThrottles: 0,
        archivedAuditLogs: 0,
        archiveId: null,
      })}\n`,
      stream: "stdout" as const,
    },
    {
      exitCode: 1,
      output: `${JSON.stringify({ error: "MAINTENANCE_FAILED" })}\n`,
      stream: "stderr" as const,
    },
  ])("preserves one $stream result when database disconnect fails", async (fixture) => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    await expect(
      runMaintenanceScript({
        env: { NODE_ENV: "test" },
        stdout: { write: (message) => stdout.push(message) },
        stderr: { write: (message) => stderr.push(message) },
        runCli: async (runtime: Parameters<typeof runMaintenanceCli>[0]) => {
          runtime.onDatabaseAccess?.();
          (fixture.stream === "stdout" ? runtime.write : runtime.writeError)(fixture.output);
          return fixture.exitCode;
        },
        disconnectDatabase: async () => {
          throw new Error("disconnect failed");
        },
      }),
    ).resolves.toBe(fixture.exitCode);
    expect(stdout).toEqual(fixture.stream === "stdout" ? [fixture.output] : []);
    expect(stderr).toEqual(fixture.stream === "stderr" ? [fixture.output] : []);
  });
});
