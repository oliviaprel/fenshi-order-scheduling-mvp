import { describe, expect, it, vi } from "vitest";
import { runMaintenanceScript } from "../../../scripts/run-maintenance";
import { MaintenanceFailure, runMaintenanceCli } from "./maintenance-cli";

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

  it("classifies an untyped executor failure as DATABASE without leaking thrown secrets", async () => {
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
    expect(stdout).toEqual([`${JSON.stringify({ error: "MAINTENANCE_DATABASE" })}\n`]);
    expect(stderr).toEqual([]);
    expect(stdout.join("")).not.toContain(secret);
  });

  it("preserves an explicit archive failure classification without leaking details", async () => {
    const stdout: string[] = [];
    const secret = "archive-path-and-key";
    const exitCode = await runMaintenanceCli({
      env: {
        NODE_ENV: "test",
        AUDIT_ARCHIVE_DIR: "unused",
        AUDIT_ARCHIVE_KEY: Buffer.alloc(32).toString("base64"),
      },
      now: new Date(),
      execute: async () => {
        throw new MaintenanceFailure("ARCHIVE", { cause: new Error(secret) });
      },
      write: (message) => stdout.push(message),
      writeError: () => undefined,
    });
    expect(exitCode).toBe(1);
    expect(stdout).toEqual([`${JSON.stringify({ error: "MAINTENANCE_ARCHIVE" })}\n`]);
    expect(stdout.join("")).not.toContain(secret);
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
    expect(stdout).toEqual([`${JSON.stringify({ error: "MAINTENANCE_CONFIG" })}\n`]);
    expect(stderr).toEqual([]);
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
      expect(stdout).toEqual([`${JSON.stringify({ error: "MAINTENANCE_CONFIG" })}\n`]);
      expect(stderr).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("classifies a disconnect failure after otherwise successful maintenance", async () => {
    const stdout: string[] = [];
    const stderr: string[] = [];

    await expect(
      runMaintenanceScript({
        env: { NODE_ENV: "test" },
        stdout: { write: (message) => stdout.push(message) },
        stderr: { write: (message) => stderr.push(message) },
        runCli: async (runtime: Parameters<typeof runMaintenanceCli>[0]) => {
          runtime.onDatabaseAccess?.();
          runtime.write(`${JSON.stringify({ archiveId: null })}\n`);
          return 0;
        },
        disconnectDatabase: async () => {
          throw new Error("disconnect failed");
        },
      }),
    ).resolves.toBe(1);
    expect(stdout).toEqual([`${JSON.stringify({ error: "MAINTENANCE_DISCONNECT" })}\n`]);
    expect(stderr).toEqual([]);
  });

  it("does not replace the original classified failure when disconnect also fails", async () => {
    const stdout: string[] = [];
    await expect(runMaintenanceScript({
      env: { NODE_ENV: "test" }, stdout: { write: (m) => stdout.push(m) }, stderr: { write: () => undefined },
      runCli: async (runtime) => {
        runtime.onDatabaseAccess?.();
        runtime.write(`${JSON.stringify({ error: "MAINTENANCE_ARCHIVE" })}\n`);
        return 1;
      },
      disconnectDatabase: async () => { throw new Error("secret disconnect detail"); },
    })).resolves.toBe(1);
    expect(stdout).toEqual([`${JSON.stringify({ error: "MAINTENANCE_ARCHIVE" })}\n`]);
  });
});
