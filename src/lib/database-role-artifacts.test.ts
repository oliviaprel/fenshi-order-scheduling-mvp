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
});
