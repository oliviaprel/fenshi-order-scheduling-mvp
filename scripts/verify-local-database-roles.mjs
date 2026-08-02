import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import net from "node:net";

import pg from "pg";

const { Client } = pg;
const composeFile = "compose.dev.yaml";
const projectName = `fenshi-role-smoke-${process.pid}-${Date.now()}`.toLowerCase();

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: options.capture ? "pipe" : "inherit",
    env: options.env ?? process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stdout}${result.stderr}` : "";
    throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}${detail}`);
  }
  return result.stdout?.trim() ?? "";
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen({ host: "127.0.0.1", port: 0 }, () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function requestedPort() {
  if (!process.env.POSTGRES_PORT) return undefined;
  const port = Number(process.env.POSTGRES_PORT);
  assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, "POSTGRES_PORT must be a valid unprivileged port");
  assert.notEqual(port, 5432, "split-role smoke must not collide with the primary PostgreSQL service");
  return port;
}

async function expectPermissionDenied(client, statement, description) {
  await assert.rejects(
    client.query(statement),
    (error) => error?.code === "42501",
    `${description} must fail with PostgreSQL insufficient_privilege (42501)`,
  );
}

async function verifyRuntimeRole(port) {
  const client = new Client({
    connectionString: `postgresql://fenshi_app:fenshi_app_dev@127.0.0.1:${port}/fenshi`,
  });
  await client.connect();
  const id = randomUUID();
  const phone = `1${String(Date.now()).slice(-10)}`;
  try {
    const roles = await client.query(
      `SELECT rolname, rolsuper, rolcreatedb, rolcreaterole
         FROM pg_roles
        WHERE rolname IN ('fenshi_app', 'fenshi_migrator')
        ORDER BY rolname`,
    );
    assert.deepEqual(roles.rows, [
      { rolname: "fenshi_app", rolsuper: false, rolcreatedb: false, rolcreaterole: false },
      { rolname: "fenshi_migrator", rolsuper: false, rolcreatedb: false, rolcreaterole: false },
    ]);

    const inserted = await client.query(
      `INSERT INTO "User"
        (id, role, "displayName", phone, "passwordHash", status, "mustChangePassword", version, "createdAt", "updatedAt")
       VALUES ($1, 'USER', 'Role smoke user', $2, 'not-a-real-password-hash', 'ACTIVE', false, 1, NOW(), NOW())
       RETURNING id`,
      [id, phone],
    );
    assert.equal(inserted.rows[0].id, id);

    const selected = await client.query(`SELECT "displayName" FROM "User" WHERE id = $1`, [id]);
    assert.equal(selected.rows[0].displayName, "Role smoke user");

    const updated = await client.query(
      `UPDATE "User" SET "displayName" = 'Role smoke updated', "updatedAt" = NOW() WHERE id = $1 RETURNING "displayName"`,
      [id],
    );
    assert.equal(updated.rows[0].displayName, "Role smoke updated");

    const deleted = await client.query(`DELETE FROM "User" WHERE id = $1 RETURNING id`, [id]);
    assert.equal(deleted.rows[0].id, id);

    await expectPermissionDenied(
      client,
      "CREATE TABLE role_smoke_must_fail (id integer)",
      "permanent DDL",
    );
    await expectPermissionDenied(
      client,
      "CREATE TEMP TABLE role_smoke_temp_must_fail (id integer)",
      "temporary DDL",
    );
    const migrationPrivileges = await client.query(`
      SELECT
        has_table_privilege(current_user, '"_prisma_migrations"', 'SELECT') AS "select",
        has_table_privilege(current_user, '"_prisma_migrations"', 'INSERT') AS "insert",
        has_table_privilege(current_user, '"_prisma_migrations"', 'UPDATE') AS "update",
        has_table_privilege(current_user, '"_prisma_migrations"', 'DELETE') AS "delete"
    `);
    assert.deepEqual(migrationPrivileges.rows[0], {
      select: false,
      insert: false,
      update: false,
      delete: false,
    });
  } finally {
    await client.query(`DELETE FROM "User" WHERE id = $1`, [id]).catch(() => undefined);
    await client.end();
  }
}

const port = requestedPort() ?? await findFreePort();
const composeArgs = ["compose", "--project-name", projectName, "--file", composeFile];
const smokeEnv = { ...process.env, POSTGRES_PORT: String(port) };

console.log(`Starting isolated split-role database project ${projectName} on 127.0.0.1:${port}.`);
try {
  run("docker", [...composeArgs, "up", "--detach", "--wait", "--wait-timeout", "120"], { env: smokeEnv });

  run(process.execPath, ["node_modules/prisma/build/index.js", "migrate", "deploy"], {
    env: {
      ...smokeEnv,
      MIGRATION_DATABASE_URL: `postgresql://fenshi_migrator:fenshi_migrator_dev@127.0.0.1:${port}/fenshi`,
    },
  });

  const migrator = new Client({
    connectionString: `postgresql://fenshi_migrator:fenshi_migrator_dev@127.0.0.1:${port}/fenshi`,
  });
  await migrator.connect();
  try {
    const migrations = await migrator.query(
      `SELECT migration_name FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    );
    assert.equal(migrations.rowCount, 4, "all four committed migrations must be applied");
    const hardeningSql = await readFile("docs/runbooks/postgresql-runtime-hardening.sql", "utf8");
    await migrator.query(hardeningSql.replace(/^\\set ON_ERROR_STOP on\s*/m, ""));
  } finally {
    await migrator.end();
  }

  await verifyRuntimeRole(port);
  console.log("Fresh split-role database smoke passed: roles, 4 migrations, CRUD, and DDL denials verified.");
} finally {
  run("docker", [...composeArgs, "down", "--volumes", "--remove-orphans"], {
    env: smokeEnv,
  });
}
