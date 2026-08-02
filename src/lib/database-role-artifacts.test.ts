import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const readProjectFile = (path: string) => readFileSync(resolve(path), "utf8");

describe("database role deployment artifacts", () => {
  it("supplies the migration URL to every Prisma build or deployment command", () => {
    const ci = readProjectFile(".github/workflows/ci.yml");
    const dockerfile = readProjectFile("Dockerfile");
    const readme = readProjectFile("README.md");
    const backupRunbook = readProjectFile("docs/runbooks/backup-and-restore.md");
    const incidentRunbook = readProjectFile("docs/runbooks/incident-response.md");

    expect(ci).toMatch(
      /- run: npm run prisma:generate\r?\n\s+env:\r?\n\s+MIGRATION_DATABASE_URL:/,
    );
    expect(dockerfile).toMatch(
      /PRISMA_GENERATE_NO_ENGINE=1 MIGRATION_DATABASE_URL=.* npx prisma generate/,
    );
    expect(readme).toContain("MIGRATION_DATABASE_URL");
    expect(backupRunbook).toContain("MIGRATION_DATABASE_URL");
    expect(backupRunbook).not.toMatch(/DATABASE_URL="\$RESTORE_OPERATIONS_DATABASE_URL" npx prisma/);
    expect(incidentRunbook).toContain("MIGRATION_DATABASE_URL");
    expect(incidentRunbook).not.toMatch(/DATABASE_URL="\$OPERATIONS_DATABASE_URL" npx prisma/);
  });

  it("revokes both permanent and temporary schema creation from the app role", () => {
    const roleRunbook = readProjectFile("docs/runbooks/postgresql-roles.sql");

    expect(roleRunbook).toMatch(/REVOKE CREATE ON SCHEMA public FROM PUBLIC;/);
    expect(roleRunbook).toMatch(/REVOKE TEMPORARY ON DATABASE .* FROM PUBLIC/);
    expect(roleRunbook).toMatch(/GRANT USAGE, CREATE ON SCHEMA public TO fenshi_migrator;/);
    expect(roleRunbook).toMatch(/GRANT USAGE ON SCHEMA public TO fenshi_app;/);
  });

  it("declares a localhost-only split-role database and a real smoke gate", () => {
    const compose = readProjectFile("compose.dev.yaml");
    const exampleEnv = readProjectFile(".env.example");
    const packageJson = JSON.parse(readProjectFile("package.json")) as {
      scripts?: Record<string, string>;
    };
    const ci = readProjectFile(".github/workflows/ci.yml");
    const localRoleBootstrap = readProjectFile(
      "docker/postgres/init-local-database-roles.sql",
    );

    expect(compose).toContain('"127.0.0.1:${POSTGRES_PORT:-5432}:5432"');
    expect(compose).toContain(
      "./docker/postgres/init-local-database-roles.sql:/docker-entrypoint-initdb.d/01-init-local-database-roles.sql:ro",
    );
    expect(exampleEnv).toContain(
      "DATABASE_URL=postgresql://fenshi_app:fenshi_app_dev@localhost:5432/fenshi",
    );
    expect(exampleEnv).toContain(
      "MIGRATION_DATABASE_URL=postgresql://fenshi_migrator:fenshi_migrator_dev@localhost:5432/fenshi",
    );
    expect(localRoleBootstrap).toContain("PASSWORD 'fenshi_migrator_dev'");
    expect(localRoleBootstrap).toContain("PASSWORD 'fenshi_app_dev'");
    expect(localRoleBootstrap).toContain(
      "ALTER DEFAULT PRIVILEGES FOR ROLE fenshi_migrator IN SCHEMA public",
    );
    expect(packageJson.scripts?.["test:database-roles"]).toBe(
      "node scripts/verify-local-database-roles.mjs",
    );
    expect(ci).toMatch(/id: database_role_smoke\r?\n\s+run: npm run test:database-roles/);
    expect(ci).toMatch(/POSTGRES_PORT: ['"]?55432['"]?/);
  });

  it("uses the network-resilient Docker install while retaining an independent audit gate", () => {
    const dockerfile = readProjectFile("Dockerfile");
    const ci = readProjectFile(".github/workflows/ci.yml");

    expect(dockerfile).toContain(
      "RUN npm ci --no-audit --maxsockets=5 --loglevel=verbose",
    );
    expect(dockerfile).not.toMatch(/npm ci .*--ignore-scripts/);
    expect(ci).toContain("npm audit --omit=dev --audit-level=high");
  });
});
